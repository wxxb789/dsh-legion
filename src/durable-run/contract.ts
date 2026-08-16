import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { deepCopy, deepFreeze } from '../internal/value.ts'
import type {
  CatalogDigest as CatalogDigestType,
  ProfileName,
  RoutePlanDigest as RoutePlanDigestType,
  StrategyName,
  StrategyPlanDigest as StrategyPlanDigestType,
} from '../identity.ts'
import type { PlanGraph } from './graph.ts'

export { CatalogDigest, RoutePlanDigest, StrategyPlanDigest } from '../identity.ts'

declare const durableBrand: unique symbol

type Brand<Value, Name extends string> = Value & {
  readonly [durableBrand]: Name
}

export type RunId = Brand<string, 'LegionRunId'>
export type PlanVersion = Brand<number, 'LegionPlanVersion'>
export type GoalVersion = Brand<number, 'LegionGoalVersion'>
export type TaskId = Brand<string, 'LegionTaskId'>
export type AttemptId = Brand<string, 'LegionAttemptId'>
export type MailId = Brand<string, 'LegionMailId'>
export type ReservationId = Brand<string, 'LegionReservationId'>
export type ContextGeneration = Brand<number, 'LegionContextGeneration'>
export type ContinuationId = Brand<string, 'LegionContinuationId'>
export type DeltaId = Brand<string, 'LegionDeltaId'>
export type AuthorityDigest = Brand<`sha256:${string}`, 'LegionAuthorityDigest'>
export type Fence = Brand<number, 'LegionFence'>
export type PlanDigest = Brand<`sha256:${string}`, 'LegionPlanDigest'>
export type ArtifactDigest = Brand<`sha256:${string}`, 'ArtifactDigest'>
export type EnvironmentDigest = Brand<`sha256:${string}`, 'EnvironmentDigest'>
export type ContextDigest = Brand<`sha256:${string}`, 'ContextDigest'>

const IDENTITY = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const GENERATED_TASK_ID = /^@legion\/delta\/[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/

function namedIdentity<Name extends string>(
  value: unknown,
  kind: Name,
): Brand<string, Name> {
  if (typeof value !== 'string' || !IDENTITY.test(value) || value.length > 128) {
    throw new Error(`dsh-legion: invalid ${kind}`)
  }
  return value as Brand<string, Name>
}

function positiveInteger<Name extends string>(
  value: unknown,
  kind: Name,
): Brand<number, Name> {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`dsh-legion: invalid ${kind}`)
  }
  return value as Brand<number, Name>
}

function digestIdentity<Name extends string>(
  value: unknown,
  kind: Name,
): Brand<`sha256:${string}`, Name> {
  if (typeof value !== 'string' || !SHA256_DIGEST.test(value)) {
    throw new Error(`dsh-legion: invalid ${kind}`)
  }
  return value as Brand<`sha256:${string}`, Name>
}

export function RunId(value: unknown): RunId {
  return namedIdentity(value, 'LegionRunId')
}

export function PlanVersion(value: unknown): PlanVersion {
  return positiveInteger(value, 'LegionPlanVersion')
}

export function GoalVersion(value: unknown): GoalVersion {
  return positiveInteger(value, 'LegionGoalVersion')
}

export function TaskId(value: unknown): TaskId {
  if (typeof value === 'string' && GENERATED_TASK_ID.test(value) && value.length <= 384) {
    return value as TaskId
  }
  return namedIdentity(value, 'LegionTaskId')
}

export function AttemptId(value: unknown): AttemptId {
  return namedIdentity(value, 'LegionAttemptId')
}

export function MailId(value: unknown): MailId {
  return namedIdentity(value, 'LegionMailId')
}

export function ReservationId(value: unknown): ReservationId {
  return namedIdentity(value, 'LegionReservationId')
}

export function ContextGeneration(value: unknown): ContextGeneration {
  return positiveInteger(value, 'LegionContextGeneration')
}

export function ContinuationId(value: unknown): ContinuationId {
  return namedIdentity(value, 'LegionContinuationId')
}

export function DeltaId(value: unknown): DeltaId {
  return namedIdentity(value, 'LegionDeltaId')
}

