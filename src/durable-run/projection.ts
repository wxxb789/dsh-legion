import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session/types'
import { deepCopy, deepFreeze } from '../internal/value.ts'
import type {
  ArtifactRef,
  AttemptRecord,
  ContinuationRecord,
  DecisionRecord,
  MailRecord,
  MilestoneReceipt,
  PlanRecord,
  RunId,
  RunRecord,
  TaskRecord,
  TaskId,
} from './contract.ts'
import { deriveReadyFrontier, type FrontierArtifact, type FrontierTaskState } from './graph.ts'
import { isLegionEvent } from './events.ts'
import { assertLegionTransition, type LegionInvariantState } from './invariant.ts'
import { isTerminalRunStatus } from './status.ts'
import { validateLegionEventData } from './validate.ts'

export const LEGION_RUN_PROJECTION_KEY = 'legion-run'
export const LEGION_RUN_PROJECTION_STATE_VERSION = 7

export interface ProjectedRun {
  readonly run?: RunRecord
  readonly plans: Readonly<Record<string, PlanRecord>>
  readonly tasks: Readonly<Record<string, TaskRecord>>
  readonly attempts: Readonly<Record<string, AttemptRecord>>
  readonly mail: Readonly<Record<string, MailRecord>>
  readonly continuations: Readonly<Record<string, ContinuationRecord>>
  readonly milestones: readonly MilestoneReceipt[]
  readonly milestoneEventSeqs: readonly number[]
  readonly decisions: readonly DecisionRecord[]
  readonly decisionEventSeqs: readonly number[]
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
    milestoneEventSeqs: [],
    decisions: [],
    decisionEventSeqs: [],
  }
}

export function applyLegionProjection(
  state: LegionProjectionState,
  event: SessionEvent,
): LegionProjectionState {
  if (!isLegionEvent(event)) return state

  const runId = event.data.runId
  const current = Object.hasOwn(state.runs, runId) ? state.runs[runId] : undefined
  // Append-time validation rejects new terminal rewrites. Projection keeps the
  // first committed terminal fact so version-6 journals remain replayable.
  if (current?.run !== undefined && isTerminalRunStatus(current.run.status)) return state
  const invariant: LegionInvariantState = current?.run === undefined
    ? { runs: {} }
    : {
        runs: {
          [runId]: {
            run: current.run,
            plans: current.plans,
            tasks: current.tasks,
            attempts: current.attempts,
            mail: current.mail,
            continuations: current.continuations,
            milestones: current.milestones,
          },
        },
      }
  assertLegionTransition(invariant, event.type, event.data)
  const previous = current ?? emptyProjectedRun()
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
      next = {
        ...previous,
        milestones: [...previous.milestones, event.data.record],
        milestoneEventSeqs: [...previous.milestoneEventSeqs, event.seq],
      }
      break
    case 'legion/decision':
      next = {
        ...previous,
        decisions: [...previous.decisions, event.data.record],
        decisionEventSeqs: [...previous.decisionEventSeqs, event.seq],
      }
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
  readonly artifacts: readonly ArtifactRef[]
  readonly readyFrontier: readonly TaskId[]
  readonly milestoneSequence: readonly { readonly seq: number; readonly receipt: MilestoneReceipt }[]
  readonly decisionSequence: readonly { readonly seq: number; readonly decision: DecisionRecord }[]
  readonly failureSeqs: readonly number[]
  readonly recoverySeqs: readonly number[]
  readonly planChangeSeqs: readonly number[]
  readonly metrics: {
    readonly acceptedArtifactBytes: number
    readonly startedAgents: number
    readonly attemptCount: number
    readonly terminalTaskCount: number
  }
}


