import { SessionId } from '@deepseek-ai/dsh-session/types'
import { ProfileName, StrategyName } from '../src/identity.ts'
import {
  ArtifactDigest,
  AttemptId,
  EnvironmentDigest,
  Fence,
  GoalVersion,
  OwnerId,
  PlanDigest,
  PlanVersion,
  RoutePlanDigest,
  StrategyPlanDigest,
  CatalogDigest,
  RunId,
  TaskId,
  type AttemptRecord,
  type PlanRecord,
  type RunRecord,
  type TaskRecord,
} from '../src/durable-run/contract.ts'
import type { PendingLegionEvent } from '../src/durable-run/events.ts'

export const runId = RunId('run-one')
export const planVersion = PlanVersion(1)
export const environmentDigest = EnvironmentDigest(`sha256:${'a'.repeat(64)}`)
export const artifactDigest = ArtifactDigest(`sha256:${'b'.repeat(64)}`)
export const taskId = TaskId('task-one')
export const attemptId = AttemptId('attempt-one')

export const runRecord: RunRecord = {
  schemaVersion: 1,
  runId,
  anchorSessionId: SessionId('session-one'),
  strategyName: StrategyName('synthetic'),
  strategyPlanDigest: StrategyPlanDigest(`sha256:${'c'.repeat(64)}`),
  catalogDigest: CatalogDigest(`sha256:${'d'.repeat(64)}`),
  goalVersion: GoalVersion(1),
  goal: {
    version: GoalVersion(1),
    statement: 'Verify durable replay.',
    acceptance: ['Projection is deterministic.'],
    constraints: [],
    nonGoals: [],
    authorityDigest: artifactDigest,
  },
  currentPlanVersion: planVersion,
  status: 'created',
  environmentDigest,
  createdAt: 1,
  updatedAt: 1,
}

export const planRecord: PlanRecord = {
  schemaVersion: 1,
  runId,
  version: planVersion,
  goalVersion: GoalVersion(1),
  digest: PlanDigest(artifactDigest),
  nodeCount: 1,
  environmentDigest,
}

export const taskRecord: TaskRecord = {
  schemaVersion: 1,
  taskId,
  planVersion,
  generation: 1,
  status: 'pending',
  acceptedArtifacts: [],
  updatedAt: 2,
}

export const attemptRecord: AttemptRecord = {
  schemaVersion: 1,
  attemptId,
  taskId,
  planVersion,
  generation: 1,
  fence: Fence(1),
  ownerId: OwnerId('owner-one'),
  profile: ProfileName('product'),
  routePlanDigest: RoutePlanDigest(`sha256:${'e'.repeat(64)}`),
  status: 'prepared',
  environmentDigest,
  childSessionIds: [],
  updatedAt: 3,
}

export function pendingRun(record: RunRecord = runRecord): PendingLegionEvent {
  return {
    type: 'legion/run-state',
    data: {
      schemaVersion: 1,
      runId,
      planVersion: record.currentPlanVersion,
      correlationId: 'correlation-one',
      phase: 'create',
      record,
    },
  }
}

export function exportedEvent(
  pending: PendingLegionEvent,
  seq: number,
): Record<string, unknown> {
  return {
    type: pending.type,
    seq,
    time: 100 + seq,
    data: pending.data,
  }
}
