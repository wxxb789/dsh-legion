import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { deepCopy, deepFreeze } from '../internal/value.ts'
import type { ProfileName, StrategyName } from '../identity.ts'

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
export type ContinuationId = Brand<string, 'LegionContinuationId'>
export type OwnerId = Brand<string, 'LegionOwnerId'>
export type Fence = Brand<number, 'LegionFence'>
export type StrategyPlanDigest = Brand<`sha256:${string}`, 'StrategyPlanDigest'>
export type CatalogDigest = Brand<`sha256:${string}`, 'CatalogDigest'>
export type RoutePlanDigest = Brand<`sha256:${string}`, 'RoutePlanDigest'>
export type ArtifactDigest = Brand<`sha256:${string}`, 'ArtifactDigest'>
export type EnvironmentDigest = Brand<`sha256:${string}`, 'EnvironmentDigest'>
export type ContextDigest = Brand<`sha256:${string}`, 'ContextDigest'>

const IDENTITY = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
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
  return namedIdentity(value, 'LegionTaskId')
}

export function AttemptId(value: unknown): AttemptId {
  return namedIdentity(value, 'LegionAttemptId')
}

export function MailId(value: unknown): MailId {
  return namedIdentity(value, 'LegionMailId')
}

export function ContinuationId(value: unknown): ContinuationId {
  return namedIdentity(value, 'LegionContinuationId')
}

export function OwnerId(value: unknown): OwnerId {
  return namedIdentity(value, 'LegionOwnerId')
}

export function Fence(value: unknown): Fence {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error('dsh-legion: invalid fence')
  }
  return value as Fence
}

export function StrategyPlanDigest(value: unknown): StrategyPlanDigest {
  return digestIdentity(value, 'StrategyPlanDigest')
}

export function CatalogDigest(value: unknown): CatalogDigest {
  return digestIdentity(value, 'CatalogDigest')
}

export function RoutePlanDigest(value: unknown): RoutePlanDigest {
  return digestIdentity(value, 'RoutePlanDigest')
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
  readonly strategyPlanDigest: StrategyPlanDigest
  readonly catalogDigest: CatalogDigest
  readonly goalVersion: GoalVersion
  readonly goal: GoalSpec
  readonly currentPlanVersion: PlanVersion
  readonly status: RunStatus
  readonly currentMilestone?: string
  readonly ownerId?: OwnerId
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
  readonly digest: ArtifactDigest
  readonly nodeCount: number
  readonly environmentDigest: EnvironmentDigest
}

export interface ArtifactRef {
  readonly name: string
  readonly digest: ArtifactDigest
  readonly mediaType: string
  readonly byteLength: number
}

export interface ResultEnvelope {
  readonly schemaVersion: 1
  readonly taskId: TaskId
  readonly attemptId: AttemptId
  readonly generation: number
  readonly fence: Fence
  readonly runId: RunId
  readonly planVersion: PlanVersion
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
  readonly ownerId: OwnerId
  readonly profile: ProfileName
  readonly routePlanDigest: RoutePlanDigest
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

export interface MailRecord {
  readonly schemaVersion: 1
  readonly mailId: MailId
  readonly runId: RunId
  readonly taskId: TaskId
  readonly status: 'queued' | 'reserved' | 'incorporated' | 'acknowledged' | 'reclaimed' | 'discarded'
  readonly payloadDigest: ArtifactDigest
  readonly updatedAt: number
}

export interface MilestoneRecord {
  readonly schemaVersion: 1
  readonly milestoneId: string
  readonly title: string
  readonly summary: string
  readonly acceptedAt: number
}

export interface DecisionRecord {
  readonly schemaVersion: 1
  readonly decisionId: string
  readonly kind: 'plan-change' | 'failure' | 'recovery' | 'review'
  readonly summary: string
  readonly digest: ArtifactDigest
}

export interface ContinuationRecord {
  readonly schemaVersion: 1
  readonly continuationId: ContinuationId
  readonly status: 'active' | 'consumed'
  readonly planVersion: PlanVersion
  readonly digest: ArtifactDigest
  readonly updatedAt: number
}
