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
const journalContract = JSON.parse(await readFile(resolve(root, 'contracts/journal-v1.json'), 'utf8'))
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
  ['compatibilityPolicy.latestTestedDshVersion', compatibilityPolicy.latestTestedDshVersion, '0.1.0-rc.7'],
  ['compatibilityPolicy.assessedDshVersions', compatibilityPolicy.assessedDshVersions, [
    compatibilityPolicy.minimumDshVersion,
    compatibilityPolicy.latestTestedDshVersion,
  ]],
  ['settingsNamespace', contract.settingsNamespace, legion.LEGION_SETTINGS_NAMESPACE],
  ['settingsServiceKey', contract.settingsServiceKey, legion.LEGION_SETTINGS_SERVICE_KEY],
  ['settingsDiagnostics', contract.settingsDiagnostics, legion.SETTINGS_DIAGNOSTIC_CODES],
  ['acpProviderPlugin', contract.acpProviderPlugin, legion.ACP_PROVIDER_PLUGIN],
  ['acpCatalogLayerId', contract.acpCatalogLayerId, legion.ACP_CATALOG_LAYER_ID],
  ['acpEntrypointProvenance', contract.acpEntrypointProvenance, legion.ACP_ENTRYPOINT_PROVENANCE],
  ['acpCuratedAgents', contract.acpCuratedAgents, legion.ACP_AGENT_CATALOG.map(agent => agent.id).sort()],
  ['clientBundle', contract.clientBundle, {
    id: manifest.name,
    platform: manifest.dsh.client.platform,
    entry: manifest.exports['./client'].default,
  }],
  ['compatibilityPolicy.compatibilityReceiptVersion', compatibilityPolicy.compatibilityReceiptVersion, contract.compatibilityReceiptVersion],
  ['compatibilityPolicy.dshPackageClosure', compatibilityPolicy.dshPackageClosure, [...new Set(compatibilityPolicy.dshPackageClosure)].sort()],
  ['packageVersion', contract.packageVersion, manifest.version],
  ['journalContract.schemaVersion', contract.journalContract.schemaVersion, journalContract.schemaVersion],
  ['journalContract.eventFamilies', contract.journalContract.eventFamilies, journalContract.eventFamilies.length],
  ['journalContract.projectionKey', contract.journalContract.projectionKey, legion.LEGION_RUN_PROJECTION_KEY],
  ['journalContract.projectionStateVersion', contract.journalContract.projectionStateVersion, legion.LEGION_RUN_PROJECTION_STATE_VERSION],
  ['journalEventKindsFromManifest', journalContract.eventFamilies.map(item => item.type), legion.LEGION_EVENT_TYPES],
  ['runControlActions', contract.runControlActions, ['inspect', 'resume', 'cancel', 'steer']],
  ['hostServicesShipped', contract.hostServicesShipped, []],
  ['durableMutationAvailability', contract.durableMutationAvailability, 'capability-gated-fail-closed'],
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
  ['durableRunPolicyFields', contract.durableRunPolicyFields, ['maxStartsPerActivation', 'maxConcurrentTasks']],
  ['strategyStageOptionalFields', contract.strategyStageOptionalFields, ['after']],
  ['journalEventSchemaVersion', contract.journalEventSchemaVersion, 1],
  ['journalEventKinds', contract.journalEventKinds, legion.LEGION_EVENT_TYPES],
  ['sessionProjection', contract.sessionProjection, {
    key: legion.LEGION_RUN_PROJECTION_KEY,
    stateVersion: legion.LEGION_RUN_PROJECTION_STATE_VERSION,
  }],
  ['durableCapabilityKeys', contract.durableCapabilityKeys, [
    'sessions',
    'sessionProjections',
    legion.LEGION_RUN_COORDINATION_KEY,
    legion.LEGION_GLOBAL_ADMISSION_KEY,
    legion.LEGION_CHILD_RECEIPTS_KEY,
  ]],
  ['durableDiagnostics', contract.durableDiagnostics, legion.DURABLE_DIAGNOSTIC_CODES],
  ['durableDeliverySemantics', contract.durableDeliverySemantics, {
    taskExecution: 'at-least-once',
    acceptedCommit: 'exactly-once-by-fence-generation',
    externalEffects: 'not-exactly-once',
  }],
  ['mailStatuses', contract.mailStatuses, [
    'queued', 'reserved', 'incorporated', 'acknowledged', 'discarded',
  ]],
  ['contextSlots', contract.contextSlots, legion.CONTEXT_SLOTS],
  ['contextSharedPrefixSlots', contract.contextSharedPrefixSlots, [
    'profile-policy', 'strategy-policy', 'shared-run',
  ]],
  ['contextFreshnessKinds', contract.contextFreshnessKinds, [
    'timeless', 'fresh', 'expired',
  ]],
  ['planDeltaSchemaVersion', contract.planDeltaSchemaVersion, 1],
  ['planDeltaOperationKinds', contract.planDeltaOperationKinds, [
    'add-node', 'add-edge', 'supersede-pending', 'narrow-limits',
  ]],
  ['continuationStatuses', contract.continuationStatuses, [
    'available', 'consumed', 'invalidated',
  ]],
  ['authorityProfileFields', contract.authorityProfileFields, [
    'members', 'tools', 'providers', 'models', 'routes', 'effectClasses',
  ]],
  ['stairStepPolicyFields', contract.stairStepPolicyFields, [
    'kind', 'plannerMember', 'verifierMember', 'advancement', 'maxMilestones',
    'maxNoProgressMilestones', 'requireVisibleArtifact', 'pauseOn',
  ]],
  ['stairStepPauseReasons', contract.stairStepPauseReasons, legion.STAIR_STEP_PAUSE_REASONS],
  ['milestoneProgressKinds', contract.milestoneProgressKinds, [
    'accepted-artifact', 'criterion-satisfied', 'risk-retired',
    'uncertainty-reduced', 'blocked-path-rejected',
  ]],
  ['milestoneNextDecisions', contract.milestoneNextDecisions, [
    'advance', 'revise', 'pause', 'complete',
  ]],
  ['environmentSnapshotSchemaVersion', contract.environmentSnapshotSchemaVersion, 1],
  ['environmentCapabilityKinds', contract.environmentCapabilityKinds, [
    'known-supported', 'known-unsupported', 'unknown',
  ]],
  ['dispatchCompatibilityTuple', contract.dispatchCompatibilityTuple, [
    'provider', 'model', 'toolsetDigest', 'profileDigest', 'sharedPrefixDigest',
  ]],
  ['admissionScopes', contract.admissionScopes, [
    'host-global-admitted', 'per-run-conservative',
  ]],
  ['reducerEnvelopeSchemaVersion', contract.reducerEnvelopeSchemaVersion, 1],
  ['parallelismScopes', contract.parallelismScopes, [
    'host-global-admitted', 'per-run-observed',
  ]],
  ['resultContracts', contract.resultContracts, legion.RESULT_CONTRACTS],
  ['artifactContracts', contract.artifactContracts, legion.ARTIFACT_CONTRACTS],
  ['strategyStageKinds', contract.strategyStageKinds, legion.STRATEGY_STAGE_KINDS],
  ['strategyLimitFields', contract.strategyLimitFields, legion.STRATEGY_LIMIT_FIELDS],
  ['teamRunOutcomes', contract.teamRunOutcomes, legion.TEAM_RUN_OUTCOMES],
  ['profileRequestFields', contract.profileRequestFields, ['kind', 'profile', 'description', 'prompt', 'run_in_background']],
  ['profileRequiredFields', contract.profileRequiredFields, ['description', 'prompt']],
  ['strategyRequestFields', contract.strategyRequestFields, [
    'kind', 'strategy', 'objective', 'limits', 'execution',
  ]],
  ['strategyRequiredFields', contract.strategyRequiredFields, ['kind', 'strategy', 'objective']],
  ['catalogLayerSemantics', contract.catalogLayerSemantics, [
    'add-new-name', 'replace-same-name', 'disable-tombstone', 'revive-later',
  ]],
  ['qualityAdjudicationReceiptVersion', contract.qualityAdjudicationReceiptVersion, 'legion-adjudication-receipt-v2'],
  ['executionReceiptVersion', contract.executionReceiptVersion, 'legion-execution-receipt-v1'],
  ['compatibilityReceiptVersion', contract.compatibilityReceiptVersion, 'dsh-legion-compatibility-receipt-v2'],
  ['qualityAdjudicationReceiptFields', contract.qualityAdjudicationReceiptFields, ['schemaVersion', 'batchId', 'blinded', 'signerId', 'payload', 'signature']],
  ['qualityAdjudicationPayloadFields', contract.qualityAdjudicationPayloadFields, ['campaignId', 'strategy', 'startedAt', 'endedAt', 'catalogDigest', 'executionCommit', 'deploymentHardBudget', 'casePackSha256', 'rubricSha256', 'thresholdsSha256', 'scoredRunsSha256']],
  ['executionReceiptFields', contract.executionReceiptFields, ['schemaVersion', 'signerId', 'payload', 'signature']],
  ['executionReceiptPayloadFields', contract.executionReceiptPayloadFields, ['campaignId', 'executionCommit', 'casePackSha256', 'packCommitmentId', 'startedAt', 'endedAt', 'executionId', 'caseId', 'repeat', 'pairId', 'arm', 'order', 'exposure', 'status', 'artifact', 'provenance', 'usage', 'timing', 'infraReceipt']],
  ['compatibilityReceiptFields', contract.compatibilityReceiptFields, [
    'schemaVersion', 'requestedDshVersion', 'resolvedDshVersion', 'platform',
    'nodeVersion', 'packageVersion', 'tarballSha256', 'consumerLockfileFile',
    'consumerLockfileSha256', 'dshDependencies', 'capabilityMode',
    'durableMutation', 'durableDiagnostics', 'status',
  ]],
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
if (migrated.enableDurableRuns !== contract.durableRunsDefault) {
  throw new Error('public contract durable run default drifted')
}
process.stdout.write('dsh-legion public contract v1 verified\n')
