import { createHash } from 'node:crypto'
import {
  copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile,
} from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { runNativeCommand } from './native-command.mjs'
import { readPackedPackageSet } from './package-set.mjs'
import { resolveNpmRegistry } from './registry-config.mjs'
import { trustedTempRoot } from './trusted-temp-root.mjs'
import { readWorkspacePackages, resolveWorkspaceInstalledPackage } from './workspace-packages.mjs'

const projectRoot = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'))
const publicContract = JSON.parse(await readFile(join(projectRoot, 'contracts', 'v1.json'), 'utf8'))
const compatibilityPolicy = JSON.parse(await readFile(
  join(projectRoot, 'contracts', 'compatibility.json'),
  'utf8',
))
const compatibilityChannels = {
  minimum: compatibilityPolicy.minimumDshVersion,
  'latest-tested': compatibilityPolicy.latestTestedDshVersion,
  'peer-range': compatibilityPolicy.dshPeerRange,
}
const requestedChannel = process.env.DSH_VERSION_CHANNEL
if (process.env.DSH_VERSION !== undefined && requestedChannel !== undefined) {
  throw new Error('DSH_VERSION and DSH_VERSION_CHANNEL cannot be combined')
}
if (requestedChannel !== undefined && !Object.hasOwn(compatibilityChannels, requestedChannel)) {
  throw new Error(`unknown DSH compatibility channel ${JSON.stringify(requestedChannel)}`)
}
// Every named channel comes from the compatibility contract, so CI never carries
// a second version literal that can drift from the package claim.
const dshVersionSpec = process.env.DSH_VERSION
  ?? compatibilityChannels[requestedChannel ?? 'minimum']
const dshRegistry = resolveNpmRegistry(projectRoot)
const cordisVersion = manifest.devDependencies?.['@deepseek-ai/cordis']
if (typeof cordisVersion !== 'string' || !/^\d+\.\d+\.\d+$/u.test(cordisVersion)) {
  throw new Error('package.json must pin one exact @deepseek-ai/cordis development version')
}
const canonicalTempRoot = trustedTempRoot()
const sandboxRoot = await mkdtemp(join(canonicalTempRoot, 'dsh-legion-packed-delegation-'))
const relativeSandbox = relative(canonicalTempRoot, resolve(sandboxRoot))
if (relativeSandbox.startsWith('..') || relativeSandbox === '') {
  throw new Error(`refusing to use unexpected temporary path: ${sandboxRoot}`)
}

