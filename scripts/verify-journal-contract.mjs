import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as legion from '../lib/index.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const contract = JSON.parse(await readFile(resolve(root, 'contracts/journal-v1.json'), 'utf8'))
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const fail = message => { throw new Error('journal contract: ' + message) }
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right)

if (contract.schemaVersion !== 'dsh-legion-journal-contract-v1') fail('schemaVersion drifted')
if (contract.packageMajor !== Number(manifest.version.split('.')[0])) fail('packageMajor drifted')
if (contract.eventSchemaVersion !== 1) fail('event schemaVersion drifted')
if (contract.eventFamilies.length !== 8) fail('exactly eight event families are required')
const types = contract.eventFamilies.map(item => item.type)
if (!equal(types, legion.LEGION_EVENT_TYPES)) fail('event type order drifted')
if (new Set(contract.eventFamilies.map(item => item.family)).size !== 8) {
  fail('event family names must be unique')
}
const common = ['schemaVersion', 'runId', 'planVersion', 'correlationId']
const expectedFields = {
  'legion/run-state': [...common, 'record'],
  'legion/plan-state': [...common, 'record'],
  'legion/task-state': [...common, 'taskId', 'generation', 'record'],
  'legion/attempt-state': [
    ...common, 'taskId', 'attemptId', 'generation', 'fence', 'record',
  ],
  'legion/mail-state': [
    ...common, 'mailId', 'taskId', 'recipientGeneration', 'record',
  ],
  'legion/milestone': [...common, 'record'],
  'legion/decision': [...common, 'record'],
  'legion/continuation-state': [...common, 'continuationId', 'record'],
}
for (const family of contract.eventFamilies) {
  if (!equal(family.requiredDataFields, expectedFields[family.type])) {
    fail('required data fields drifted for ' + family.type)
  }
}
if (!equal(contract.commonOptionalDataFields, ['causationSeq', 'phase'])) {
  fail('optional event data fields drifted')
}
if (contract.projection.key !== legion.LEGION_RUN_PROJECTION_KEY
  || contract.projection.stateVersion !== legion.LEGION_RUN_PROJECTION_STATE_VERSION) {
  fail('projection metadata drifted')
}
// The journal contract records the published v2 receipt it shipped with. The
// package-pair distribution receipt may advance independently without rewriting
// protected journal bytes.
if (contract.receipts.compatibility !== 'dsh-legion-compatibility-receipt-v2') {
  fail('protected compatibility receipt metadata drifted')
}
if (contract.projection.unknownSessionEvents !== 'identity'
  || contract.projection.checkpointMismatch !== 'refold-full-history') {
  fail('replay expectations drifted')
}
if (contract.validation.unknownEventDataFields !== 'reject'
  || contract.validation.unknownRecordFields !== 'reject'
  || contract.validation.nonContiguousExportedSequence !== 'reject'
  || contract.validation.malformedJson !== 'reject') {
  fail('strict validation expectations drifted')
}
if (contract.durability.missingMandatoryCapability !== 'fail-closed-before-mutation'
  || contract.publishedHostServices !== false) {
  fail('capability disclaimer drifted')
}
const empty = legion.EMPTY_LEGION_PROJECTION_STATE
const unrelated = { seq: 1, time: 0, type: 'host/unrelated', data: {} }
if (legion.applyLegionProjection(empty, unrelated) !== empty) {
  fail('unknown Session events must preserve state identity')
}
const restored = legion.restoreLegionProjection({
  stateVersion: contract.projection.stateVersion - 1,
  state: { runs: { corrupt: {} } },
}, [], [])
if (!equal(restored, empty)) fail('checkpoint mismatch must refold full history')
process.stdout.write('dsh-legion journal contract v1 verified' + String.fromCharCode(10))
