import { canonicalValue, deepCopy, deepFreeze, sha256Digest } from '../internal/value.ts'
import type { StairStepPauseReason, StairStepPolicySpec } from '../orchestration-contract.ts'
import {
  ArtifactDigest, DeltaId, TaskId,
  type ArtifactRef, type MilestoneReceipt, type MilestoneSpec,
  type MilestoneVerification, type ProgressEvidence, type TaskId as TaskIdType,
  type PlanVersion,
} from './contract.ts'
import type { PlanDeltaProposal } from './plan-delta.ts'
import type { TaskSpec } from './graph.ts'

export interface MilestoneObservation {
  readonly milestoneId: string
  readonly title: string
  readonly summary: string
  readonly artifacts: readonly ArtifactRef[]
  readonly verification: readonly MilestoneVerification[]
  readonly risksRetired: readonly string[]
  readonly openRisks: readonly string[]
  readonly observedDelta: string
  readonly progress: readonly ProgressEvidence[]
  readonly acceptedAt: number
  readonly signals?: readonly Exclude<StairStepPauseReason, 'verification-failure' | 'no-progress'>[]
  readonly stop?: boolean
  readonly revise?: boolean
}
export interface ExpandedStairStepPolicy {
  readonly schemaVersion: 1
  readonly policy: Required<StairStepPolicySpec>
  readonly plannerTaskId: TaskIdType
  readonly verifierTaskId: TaskIdType
  readonly policyDigest: string
}
export type StairStepEvaluation =
  | { readonly kind: 'accepted'; readonly receipt: MilestoneReceipt; readonly madeProgress: boolean }
  | { readonly kind: 'suspended'; readonly receipt: MilestoneReceipt; readonly reason: StairStepPauseReason }
  | { readonly kind: 'rejected'; readonly reason: 'malformed' | 'verification-failure' | 'visible-artifact-required' | 'milestone-limit'; readonly message: string }
export type StairStepYieldReason = 'checkpoint' | 'activation-limit' | 'policy-pause' | 'complete'
export interface StairStepAdvanceDecision { readonly kind: 'continue' | 'yield'; readonly reason?: StairStepYieldReason }