export function AuthorityDigest(value: unknown): AuthorityDigest {
  return digestIdentity(value, 'LegionAuthorityDigest')
}

export function Fence(value: unknown): Fence {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error('dsh-legion: invalid fence')
  }
  return value as Fence
}

export function PlanDigest(value: unknown): PlanDigest {
  return digestIdentity(value, 'LegionPlanDigest')
}

export function ArtifactDigest(value: unknown): ArtifactDigest {
  return digestIdentity(value, 'ArtifactDigest')
}

export function EnvironmentDigest(value: unknown): EnvironmentDigest {
  return digestIdentity(value, 'EnvironmentDigest')
}

export function ContextDigest(value: unknown): ContextDigest {
  return digestIdentity(value, 'ContextDigest')
}

export interface GoalSpec {
  readonly version: GoalVersion
  readonly statement: string
  readonly acceptance: readonly string[]
  readonly constraints: readonly string[]
  readonly nonGoals: readonly string[]
  readonly authorityDigest: ArtifactDigest
}

export const RUN_STATUSES = [
  'created',
  'active',
  'suspended',
  'completed',
  'degraded',
  'cancelled',
  'failed',
  'needs-attention',
] as const

export type RunStatus = typeof RUN_STATUSES[number]

export interface RunRecord {
  readonly schemaVersion: 1
  readonly runId: RunId
  readonly anchorSessionId: SessionId
  readonly strategyName: StrategyName
  readonly strategyPlanDigest: StrategyPlanDigestType
  readonly catalogDigest: CatalogDigestType
  readonly goalVersion: GoalVersion
  readonly goal: GoalSpec
  readonly currentPlanVersion: PlanVersion
  readonly status: RunStatus
  readonly currentMilestone?: string
  readonly fence?: Fence
  readonly environmentDigest: EnvironmentDigest
  readonly contextDigest?: ContextDigest
  readonly createdAt: number
  readonly updatedAt: number
  readonly terminalSummary?: string
}

export interface PlanRecord {
  readonly schemaVersion: 1
  readonly runId: RunId
  readonly version: PlanVersion
  readonly goalVersion: GoalVersion
  readonly digest: PlanDigest
  readonly nodeCount: number
  readonly environmentDigest: EnvironmentDigest
  /** Full reconstructible static graph for M2 plans; omission keeps M1 records inspect-only. */
  readonly graph?: PlanGraph
}

export interface ArtifactRef {
  readonly name: string
  readonly digest: ArtifactDigest
  readonly mediaType: string
  readonly byteLength: number
}

export type EffectClass = 'read' | 'idempotent-write' | 'non-idempotent-write'


export interface AuthorityProfileScope {
  readonly members: readonly string[]
  readonly tools: readonly string[]
  readonly providers: readonly string[]
  readonly models: readonly string[]
  readonly routes: readonly string[]
  readonly effectClasses: readonly EffectClass[]
}

export interface AuthorityEnvelope {
  readonly profiles: Readonly<Record<string, AuthorityProfileScope>>
  readonly maxDepth: number
  readonly allowGoalRevision: boolean
  readonly digest: AuthorityDigest
}

export interface OwnerFingerprint {
  readonly hostInstanceId: string
  readonly processBootId: string
  readonly pluginGeneration: string
  readonly anchorSessionId: string
  readonly activationId: string
}

export interface ResultEnvelope {
  readonly schemaVersion: 1
  readonly taskId: TaskId
  readonly attemptId: AttemptId
  readonly generation: number
  readonly fence: Fence
  readonly runId: RunId
  readonly planVersion: PlanVersion
  readonly routePlanDigest: RoutePlanDigestType
  readonly environmentDigest: EnvironmentDigest
  readonly contextDigest?: ContextDigest
  readonly summary: string
  readonly artifacts: readonly ArtifactRef[]
  readonly evidence: readonly ArtifactRef[]
  readonly decisions: readonly Readonly<Record<string, unknown>>[]
  readonly verification: readonly Readonly<Record<string, unknown>>[]
  readonly openRisks: readonly string[]
  readonly progress: Readonly<Record<string, unknown>>
}

