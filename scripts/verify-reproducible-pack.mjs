import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { runNativeCommand } from './native-command.mjs'
import { readPackedPackageSet, verifyPackedPackageContents } from './package-set.mjs'
import { trustedTempRoot } from './trusted-temp-root.mjs'
import { readWorkspacePackages } from './workspace-packages.mjs'

const root = resolve(import.meta.dirname, '..')
const arguments_ = process.argv.slice(2).filter(argument => argument !== '--')
const sourceMode = arguments_.find(argument => argument.startsWith('--source='))?.slice(9)
  ?? 'workspace'
if (!['git', 'workspace'].includes(sourceMode)) {
  throw new Error(`unsupported reproducible-pack source mode: ${sourceMode}`)
}
const outputArgument = arguments_.find(argument => !argument.startsWith('--source='))
const outputDirectory = outputArgument === undefined ? undefined : resolve(outputArgument)
if (outputDirectory !== undefined) {
  await mkdir(outputDirectory, { recursive: true })
  const unexpectedTarballs = (await readdir(outputDirectory)).filter(name => name.endsWith('.tgz')).sort()
  if (unexpectedTarballs.length > 0) {
    throw new Error(`reproducible pack output contains unexpected existing tarball(s): ${unexpectedTarballs.join(', ')}`)
  }
}
const canonicalTempRoot = trustedTempRoot()
const sandbox = await mkdtemp(join(canonicalTempRoot, 'dsh-legion-reproducible-pack-'))
const relativeSandbox = relative(canonicalTempRoot, resolve(sandbox))
if (relativeSandbox.startsWith('..') || relativeSandbox === '') {
  throw new Error(`refusing to use unexpected temporary path: ${sandbox}`)
}

function run(program, args, cwd) {
  runNativeCommand(program, args, cwd)
}

const excludedSegments = new Set(['.git', '.tmp', 'coverage', 'dist', 'lib', 'node_modules'])
const copySource = source => {
  const relativeSource = relative(root, source)
  if (relativeSource === '') return true
  return !relativeSource.split(/[\\/]/u).some(segment => excludedSegments.has(segment))
}
const sourceWorkspacePackages = readWorkspacePackages(root)
const sourceArchive = join(sandbox, 'source.tar')
if (sourceMode === 'git') {
  run('git', ['archive', '--format=tar', '--output', sourceArchive, 'HEAD'], root)
}

try {
  const rounds = []
  for (const round of ['first', 'second']) {
    const roundRoot = join(sandbox, round)
    const packageRoot = join(roundRoot, 'package')
    const destination = join(roundRoot, 'pack')
    await mkdir(roundRoot)
    if (sourceMode === 'git') {
      await mkdir(packageRoot)
      run('tar', ['-xf', sourceArchive, '-C', packageRoot], root)
    } else {
      await cp(root, packageRoot, { recursive: true, filter: copySource })
    }
    await symlink(
      join(root, 'node_modules'),
      join(packageRoot, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    for (const sourcePackage of sourceWorkspacePackages) {
      if (sourcePackage.relativeDirectory === '.') continue
      await symlink(
        join(sourcePackage.directory, 'node_modules'),
        join(packageRoot, sourcePackage.relativeDirectory, 'node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir',
      )
    }
    run('pnpm', ['run', 'build'], packageRoot)
    await mkdir(destination)
    const workspacePackages = readWorkspacePackages(packageRoot)
    for (const workspacePackage of workspacePackages) {
      run('pnpm', [
        '--dir', workspacePackage.directory,
        '--config.ignore-scripts=true',
        'pack',
        '--pack-destination', destination,
      ], packageRoot)
    }
    const packageSet = readPackedPackageSet(destination, workspacePackages)
    for (const item of packageSet) verifyPackedPackageContents(item)
    const rootPackage = packageSet.find(item => item.relativeDirectory === '.')
      ?? packageSet.find(item => item.name === 'dsh-legion')
    const companion = packageSet.find(item => item.name === 'dsh-legion-receipts')
    if (rootPackage === undefined || companion === undefined) {
      throw new Error('reproducible pack requires dsh-legion and dsh-legion-receipts')
    }
    const dependency = rootPackage.manifest.dependencies?.[companion.name]
    if (dependency !== companion.version || String(dependency).startsWith('workspace:')) {
      throw new Error(`packed root must depend on ${companion.name}@${companion.version}, found ${String(dependency)}`)
    }
    rounds.push(packageSet)
  }

  const first = new Map(rounds[0].map(item => [item.name, item]))
  const second = new Map(rounds[1].map(item => [item.name, item]))
  for (const [name, item] of first) {
    const repeated = second.get(name)
    if (repeated?.tarballSha256 !== item.tarballSha256) {
      throw new Error(`reproducible pack mismatch for ${name}: ${item.tarballSha256} != ${String(repeated?.tarballSha256)}`)
    }
  }
  if (outputDirectory !== undefined) {
    for (const item of first.values()) await copyFile(item.tarball, join(outputDirectory, item.tarballFile))
    readPackedPackageSet(outputDirectory, [...first.values()])
  }
  for (const item of [...first.values()].sort((left, right) => left.name.localeCompare(right.name))) {
    process.stdout.write(`verified reproducible package ${item.name}@${item.version} ${item.tarballSha256}\n`)
  }
} finally {
  await rm(sandbox, { recursive: true, force: true })
}