const run = (program, args, cwd) => {
  runNativeCommand(program, args, cwd)
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
    `--registry=${dshRegistry}`,
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
  const workspacePackages = readWorkspacePackages(projectRoot)
  const suppliedTarballs = [
    process.env.DSH_LEGION_RECEIPTS_TARBALL,
    process.env.DSH_LEGION_TARBALL,
  ]
  if (suppliedTarballs.every(value => value === undefined)) {
    for (const workspacePackage of workspacePackages) {
      run('pnpm', [
        '--dir', workspacePackage.directory,
        '--config.ignore-scripts=true',
        'pack',
        '--pack-destination', packDir,
      ], projectRoot)
    }
  } else {
    if (suppliedTarballs.some(value => value === undefined)) {
      throw new Error('supplied packed delegation requires both root and companion tarballs')
    }
    for (const suppliedTarball of suppliedTarballs) {
      await copyFile(resolve(suppliedTarball), join(packDir, basename(suppliedTarball)))
    }
  }
  const packageSet = readPackedPackageSet(packDir, workspacePackages)
  const rootArtifact = packageSet.find(item => item.name === manifest.name)
  const companionArtifact = packageSet.find(item => item.name === 'dsh-legion-receipts')
  if (rootArtifact === undefined || companionArtifact === undefined
    || rootArtifact.manifest.dependencies?.[companionArtifact.name] !== companionArtifact.version) {
    throw new Error('packed delegation requires one exact dsh-legion package pair')
  }
  const dshVersion = resolveDshVersion(dshVersionSpec)
  process.stdout.write(`testing packed delegation against DSH ${dshVersion}\n`)
  // Pinning only the direct dependencies is not enough to hold one generation.
  // Each DSH package depends on its siblings through a caret range, so as soon
  // as a newer prerelease exists on the registry every transitive edge slides
  // forward and the minimum channel silently installs a mixed closure. The
  // declared package closure is exactly the set that has to be held down.
  const dshPackageNames = [...new Set([
    ...compatibilityPolicy.registryInstallPackageClosure,
    ...compatibilityPolicy.dshPackageClosure,
  ])].sort()
  const companionSpec = `file:${relative(consumerDir, companionArtifact.tarball).replaceAll('\\', '/')}`
  const overrides = Object.fromEntries([
    ...dshPackageNames.map(name => [`@deepseek-ai/${name}`, dshVersion]),
    [companionArtifact.name, companionSpec],
  ])
  await writeFile(join(consumerDir, 'package.json'), JSON.stringify({
    name: 'dsh-legion-packed-delegation-consumer',
    private: true,
    type: 'module',
  }, null, 2) + '\n')
  // pnpm 11 no longer reads the "pnpm" field in package.json, so overrides
  // belong here or they are silently ignored.
  await writeFile(join(consumerDir, 'pnpm-workspace.yaml'), [
    "packages:",
    "  - '.'",
    '',
    'allowBuilds:',
    '  esbuild: true',
    '  koffi: true',
    '',
    'overrides:',
    ...Object.entries(overrides).map(([name, version]) => `  '${name}': '${version}'`),
    '',
  ].join('\n'))

  const dshPackages = dshPackageNames.map(name => `@deepseek-ai/${name}@${dshVersion}`)
  let dshDependencies
  if (process.env.DSH_LEGION_OFFLINE === '1') {
    const nodeModules = join(consumerDir, 'node_modules')
    await mkdir(join(nodeModules, '@deepseek-ai'), { recursive: true })
    const packages = [
      '@deepseek-ai/cordis',
      ...dshPackages.map(specifier => specifier.slice(0, specifier.lastIndexOf('@'))),
      '@deepseek-ai/schemastery',
      'js-yaml',
      'zod',
    ]
    for (const packageName of packages) {
      const source = resolveWorkspaceInstalledPackage(
        projectRoot,
        workspacePackages,
        packageName,
        packageName.startsWith('@deepseek-ai/dsh-') ? dshVersion : undefined,
      )
      const target = join(nodeModules, packageName)
      await mkdir(dirname(target), { recursive: true })
      await symlink(source, target, 'junction')
    }
    for (const artifact of [companionArtifact, rootArtifact]) {
      const target = join(nodeModules, artifact.name)
      await mkdir(target, { recursive: true })
      run('tar', ['-xzf', artifact.tarball, '-C', target, '--strip-components=1'], consumerDir)
    }
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
      `--registry=${dshRegistry}`,
      companionArtifact.tarball,
      rootArtifact.tarball,
      `@deepseek-ai/cordis@${cordisVersion}`,
      ...dshPackages,
    ], consumerDir)
    dshDependencies = await verifyDshGeneration(consumerDir, dshVersion)
  }
  runNode([
    join('node_modules', 'dsh-legion', 'scripts', 'verify-public-contract.mjs'),
  ], consumerDir)

  await copyFile(
    join(projectRoot, 'tests', 'fixtures', 'packed-legacy-consumer.ts'),
    join(consumerDir, 'packed-legacy-consumer.ts'),
  )
  await writeFile(join(consumerDir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2024',
      lib: ['ES2024', 'DOM', 'ESNext.Disposable'],
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      skipLibCheck: false,
      outDir: 'compiled',
    },
    include: ['packed-legacy-consumer.ts'],
  }, null, 2) + '\n')
  run(process.execPath, [
    join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
    '--project', 'tsconfig.json',
  ], consumerDir)
  runNode([join('compiled', 'packed-legacy-consumer.js')], consumerDir)

  await copyFile(
    join(projectRoot, 'scripts', 'packed-delegation-consumer.mjs'),
    join(consumerDir, 'packed-delegation-consumer.mjs'),
  )
  runNode(['packed-delegation-consumer.mjs'], consumerDir)
  const receiptPath = process.env.DSH_COMPATIBILITY_RECEIPT || undefined
  if (receiptPath !== undefined) {
    const installedPackages = await Promise.all(packageSet.map(async artifact => {
      const installedManifest = JSON.parse(await readFile(
        join(consumerDir, 'node_modules', artifact.name, 'package.json'),
        'utf8',
      ))
      if (installedManifest.version !== artifact.version) {
        throw new Error(`packed consumer installed ${artifact.name}@${String(installedManifest.version)} instead of ${artifact.version}`)
      }
      return {
        name: artifact.name,
        version: installedManifest.version,
        tarballFile: artifact.tarballFile,
        tarballSha256: artifact.tarballSha256,
      }
    }))
    const consumerLockfile = await readFile(join(consumerDir, 'pnpm-lock.yaml'))
    const consumerLockfileSha256 = createHash('sha256').update(consumerLockfile).digest('hex')
    const lockfilePath = resolve(receiptPath.replace(/\.json$/, '.lock.yaml'))
    await writeFile(lockfilePath, consumerLockfile)
    await writeFile(resolve(receiptPath), JSON.stringify({
      schemaVersion: publicContract.compatibilityReceiptVersion,
      matrixSlot: `${process.platform}-${requestedChannel ?? 'minimum'}-${process.version.slice(1)}`,
      requestedDshVersion: dshVersionSpec,
      resolvedDshVersion: dshVersion,
      platform: process.platform,
      nodeVersion: process.version,
      packages: installedPackages.sort((left, right) => left.name.localeCompare(right.name)),
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