export const TASK_STATUSES = [
  'pending',
  'ready',
  'leased',
  'running',
  'suspended',
  'succeeded',
  'failed',
  'cancelled',
  'superseded',
  'blocked',
] as const

export type TaskStatus = typeof TASK_STATUSES[number]

export interface TaskRecord {
  readonly schemaVersion: 1
  readonly taskId: TaskId
  readonly planVersion: PlanVersion
  readonly generation: number
  readonly status: TaskStatus
  readonly currentAttempt?: AttemptId
  readonly acceptedArtifacts: readonly ArtifactRef[]
  readonly contextDigest?: ContextDigest
  readonly failure?: string
  readonly updatedAt: number
}

export const ATTEMPT_STATUSES = [
  'prepared',
  'started',
  'settled',
  'abandoned',
  'rejected-stale',
] as const

export type AttemptStatus = typeof ATTEMPT_STATUSES[number]

export interface AttemptRecord {
  readonly schemaVersion: 1
  readonly attemptId: AttemptId
  readonly taskId: TaskId
  readonly planVersion: PlanVersion
  readonly generation: number
  readonly fence: Fence
  readonly owner: OwnerFingerprint
  readonly effectClass: EffectClass
  readonly idempotencyKey?: string
  readonly profile: ProfileName
  readonly routePlanDigest: RoutePlanDigestType
  readonly status: AttemptStatus
  readonly environmentDigest: EnvironmentDigest
  readonly contextDigest?: ContextDigest
  readonly childSessionIds: readonly SessionId[]
  readonly result?: ResultEnvelope
  readonly failure?: string
  readonly updatedAt: number
}

/** Clone and recursively freeze one validated boundary value. */
export function trustedRecord<Value>(value: Value): Readonly<Value> {
  return deepFreeze(deepCopy(value))
}

export type MailSender =
  | { readonly kind: 'controller'; readonly id: string }
  | { readonly kind: 'task'; readonly id: TaskId }
  | { readonly kind: 'user'; readonly id: string }

export type MailKind = 'assignment' | 'evidence' | 'decision' | 'steer' | 'cancel'

export interface MailMessage {
  readonly mailId: MailId
  readonly runId: RunId
  readonly sender: MailSender
  readonly recipientTaskId: TaskId
  readonly kind: MailKind
  readonly payload: readonly ArtifactRef[]
  readonly idempotencyKey: string
  readonly createdAt: number
  readonly expiresAt?: number
}

interface MailRecordBase {
  readonly schemaVersion: 1
  readonly message: MailMessage
  readonly recipientGeneration: number
  readonly reclaimCount: number
  readonly updatedAt: number
}

export interface QueuedMailRecord extends MailRecordBase {
  readonly status: 'queued'
}

export interface MailReservation {
  readonly reservationId: ReservationId
  readonly owner: OwnerFingerprint
  readonly fence: Fence
  readonly reservedAt: number
  readonly expiresAt: number
}

export interface ReservedMailRecord extends MailRecordBase {
  readonly status: 'reserved'
  readonly reservation: MailReservation
}

export interface IncorporatedMailRecord extends MailRecordBase {
  readonly status: 'incorporated'
  readonly reservation: MailReservation
  readonly contextGeneration: ContextGeneration
  readonly contextManifestDigest: ContextDigest
  readonly sharedPrefixDigest: ContextDigest
  readonly receiptDigest: ArtifactDigest
  readonly incorporatedAt: number
}

export interface AcknowledgedMailRecord extends MailRecordBase {
  readonly status: 'acknowledged'
  readonly reservation: MailReservation
  readonly contextGeneration: ContextGeneration
  readonly contextManifestDigest: ContextDigest
  readonly sharedPrefixDigest: ContextDigest
  readonly receiptDigest: ArtifactDigest
  readonly incorporatedAt: number
  readonly acknowledgedAt: number
}

export interface DiscardedMailRecord extends MailRecordBase {
  readonly status: 'discarded'
  readonly reason: 'expired' | 'recipient-terminal' | 'superseded' | 'policy'
  readonly discardedAt: number
}

