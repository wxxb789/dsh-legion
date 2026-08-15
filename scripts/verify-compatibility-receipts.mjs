import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = resolve(process.argv[2] ?? 'dist')
const contract = JSON.parse(await readFile(resolve(root, 'contracts/v1.json'), 'utf8'))
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const names = await readdir(directory)
const tarballs = names.filter(name => name.endsWith('.tgz'))
if (tarballs.length !== 1) throw new Error(`release requires exactly one tarball, found ${String(tarballs.length)}`)
const tarballBytes = await readFile(resolve(directory, tarballs[0]))
const tarballSha256 = `sha256:${createHash('sha256').update(tarballBytes).digest('hex')}`
const receiptNames = names.filter(name => /^compatibility-(minimum|latest-compatible)-(22\.19\.0|24\.x)\.json$/.test(name)).sort()
if (receiptNames.length !== 4) throw new Error(`release requires four compatibility receipts, found ${String(receiptNames.length)}`)
const expectedFields = [...contract.compatibilityReceiptFields].sort()
const expectedDshPackages = [
  'dsh-agent', 'dsh-agent-loop', 'dsh-agent-loop-testkit', 'dsh-llm', 'dsh-session',
  'dsh-session-persistence-jsonl', 'dsh-subagent', 'dsh-subagent-spawn-in-process',
  'dsh-system-prompt', 'dsh-tools',
]
for (const name of receiptNames) {
  const slot = /^compatibility-(minimum|latest-compatible)-(22\.19\.0|24\.x)\.json$/.exec(name)
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
  const lockfileSha256 = `sha256:${createHash('sha256').update(lockfileBytes).digest('hex')}`
  const fields = Object.keys(receipt).sort()
  const expectedRequest = channel === 'minimum' ? '0.1.0-rc.6' : '>=0.1.0-rc.6 <0.2.0'
  const nodeMatches = node === '22.19.0'
    ? receipt.nodeVersion === 'v22.19.0'
    : /^v24\.\d+\.\d+$/.test(receipt.nodeVersion)
  const dependencyNames = Array.isArray(receipt.dshDependencies)
    ? receipt.dshDependencies.map(item => item?.name).sort()
    : []
  if (JSON.stringify(fields) !== JSON.stringify(expectedFields)
    || receipt.schemaVersion !== contract.compatibilityReceiptVersion
    || receipt.requestedDshVersion !== expectedRequest
    || !nodeMatches
    || (channel === 'minimum' && receipt.resolvedDshVersion !== '0.1.0-rc.6')
    || (channel === 'latest-compatible' && !receipt.resolvedDshVersion.startsWith('0.1.'))
    || receipt.packageVersion !== manifest.version
    || receipt.tarballSha256 !== tarballSha256
    || receipt.consumerLockfileFile !== expectedLockfile
    || receipt.consumerLockfileSha256 !== lockfileSha256
    || receipt.status !== 'passed'
    || !Array.isArray(receipt.dshDependencies)
    || new Set(dependencyNames).size !== dependencyNames.length
    || expectedDshPackages.some(name => !dependencyNames.includes(name))
    || receipt.dshDependencies.some(item =>
      typeof item?.name !== 'string'
      || item.version !== receipt.resolvedDshVersion
      || !packageKeys.some(key => key.includes(`@deepseek-ai/${item.name}@${item.version}`)))) {
    throw new Error(`invalid compatibility receipt ${basename(name)}`)
  }
}
process.stdout.write(`verified exact release tarball against ${String(receiptNames.length)} compatibility receipts\n`)