function derivedRunFacts(
  projected: ProjectedRun,
  currentPlan: PlanRecord | undefined,
): Pick<LegionRunProjectionView,
  'artifacts' | 'readyFrontier' | 'milestoneSequence' | 'decisionSequence'
  | 'failureSeqs' | 'recoverySeqs' | 'planChangeSeqs' | 'metrics'> {
  const artifacts = Object.values(projected.tasks)
    .flatMap(task => task.acceptedArtifacts)
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
  const graph = currentPlan?.graph
  let readyFrontier: readonly TaskId[] = []
  if (graph !== undefined) {
    const taskStates: Record<string, FrontierTaskState> = {}
    for (const [taskId, task] of Object.entries(projected.tasks)) {
      taskStates[taskId] = {
        status: task.status,
        generation: task.generation,
        attempts: Object.values(projected.attempts)
          .filter(attempt => attempt.taskId === task.taskId).length,
      }
    }
    const frontierArtifacts: Record<string, FrontierArtifact> = {
      objective: {
        name: 'objective', contract: 'objective-v1', collection: false,
        value: null, bytes: 0,
      },
    }
    for (const artifact of artifacts) {
      const producer = Object.values(graph.nodes)
        .find(node => node.output.artifact === artifact.name)
      if (producer !== undefined) {
        frontierArtifacts[artifact.name] = {
          name: artifact.name,
          contract: producer.output.contract,
          collection: producer.output.collection,
          value: null,
          bytes: artifact.byteLength,
        }
      }
    }
    readyFrontier = deriveReadyFrontier(graph, taskStates, frontierArtifacts)
  }
  return {
    artifacts,
    readyFrontier,
    milestoneSequence: projected.milestones.map((receipt, index) => ({
      seq: projected.milestoneEventSeqs[index]!, receipt,
    })),
    decisionSequence: projected.decisions.map((decision, index) => ({
      seq: projected.decisionEventSeqs[index]!, decision,
    })),
    failureSeqs: projected.decisions.flatMap((decision, index) =>
      decision.kind === 'failure' ? [projected.decisionEventSeqs[index]!] : []),
    recoverySeqs: projected.decisions.flatMap((decision, index) =>
      decision.kind === 'recovery' ? [projected.decisionEventSeqs[index]!] : []),
    planChangeSeqs: projected.decisions.flatMap((decision, index) =>
      decision.kind === 'plan-change' ? [projected.decisionEventSeqs[index]!] : []),
    metrics: {
      acceptedArtifactBytes: artifacts.reduce((sum, artifact) => sum + artifact.byteLength, 0),
      startedAgents: Object.values(projected.attempts).reduce((sum, attempt) =>
        sum + (graph?.nodes[attempt.taskId]?.agentCount ?? 1), 0),
      attemptCount: Object.keys(projected.attempts).length,
      terminalTaskCount: Object.values(projected.tasks).filter(task =>
        ['succeeded', 'failed', 'cancelled', 'superseded', 'blocked'].includes(task.status)).length,
    },
  }
}

export function viewLegionRun(
  state: LegionProjectionState,
  runId: RunId,
): LegionRunProjectionView {
  const projected = Object.hasOwn(state.runs, runId) ? state.runs[runId] : undefined
  if (projected === undefined) {
    return deepFreeze({
      runId,
      found: false,
      counts: { plans: 0, tasks: 0, attempts: 0, mail: 0, continuations: 0, milestones: 0, decisions: 0 },
      mailCounts: { queued: 0, reserved: 0, incorporated: 0, acknowledged: 0, discarded: 0 },
      artifacts: [],
      readyFrontier: [],
      milestoneSequence: [],
      decisionSequence: [],
      failureSeqs: [],
      recoverySeqs: [],
      planChangeSeqs: [],
      metrics: {
        acceptedArtifactBytes: 0, startedAgents: 0,
        attemptCount: 0, terminalTaskCount: 0,
      },
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
    ...derivedRunFacts(projected, currentPlan),
    ...(latestContext === undefined ? {} : { latestContextDigest: latestContext.contextManifestDigest, latestSharedPrefixDigest: latestContext.sharedPrefixDigest }),
  })
}

export interface ProjectionSchema<Value> {
  parse(value: unknown): Value
}

/**
 * The unit Legion hands `ctx.sessionProjections`, written to satisfy the Host
 * contract the declared peer range admits and the one it no longer does.
 *
 * DSH 0.1.0-rc.6 through 0.1.0-rc.8 drive a unit through `schema` (which
 * validates the wire payload `view` produces) plus `view`. DSH 0.1.1-rc.1
 * renamed the parser to `stateSchema` and moved the client view into an
 * optional `wire` member, so a unit that omits `wire` is host-only. Legion
 * reaches the registry structurally and takes no dependency on
 * `@deepseek-ai/dsh-session-projection`, so neither rename reaches the
 * compiler: a definition carrying only the older spelling registers cleanly on
 * 0.1.1-rc.1 and then throws inside the Host's own `restore()` — for every
 * unit in the session, not just this one — the first time a checkpoint row for
 * this key is usable.
 *
 * The declared range uses the newer spelling. Both are still carried: the
 * older one costs one member, and it is what keeps a build mounted on a
 * pre-0.1.1 Host from defeating that Host's projection cache silently. Legion's
 * `view` is the identity, so one parser is both the state parser and the wire
 * parser and the two members share it. `wire` is deliberately absent: run
 * state is host-only, and no Legion surface reads it from a client snapshot.
 */
export interface LegionProjectionDefinition {
  readonly key: typeof LEGION_RUN_PROJECTION_KEY
  /** Current Host contract: validates persisted state before it seeds a fold. */
  readonly stateSchema: ProjectionSchema<LegionProjectionState>
  /** Legacy pre-0.1.1 Host parser spelling. */
  readonly schema: ProjectionSchema<LegionProjectionState>
  readonly stateVersion: number
  init(header: SessionHeader): LegionProjectionState
  apply(state: LegionProjectionState, event: SessionEvent): LegionProjectionState
  /** Legacy pre-0.1.1 Host view; current hosts use optional `wire`. */
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

function projectionSequence(value: unknown, at: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`dsh-legion: invalid projection ${at}`)
  }
  return value as number
}

