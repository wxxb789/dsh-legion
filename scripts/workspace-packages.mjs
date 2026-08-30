import { globSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { load } from 'js-yaml'

const dependencyGroups = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
]

/** Read every package manifest selected by pnpm-workspace.yaml in dependency order. */
export function readWorkspacePackages(root) {
  const workspaceRoot = resolve(root)
  const policy = load(readFileSync(join(workspaceRoot, 'pnpm-workspace.yaml'), 'utf8'))
  if (typeof policy !== 'object' || policy === null || !Array.isArray(policy.packages)) {
    throw new Error('pnpm-workspace.yaml must declare a packages array')
  }
  const manifestPaths = [...new Set(policy.packages.flatMap(pattern => {
    if (typeof pattern !== 'string' || pattern.trim() === '') {
      throw new Error('pnpm-workspace.yaml contains an invalid package pattern')
    }
    const normalized = pattern.replaceAll('\\', '/').replace(/\/$/u, '')
    const manifestPattern = normalized === '.' ? 'package.json' : `${normalized}/package.json`
    return globSync(manifestPattern, { cwd: workspaceRoot })
      .map(path => resolve(workspaceRoot, path))
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

export function workspaceDependencyGroups() {
  return [...dependencyGroups]
}
