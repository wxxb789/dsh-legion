import { deepFreeze } from '../internal/value.ts'
import type {
  AttemptId,
  AttemptRecord,
  EffectClass,
  Fence,
  OwnerFingerprint,
  ResultEnvelope,
  TaskId,
} from './contract.ts'

export interface RecoveryTaskState {
  readonly taskId: TaskId
  readonly generation: number
  readonly terminal: boolean
  readonly effectClass: EffectClass
  readonly attempt?: AttemptRecord
}

export type RecoveryReceipt =
  | { readonly kind: 'proven'; readonly result: ResultEnvelope }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unknown'; readonly reason: string }

export type RecoveryAction =
  | { readonly kind: 'keep-terminal'; readonly taskId: TaskId }
  | {
      readonly kind: 'abandon-attempt'
      readonly taskId: TaskId
      readonly attemptId: AttemptId
    }
  | {
      readonly kind: 'incorporate-receipt'
      readonly taskId: TaskId
      readonly result: ResultEnvelope
    }
  | {
      readonly kind: 'reject-stale-result'
      readonly taskId: TaskId
      readonly reason: string
    }
  | {
      readonly kind: 'retry'
      readonly taskId: TaskId
      readonly generation: number
      readonly idempotencyKey?: string
    }
  | { readonly kind: 'needs-attention'; readonly taskId: TaskId; readonly code: string }

export interface RecoveryPlan {
  readonly schemaVersion: 1
  readonly baseJournalSeq: number
  readonly fence: Fence
  readonly owner: OwnerFingerprint
  readonly actions: readonly RecoveryAction[]
}

function compareTask(left: RecoveryAction, right: RecoveryAction): number {
  if (left.taskId !== right.taskId) return left.taskId < right.taskId ? -1 : 1
  return left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0
}

function receiptMatches(
  task: RecoveryTaskState,
  result: ResultEnvelope,
): boolean {
  const attempt = task.attempt
  return attempt !== undefined
    && result.taskId === task.taskId
    && result.attemptId === attempt.attemptId
    && result.generation === task.generation
    && result.generation === attempt.generation
    && result.fence === attempt.fence
    && result.planVersion === attempt.planVersion
    && result.routePlanDigest === attempt.routePlanDigest
    && result.environmentDigest === attempt.environmentDigest
    && result.contextDigest === attempt.contextDigest
}

export function planRecovery(input: {
  readonly tasks: readonly RecoveryTaskState[]
  readonly receipts: Readonly<Record<string, RecoveryReceipt>>
  readonly baseJournalSeq: number
  readonly fence: Fence
  readonly owner: OwnerFingerprint
}): RecoveryPlan {
  if (!Number.isSafeInteger(input.baseJournalSeq) || input.baseJournalSeq < 0) {
    throw new Error('dsh-legion: invalid recovery journal sequence')
  }
  const seen = new Set<string>()
  const actions: RecoveryAction[] = []
  for (const task of input.tasks) {
    if (seen.has(task.taskId)) throw new Error('dsh-legion: duplicate recovery task')
    seen.add(task.taskId)
    if (task.terminal) {
      actions.push({ kind: 'keep-terminal', taskId: task.taskId })
      continue
    }
    const receipt = input.receipts[task.taskId]
    if (receipt?.kind === 'proven') {
      actions.push(receiptMatches(task, receipt.result)
        ? { kind: 'incorporate-receipt', taskId: task.taskId, result: receipt.result }
        : {
            kind: 'reject-stale-result',
            taskId: task.taskId,
            reason: 'receipt identity does not match the active attempt and fence',
          })
      continue
    }
    if (task.attempt !== undefined) {
      actions.push({
        kind: 'abandon-attempt',
        taskId: task.taskId,
        attemptId: task.attempt.attemptId,
      })
    }
    if (task.effectClass === 'read') {
      actions.push({ kind: 'retry', taskId: task.taskId, generation: task.generation + 1 })
      continue
    }
    if (task.effectClass === 'idempotent-write' && task.attempt?.idempotencyKey !== undefined) {
      actions.push({
        kind: 'retry',
        taskId: task.taskId,
        generation: task.generation + 1,
        idempotencyKey: task.attempt.idempotencyKey,
      })
      continue
    }
    actions.push({
      kind: 'needs-attention',
      taskId: task.taskId,
      code: 'LEGION_RECOVERY_EFFECT_AMBIGUOUS',
    })
  }
  return deepFreeze({
    schemaVersion: 1,
    baseJournalSeq: input.baseJournalSeq,
    fence: input.fence,
    owner: input.owner,
    actions: actions.sort(compareTask),
  })
}
