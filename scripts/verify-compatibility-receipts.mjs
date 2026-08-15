import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = resolve(process.argv[2] ?? 'dist')
const contract = JSON.parse(await readFile(resolve(root, 'contracts/v1.json'), 'utf8'))
const compatibilityPolicy = JSON.parse(await readFile(
  resolve(root, 'contracts/compatibility.json'),
  'utf8',
))
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const names = await readdir(directory)
const tarballs = names.filter(name => name.endsWith('.tgz'))
if (tarballs.length !== 1) throw new Error(`release requires exactly one tarball, found ${String(tarballs.length)}`)
const tarballBytes = await readFile(resolve(directory, tarballs[0]))
const tarballSha256 = `sha256:${createHash('sha256').update(tarballBytes).digest('hex')}`
const receiptNames = names.filter(name => /^compatibility-(minimum|latest-tested)-(22\.19\.0|24\.19\.0)\.json$/.test(name)).sort()
if (receiptNames.length !== 4) throw new Error(`release requires four compatibility receipts, found ${String(receiptNames.length)}`)
const expectedFields = [...contract.compatibilityReceiptFields].sort()
const expectedDshPackages = [...compatibilityPolicy.dshPackageClosure].sort()
for (const name of receiptNames) {
  const slot = /^compatibility-(minimum|latest-tested)-(22\.19\.0|24\.19\.0)\.json$/.exec(name)
  if (slot === null) throw new Error(`invalid compatibility receipt filename ${name}`)
  const [, channel, node] = slot
  const receipt = JSON.parse(await readFile(resolve(directory, name), 'utf8'))
  const expectedLockfile = name.replace(/\.json$/, '.lock.yaml')
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
  const lockfileDshDependencies = [...new Set(packageKeys.flatMap(key => {
    const match = /(?:^|\/)@deepseek-ai\/(dsh-[^@/:(]+)@([^(/:]+)(?:$|\()/u.exec(key)
    return match === null ? [] : [`${match[1]}@${match[2]}`]
  }))].sort()
  const lockfileSha256 = `sha256:${createHash('sha256').update(lockfileBytes).digest('hex')}`
  const fields = Object.keys(receipt).sort()
  const expectedRequest = channel === 'minimum'
    ? compatibilityPolicy.minimumDshVersion
    : compatibilityPolicy.latestTestedDshVersion
  const nodeMatches = receipt.nodeVersion === `v${node}`
  const dependencyNames = Array.isArray(receipt.dshDependencies)
    ? receipt.dshDependencies.map(item => item?.name).sort()
    : []
  const receiptDshDependencies = Array.isArray(receipt.dshDependencies)
    ? receipt.dshDependencies.map(item => `${String(item?.name)}@${String(item?.version)}`).sort()
    : []
  const expectedDshDependencies = expectedDshPackages
    .map(packageName => `${packageName}@${receipt.resolvedDshVersion}`)
    .sort()
  if (JSON.stringify(fields) !== JSON.stringify(expectedFields)
    || receipt.schemaVersion !== contract.compatibilityReceiptVersion
    || receipt.requestedDshVersion !== expectedRequest
    || !nodeMatches
    || (channel === 'minimum'
      && receipt.resolvedDshVersion !== compatibilityPolicy.minimumDshVersion)
    || (channel === 'latest-tested'
      && receipt.resolvedDshVersion !== compatibilityPolicy.latestTestedDshVersion)
    || receipt.packageVersion !== manifest.version
    || receipt.tarballSha256 !== tarballSha256
    || receipt.consumerLockfileFile !== expectedLockfile
    || receipt.consumerLockfileSha256 !== lockfileSha256
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
process.stdout.write(`verified exact release tarball against ${String(receiptNames.length)} compatibility receipts\n`)
