import { resolve } from 'node:path'
import { evaluateQualityCampaign } from './evaluate-quality-campaign.mjs'

const [
  leftCampaign,
  rightCampaign,
  currentCatalogDigest,
  leftPack,
  rightPack,
  trustStore,
] = process.argv.slice(2)
if (leftCampaign === undefined
  || rightCampaign === undefined
  || currentCatalogDigest === undefined
  || leftPack === undefined
  || rightPack === undefined
  || trustStore === undefined) {
  throw new Error(
    'usage: evaluate-exposure-evidence.mjs <campaign-a.json> <campaign-b.json> '
    + '<current-catalog-digest> <held-out-pack-a.json> <held-out-pack-b.json> '
    + '<trusted-adjudicators.json>',
  )
}
const [left, right] = await Promise.all([
  evaluateQualityCampaign(resolve(leftCampaign), resolve(leftPack), resolve(trustStore)),
  evaluateQualityCampaign(resolve(rightCampaign), resolve(rightPack), resolve(trustStore)),
])
const reasons = []
if (left.verdict !== 'pass' || right.verdict !== 'pass') reasons.push('both campaigns must pass independently')
if (left.strategy !== right.strategy) reasons.push('campaign strategies differ')
if (left.campaignId === right.campaignId
  || left.evidence.campaignSha256 === right.evidence.campaignSha256) {
  reasons.push('campaign identities are not independent')
}
if (left.evidence.adjudicationBatch === right.evidence.adjudicationBatch
  || left.evidence.adjudicationReceiptSha256 === right.evidence.adjudicationReceiptSha256
  || left.evidence.adjudicationSigner === right.evidence.adjudicationSigner) {
  reasons.push('campaign adjudication receipts are not independent')
}
if (left.evidence.casePack.visibility !== 'held-out'
  || right.evidence.casePack.visibility !== 'held-out'
  || left.evidence.casePack.sha256 === right.evidence.casePack.sha256
  || left.evidence.casePack.commitmentId === right.evidence.casePack.commitmentId
  || left.evidence.casePack.issuer === right.evidence.casePack.issuer
  || left.evidence.casePack.issuerKeySha256 === right.evidence.casePack.issuerKeySha256) {
  reasons.push('two independently issued held-out case packs are required')
}
if (left.evidence.catalogDigest !== currentCatalogDigest
  || right.evidence.catalogDigest !== currentCatalogDigest) {
  reasons.push('campaign catalog digest is stale')
}
if (left.evidence.executionCommit !== right.evidence.executionCommit) {
  reasons.push('campaign execution commits differ')
}
const leftExecutionIds = new Set(left.evidence.executionIds)
if (right.evidence.executionIds.some(executionId => leftExecutionIds.has(executionId))) {
  reasons.push('campaigns reuse one or more execution identities')
}
const leftExecutionSigners = new Set(left.evidence.executionSigners)
if (right.evidence.executionSigners.some(signerId => leftExecutionSigners.has(signerId))) {
  reasons.push('campaigns reuse one or more executor trust principals')
}
const leftTrustKeys = new Set([
  left.evidence.casePack.issuerKeySha256,
  left.evidence.adjudicationSignerKeySha256,
  ...left.evidence.executionSignerKeySha256s,
])
const rightTrustKeys = [
  right.evidence.casePack.issuerKeySha256,
  right.evidence.adjudicationSignerKeySha256,
  ...right.evidence.executionSignerKeySha256s,
]
if (rightTrustKeys.some(key => leftTrustKeys.has(key))) {
  reasons.push('campaigns reuse one or more trust keys across roles')
}
if (left.evidence.rubricSha256 !== right.evidence.rubricSha256
  || left.evidence.thresholdsSha256 !== right.evidence.thresholdsSha256) {
  reasons.push('campaign rubric or thresholds differ')
}
const windowsAreIndependent = Date.parse(left.evidence.endedAt) <= Date.parse(right.evidence.startedAt)
  || Date.parse(right.evidence.endedAt) <= Date.parse(left.evidence.startedAt)
if (!windowsAreIndependent) reasons.push('campaign execution windows overlap')
const result = {
  schemaVersion: 'legion-exposure-evidence-v1',
  strategy: left.strategy,
  eligible: reasons.length === 0,
  campaigns: [left.campaignId, right.campaignId],
  catalogDigest: currentCatalogDigest,
  reasons,
}
process.stdout.write(JSON.stringify(result, null, 2) + '\n')
if (!result.eligible) process.exitCode = 1
