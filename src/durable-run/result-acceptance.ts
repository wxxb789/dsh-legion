import type { AttemptRecord, Fence, ResultEnvelope, RunRecord, TaskRecord } from './contract.ts'
import {
  isTerminalAttemptStatus,
  isTerminalRunStatus,
  isTerminalTaskStatus,
} from './status.ts'

export type ResultRejectionCode =
  | 'run-mismatch'
  | 'task-missing'
  | 'plan-stale'
  | 'generation-stale'
  | 'attempt-stale'
  | 'fence-stale'
  | 'task-terminal'
  | 'digest-mismatch'
  | 'contract-invalid'

export type ResultAcceptanceDecision =
  | { readonly kind: 'accept' }
  | { readonly kind: 'reject'; readonly code: ResultRejectionCode }

export function decideResultAcceptance(input: {
  readonly run: RunRecord
  readonly task?: TaskRecord
  readonly attempt?: AttemptRecord
  readonly activeFence: Fence
  readonly result: ResultEnvelope
  readonly contractValid: boolean
}): ResultAcceptanceDecision {
  const { run, task, attempt, result } = input
  if (result.runId !== run.runId) return { kind: 'reject', code: 'run-mismatch' }
  if (task === undefined || attempt === undefined) return { kind: 'reject', code: 'task-missing' }
  if (result.taskId !== task.taskId || attempt.taskId !== task.taskId) {
    return { kind: 'reject', code: 'task-missing' }
  }
  if (result.planVersion !== run.currentPlanVersion
    || result.planVersion !== task.planVersion
    || result.planVersion !== attempt.planVersion) {
    return { kind: 'reject', code: 'plan-stale' }
  }
  if (result.generation !== task.generation || result.generation !== attempt.generation) {
    return { kind: 'reject', code: 'generation-stale' }
  }
  if (task.currentAttempt !== result.attemptId
    || attempt.attemptId !== result.attemptId) {
    return { kind: 'reject', code: 'attempt-stale' }
  }
  if (result.fence !== input.activeFence || attempt.fence !== input.activeFence) {
    return { kind: 'reject', code: 'fence-stale' }
  }
  if (isTerminalRunStatus(run.status)
    || isTerminalTaskStatus(task.status)
    || isTerminalAttemptStatus(attempt.status)) {
    return { kind: 'reject', code: 'task-terminal' }
  }
  if (result.routePlanDigest !== attempt.routePlanDigest
    || result.environmentDigest !== attempt.environmentDigest
    || result.contextDigest !== attempt.contextDigest) {
    return { kind: 'reject', code: 'digest-mismatch' }
  }
  return input.contractValid
    ? { kind: 'accept' }
    : { kind: 'reject', code: 'contract-invalid' }
}
