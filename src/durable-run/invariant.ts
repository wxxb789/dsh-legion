import type { SessionEventMap } from '@deepseek-ai/dsh-session/types'
import type { AttemptRecord, ContinuationRecord, MailRecord, PlanVersion, RunRecord, TaskRecord } from './contract.ts'
import type { LegionEventType } from './events.ts'

export interface LegionInvariantRun {
  readonly run: RunRecord
  readonly plans: Readonly<Record<string, SessionEventMap['legion/plan-state']['record']>>
  readonly tasks: Readonly<Record<string, TaskRecord>>
  readonly attempts: Readonly<Record<string, AttemptRecord>>
  readonly mail?: Readonly<Record<string, MailRecord>>
  readonly continuations?: Readonly<Record<string, ContinuationRecord>>
}

export interface LegionInvariantState {
  readonly runs: Readonly<Record<string, LegionInvariantRun>>
}

const TERMINAL_RUN_STATUSES = new Set([
  'completed',
  'degraded',
  'cancelled',
  'failed',
])

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
  const current = state.runs[data.runId]

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
    if (TERMINAL_RUN_STATUSES.has(current.run.status)
      && record.status !== current.run.status) {
      throw new Error('dsh-legion: terminal durable run cannot transition')
    }
    return
  }

  if (current === undefined) {
    throw new Error('dsh-legion: durable run must exist before related events')
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
    const existing = current.tasks[record.taskId]
    if (existing !== undefined && record.generation < existing.generation) {
      throw new Error('dsh-legion: task generation cannot decrease')
    }
    return
  }

  if (type === 'legion/mail-state') {
    const record = (data as SessionEventMap['legion/mail-state']).record
    const mailEvent = data as SessionEventMap['legion/mail-state']
    const task = current.tasks[record.message.recipientTaskId]
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

  if (type === 'legion/milestone' || type === 'legion/decision') return

  const record = (data as SessionEventMap['legion/attempt-state']).record
  const task = current.tasks[record.taskId]
  if (task === undefined) {
    throw new Error('dsh-legion: attempt task must exist')
  }
  const existing = current.attempts[record.attemptId]
  if (existing !== undefined
    && (existing.taskId !== record.taskId
      || existing.planVersion !== record.planVersion
      || existing.generation !== record.generation
      || existing.fence !== record.fence
      || existing.effectClass !== record.effectClass
      || existing.idempotencyKey !== record.idempotencyKey
      || JSON.stringify(existing.owner) !== JSON.stringify(record.owner))) {
    throw new Error('dsh-legion: attempt safety identity cannot be rebound')
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
