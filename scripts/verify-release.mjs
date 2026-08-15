import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootFlag = process.argv.indexOf('--root')
if (rootFlag !== -1 && process.argv[rootFlag + 1] === undefined) {
  throw new Error('--root requires a directory')
}
const root = rootFlag === -1
  ? resolve(dirname(fileURLToPath(import.meta.url)), '..')
  : resolve(process.argv[rootFlag + 1] ?? '')
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8')
const version = String(manifest.version)
const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
if (!SEMVER.test(version)) {
  throw new Error(`package version is not valid semver: ${version}`)
}
if (tag === undefined) throw new Error('release verification requires a v<version> tag')
if (tag !== `v${version}`) {
  throw new Error(`release tag ${tag} does not match package version v${version}`)
}
const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const heading = changelog.match(new RegExp(`^## \\[${escapedVersion}\\] - (\\d{4}-\\d{2}-\\d{2})$`, 'm'))
const releaseDate = heading?.[1]
const parsedDate = releaseDate === undefined ? undefined : new Date(`${releaseDate}T00:00:00.000Z`)
if (releaseDate === undefined
  || parsedDate === undefined
  || Number.isNaN(parsedDate.valueOf())
  || parsedDate.toISOString().slice(0, 10) !== releaseDate) {
  throw new Error(`CHANGELOG.md has no valid dated [${version}] release heading`)
}
if (manifest.private === true) throw new Error('release package must not be private')
if (manifest.publishConfig?.access !== 'public') {
  throw new Error('release package must declare publishConfig.access=public')
}
process.stdout.write(`release metadata is consistent for ${tag}\n`)
