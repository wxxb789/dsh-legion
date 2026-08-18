import { createHash } from 'node:crypto'
import {
  copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile,
} from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { trustedTempRoot } from './trusted-temp-root.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'))
const publicContract = JSON.parse(await readFile(join(projectRoot, 'contracts', 'v1.json'), 'utf8'))
const compatibilityPolicy = JSON.parse(await readFile(
  join(projectRoot, 'contracts', 'compatibility.json'),
  'utf8',
))
const dshVersionSpec = process.env.DSH_VERSION ?? '0.1.0-rc.6'
const canonicalTempRoot = trustedTempRoot()
const sandboxRoot = await mkdtemp(join(canonicalTempRoot, 'dsh-legion-packed-delegation-'))
const relativeSandbox = relative(canonicalTempRoot, resolve(sandboxRoot))
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

  const dshVersion = resolveDshVersion(dshVersionSpec)
  process.stdout.write(`testing packed delegation against DSH ${dshVersion}\n`)
  // Pinning only the direct dependencies is not enough to hold one generation.
  // Each DSH package depends on its siblings through a caret range, so as soon
  // as a newer prerelease exists on the registry every transitive edge slides
  // forward and the minimum channel silently installs a mixed closure. The
  // declared package closure is exactly the set that has to be held down.
  const overrides = Object.fromEntries(
    compatibilityPolicy.dshPackageClosure.map(name => [`@deepseek-ai/${name}`, dshVersion]),
  )
  await writeFile(join(consumerDir, 'package.json'), JSON.stringify({
    name: 'dsh-legion-packed-delegation-consumer',
    private: true,
    type: 'module',
    pnpm: { overrides },
  }, null, 2) + '\n')
  await writeFile(join(consumerDir, 'pnpm-workspace.yaml'), [
    "packages:",
    "  - '.'",
    '',
    'allowBuilds:',
    '  koffi: true',
    '',
  ].join('\n'))

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
  let dshDependencies
  if (process.env.DSH_LEGION_OFFLINE === '1') {
    const nodeModules = join(consumerDir, 'node_modules')
    await mkdir(join(nodeModules, '@deepseek-ai'), { recursive: true })
    const packages = [
      '@deepseek-ai/cordis',
      ...dshPackages.map(specifier => specifier.slice(0, specifier.lastIndexOf('@'))),
      '@deepseek-ai/schemastery',
      'js-yaml',
    ]
    for (const packageName of packages) {
      const source = await realpath(join(projectRoot, 'node_modules', packageName))
      const target = join(nodeModules, packageName)
      await mkdir(dirname(target), { recursive: true })
      await symlink(source, target, 'junction')
    }
    const legionTarget = join(nodeModules, 'dsh-legion')
    await mkdir(legionTarget, { recursive: true })
    run('tar', ['-xzf', tarball, '-C', legionTarget, '--strip-components=1'], consumerDir)
    dshDependencies = await Promise.all(dshPackages.map(async (specifier) => {
      const name = specifier.slice('@deepseek-ai/'.length, specifier.lastIndexOf('@'))
      const packageManifest = JSON.parse(await readFile(
        join(nodeModules, '@deepseek-ai', name, 'package.json'),
        'utf8',
      ))
      return { name, version: packageManifest.version }
    }))
    process.stdout.write('installed packed consumer from workspace-linked offline dependencies\n')
  } else {
    run('pnpm', [
      'add',
      '--save-exact',
      '--registry=https://registry.npmjs.org',
      tarball,
      '@deepseek-ai/cordis@4.0.1',
      ...dshPackages,
    ], consumerDir)
    dshDependencies = await verifyDshGeneration(consumerDir, dshVersion)
  }
  runNode([
    join('node_modules', 'dsh-legion', 'scripts', 'verify-public-contract.mjs'),
  ], consumerDir)

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
      platform: process.platform,
      nodeVersion: process.version,
      packageVersion: installedManifest.version,
      tarballSha256: `sha256:${tarballSha256}`,
      consumerLockfileFile: basename(lockfilePath),
      consumerLockfileSha256: `sha256:${consumerLockfileSha256}`,
      dshDependencies,
      capabilityMode: 'rc6-replay-only-fail-closed',
      durableMutation: false,
      durableDiagnostics: [
        'LEGION_DURABLE_FLUSH_UNAVAILABLE',
        'LEGION_SESSION_PROJECTION_UNAVAILABLE',
        'LEGION_DURABLE_COORDINATION_UNAVAILABLE',
        'LEGION_GLOBAL_ADMISSION_UNAVAILABLE',
        'LEGION_DURABLE_CHILD_RECEIPT_UNAVAILABLE',
      ],
      status: 'passed',
    }, null, 2) + '\n')
  }
} finally {
  await rm(sandboxRoot, { recursive: true, force: true })
}