function parseProjectionState(value: unknown): LegionProjectionState {
  const state = plainRecord(value, 'state')
  if (Object.keys(state).some(key => key !== 'runs')) {
    throw new Error('dsh-legion: projection state contains unknown fields')
  }
  const runs = plainRecord(state.runs, 'runs')
  const parsedRuns = Object.create(null) as Record<string, ProjectedRun>
  const fields = [
    'run', 'plans', 'tasks', 'attempts', 'mail', 'continuations',
    'milestones', 'milestoneEventSeqs', 'decisions', 'decisionEventSeqs',
  ]
  for (const [runId, candidate] of Object.entries(runs)) {
    const projected = plainRecord(candidate, `run ${JSON.stringify(runId)}`)
    if (Object.keys(projected).some(key => !fields.includes(key))
      || fields.some(key => !Object.hasOwn(projected, key))) {
      throw new Error(`dsh-legion: projection run ${JSON.stringify(runId)} has invalid fields`)
    }
    const rawRun = plainRecord(projected.run, `${runId}.run`)
    const run = validateLegionEventData('legion/run-state', {
      schemaVersion: 1,
      runId,
      planVersion: rawRun.currentPlanVersion,
      correlationId: 'projection-checkpoint',
      record: projected.run,
    }).record
    if (run.runId !== runId || run.goalVersion !== run.goal.version) {
      throw new Error('dsh-legion: projection run identity does not match record')
    }

    const plans = Object.create(null) as Record<string, PlanRecord>
    for (const [key, record] of Object.entries(plainRecord(projected.plans, `${runId}.plans`))) {
      const raw = plainRecord(record, `${runId}.plans.${key}`)
      const parsed = validateLegionEventData('legion/plan-state', {
        schemaVersion: 1, runId, planVersion: raw.version,
        correlationId: 'projection-checkpoint', record,
      }).record
      if (String(parsed.version) !== key) throw new Error('dsh-legion: projection plan key does not match record')
      plans[key] = parsed
    }

    const tasks = Object.create(null) as Record<string, TaskRecord>
    for (const [key, record] of Object.entries(plainRecord(projected.tasks, `${runId}.tasks`))) {
      const raw = plainRecord(record, `${runId}.tasks.${key}`)
      const parsed = validateLegionEventData('legion/task-state', {
        schemaVersion: 1, runId, planVersion: raw.planVersion,
        correlationId: 'projection-checkpoint', taskId: key,
        generation: raw.generation, record,
      }).record
      if (parsed.taskId !== key) throw new Error('dsh-legion: projection task key does not match record')
      tasks[key] = parsed
    }

    const attempts = Object.create(null) as Record<string, AttemptRecord>
    for (const [key, record] of Object.entries(plainRecord(projected.attempts, `${runId}.attempts`))) {
      const raw = plainRecord(record, `${runId}.attempts.${key}`)
      const parsed = validateLegionEventData('legion/attempt-state', {
        schemaVersion: 1, runId, planVersion: raw.planVersion,
        correlationId: 'projection-checkpoint', taskId: raw.taskId,
        attemptId: key, generation: raw.generation, fence: raw.fence, record,
      }).record
      if (parsed.attemptId !== key) throw new Error('dsh-legion: projection attempt key does not match record')
      attempts[key] = parsed
    }

    for (const attempt of Object.values(attempts)) {
      const task = Object.hasOwn(tasks, attempt.taskId) ? tasks[attempt.taskId] : undefined
      if (task === undefined
        || task.planVersion !== attempt.planVersion
        || task.generation !== attempt.generation) {
        throw new Error('dsh-legion: projection attempt does not match its task')
      }
      const binding = attempt.binding
      if (binding !== undefined
        && (binding.runId !== run.runId
          || binding.planVersion !== attempt.planVersion
          || binding.taskId !== attempt.taskId
          || binding.attemptId !== attempt.attemptId
          || binding.generation !== attempt.generation
          || binding.fence !== attempt.fence
          || binding.profile !== attempt.profile
          || binding.routePlanDigest !== attempt.routePlanDigest
          || binding.environmentDigest !== attempt.environmentDigest
          || binding.contextManifestDigest !== attempt.contextDigest)) {
        throw new Error('dsh-legion: projection attempt binding identity mismatch')
      }
      const result = attempt.result
      if (result !== undefined
        && (result.runId !== run.runId
          || result.taskId !== attempt.taskId
          || result.attemptId !== attempt.attemptId
          || result.planVersion !== attempt.planVersion
          || result.generation !== attempt.generation
          || result.fence !== attempt.fence
          || result.routePlanDigest !== attempt.routePlanDigest
          || result.environmentDigest !== attempt.environmentDigest
          || result.contextDigest !== attempt.contextDigest)) {
        throw new Error('dsh-legion: projection attempt result identity mismatch')
      }
    }

    const mail = Object.create(null) as Record<string, MailRecord>
    for (const [key, record] of Object.entries(plainRecord(projected.mail, `${runId}.mail`))) {
      const raw = plainRecord(record, `${runId}.mail.${key}`)
      const message = plainRecord(raw.message, `${runId}.mail.${key}.message`)
      const reservation = raw.reservation === undefined
        ? undefined
        : plainRecord(raw.reservation, `${runId}.mail.${key}.reservation`)
      const parsed = validateLegionEventData('legion/mail-state', {
        schemaVersion: 1, runId, planVersion: run.currentPlanVersion,
        correlationId: 'projection-checkpoint', taskId: message.recipientTaskId,
        mailId: key, recipientGeneration: raw.recipientGeneration,
        ...(reservation?.fence === undefined && run.fence === undefined
          ? {}
          : { fence: reservation?.fence ?? run.fence }),
        record,
      }).record
      if (parsed.message.mailId !== key) throw new Error('dsh-legion: projection mail key does not match record')
      mail[key] = parsed
    }

    for (const record of Object.values(mail)) {
      const taskId = record.message.recipientTaskId
      const task = Object.hasOwn(tasks, taskId) ? tasks[taskId] : undefined
      if (task === undefined || task.generation !== record.recipientGeneration) {
        throw new Error('dsh-legion: projection mail does not match its recipient task')
      }
    }

    const continuations = Object.create(null) as Record<string, ContinuationRecord>
    for (const [key, record] of Object.entries(plainRecord(projected.continuations, `${runId}.continuations`))) {
      const raw = plainRecord(record, `${runId}.continuations.${key}`)
      const token = plainRecord(raw.token, `${runId}.continuations.${key}.token`)
      const parsed = validateLegionEventData('legion/continuation-state', {
        schemaVersion: 1, runId, planVersion: token.planVersion,
        correlationId: 'projection-checkpoint', continuationId: key, record,
      }).record
      if (parsed.continuationId !== key) {
        throw new Error('dsh-legion: projection continuation key does not match record')
      }
      continuations[key] = parsed
    }

    const rawMilestones = projected.milestones
    const rawDecisions = projected.decisions
    const rawMilestoneSeqs = projected.milestoneEventSeqs
    const rawDecisionSeqs = projected.decisionEventSeqs
    if (!Array.isArray(rawMilestones) || !Array.isArray(rawDecisions)
      || !Array.isArray(rawMilestoneSeqs) || !Array.isArray(rawDecisionSeqs)
      || rawMilestones.length !== rawMilestoneSeqs.length
      || rawDecisions.length !== rawDecisionSeqs.length) {
      throw new Error(`dsh-legion: invalid projection ${runId} list fields`)
    }
    const milestones = rawMilestones.map(record => validateLegionEventData('legion/milestone', {
      schemaVersion: 1, runId, planVersion: run.currentPlanVersion,
      correlationId: 'projection-checkpoint', record,
    }).record)
    const decisions = rawDecisions.map(record => validateLegionEventData('legion/decision', {
      schemaVersion: 1, runId, planVersion: run.currentPlanVersion,
      correlationId: 'projection-checkpoint', record,
    }).record)
    parsedRuns[runId] = {
      run, plans, tasks, attempts, mail, continuations, milestones, decisions,
      milestoneEventSeqs: rawMilestoneSeqs.map((seq, index) =>
        projectionSequence(seq, `${runId}.milestoneEventSeqs[${String(index)}]`)),
      decisionEventSeqs: rawDecisionSeqs.map((seq, index) =>
        projectionSequence(seq, `${runId}.decisionEventSeqs[${String(index)}]`)),
    }
  }
  return deepFreeze({ runs: parsedRuns })
}

const legionProjectionSchema: ProjectionSchema<LegionProjectionState> = { parse: parseProjectionState }

export const legionRunProjection: LegionProjectionDefinition = {
  key: LEGION_RUN_PROJECTION_KEY,
  stateSchema: legionProjectionSchema,
  schema: legionProjectionSchema,
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
