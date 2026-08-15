import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'))
const publicContract = JSON.parse(await readFile(join(projectRoot, 'contracts', 'v1.json'), 'utf8'))
const dshVersionSpec = process.env.DSH_VERSION ?? '0.1.0-rc.6'
const sandboxRoot = await mkdtemp(join(tmpdir(), 'dsh-legion-packed-delegation-'))
const canonicalTempRoot = await realpath(tmpdir())
const canonicalSandboxRoot = await realpath(sandboxRoot)
const relativeSandbox = relative(canonicalTempRoot, canonicalSandboxRoot)
if (relativeSandbox.startsWith('..') || relativeSandbox === '') {
  throw new Error(`refusing to use unexpected temporary path: ${sandboxRoot}`)
}

const run = (program, args, cwd) => {
  const command = process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : program
  const commandArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', program, ...args]
    : args
  const result = spawnSync(command, commandArgs, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${program} ${args.join(' ')} failed with exit code ${String(result.status)}`)
  }
}

const resolveDshVersion = (specifier) => {
  if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(specifier)) return specifier
  if (process.platform === 'win32') {
    throw new Error('range-based DSH compatibility resolution runs in the Ubuntu CI matrix')
  }
  const result = spawnSync('npm', [
    'view',
    `@deepseek-ai/dsh-agent@${specifier}`,
    'version',
    '--json',
    '--registry=https://registry.npmjs.org',
  ], { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`failed to resolve DSH compatibility version: ${result.stderr}`)
  }
  const value = JSON.parse(result.stdout)
  const versions = Array.isArray(value) ? value : [value]
  const resolved = versions.at(-1)
  if (typeof resolved !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(resolved)) {
    throw new Error(`registry returned an invalid DSH version for ${specifier}`)
  }
  return resolved
}

const verifyDshGeneration = async (consumerDir, expected) => {
  const store = join(consumerDir, 'node_modules', '.pnpm')
  const entries = await readdir(store, { withFileTypes: true })
  const observed = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const scopeRoot = join(store, entry.name, 'node_modules', '@deepseek-ai')
    let names
    try {
      names = await readdir(scopeRoot)
    } catch {
      continue
    }
    for (const name of names.filter(value => value.startsWith('dsh-'))) {
      const manifest = JSON.parse(await readFile(join(scopeRoot, name, 'package.json'), 'utf8'))
      if (typeof manifest.version === 'string') observed.push({ name, version: manifest.version })
    }
  }
  if (observed.length === 0) throw new Error('packed consumer installed no DSH packages')
  const mismatched = observed.filter(item => item.version !== expected)
  if (mismatched.length > 0) {
    throw new Error(
      `packed consumer mixed DSH generations: expected ${expected}, found `
      + mismatched.map(item => `${item.name}@${item.version}`).join(', '),
    )
  }
  process.stdout.write(`verified one DSH dependency generation (${expected}) across ${String(observed.length)} entries\n`)
  return [...new Map(observed.map(item => [item.name, item])).values()]
    .sort((left, right) => left.name.localeCompare(right.name))
}

const runNode = (args, cwd) => {
  const result = spawnSync(process.execPath, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, DSH_LEGION_PACKED_CONSUMER: '1' },
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`node ${args.join(' ')} failed with exit code ${String(result.status)}`)
  }
}

try {
  const packDir = join(sandboxRoot, 'pack')
  const consumerDir = join(sandboxRoot, 'consumer')
  await mkdir(packDir, { recursive: true })
  await mkdir(consumerDir, { recursive: true })
  const tarball = join(packDir, `dsh-legion-${String(manifest.version)}.tgz`)
  const suppliedTarball = process.env.DSH_LEGION_TARBALL
  if (suppliedTarball === undefined) {
    run('npm', ['pack', '--ignore-scripts', '--pack-destination', packDir], projectRoot)
  } else {
    await copyFile(resolve(suppliedTarball), tarball)
  }

  await writeFile(join(consumerDir, 'package.json'), JSON.stringify({
    name: 'dsh-legion-packed-delegation-consumer',
    private: true,
    type: 'module',
  }, null, 2) + '\n')
  await writeFile(join(consumerDir, 'pnpm-workspace.yaml'), [
    "packages:",
    "  - '.'",
    '',
    'allowBuilds:',
    '  koffi: true',
    '',
  ].join('\n'))

  const dshVersion = resolveDshVersion(dshVersionSpec)
  process.stdout.write(`testing packed delegation against DSH ${dshVersion}\n`)
  const dshPackages = [
    '@deepseek-ai/dsh-agent',
    '@deepseek-ai/dsh-agent-loop',
    '@deepseek-ai/dsh-agent-loop-testkit',
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-session',
    '@deepseek-ai/dsh-session-persistence-jsonl',
    '@deepseek-ai/dsh-subagent',
    '@deepseek-ai/dsh-subagent-spawn-in-process',
    '@deepseek-ai/dsh-system-prompt',
    '@deepseek-ai/dsh-tools',
  ].map(name => `${name}@${dshVersion}`)
  run('pnpm', [
    'add',
    '--save-exact',
    '--registry=https://registry.npmjs.org',
    tarball,
    '@deepseek-ai/cordis@4.0.1',
    ...dshPackages,
  ], consumerDir)
  const dshDependencies = await verifyDshGeneration(consumerDir, dshVersion)

  await copyFile(
    join(projectRoot, 'scripts', 'packed-delegation-consumer.mjs'),
    join(consumerDir, 'packed-delegation-consumer.mjs'),
  )
  runNode(['packed-delegation-consumer.mjs'], consumerDir)
  const receiptPath = process.env.DSH_COMPATIBILITY_RECEIPT
  if (receiptPath !== undefined) {
    const tarballSha256 = createHash('sha256').update(await readFile(tarball)).digest('hex')
    const installedManifest = JSON.parse(await readFile(
      join(consumerDir, 'node_modules', 'dsh-legion', 'package.json'),
      'utf8',
    ))
    const consumerLockfile = await readFile(join(consumerDir, 'pnpm-lock.yaml'))
    const consumerLockfileSha256 = createHash('sha256').update(consumerLockfile).digest('hex')
    const lockfilePath = resolve(receiptPath.replace(/\.json$/, '.lock.yaml'))
    await writeFile(lockfilePath, consumerLockfile)
    await writeFile(resolve(receiptPath), JSON.stringify({
      schemaVersion: publicContract.compatibilityReceiptVersion,
      requestedDshVersion: dshVersionSpec,
      resolvedDshVersion: dshVersion,
      nodeVersion: process.version,
      packageVersion: installedManifest.version,
      tarballSha256: `sha256:${tarballSha256}`,
      consumerLockfileFile: basename(lockfilePath),
      consumerLockfileSha256: `sha256:${consumerLockfileSha256}`,
      dshDependencies,
      status: 'passed',
    }, null, 2) + '\n')
  }
} finally {
  await rm(sandboxRoot, { recursive: true, force: true })
}
