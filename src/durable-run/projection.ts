import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { deepCopy, deepFreeze } from '../internal/value.ts'
import type {
  AttemptRecord,
  ContinuationRecord,
  DecisionRecord,
  MailRecord,
  MilestoneRecord,
  PlanRecord,
  RunId,
  RunRecord,
  TaskRecord,
} from './contract.ts'
import { isLegionEvent } from './events.ts'

export const LEGION_RUN_PROJECTION_KEY = 'legion-run'
export const LEGION_RUN_PROJECTION_STATE_VERSION = 2

export interface ProjectedRun {
  readonly run?: RunRecord
  readonly plans: Readonly<Record<string, PlanRecord>>
  readonly tasks: Readonly<Record<string, TaskRecord>>
  readonly attempts: Readonly<Record<string, AttemptRecord>>
  readonly mail: Readonly<Record<string, MailRecord>>
  readonly continuations: Readonly<Record<string, ContinuationRecord>>
  readonly milestones: readonly MilestoneRecord[]
  readonly decisions: readonly DecisionRecord[]
}

export interface LegionProjectionState {
  readonly runs: Readonly<Record<string, ProjectedRun>>
}

export const EMPTY_LEGION_PROJECTION_STATE: LegionProjectionState = deepFreeze({
  runs: {},
})

function emptyProjectedRun(): ProjectedRun {
  return {
    plans: {},
    tasks: {},
    attempts: {},
    mail: {},
    continuations: {},
    milestones: [],
    decisions: [],
  }
}

export function applyLegionProjection(
  state: LegionProjectionState,
  event: SessionEvent,
): LegionProjectionState {
  if (!isLegionEvent(event)) return state

  const runId = event.data.runId
  const previous = state.runs[runId] ?? emptyProjectedRun()
  let next: ProjectedRun

  switch (event.type) {
    case 'legion/run-state':
      next = { ...previous, run: event.data.record }
      break
    case 'legion/plan-state':
      next = {
        ...previous,
        plans: {
          ...previous.plans,
          [String(event.data.record.version)]: event.data.record,
        },
      }
      break
    case 'legion/task-state':
      next = {
        ...previous,
        tasks: {
          ...previous.tasks,
          [event.data.record.taskId]: event.data.record,
        },
      }
      break
    case 'legion/mail-state':
      next = { ...previous, mail: { ...previous.mail, [event.data.record.message.mailId]: event.data.record } }
      break
    case 'legion/milestone':
      next = { ...previous, milestones: [...previous.milestones, event.data.record] }
      break
    case 'legion/decision':
      next = { ...previous, decisions: [...previous.decisions, event.data.record] }
      break
    case 'legion/continuation-state':
      next = { ...previous, continuations: { ...previous.continuations, [event.data.record.continuationId]: event.data.record } }
      break
    case 'legion/attempt-state':
      next = {
        ...previous,
        attempts: {
          ...previous.attempts,
          [event.data.record.attemptId]: event.data.record,
        },
      }
      break
  }

  return {
    runs: {
      ...state.runs,
      [runId]: next,
    },
  }
}

export function foldLegionProjection(
  events: readonly SessionEvent[],
  initial: LegionProjectionState = EMPTY_LEGION_PROJECTION_STATE,
): LegionProjectionState {
  return events.reduce(applyLegionProjection, initial)
}

export interface LegionRunProjectionView {
  readonly runId: RunId
  readonly found: boolean
  readonly run?: RunRecord
  readonly currentPlan?: PlanRecord
  readonly counts: {
    readonly plans: number
    readonly tasks: number
    readonly attempts: number
    readonly mail: number
    readonly continuations: number
    readonly milestones: number
    readonly decisions: number
  }
  readonly mailCounts: Readonly<Record<MailRecord['status'], number>>
  readonly latestContextDigest?: import('./contract.ts').ContextDigest
  readonly latestSharedPrefixDigest?: import('./contract.ts').ContextDigest
}

