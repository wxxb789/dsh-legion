import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as legion from '../lib/index.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const contract = JSON.parse(await readFile(resolve(root, 'contracts/v1.json'), 'utf8'))
const compatibilityPolicy = JSON.parse(await readFile(
  resolve(root, 'contracts/compatibility.json'),
  'utf8',
))
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const declarationBytes = await readFile(resolve(root, 'lib/index.d.ts'))
const declarationSource = declarationBytes.toString('utf8').replace(/\r\n/g, '\n')
const exportLists = [...declarationSource.matchAll(/(?:^|\n)export\s*\{([\s\S]*?)\};/gu)]
if (exportLists.length !== 1 || exportLists[0]?.[1] === undefined) {
  throw new Error(`expected one generated declaration export list, found ${String(exportLists.length)}`)
}
const declarationExports = new Set(exportLists[0][1].split(',').map(specifier => {
  const withoutType = specifier.trim().replace(/^type\s+/u, '')
  return withoutType.split(/\s+as\s+/u).at(-1)?.trim()
}).filter(name => name !== undefined && name.length > 0))
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const checks = [
  ['schemaVersion', contract.schemaVersion, 'dsh-legion-public-contract-v1'],
  ['compatibilityPolicy.schemaVersion', compatibilityPolicy.schemaVersion, 'dsh-legion-compatibility-policy-v1'],
  ['compatibilityPolicy.dshPeerRange', compatibilityPolicy.dshPeerRange, manifest.peerDependencies['@deepseek-ai/dsh-agent']],
  ['compatibilityPolicy.peerRanges', [...new Set(Object.entries(manifest.peerDependencies)
    .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
    .map(([, range]) => range))], [compatibilityPolicy.dshPeerRange]],
  ['compatibilityPolicy.minimumDshVersion', compatibilityPolicy.minimumDshVersion, '0.1.0-rc.6'],
  ['compatibilityPolicy.latestTestedDshVersion', compatibilityPolicy.latestTestedDshVersion, '0.1.0-rc.6'],
  ['compatibilityPolicy.dshPackageClosure', compatibilityPolicy.dshPackageClosure, [...new Set(compatibilityPolicy.dshPackageClosure)].sort()],
  ['packageMajor', contract.packageMajor, Number.parseInt(manifest.version.split('.')[0], 10)],
  ['declarationExports', contract.declarationExports, [...declarationExports].sort()],
  ['runtimeExports', contract.runtimeExports, Object.keys(legion).sort()],
  ['packageEntry', contract.packageEntry, {
    main: manifest.main,
    types: manifest.types,
    bin: manifest.bin,
    exports: manifest.exports,
  }],
  ['configVersion', contract.configVersion, legion.CURRENT_CONFIG_VERSION],
  ['resultContracts', contract.resultContracts, legion.RESULT_CONTRACTS],
  ['artifactContracts', contract.artifactContracts, legion.ARTIFACT_CONTRACTS],
  ['strategyStageKinds', contract.strategyStageKinds, legion.STRATEGY_STAGE_KINDS],
  ['strategyLimitFields', contract.strategyLimitFields, legion.STRATEGY_LIMIT_FIELDS],
  ['teamRunOutcomes', contract.teamRunOutcomes, legion.TEAM_RUN_OUTCOMES],
  ['profileRequestFields', contract.profileRequestFields, ['kind', 'profile', 'description', 'prompt', 'run_in_background']],
  ['profileRequiredFields', contract.profileRequiredFields, ['description', 'prompt']],
  ['strategyRequestFields', contract.strategyRequestFields, ['kind', 'strategy', 'objective', 'limits']],
  ['strategyRequiredFields', contract.strategyRequiredFields, ['kind', 'strategy', 'objective']],
  ['catalogLayerSemantics', contract.catalogLayerSemantics, [
    'add-new-name', 'replace-same-name', 'disable-tombstone', 'revive-later',
  ]],
  ['qualityAdjudicationReceiptVersion', contract.qualityAdjudicationReceiptVersion, 'legion-adjudication-receipt-v2'],
  ['executionReceiptVersion', contract.executionReceiptVersion, 'legion-execution-receipt-v1'],
  ['compatibilityReceiptVersion', contract.compatibilityReceiptVersion, 'dsh-legion-compatibility-receipt-v1'],
  ['qualityAdjudicationReceiptFields', contract.qualityAdjudicationReceiptFields, ['schemaVersion', 'batchId', 'blinded', 'signerId', 'payload', 'signature']],
  ['qualityAdjudicationPayloadFields', contract.qualityAdjudicationPayloadFields, ['campaignId', 'strategy', 'startedAt', 'endedAt', 'catalogDigest', 'executionCommit', 'deploymentHardBudget', 'casePackSha256', 'rubricSha256', 'thresholdsSha256', 'scoredRunsSha256']],
  ['executionReceiptFields', contract.executionReceiptFields, ['schemaVersion', 'signerId', 'payload', 'signature']],
  ['executionReceiptPayloadFields', contract.executionReceiptPayloadFields, ['campaignId', 'executionCommit', 'casePackSha256', 'packCommitmentId', 'startedAt', 'endedAt', 'executionId', 'caseId', 'repeat', 'pairId', 'arm', 'order', 'exposure', 'status', 'artifact', 'provenance', 'usage', 'timing', 'infraReceipt']],
  ['compatibilityReceiptFields', contract.compatibilityReceiptFields, ['schemaVersion', 'requestedDshVersion', 'resolvedDshVersion', 'platform', 'nodeVersion', 'packageVersion', 'tarballSha256', 'consumerLockfileFile', 'consumerLockfileSha256', 'dshDependencies', 'status']],
  ['heldOutPackTrustFields', contract.heldOutPackTrustFields, ['packId', 'packSha256', 'issuer', 'commitmentId', 'committedAt', 'unsealedAt', 'signature']],
  ['authorityOwners', contract.authorityOwners, {
    modelStrategyExposure: 'deployment',
    childLifecycle: 'dsh-subagent',
    sandboxApproval: 'dsh-host',
    aggregateTokenCost: 'unavailable-without-host-admission',
  }],
]
if ('resolveCatalogLayers' in legion) {
  throw new Error('internal Catalog Layer resolver leaked into the public package Interface')
}
for (const [name, expected, actual] of checks) {
  if (!equal(expected, actual)) {
    throw new Error(`public contract ${name} drifted: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}
const migrated = legion.materializeConfig({
  profiles: {
    contract: {
      description: 'Contract verification.',
      subagentProvider: 'spawn',
      maxDepth: 1,
      defaultRunInBackground: false,
    },
  },
})
if (migrated.enableStrategies !== contract.modelStrategyExposureDefault) {
  throw new Error('public contract model Strategy exposure default drifted')
}
process.stdout.write('dsh-legion public contract v1 verified\n')
