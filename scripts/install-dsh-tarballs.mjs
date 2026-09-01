#!/usr/bin/env node
/**
 * Install the assessed DSH source tarball closure without resolving DSH on npm.
 * Temporary manifest, workspace, and registry rewrites are restored before exit;
 * the committed lockfile remains the separate distribution-install contract.
 */
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { runNativeCommand } from './native-command.mjs'
import { resolveNpmRegistry } from './registry-config.mjs'
import { restoreProjectFiles } from './source-install-restore.mjs'
import { readWorkspacePackages, workspaceDependencyGroups } from './workspace-packages.mjs'

const projectRoot = resolve(import.meta.dirname, '..')
const { values } = parseArgs({
  options: {
    from: { type: 'string' },
    policy: { type: 'string' },
    registry: { type: 'string' },
  },
  allowPositionals: false,
})
if (values.from === undefined) throw new Error('usage: install-dsh-tarballs.mjs --from <directory> [--policy <pnpm-workspace.yaml>] [--registry <url>]')
const registry = resolveNpmRegistry(projectRoot, values.registry)
const tarballRoot = resolve(projectRoot, values.from)
const defaultPolicy = join(tarballRoot, 'dsh-pnpm-workspace.yaml')
const policyPath = resolve(projectRoot, values.policy ?? defaultPolicy)
let policySource
try {
  policySource = readFileSync(policyPath, 'utf8')
} catch (error) {
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
    throw new Error('DSH source build policy is required; pass --policy <pnpm-workspace.yaml>', { cause: error })
  }
  throw error
}

