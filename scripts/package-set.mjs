import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, posix } from 'node:path'
import { spawnSync } from 'node:child_process'

export const packageTarballFilename = ({ name, version }) => (
  `${name.replace(/^@/u, '').replaceAll('/', '-')}-${version}.tgz`
)

function captureTar(tarball, flags, member) {
  const args = [flags, tarball, ...(member === undefined ? [] : [member])]
  const result = spawnSync('tar', args, { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`tar ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

export function readPackedPackageSet(directory, workspacePackages) {
  const expected = new Map(workspacePackages.map(item => [item.name, item]))
  const found = new Map()
  for (const tarballFile of readdirSync(directory).filter(name => name.endsWith('.tgz')).sort()) {
    const tarball = join(directory, tarballFile)
    const manifest = JSON.parse(captureTar(tarball, '-xOzf', 'package/package.json'))
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
      throw new Error(`${tarballFile} has no package name/version`)
    }
    if (found.has(manifest.name)) throw new Error(`duplicate packed package ${manifest.name}`)
    const expectedPackage = expected.get(manifest.name)
    if (expectedPackage === undefined) throw new Error(`unexpected packed package ${manifest.name}`)
    if (manifest.version !== expectedPackage.version) {
      throw new Error(`${manifest.name} packed version ${manifest.version} does not match ${expectedPackage.version}`)
    }
    const expectedFilename = packageTarballFilename(manifest)
    if (tarballFile !== expectedFilename) {
      throw new Error(`${manifest.name} tarball must be named ${expectedFilename}, found ${tarballFile}`)
    }
    const files = new Set(captureTar(tarball, '-tzf').split(/\r?\n/u)
      .filter(Boolean)
      .map(path => path.replace(/^package\//u, '')))
    found.set(manifest.name, {
      name: manifest.name,
      version: manifest.version,
      manifest,
      tarball,
      tarballFile,
      tarballSha256: `sha256:${createHash('sha256').update(readFileSync(tarball)).digest('hex')}`,
      files,
    })
  }
  const missing = [...expected.keys()].filter(name => !found.has(name))
  if (missing.length > 0) throw new Error(`missing packed package(s): ${missing.join(', ')}`)
  if (found.size !== expected.size) {
    throw new Error(`packed package set has ${String(found.size)} packages; expected ${String(expected.size)}`)
  }
  return workspacePackages.map(item => found.get(item.name))
}

function exportedFiles(manifest) {
  const files = []
  const collect = value => {
    if (typeof value === 'string' && value.startsWith('./')) files.push(value.slice(2))
    else if (typeof value === 'object' && value !== null) {
      for (const nested of Object.values(value)) collect(nested)
    }
  }
  collect(manifest.main)
  collect(manifest.types)
  collect(manifest.bin)
  collect(manifest.exports)
  return [...new Set(files)]
}

export function verifyPackedPackageContents(item) {
  for (const path of exportedFiles(item.manifest)) {
    if (!item.files.has(path)) throw new Error(`${item.name} export target is missing from tarball: ${path}`)
  }
  for (const path of [...item.files].filter(value => value.endsWith('.mjs'))) {
    const source = captureTar(item.tarball, '-xOzf', `package/${path}`)
    for (const match of source.matchAll(/(?:from\s+|import\s*\()\s*['"](\.[^'"]+)['"]/gu)) {
      const specifier = match[1]
      const target = posix.normalize(posix.join(posix.dirname(path), specifier))
      const candidates = [target, `${target}.mjs`, `${target}.js`, posix.join(target, 'index.mjs')]
      if (!candidates.some(candidate => item.files.has(candidate))) {
        throw new Error(`${item.name} published script ${path} imports missing ${specifier}`)
      }
    }
  }
  return {
    name: item.name,
    version: item.version,
    tarballFile: item.tarballFile,
    tarballSha256: item.tarballSha256,
  }
}
