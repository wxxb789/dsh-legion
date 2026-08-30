import { globSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

const dependencyGroups = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
]

const packagePattern = source => {
  if (source.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/u.test(source)) throw new Error('pnpm-workspace.yaml contains invalid package quoting')
    return source.slice(1, -1).replaceAll("''", "'")
  }
  if (source.startsWith('"')) {
    let value
    try { value = JSON.parse(source) } catch { throw new Error('pnpm-workspace.yaml contains invalid package quoting') }
    if (typeof value !== 'string') throw new Error('pnpm-workspace.yaml contains an invalid package pattern')
    return value
  }
  if (!/^[A-Za-z0-9_./*+-]+$/u.test(source)) {
    throw new Error('pnpm-workspace.yaml contains an unsupported package pattern')
  }
  return source
}

// The source installer runs before dependencies exist, so parse only the simple
// top-level block list this repository owns and reject every other YAML shape.
const packagePatterns = source => {
  const lines = source.split(/\r?\n/u)
  const starts = lines.flatMap((line, index) => line === 'packages:' ? [index] : [])
  if (starts.length !== 1) throw new Error('pnpm-workspace.yaml must declare one packages block list')
  const patterns = []
  for (const line of lines.slice(starts[0] + 1)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    if (/^\S/u.test(line)) break
    const match = /^  - (\S(?:.*\S)?)\s*$/u.exec(line)
    if (match === null) throw new Error(`pnpm-workspace.yaml contains an invalid packages entry: ${line}`)
    patterns.push(packagePattern(match[1]))
  }
  if (patterns.length === 0) throw new Error('pnpm-workspace.yaml must declare at least one package pattern')
  return patterns
}

/** Read every package manifest selected by pnpm-workspace.yaml in dependency order. */
export function readWorkspacePackages(root) {
  const workspaceRoot = realpathSync(resolve(root))
  const patterns = packagePatterns(readFileSync(join(workspaceRoot, 'pnpm-workspace.yaml'), 'utf8'))
  const manifestPaths = [...new Set(patterns.flatMap(pattern => {
    if (typeof pattern !== 'string' || pattern.trim() === '') {
      throw new Error('pnpm-workspace.yaml contains an invalid package pattern')
    }
    const normalized = pattern.replaceAll('\\', '/').replace(/\/$/u, '')
    if (/^(?:[A-Za-z]:|\/)/u.test(normalized) || normalized.split('/').includes('..')) {
      throw new Error(`pnpm-workspace.yaml package pattern escapes the workspace: ${pattern}`)
    }
    const manifestPattern = normalized === '.' ? 'package.json' : `${normalized}/package.json`
    return globSync(manifestPattern, { cwd: workspaceRoot }).map(path => {
      const manifestPath = realpathSync(resolve(workspaceRoot, path))
      const relativePath = relative(workspaceRoot, manifestPath)
      if (isAbsolute(relativePath) || /^\.\.(?:[\\/]|$)/u.test(relativePath)) {
        throw new Error(`pnpm-workspace.yaml package manifest escapes the workspace: ${path}`)
      }
      return manifestPath
    })
  }))]
  const packages = manifestPaths.map(manifestPath => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (typeof manifest.name !== 'string' || manifest.name === ''
      || typeof manifest.version !== 'string' || manifest.version === '') {
      throw new Error(`${relative(workspaceRoot, manifestPath)} must declare package name and version`)
    }
    const directory = dirname(manifestPath)
    return {
      name: manifest.name,
      version: manifest.version,
      manifest,
      manifestPath,
      directory,
      relativeDirectory: relative(workspaceRoot, directory).replaceAll('\\', '/') || '.',
    }
  })
  const byName = new Map(packages.map(item => [item.name, item]))
  if (byName.size !== packages.length) throw new Error('workspace package names must be unique')

  const ordered = []
  const visiting = new Set()
  const visited = new Set()
  const visit = item => {
    if (visited.has(item.name)) return
    if (visiting.has(item.name)) throw new Error(`workspace dependency cycle includes ${item.name}`)
    visiting.add(item.name)
    for (const group of dependencyGroups) {
      for (const name of Object.keys(item.manifest[group] ?? {}).sort()) {
        const dependency = byName.get(name)
        if (dependency !== undefined) visit(dependency)
      }
    }
    visiting.delete(item.name)
    visited.add(item.name)
    ordered.push(item)
  }
  for (const item of [...packages].sort((left, right) => left.name.localeCompare(right.name))) visit(item)
  return ordered
}

function installedPackage(candidate, expectedVersion) {
  let directory
  try {
    directory = realpathSync(candidate)
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return undefined
    throw error
  }
  if (expectedVersion === undefined) return directory
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  return manifest.version === expectedVersion ? directory : undefined
}

/** Resolve one installed package from a workspace importer or pnpm's isolated store. */
export function resolveWorkspaceInstalledPackage(root, workspacePackages, packageName, expectedVersion) {
  if (!/^(?:@[^/]+\/)?[^/]+$/u.test(packageName) || packageName.split('/').includes('..')) {
    throw new Error(`invalid installed package name: ${packageName}`)
  }
  const workspaceRoot = realpathSync(resolve(root))
  for (const directory of [workspaceRoot, ...workspacePackages.map(item => item.directory)]) {
    const installed = installedPackage(join(directory, 'node_modules', packageName), expectedVersion)
    if (installed !== undefined) return installed
  }
  const store = join(workspaceRoot, 'node_modules', '.pnpm')
  let entries
  try {
    entries = readdirSync(store).sort()
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') entries = []
    else throw error
  }
  for (const entry of entries) {
    const installed = installedPackage(join(store, entry, 'node_modules', packageName), expectedVersion)
    if (installed !== undefined) return installed
  }
  throw new Error(`installed package ${packageName}${expectedVersion === undefined ? '' : `@${expectedVersion}`} was not found in the workspace`)
}

export function workspaceDependencyGroups() {
  return [...dependencyGroups]
}