const PAUSE_REASONS: readonly StairStepPauseReason[] = [
  'authority-expansion', 'irreversible-effect', 'high-cost-ambiguity',
  'verification-failure', 'no-progress',
]
const LOCAL_ID = /^[a-z][a-z0-9-]*$/
function record(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('dsh-legion: ' + at + ' must be a plain object')
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new Error('dsh-legion: ' + at + ' must be a plain object')
  return value as Record<string, unknown>
}
function exact(source: Record<string, unknown>, fields: readonly string[], at: string): void {
  if (Object.keys(source).some(key => !fields.includes(key)) || fields.some(key => !Object.hasOwn(source, key))) throw new Error('dsh-legion: invalid ' + at + ' fields')
}
function text(value: unknown, at: string, max = 512): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new Error('dsh-legion: invalid ' + at)
  return value
}
function positive(value: unknown, at: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error('dsh-legion: invalid ' + at)
  return value as number
}
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0 }
export function materializeStairStepPolicy(value: unknown): Required<StairStepPolicySpec> {
  const source = record(value, 'StairStepPolicySpec')
  const fields = ['kind', 'plannerMember', 'verifierMember', 'advancement', 'maxMilestones', 'maxNoProgressMilestones', 'requireVisibleArtifact', 'pauseOn']
  exact(source, fields, 'StairStepPolicySpec')
  if (source.kind !== 'stair-step' || source.advancement !== 'continuous' && source.advancement !== 'checkpoint'
    || typeof source.requireVisibleArtifact !== 'boolean' || !Array.isArray(source.pauseOn)) throw new Error('dsh-legion: invalid StairStepPolicySpec')
  const maxMilestones = positive(source.maxMilestones, 'maxMilestones')
  const maxNoProgressMilestones = positive(source.maxNoProgressMilestones, 'maxNoProgressMilestones')
  if (maxNoProgressMilestones > maxMilestones) throw new Error('dsh-legion: maxNoProgressMilestones exceeds maxMilestones')
  const pauseOn = [...new Set(source.pauseOn.map((item, index) => {
    if (typeof item !== 'string' || !PAUSE_REASONS.includes(item as StairStepPauseReason)) throw new Error('dsh-legion: invalid pauseOn[' + index + ']')
    return item as StairStepPauseReason
  }))].sort(compare)
  return deepFreeze({ kind: 'stair-step', plannerMember: text(source.plannerMember, 'plannerMember'), verifierMember: text(source.verifierMember, 'verifierMember'), advancement: source.advancement, maxMilestones, maxNoProgressMilestones, requireVisibleArtifact: source.requireVisibleArtifact, pauseOn })
}
export function expandStairStepPolicy(value: unknown, namespace: string): ExpandedStairStepPolicy {
  if (!LOCAL_ID.test(namespace) || namespace.startsWith('@legion')) throw new Error('dsh-legion: invalid stair-step namespace')
  const policy = materializeStairStepPolicy(value)
  const identity = { schemaVersion: 1, kind: 'legion-stair-step-policy', namespace, policy }
  return deepFreeze({ schemaVersion: 1, policy, plannerTaskId: TaskId('@legion/delta/' + namespace + '/stair-step-planner'), verifierTaskId: TaskId('@legion/delta/' + namespace + '/stair-step-verifier'), policyDigest: sha256Digest(canonicalValue(identity)) })
}
export function expandStairStepToPlanDelta(input: { readonly policy: unknown; readonly namespace: string; readonly basePlanVersion: PlanVersion; readonly planner: Omit<TaskSpec, 'taskId'>; readonly verifier: Omit<TaskSpec, 'taskId'> }): PlanDeltaProposal {
  expandStairStepPolicy(input.policy, input.namespace)
  return deepFreeze({ schemaVersion: 1, deltaId: DeltaId(input.namespace), basePlanVersion: input.basePlanVersion, reason: 'Expand public stair-step advancement policy.', evidence: [], operations: [
    { kind: 'add-node', localId: 'stair-step-planner', node: deepCopy(input.planner) },
    { kind: 'add-node', localId: 'stair-step-verifier', node: deepCopy(input.verifier) },
    { kind: 'add-edge', from: 'stair-step-planner', to: 'stair-step-verifier', reason: 'after' },
  ] })
}
function validateSpec(spec: MilestoneSpec): void {
  if (!Number.isSafeInteger(spec.index) || spec.index < 1 || !spec.outcomeDelta || !spec.deliverable
    || spec.acceptance.length === 0 || spec.risksToRetire.length === 0 || spec.taskIds.length === 0
    || spec.budget.maxTasks < 1 || spec.budget.maxAttempts < 1 || spec.taskIds.length > spec.budget.maxTasks
    || spec.interaction !== 'auto' && spec.interaction !== 'checkpoint') throw new Error('invalid milestone spec')
}
function progressDigest(progress: readonly ProgressEvidence[]): ArtifactDigest {
  const canonical = [...progress].sort((a, b) => compare(JSON.stringify(canonicalValue(a)), JSON.stringify(canonicalValue(b))))
  return ArtifactDigest(sha256Digest({ kind: 'legion-stair-step-progress', progress: canonical }))
}
export function evaluateStairStepMilestone(input: { readonly policy: StairStepPolicySpec; readonly spec: MilestoneSpec; readonly observation: MilestoneObservation; readonly previousNoProgressMilestones: number; readonly acceptedProgressDigests?: readonly ArtifactDigest[] }): StairStepEvaluation {
  const policy = materializeStairStepPolicy(input.policy)
  try { validateSpec(input.spec) } catch (error) { return deepFreeze({ kind: 'rejected', reason: 'malformed', message: error instanceof Error ? error.message : 'invalid milestone' }) }
  if (input.spec.index > policy.maxMilestones) return deepFreeze({ kind: 'rejected', reason: 'milestone-limit', message: 'milestone limit exceeded' })
  const verification = new Map(input.observation.verification.map(item => [item.criterion, item]))
  if (!input.spec.acceptance.every(item => verification.get(item.criterion)?.accepted === true && verification.get(item.criterion)!.evidence.length > 0)) return deepFreeze({ kind: 'rejected', reason: 'verification-failure', message: 'acceptance verification failed' })
  if (policy.requireVisibleArtifact && input.observation.artifacts.length === 0) return deepFreeze({ kind: 'rejected', reason: 'visible-artifact-required', message: 'a visible artifact is required' })
  const targets = new Set(input.spec.risksToRetire)
  if (input.observation.risksRetired.some(risk => !targets.has(risk))) return deepFreeze({ kind: 'rejected', reason: 'malformed', message: 'retired risk was not targeted' })
  const digest = progressDigest(input.observation.progress)
  const madeProgress = !(input.acceptedProgressDigests ?? []).includes(digest) && input.observation.progress.length > 0
  const noProgressMilestones = madeProgress ? 0 : input.previousNoProgressMilestones + 1
  const signal = input.observation.signals?.find(item => policy.pauseOn.includes(item))
  const pauseReason = signal ?? (noProgressMilestones >= policy.maxNoProgressMilestones && policy.pauseOn.includes('no-progress') ? 'no-progress' : undefined)
  const nextDecision: MilestoneReceipt['nextDecision'] = pauseReason !== undefined ? 'pause' : input.observation.stop ? 'complete' : input.observation.revise ? 'revise' : 'advance'
  const receiptBase = { schemaVersion: 1 as const, milestoneId: text(input.observation.milestoneId, 'milestoneId'), step: input.spec.index, title: text(input.observation.title, 'title'), summary: text(input.observation.summary, 'summary', 4096), spec: deepCopy(input.spec), artifacts: deepCopy(input.observation.artifacts), verification: deepCopy(input.observation.verification), retiredRisks: [...new Set(input.observation.risksRetired)].sort(compare), openRisks: [...new Set(input.observation.openRisks)].sort(compare), observedDelta: text(input.observation.observedDelta, 'observedDelta', 4096), progress: deepCopy(input.observation.progress), progressDigest: digest, nextDecision, decisionSummary: pauseReason ?? nextDecision, acceptedAt: input.observation.acceptedAt, noProgressMilestones }
  const receipt: MilestoneReceipt = deepFreeze({ ...receiptBase, receiptDigest: ArtifactDigest(sha256Digest({ kind: 'legion-milestone-receipt', receipt: receiptBase })) })
  return pauseReason === undefined ? deepFreeze({ kind: 'accepted', receipt, madeProgress }) : deepFreeze({ kind: 'suspended', receipt, reason: pauseReason })
}
export function decideStairStepAdvancement(input: { readonly policy: StairStepPolicySpec; readonly receipt: MilestoneReceipt; readonly milestonesInActivation: number; readonly activationMilestoneLimit: number }): StairStepAdvanceDecision {
  const policy = materializeStairStepPolicy(input.policy)
  if (!Number.isSafeInteger(input.milestonesInActivation) || input.milestonesInActivation < 1 || !Number.isSafeInteger(input.activationMilestoneLimit) || input.activationMilestoneLimit < 1) throw new Error('dsh-legion: invalid activation milestone bounds')
  if (input.receipt.nextDecision === 'pause') return deepFreeze({ kind: 'yield', reason: 'policy-pause' })
  if (input.receipt.nextDecision === 'complete') return deepFreeze({ kind: 'yield', reason: 'complete' })
  if (policy.advancement === 'checkpoint' || input.receipt.spec.interaction === 'checkpoint') return deepFreeze({ kind: 'yield', reason: 'checkpoint' })
  if (input.milestonesInActivation >= input.activationMilestoneLimit) return deepFreeze({ kind: 'yield', reason: 'activation-limit' })
  return deepFreeze({ kind: 'continue' })
}
export async function checkpointMilestoneBeforeYield(steps: { readonly appendMilestone: () => void | Promise<void>; readonly appendContinuation: () => void | Promise<void>; readonly flush: () => boolean | Promise<boolean> }): Promise<void> {
  await steps.appendMilestone(); if (!await steps.flush()) throw new Error('dsh-legion: DURABILITY_UNAVAILABLE')
  await steps.appendContinuation(); if (!await steps.flush()) throw new Error('dsh-legion: DURABILITY_UNAVAILABLE')
}
