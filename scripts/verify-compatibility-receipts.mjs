import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { readPackedPackageSet, verifyPackedPackageContents } from './package-set.mjs'
import { readWorkspacePackages } from './workspace-packages.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = resolve(process.argv[2] ?? 'dist')
const contract = JSON.parse(await readFile(resolve(root, 'contracts/v1.json'), 'utf8'))
const compatibilityPolicy = JSON.parse(await readFile(
  resolve(root, 'contracts/compatibility.json'),
  'utf8',
))
const workspacePackages = readWorkspacePackages(root)
const expectedPackageNames = workspacePackages.map(item => item.name)
if (JSON.stringify(compatibilityPolicy.releasePackages) !== JSON.stringify(expectedPackageNames)) {
  throw new Error('compatibility releasePackages do not match the workspace package generation')
}
const packageSet = readPackedPackageSet(directory, workspacePackages)
const expectedPackages = packageSet
  .map(verifyPackedPackageContents)
  .sort((left, right) => left.name.localeCompare(right.name))
const rootArtifact = packageSet.find(item => item.name === 'dsh-legion')
const companionArtifact = packageSet.find(item => item.name === 'dsh-legion-receipts')
if (rootArtifact === undefined || companionArtifact === undefined
  || rootArtifact.manifest.dependencies?.[companionArtifact.name] !== companionArtifact.version) {
  throw new Error('release tarballs do not contain one exact root and companion generation')
}

const matrix = compatibilityPolicy.compatibilityMatrix
if (!Array.isArray(matrix?.platforms) || !Array.isArray(matrix?.channels)
  || !Array.isArray(matrix?.nodeVersions)) {
  throw new Error('compatibility policy has no release matrix')
}
const slots = matrix.platforms.flatMap(platform => matrix.channels.flatMap(channel => (
  matrix.nodeVersions.map(nodeVersion => ({
    platform,
    channel,
    nodeVersion,
    stem: `compatibility-${platform}-${channel}-${nodeVersion}`,
  }))
)))
if (slots.length !== 8 || new Set(slots.map(slot => slot.stem)).size !== slots.length) {
  throw new Error(`release requires eight unique compatibility matrix slots, found ${String(slots.length)}`)
}
const names = await readdir(directory)
const expectedFiles = new Set([
  ...packageSet.map(item => item.tarballFile),
  ...slots.flatMap(slot => [`${slot.stem}.json`, `${slot.stem}.lock.yaml`]),
])
const extra = names.filter(name => !expectedFiles.has(name))
const missing = [...expectedFiles].filter(name => !names.includes(name))
if (extra.length > 0 || missing.length > 0) {
  throw new Error(`release package set mismatch; missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'}`)
}