function capture(program, args) {
  const result = spawnSync(program, args, { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${program} ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

function run(program, args) {
  runNativeCommand(program, args, projectRoot)
}

const isDshPackage = name => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')
function booleanMapBlock(source, key, sourceLabel) {
  const lines = source.split(/\r?\n/)
  const start = lines.findIndex(line => line === `${key}:`)
  if (start === -1) throw new Error(`${sourceLabel} has no ${key} block`)
  const values = new Map()
  let end = start + 1
  for (; end < lines.length; end += 1) {
    const line = lines[end]
    if (/^[^ #]/.test(line)) break
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) continue
    const match = /^  (.*?): (true|false)$/.exec(line)
    if (match === null) throw new Error(`${sourceLabel} has an invalid ${key} entry: ${line}`)
    const name = match[1].replace(/^['"]|['"]$/g, '')
    values.set(name, match[2] === 'true')
  }
  return { values, without: [...lines.slice(0, start), ...lines.slice(end)].join('\n').trimEnd() }
}

const tarballs = new Map()
for (const filename of readdirSync(tarballRoot).filter(name => name.endsWith('.tgz')).sort()) {
  const tarball = join(tarballRoot, filename)
  const manifest = JSON.parse(capture('tar', ['-xOzf', tarball, 'package/package.json']))
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
    throw new Error(`${filename} has no package name/version`)
  }
  if (tarballs.has(manifest.name)) throw new Error(`duplicate packed package ${manifest.name}`)
  const specFor = directory => `file:${relative(directory, tarball).replaceAll('\\', '/')}`
  tarballs.set(manifest.name, { version: manifest.version, specFor, manifest })
}
if (tarballs.size === 0) throw new Error(`${tarballRoot} contains no npm tarballs`)

const workspacePath = join(projectRoot, 'pnpm-workspace.yaml')
const lockPath = join(projectRoot, 'pnpm-lock.yaml')
const npmrcPath = join(projectRoot, '.npmrc')
const workspaceSource = readFileSync(workspacePath, 'utf8')
const lockSource = readFileSync(lockPath, 'utf8')
const npmrcSource = readFileSync(npmrcPath, 'utf8')
const workspacePackages = readWorkspacePackages(projectRoot)
const manifestSources = new Map(workspacePackages.map(item => [
  item.manifestPath,
  readFileSync(item.manifestPath, 'utf8'),
]))
const compatibility = JSON.parse(readFileSync(join(projectRoot, 'contracts', 'compatibility.json'), 'utf8'))
const direct = new Set()
for (const workspacePackage of workspacePackages) {
  for (const group of workspaceDependencyGroups()) {
    for (const [name, expected] of Object.entries(workspacePackage.manifest[group] ?? {})) {
      if (!isDshPackage(name)) continue
      const packed = tarballs.get(name)
      if (packed === undefined) {
        throw new Error(`DSH tarballs do not provide ${workspacePackage.name} ${group} dependency ${name}`)
      }
      if (packed.version !== compatibility.latestTestedDshVersion
        || (group === 'devDependencies' && packed.version !== expected)) {
        throw new Error(`${name} tarball version ${packed.version} does not match ${workspacePackage.name} ${group} declaration ${expected}`)
      }
      direct.add(name)
      workspacePackage.manifest[group][name] = packed.specFor(workspacePackage.directory)
    }
  }
}
const declaredClosure = compatibility.dshPackageClosure
if (!Array.isArray(declaredClosure)
  || declaredClosure.some(name => typeof name !== 'string' || !/^dsh-[a-z0-9-]+$/u.test(name))) {
  throw new Error('compatibility policy has an invalid DSH package closure')
}
const closure = new Set()
const queue = [
  ...direct,
  ...declaredClosure.map(name => `@deepseek-ai/${name}`),
]
while (queue.length > 0) {
  const name = queue.shift()
  if (closure.has(name)) continue
  const packed = tarballs.get(name)
  if (packed === undefined) throw new Error(`DSH tarballs do not provide dependency ${name}`)
  if (packed.version !== compatibility.latestTestedDshVersion) {
    throw new Error(`${name} tarball version ${packed.version} is outside the assessed DSH generation`)
  }
  closure.add(name)
  const optionalPeers = packed.manifest.peerDependenciesMeta ?? {}
  const dependencies = {
    ...(packed.manifest.dependencies ?? {}),
    ...(packed.manifest.peerDependencies ?? {}),
    ...(packed.manifest.optionalDependencies ?? {}),
  }
  for (const dependency of Object.keys(dependencies)) {
    if (isDshPackage(dependency) && optionalPeers[dependency]?.optional !== true) queue.push(dependency)
  }
}
// Overrides pin referenced packages but do not materialize optional peer type
// faces. Add the declared closure as temporary root dev dependencies so the
// offline packed consumer can compile every published declaration it exposes.
const rootPackage = workspacePackages.find(item => item.relativeDirectory === '.')
if (rootPackage === undefined) throw new Error('workspace has no root package')
rootPackage.manifest.devDependencies ??= {}
for (const name of closure) {
  if (direct.has(name)) continue
  rootPackage.manifest.devDependencies[name] = tarballs.get(name).specFor(rootPackage.directory)
}
if (/^overrides:/m.test(workspaceSource)) throw new Error('source install refuses to replace existing pnpm overrides')
const policyBuilds = booleanMapBlock(policySource, 'allowBuilds', policyPath)
const workspaceBuilds = booleanMapBlock(workspaceSource, 'allowBuilds', workspacePath)
const allowBuilds = new Map()
for (const [selector, allowed] of policyBuilds.values) {
  const fileMarker = selector.indexOf('@file:')
  const name = fileMarker === -1 ? selector : selector.slice(0, fileMarker)
  const packed = tarballs.get(name)
  const rootSpec = packed?.specFor(projectRoot)
  allowBuilds.set(fileMarker === -1 || rootSpec === undefined ? selector : `${name}@${rootSpec}`, allowed)
}
for (const [name, allowed] of workspaceBuilds.values) allowBuilds.set(name, allowed)
const buildPolicy = [...allowBuilds].sort(([left], [right]) => left.localeCompare(right))
  .map(([name, allowed]) => `  ${JSON.stringify(name)}: ${String(allowed)}`)
const overrides = [...closure].sort().map(name => [name, tarballs.get(name)])
  .map(([name, packed]) => `  ${JSON.stringify(name)}: ${JSON.stringify(packed.specFor(projectRoot))}`)
const workspaceWithOverrides = `${workspaceBuilds.without}

allowBuilds:
${buildPolicy.join('\n')}

overrides:
${overrides.join('\n')}
`

let installError
try {
  for (const workspacePackage of workspacePackages) {
    writeFileSync(workspacePackage.manifestPath, `${JSON.stringify(workspacePackage.manifest, null, 2)}\n`)
  }
  writeFileSync(workspacePath, workspaceWithOverrides)
  writeFileSync(npmrcPath, `registry=${registry}/\n`)
  rmSync(lockPath)
  run('pnpm', ['install', '--no-frozen-lockfile', '--lockfile=false', `--registry=${registry}`])
} catch (error) {
  installError = error
}

const originals = [
  ...workspacePackages.map(item => [item.manifestPath, manifestSources.get(item.manifestPath)]),
  [workspacePath, workspaceSource],
  [lockPath, lockSource],
  [npmrcPath, npmrcSource],
]
restoreProjectFiles(originals, installError)
console.log(`installed ${String(closure.size)} DSH source package(s) without registry DSH resolution`)
