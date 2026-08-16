import type { Session, SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session'
import { deepCopy } from '../internal/value.ts'
import type {
  AttemptRecord,
  ContinuationRecord,
  DecisionRecord,
  Fence,
  MailRecord,
  MilestoneReceipt,
  PlanRecord,
  PlanVersion,
  RunId,
  RunRecord,
  TaskRecord,
} from './contract.ts'
import { assertLegionTransition, type LegionInvariantState } from './invariant.ts'
import { validateLegionEventData } from './validate.ts'

export interface LegionEventHeader {
  readonly schemaVersion: 1
  readonly runId: RunId
  readonly planVersion: PlanVersion
  readonly correlationId: string
  readonly causationSeq?: number
  readonly phase?: 'create' | 'plan' | 'dispatch' | 'settle' | 'suspend' | 'terminal'
}

export interface LegionRunStateEvent extends LegionEventHeader {
  readonly record: RunRecord
}

export interface LegionPlanStateEvent extends LegionEventHeader {
  readonly record: PlanRecord
}

export interface LegionTaskStateEvent extends LegionEventHeader {
  readonly taskId: TaskRecord['taskId']
  readonly generation: number
  readonly record: TaskRecord
}

export interface LegionMailStateEvent extends LegionEventHeader {
  readonly mailId: MailRecord['message']['mailId']
  readonly taskId: MailRecord['message']['recipientTaskId']
  readonly recipientGeneration: number
  readonly fence?: Fence
  readonly record: MailRecord
}

export interface LegionMilestoneEvent extends LegionEventHeader {
  readonly record: MilestoneReceipt
}

export interface LegionDecisionEvent extends LegionEventHeader {
  readonly record: DecisionRecord
}

export interface LegionContinuationStateEvent extends LegionEventHeader {
  readonly continuationId: ContinuationRecord['continuationId']
  readonly record: ContinuationRecord
}

export interface LegionAttemptStateEvent extends LegionEventHeader {
  readonly taskId: TaskRecord['taskId']
  readonly attemptId: AttemptRecord['attemptId']
  readonly generation: number
  readonly fence: Fence
  readonly record: AttemptRecord
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'legion/run-state': LegionRunStateEvent
    'legion/plan-state': LegionPlanStateEvent
    'legion/task-state': LegionTaskStateEvent
    'legion/attempt-state': LegionAttemptStateEvent
    'legion/mail-state': LegionMailStateEvent
    'legion/milestone': LegionMilestoneEvent
    'legion/decision': LegionDecisionEvent
    'legion/continuation-state': LegionContinuationStateEvent
  }
}

export const LEGION_EVENT_TYPES = [
  'legion/run-state',
  'legion/plan-state',
  'legion/task-state',
  'legion/attempt-state',
  'legion/mail-state',
  'legion/milestone',
  'legion/decision',
  'legion/continuation-state',
] as const

export type LegionEventType = typeof LEGION_EVENT_TYPES[number]
export type LegionEvent = SessionEvent<LegionEventType>

export type PendingLegionEvent = {
  readonly [Type in LegionEventType]: {
    readonly type: Type
    readonly data: SessionEventMap[Type]
  }
}[LegionEventType]

export function isLegionEventType(type: string): type is LegionEventType {
  return (LEGION_EVENT_TYPES as readonly string[]).includes(type)
}

export function isLegionEvent(
  event: { readonly type: string },
): event is LegionEvent {
  return isLegionEventType(event.type)
}

/** Validate and append one detached pending Legion event. */
export function appendLegionEvent(
  session: Session,
  state: LegionInvariantState,
  pending: PendingLegionEvent,
): LegionEvent {
  const data = validateLegionEventData(pending.type, pending.data)
  assertLegionTransition(state, pending.type, data)
  return session.append(pending.type, deepCopy(data))
}
