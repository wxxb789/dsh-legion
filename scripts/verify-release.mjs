import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWorkspacePackages } from './workspace-packages.mjs'

const arguments_ = process.argv.slice(2).filter(argument => argument !== '--')
const rootFlag = arguments_.indexOf('--root')
if (rootFlag !== -1 && arguments_[rootFlag + 1] === undefined) {
  throw new Error('--root requires a directory')
}
const root = rootFlag === -1
  ? resolve(dirname(fileURLToPath(import.meta.url)), '..')
  : resolve(arguments_[rootFlag + 1] ?? '')
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8')
const version = String(manifest.version)
const tag = arguments_[0] ?? process.env.GITHUB_REF_NAME

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
const workspacePackages = readWorkspacePackages(root)
const names = workspacePackages.map(item => item.name)
if (workspacePackages.some(item => item.version !== version)) {
  throw new Error('release workspace package versions must be lockstep')
}
const companion = workspacePackages.find(item => item.name === 'dsh-legion-receipts')
if (companion === undefined
  || manifest.dependencies?.[companion.name] !== `workspace:${version}`
  || companion.manifest.dependencies?.[manifest.name] !== undefined) {
  throw new Error('release package pair dependency direction or exact version is invalid')
}
const contractsDirectory = join(root, 'contracts')
const publicContract = JSON.parse(await readFile(join(contractsDirectory, 'v1.json'), 'utf8'))
const journalContract = JSON.parse(await readFile(join(contractsDirectory, 'journal-v1.json'), 'utf8'))
const compatibility = JSON.parse(await readFile(join(contractsDirectory, 'compatibility.json'), 'utf8'))
if (publicContract.packageVersion !== version
  || compatibility.packageVersion !== version
  || compatibility.compatibilityReceiptVersion !== publicContract.compatibilityReceiptVersion
  || JSON.stringify(compatibility.releasePackages) !== JSON.stringify(names)) {
  throw new Error('release package pair, public contract, and compatibility policy versions disagree')
}
if (journalContract.schemaVersion !== 'dsh-legion-journal-contract-v1'
  || journalContract.projection?.key !== 'legion-run'
  || journalContract.projection?.stateVersion
    !== publicContract.journalContract.projectionStateVersion) {
  throw new Error('journal release metadata is inconsistent')
}
if (compatibility.npmTrustedPublisher?.repository !== 'wxxb789/dsh-legion'
  || compatibility.npmTrustedPublisher?.workflow !== '.github/workflows/release.yml'
  || compatibility.npmTrustedPublisher?.environment !== 'npm'
  || compatibility.npmTrustedPublisher?.status !== 'prerequisite-deferred') {
  throw new Error('companion npm Trusted Publisher prerequisite metadata is incomplete')
}
for (const workspacePackage of workspacePackages) {
  if (workspacePackage.manifest.private === true
    || workspacePackage.manifest.publishConfig?.access !== 'public'
    || workspacePackage.manifest.publishConfig?.registry !== 'https://registry.npmjs.org') {
    throw new Error(`${workspacePackage.name} must declare public npm identity`)
  }
}
process.stdout.write(`release metadata is consistent for ${tag}\n`)
