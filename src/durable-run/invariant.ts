import type { SessionEventMap } from '@deepseek-ai/dsh-session/types'
import type { AttemptRecord, ContinuationRecord, MailRecord, MilestoneReceipt, PlanVersion, RunRecord, TaskRecord } from './contract.ts'
import type { LegionEventType } from './events.ts'
import {
  isTerminalAttemptStatus,
  isTerminalRunStatus,
  isTerminalTaskStatus,
} from './status.ts'

export interface LegionInvariantRun {
  readonly run: RunRecord
  readonly plans: Readonly<Record<string, SessionEventMap['legion/plan-state']['record']>>
  readonly tasks: Readonly<Record<string, TaskRecord>>
  readonly attempts: Readonly<Record<string, AttemptRecord>>
  readonly mail?: Readonly<Record<string, MailRecord>>
  readonly continuations?: Readonly<Record<string, ContinuationRecord>>
  readonly milestones?: readonly MilestoneReceipt[]
}

export interface LegionInvariantState {
  readonly runs: Readonly<Record<string, LegionInvariantRun>>
}

function assertVersionNotLower(current: PlanVersion, next: PlanVersion): void {
  if (next < current) {
    throw new Error('dsh-legion: plan version cannot decrease')
  }
}

export function assertLegionTransition<Type extends LegionEventType>(
  state: LegionInvariantState,
  type: Type,
  data: SessionEventMap[Type],
): void {
  const current = Object.hasOwn(state.runs, data.runId)
    ? state.runs[data.runId]
    : undefined

  if (type === 'legion/run-state') {
    const record = (data as SessionEventMap['legion/run-state']).record
    if (current === undefined) {
      if (record.status !== 'created') {
        throw new Error('dsh-legion: a new durable run must start in created state')
      }
      return
    }

    assertVersionNotLower(current.run.currentPlanVersion, record.currentPlanVersion)
    if (current.run.fence !== undefined && record.fence !== undefined
      && record.fence < current.run.fence) {
      throw new Error('dsh-legion: run fence cannot decrease')
    }
    if (isTerminalRunStatus(current.run.status)) {
      throw new Error('dsh-legion: terminal durable run cannot transition')
    }
    return
  }

  if (current === undefined) {
    throw new Error('dsh-legion: durable run must exist before related events')
  }
  if (isTerminalRunStatus(current.run.status)) {
    throw new Error('dsh-legion: terminal durable run cannot accept related events')
  }
  assertVersionNotLower(current.run.currentPlanVersion, data.planVersion)

  if (type === 'legion/plan-state') {
    const record = (data as SessionEventMap['legion/plan-state']).record
    const existing = current.plans[String(record.version)]
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(record)) {
      throw new Error('dsh-legion: committed plan version cannot be rewritten')
    }
    return
  }

  if (type === 'legion/task-state') {
    const record = (data as SessionEventMap['legion/task-state']).record
    const existing = Object.hasOwn(current.tasks, record.taskId)
      ? current.tasks[record.taskId]
      : undefined
    if (existing !== undefined && record.generation < existing.generation) {
      throw new Error('dsh-legion: task generation cannot decrease')
    }
    if (existing !== undefined && isTerminalTaskStatus(existing.status)) {
      throw new Error('dsh-legion: terminal task cannot transition or repeat')
    }
    return
  }

  if (type === 'legion/mail-state') {
    const record = (data as SessionEventMap['legion/mail-state']).record
    const mailEvent = data as SessionEventMap['legion/mail-state']
    const task = Object.hasOwn(current.tasks, record.message.recipientTaskId)
      ? current.tasks[record.message.recipientTaskId]
      : undefined
    if (task === undefined) throw new Error('dsh-legion: mail task must exist')
    if (task.generation !== record.recipientGeneration
      || mailEvent.recipientGeneration !== record.recipientGeneration) {
      throw new Error('dsh-legion: mail recipient generation is stale')
    }
    if ((record.status === 'reserved'
      || record.status === 'incorporated'
      || record.status === 'acknowledged')
      && mailEvent.fence !== record.reservation.fence) {
      throw new Error('dsh-legion: mail fence is stale')
    }
    if (record.status === 'discarded' && mailEvent.fence === undefined) {
      throw new Error('dsh-legion: discarded mail requires an active fence')
    }
    if (current.run.fence !== undefined
      && mailEvent.fence !== undefined
      && mailEvent.fence !== current.run.fence) {
      throw new Error('dsh-legion: mail event fence is not current')
    }
    const existing = current.mail?.[record.message.mailId]
    if (existing !== undefined) {
      if (existing.message.idempotencyKey !== record.message.idempotencyKey) throw new Error('dsh-legion: mail identity cannot be rebound')
      if ((existing.status === 'acknowledged' || existing.status === 'discarded') && JSON.stringify(existing) !== JSON.stringify(record)) throw new Error('dsh-legion: terminal mail cannot transition')
      if (existing.status === 'incorporated' && record.status !== 'incorporated' && record.status !== 'acknowledged') throw new Error('dsh-legion: incorporated mail cannot regress')
      if (existing.status === 'reserved' && record.status === 'queued' && record.reclaimCount !== existing.reclaimCount + 1) throw new Error('dsh-legion: reclaimed mail must increment reclaim count')
      if (record.reclaimCount < existing.reclaimCount) throw new Error('dsh-legion: mail reclaim count cannot decrease')
    }
    return
  }

  if (type === 'legion/continuation-state') {
    const record = (data as SessionEventMap['legion/continuation-state']).record
    const existing = current.continuations?.[record.continuationId]
    if (existing !== undefined && existing.status !== 'available' && JSON.stringify(existing) !== JSON.stringify(record)) {
      throw new Error('dsh-legion: terminal continuation cannot transition')
    }
    if (existing?.status === 'available' && record.status === 'available' && JSON.stringify(existing) !== JSON.stringify(record)) {
      throw new Error('dsh-legion: available continuation cannot be rewritten')
    }
    return
  }

  if (type === 'legion/milestone') {
    const receipt = (data as SessionEventMap['legion/milestone']).record
    const previous = current.milestones?.at(-1)
    if (previous !== undefined && receipt.step !== previous.step + 1) {
      throw new Error('dsh-legion: milestone step must advance contiguously')
    }
    if (previous === undefined && receipt.step !== 1) {
      throw new Error('dsh-legion: first milestone step must be 1')
    }
    if (current.milestones?.some(item => item.milestoneId === receipt.milestoneId
      || item.receiptDigest === receipt.receiptDigest)) {
      throw new Error('dsh-legion: milestone receipt cannot be duplicated')
    }
    return
  }

  if (type === 'legion/decision') return

  const record = (data as SessionEventMap['legion/attempt-state']).record
  const task = Object.hasOwn(current.tasks, record.taskId)
    ? current.tasks[record.taskId]
    : undefined
  if (task === undefined) {
    throw new Error('dsh-legion: attempt task must exist')
  }
  const activeFence = current.run.fence
  if (activeFence !== undefined && record.fence !== activeFence) {
    throw new Error('dsh-legion: attempt fence is not current')
  }
  if (isTerminalTaskStatus(task.status)) {
    throw new Error('dsh-legion: terminal task cannot admit or settle another attempt')
  }
  const existing = Object.hasOwn(current.attempts, record.attemptId)
    ? current.attempts[record.attemptId]
    : undefined
  if (existing !== undefined && isTerminalAttemptStatus(existing.status)) {
    throw new Error('dsh-legion: terminal attempt cannot transition or repeat')
  }
  if (existing !== undefined
    && (existing.taskId !== record.taskId
      || existing.planVersion !== record.planVersion
      || existing.generation !== record.generation
      || existing.fence !== record.fence
      || existing.effectClass !== record.effectClass
      || existing.idempotencyKey !== record.idempotencyKey
      || JSON.stringify(existing.binding) !== JSON.stringify(record.binding)
      || JSON.stringify(existing.owner) !== JSON.stringify(record.owner))) {
    throw new Error('dsh-legion: attempt safety identity cannot be rebound')
  }
  if (record.binding !== undefined
    && (record.binding.attemptId !== record.attemptId
      || record.binding.taskId !== record.taskId
      || record.binding.planVersion !== record.planVersion
      || record.binding.generation !== record.generation
      || record.binding.fence !== record.fence
      || record.binding.profile !== record.profile
      || record.binding.routePlanDigest !== record.routePlanDigest
      || record.binding.environmentDigest !== record.environmentDigest
      || record.binding.contextManifestDigest !== record.contextDigest)) {
    throw new Error('dsh-legion: attempt record disagrees with immutable binding')
  }
  if (record.childSessionIds.length > 1) {
    throw new Error('dsh-legion: one child may start per attempt')
  }
  if (record.result !== undefined
    && (record.result.runId !== data.runId
      || record.result.taskId !== record.taskId
      || record.result.attemptId !== record.attemptId
      || record.result.planVersion !== record.planVersion
      || record.result.generation !== record.generation
      || record.result.fence !== record.fence
      || record.result.routePlanDigest !== record.routePlanDigest
      || record.result.environmentDigest !== record.environmentDigest
      || record.result.contextDigest !== record.contextDigest)) {
    throw new Error('dsh-legion: attempt result identity is stale')
  }
}