export function viewLegionRun(
  state: LegionProjectionState,
  runId: RunId,
): LegionRunProjectionView {
  const projected = state.runs[runId]
  if (projected === undefined) {
    return deepFreeze({
      runId,
      found: false,
      counts: { plans: 0, tasks: 0, attempts: 0, mail: 0, continuations: 0, milestones: 0, decisions: 0 },
      mailCounts: { queued: 0, reserved: 0, incorporated: 0, acknowledged: 0, discarded: 0 },
    })
  }

  const currentVersion = projected.run?.currentPlanVersion
  const currentPlan = currentVersion === undefined
    ? undefined
    : projected.plans[String(currentVersion)]
  const mail = Object.values(projected.mail)
  const mailCounts = { queued: 0, reserved: 0, incorporated: 0, acknowledged: 0, discarded: 0 }
  for (const item of mail) mailCounts[item.status] += 1
  const latestContext = mail
    .filter(item => item.status === 'incorporated' || item.status === 'acknowledged')
    .sort((left, right) => right.updatedAt - left.updatedAt
      || (left.message.mailId < right.message.mailId ? -1 : 1))[0]
  return deepFreeze({
    runId,
    found: true,
    ...(projected.run === undefined ? {} : { run: deepCopy(projected.run) }),
    ...(currentPlan === undefined ? {} : { currentPlan: deepCopy(currentPlan) }),
    counts: {
      plans: Object.keys(projected.plans).length,
      tasks: Object.keys(projected.tasks).length,
      attempts: Object.keys(projected.attempts).length,
      mail: Object.keys(projected.mail).length,
      continuations: Object.keys(projected.continuations).length,
      milestones: projected.milestones.length,
      decisions: projected.decisions.length,
    },
    mailCounts,
    ...(latestContext === undefined ? {} : { latestContextDigest: latestContext.contextManifestDigest, latestSharedPrefixDigest: latestContext.sharedPrefixDigest }),
  })
}

export interface ProjectionSchema<Value> {
  parse(value: unknown): Value
}

export interface LegionProjectionDefinition {
  readonly key: typeof LEGION_RUN_PROJECTION_KEY
  readonly schema: ProjectionSchema<LegionProjectionState>
  readonly stateVersion: number
  init(): LegionProjectionState
  apply(state: LegionProjectionState, event: SessionEvent): LegionProjectionState
  view(state: LegionProjectionState): LegionProjectionState
}

function plainRecord(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`dsh-legion: invalid projection ${at}`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`dsh-legion: invalid projection ${at}`)
  }
  return value as Record<string, unknown>
}

function parseProjectionState(value: unknown): LegionProjectionState {
  const state = plainRecord(value, 'state')
  if (Object.keys(state).some(key => key !== 'runs')) {
    throw new Error('dsh-legion: projection state contains unknown fields')
  }
  const runs = plainRecord(state.runs, 'runs')
  const containerFields = ['plans', 'tasks', 'attempts', 'mail', 'continuations'] as const
  const listFields = ['milestones', 'decisions'] as const
  for (const [runId, candidate] of Object.entries(runs)) {
    const run = plainRecord(candidate, `run ${JSON.stringify(runId)}`)
    const allowed = new Set(['run', ...containerFields, ...listFields])
    if (Object.keys(run).some(key => !allowed.has(key))) {
      throw new Error(`dsh-legion: projection run ${JSON.stringify(runId)} contains unknown fields`)
    }
    for (const field of containerFields) plainRecord(run[field], `${runId}.${field}`)
    for (const field of listFields) {
      if (!Array.isArray(run[field])) {
        throw new Error(`dsh-legion: invalid projection ${runId}.${field}`)
      }
    }
  }
  return deepFreeze(deepCopy(value as LegionProjectionState))
}

export const legionRunProjection: LegionProjectionDefinition = {
  key: LEGION_RUN_PROJECTION_KEY,
  schema: { parse: parseProjectionState },
  stateVersion: LEGION_RUN_PROJECTION_STATE_VERSION,
  init: () => EMPTY_LEGION_PROJECTION_STATE,
  apply: applyLegionProjection,
  view: state => state,
}

export interface HostProjectionRegistry {
  register(definition: LegionProjectionDefinition): () => void
}

export interface HostProjectionContext {
  get?(key: string): unknown
  effect(callback: () => void | (() => void), label?: string): unknown
}

function projectionRegistry(value: unknown): HostProjectionRegistry | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const register = (value as { readonly register?: unknown }).register
  return typeof register === 'function'
    ? value as HostProjectionRegistry
    : undefined
}

export function registerLegionRunProjection(ctx: HostProjectionContext): boolean {
  const registry = projectionRegistry(ctx.get?.('sessionProjections'))
  if (registry === undefined) return false
  ctx.effect(
    () => registry.register(legionRunProjection),
    'dsh-legion.sessionProjection()',
  )
  return true
}