export type MailRecord =
  | QueuedMailRecord
  | ReservedMailRecord
  | IncorporatedMailRecord
  | AcknowledgedMailRecord
  | DiscardedMailRecord

export interface AcceptanceCriterion { readonly criterion: string }
export interface MilestoneBudget { readonly maxTasks: number; readonly maxAttempts: number }
export interface MilestoneSpec {
  readonly index: number
  readonly outcomeDelta: string
  readonly deliverable: string
  readonly acceptance: readonly AcceptanceCriterion[]
  readonly risksToRetire: readonly string[]
  readonly taskIds: readonly TaskId[]
  readonly budget: MilestoneBudget
  readonly interaction: 'auto' | 'checkpoint'
}
export type ProgressEvidence =
  | { readonly kind: 'accepted-artifact'; readonly digest: ArtifactDigest }
  | { readonly kind: 'criterion-satisfied'; readonly criterion: string; readonly evidence: readonly ArtifactDigest[] }
  | { readonly kind: 'risk-retired'; readonly risk: string; readonly evidence: readonly ArtifactDigest[] }
  | { readonly kind: 'uncertainty-reduced'; readonly uncertainty: string; readonly evidence: readonly ArtifactDigest[] }
  | { readonly kind: 'blocked-path-rejected'; readonly path: string; readonly evidence: readonly ArtifactDigest[] }
export interface MilestoneVerification {
  readonly criterion: string
  readonly accepted: boolean
  readonly evidence: readonly ArtifactDigest[]
}
export interface MilestoneReceipt {
  readonly schemaVersion: 1
  readonly milestoneId: string
  readonly step: number
  readonly title: string
  readonly summary: string
  readonly spec: MilestoneSpec
  readonly artifacts: readonly ArtifactRef[]
  readonly verification: readonly MilestoneVerification[]
  readonly retiredRisks: readonly string[]
  readonly openRisks: readonly string[]
  readonly observedDelta: string
  readonly progress: readonly ProgressEvidence[]
  readonly progressDigest: ArtifactDigest
  readonly nextDecision: 'advance' | 'revise' | 'pause' | 'complete'
  readonly decisionSummary: string
  readonly acceptedAt: number
  readonly noProgressMilestones: number
  readonly receiptDigest: ArtifactDigest
}

export interface DecisionRecord {
  readonly schemaVersion: 1
  readonly decisionId: string
  readonly kind: 'plan-change' | 'failure' | 'recovery' | 'review'
  readonly summary: string
  readonly digest: ArtifactDigest
}

export interface ContinuationToken {
  readonly schemaVersion: 1
  readonly continuationId: ContinuationId
  readonly runId: RunId
  readonly anchorSessionId: SessionId
  readonly owner: OwnerFingerprint
  readonly fence: Fence
  readonly planVersion: PlanVersion
  readonly goalVersion: GoalVersion
  readonly contextDigest?: ContextDigest
  readonly environmentDigest: EnvironmentDigest
  readonly expectedInputs: readonly ArtifactDigest[]
  readonly limits: Readonly<Record<string, number>>
  readonly authority: AuthorityEnvelope
  readonly authorityDigest: AuthorityDigest
  readonly issuedAt: number
  readonly expiresAt?: number
  readonly digest: ArtifactDigest
}

export type ContinuationInvalidationReason =
  | 'expired' | 'stale-fence' | 'plan-changed' | 'goal-changed'
  | 'context-changed' | 'environment-changed' | 'inputs-changed'
  | 'limits-incompatible' | 'authority-incompatible' | 'owner-changed'

export type ContinuationRecord =
  | { readonly schemaVersion: 1; readonly continuationId: ContinuationId; readonly status: 'available'; readonly token: ContinuationToken; readonly updatedAt: number }
  | { readonly schemaVersion: 1; readonly continuationId: ContinuationId; readonly status: 'consumed'; readonly token: ContinuationToken; readonly consumedAt: number; readonly consumingFence: Fence; readonly updatedAt: number }
  | { readonly schemaVersion: 1; readonly continuationId: ContinuationId; readonly status: 'invalidated'; readonly token: ContinuationToken; readonly invalidatedAt: number; readonly reason: ContinuationInvalidationReason; readonly updatedAt: number }