const expectedFields = [...contract.compatibilityReceiptFields].sort()
const expectedDshPackages = [...new Set([
  ...compatibilityPolicy.registryInstallPackageClosure,
  ...compatibilityPolicy.dshPackageClosure,
])].sort()
const expectedDurableDiagnostics = [
  'LEGION_DURABLE_FLUSH_UNAVAILABLE',
  'LEGION_SESSION_PROJECTION_UNAVAILABLE',
  'LEGION_DURABLE_COORDINATION_UNAVAILABLE',
  'LEGION_GLOBAL_ADMISSION_UNAVAILABLE',
  'LEGION_DURABLE_CHILD_RECEIPT_UNAVAILABLE',
]
for (const slot of slots) {
  const name = `${slot.stem}.json`
  const receipt = JSON.parse(await readFile(resolve(directory, name), 'utf8'))
  const expectedLockfile = `${slot.stem}.lock.yaml`
  const lockfileBytes = await readFile(resolve(directory, expectedLockfile))
  const lockfileText = lockfileBytes.toString('utf8')
  const lockfile = load(lockfileText)
  if (typeof lockfile !== 'object' || lockfile === null || Array.isArray(lockfile)) {
    throw new Error(`invalid compatibility lockfile ${expectedLockfile}`)
  }
  const lockRecord = lockfile
  const packageKeys = [
    ...Object.keys(typeof lockRecord.packages === 'object' && lockRecord.packages !== null
      ? lockRecord.packages : {}),
    ...Object.keys(typeof lockRecord.snapshots === 'object' && lockRecord.snapshots !== null
      ? lockRecord.snapshots : {}),
  ]
  const importerDependencies = typeof lockRecord.importers?.['.']?.dependencies === 'object'
    && lockRecord.importers['.'].dependencies !== null
    ? lockRecord.importers['.'].dependencies
    : {}
  const lockfileDshDependencies = [...new Set(packageKeys.flatMap(key => {
    const match = /(?:^|\/)@deepseek-ai\/(dsh-[^@/:(]+)@([^(/:]+)(?:$|\()/u.exec(key)
    return match === null ? [] : [`${match[1]}@${match[2]}`]
  }))].sort()
  const lockfileSha256 = `sha256:${createHash('sha256').update(lockfileBytes).digest('hex')}`
  const fields = Object.keys(receipt).sort()
  const expectedRequest = slot.channel === 'minimum'
    ? compatibilityPolicy.minimumDshVersion
    : compatibilityPolicy.latestTestedDshVersion
  const dependencyNames = Array.isArray(receipt.dshDependencies)
    ? receipt.dshDependencies.map(item => item?.name).sort()
    : []
  const receiptDshDependencies = Array.isArray(receipt.dshDependencies)
    ? receipt.dshDependencies.map(item => `${String(item?.name)}@${String(item?.version)}`).sort()
    : []
  const expectedDshDependencies = expectedDshPackages
    .map(packageName => `${packageName}@${receipt.resolvedDshVersion}`)
    .sort()
  const lockBindsPackages = expectedPackages.every(item => {
    const dependency = importerDependencies[item.name]
    return dependency !== undefined && JSON.stringify(dependency).includes(item.tarballFile)
  })
  if (JSON.stringify(fields) !== JSON.stringify(expectedFields)
    || receipt.schemaVersion !== contract.compatibilityReceiptVersion
    || receipt.matrixSlot !== slot.stem.replace(/^compatibility-/u, '')
    || receipt.requestedDshVersion !== expectedRequest
    || receipt.platform !== slot.platform
    || receipt.nodeVersion !== `v${slot.nodeVersion}`
    || (slot.channel === 'minimum'
      && receipt.resolvedDshVersion !== compatibilityPolicy.minimumDshVersion)
    || (slot.channel === 'latest-tested'
      && receipt.resolvedDshVersion !== compatibilityPolicy.latestTestedDshVersion)
    || JSON.stringify(receipt.packages) !== JSON.stringify(expectedPackages)
    || receipt.consumerLockfileFile !== expectedLockfile
    || receipt.consumerLockfileSha256 !== lockfileSha256
    || !lockBindsPackages
    || receipt.capabilityMode !== 'rc6-replay-only-fail-closed'
    || receipt.durableMutation !== false
    || JSON.stringify(receipt.durableDiagnostics) !== JSON.stringify(expectedDurableDiagnostics)
    || receipt.status !== 'passed'
    || !Array.isArray(receipt.dshDependencies)
    || new Set(dependencyNames).size !== dependencyNames.length
    || JSON.stringify(dependencyNames) !== JSON.stringify(expectedDshPackages)
    || JSON.stringify(receiptDshDependencies) !== JSON.stringify(expectedDshDependencies)
    || JSON.stringify(lockfileDshDependencies) !== JSON.stringify(expectedDshDependencies)
    || receipt.dshDependencies.some(item =>
      typeof item?.name !== 'string'
      || item.version !== receipt.resolvedDshVersion
      || !packageKeys.some(key => key.includes(`@deepseek-ai/${item.name}@${item.version}`)))) {
    throw new Error(`invalid compatibility receipt ${basename(name)}`)
  }
}
process.stdout.write(`verified exact release package pair against ${String(slots.length)} compatibility receipts\n`)
