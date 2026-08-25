import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { SubagentDescendantListEntry } from '@deepseek-ai/dsh-subagent'
import { CohortName, CohortRunId, StrategyName, StrategyPlanDigest } from './identity.ts'
import type { CompiledStrategyPlan } from './orchestration.ts'
import { deepFreeze } from './internal/value.ts'

export const RUN_RECEIPT_PROJECTION_KEY = 'legion/run-receipts'
export const RUN_RECEIPT_EVENT_TYPE = 'legion/run-receipt'

export type RunReceiptStageStatus = 'pending' | 'completed' | 'degraded' | 'cancelled' | 'failed'
export type RunReceiptOutcome = 'running' | Exclude<RunReceiptStageStatus, 'pending'>

interface RunReceiptParticipantBase {
  readonly childId: SessionId
  readonly parentId: SessionId
  readonly depth: number
  readonly stage: string
  readonly member: string
  readonly childIndex: number
}

export type RunReceiptParticipant =
  | RunReceiptParticipantBase & {
      readonly state: 'live'
      readonly registryStatus: AgentStatus
    }
  | RunReceiptParticipantBase & {
      readonly state: 'ended'
    }

export interface RunReceiptStage {
  readonly id: string
  readonly kind: 'dsh-delegate' | 'dsh-subagent-fanout'
  readonly member: string
  readonly expectedChildren: number
  readonly after: readonly string[]
  readonly status: RunReceiptStageStatus
}

export interface RunReceipt {
  readonly schemaVersion: 2
  readonly runId: CohortRunId
  readonly strategy: CompiledStrategyPlan['strategy']
  readonly cohort: CompiledStrategyPlan['cohort']
  readonly planDigest: CompiledStrategyPlan['planDigest']
  readonly startedAt: number
  readonly elapsedMs: number
  readonly outcome: RunReceiptOutcome
  readonly stages: readonly RunReceiptStage[]
  readonly participation: readonly RunReceiptParticipant[]
}

export interface RunReceiptProjection {
  readonly receipts: Readonly<Record<string, RunReceipt>>
}

export interface RunReceiptSummary {
  readonly runId: CohortRunId
  readonly outcome: Exclude<RunReceiptOutcome, 'running'>
  readonly elapsedMs: number
  readonly stageCounts: Readonly<{
    readonly total: number
    readonly pending: number
    readonly completed: number
    readonly degraded: number
    readonly cancelled: number
    readonly failed: number
  }>
  readonly participationCounts: Readonly<{
    readonly total: number
    readonly running: number
    readonly idle: number
    readonly ended: number
  }>
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'legion/run-receipt': RunReceipt
  }
}

function object(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`dsh-legion: invalid ${at}`)
  }
  return value as Record<string, unknown>
}

function record(value: unknown, fields: readonly string[], at: string): Record<string, unknown> {
  const source = object(value, at)
  if (Object.keys(source).some(key => !fields.includes(key))) {
    throw new Error(`dsh-legion: ${at} contains unknown fields`)
  }
  return source
}

function text(value: unknown, at: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    throw new Error(`dsh-legion: invalid ${at}`)
  }
  return value
}

function nonNegativeInteger(value: unknown, at: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`dsh-legion: invalid ${at}`)
  }
  return value as number
}

function parseStage(value: unknown, at: string): RunReceiptStage {
  const source = record(value, ['id', 'kind', 'member', 'expectedChildren', 'after', 'status'], at)
  if (source.kind !== 'dsh-delegate' && source.kind !== 'dsh-subagent-fanout') {
    throw new Error(`dsh-legion: invalid ${at}.kind`)
  }
  if (!Array.isArray(source.after)) throw new Error(`dsh-legion: invalid ${at}.after`)
  const after = source.after.map((item, index) => text(item, `${at}.after[${String(index)}]`))
  const statuses: readonly RunReceiptStageStatus[] = [
    'pending', 'completed', 'degraded', 'cancelled', 'failed',
  ]
  if (!statuses.includes(source.status as RunReceiptStageStatus)) {
    throw new Error(`dsh-legion: invalid ${at}.status`)
  }
  const expectedChildren = nonNegativeInteger(source.expectedChildren, `${at}.expectedChildren`)
  if (expectedChildren === 0) throw new Error(`dsh-legion: invalid ${at}.expectedChildren`)
  return {
    id: text(source.id, `${at}.id`),
    kind: source.kind,
    member: text(source.member, `${at}.member`),
    expectedChildren,
    after,
    status: source.status as RunReceiptStageStatus,
  }
}

function parseParticipant(value: unknown, at: string): RunReceiptParticipant {
  const candidate = object(value, at)
  const common = ['childId', 'parentId', 'depth', 'stage', 'member', 'childIndex', 'state'] as const
  const source = candidate.state === 'live'
    ? record(value, [...common, 'registryStatus'], at)
    : record(value, common, at)
  const depth = nonNegativeInteger(source.depth, `${at}.depth`)
  if (depth === 0) throw new Error(`dsh-legion: invalid ${at}.depth`)
  const base: RunReceiptParticipantBase = {
    childId: SessionId(text(source.childId, `${at}.childId`)),
    parentId: SessionId(text(source.parentId, `${at}.parentId`)),
    depth,
    stage: text(source.stage, `${at}.stage`),
    member: text(source.member, `${at}.member`),
    childIndex: nonNegativeInteger(source.childIndex, `${at}.childIndex`),
  }
  if (source.state === 'ended') return { ...base, state: 'ended' }
  if (source.state !== 'live' || (source.registryStatus !== 'idle' && source.registryStatus !== 'running')) {
    throw new Error(`dsh-legion: invalid ${at} registry state`)
  }
  return { ...base, state: 'live', registryStatus: source.registryStatus }
}

function parseRunReceipt(value: unknown): RunReceipt {
  const candidate = object(value, 'Run Receipt')
  const common = [
    'schemaVersion', 'runId', 'strategy', 'cohort', 'planDigest',
    'startedAt', 'elapsedMs', 'outcome', 'stages',
  ] as const
  const schemaVersion = candidate.schemaVersion
  if (schemaVersion !== 1 && schemaVersion !== 2) {
    throw new Error('dsh-legion: invalid Run Receipt schemaVersion')
  }
  const source = record(value, schemaVersion === 1 ? common : [...common, 'participation'], 'Run Receipt')
  const outcomes: readonly RunReceiptOutcome[] = [
    'running', 'completed', 'degraded', 'cancelled', 'failed',
  ]
  if (!outcomes.includes(source.outcome as RunReceiptOutcome)) {
    throw new Error('dsh-legion: invalid Run Receipt outcome')
  }
  if (!Array.isArray(source.stages)) throw new Error('dsh-legion: invalid Run Receipt stages')
  const rawParticipation = schemaVersion === 1 ? [] : source.participation
  if (!Array.isArray(rawParticipation)) throw new Error('dsh-legion: invalid Run Receipt participation')
  const participation = rawParticipation.map((item, index) =>
    parseParticipant(item, `Run Receipt participation[${String(index)}]`))
  if (new Set(participation.map(item => String(item.childId))).size !== participation.length) {
    throw new Error('dsh-legion: duplicate Run Receipt participant childId')
  }
  return deepFreeze({
    schemaVersion: 2,
    runId: CohortRunId(text(source.runId, 'Run Receipt runId')),
    strategy: StrategyName(text(source.strategy, 'Run Receipt strategy')),
    cohort: CohortName(text(source.cohort, 'Run Receipt cohort')),
    planDigest: StrategyPlanDigest(text(source.planDigest, 'Run Receipt planDigest')),
    startedAt: nonNegativeInteger(source.startedAt, 'Run Receipt startedAt'),
    elapsedMs: nonNegativeInteger(source.elapsedMs, 'Run Receipt elapsedMs'),
    outcome: source.outcome as RunReceiptOutcome,
    stages: source.stages.map((stage, index) => parseStage(stage, `Run Receipt stages[${String(index)}]`)),
    participation,
  })
}

function parseProjection(value: unknown): RunReceiptProjection {
  const source = record(value, ['receipts'], 'Run Receipt projection')
  const receipts = object(source.receipts, 'Run Receipt projection receipts')
  const parsed = Object.fromEntries(Object.entries(receipts).map(([runId, receipt]) => {
    const next = parseRunReceipt(receipt)
    if (String(next.runId) !== runId) throw new Error('dsh-legion: Run Receipt projection key mismatch')
    return [runId, next]
  }))
  return deepFreeze({ receipts: parsed })
}

export const EMPTY_RUN_RECEIPT_PROJECTION: RunReceiptProjection = deepFreeze({ receipts: {} })

export function applyRunReceiptProjection(
  state: RunReceiptProjection,
  event: SessionEvent,
): RunReceiptProjection {
  if (event.type !== RUN_RECEIPT_EVENT_TYPE) return state
  try {
    const receipt = parseRunReceipt(event.data)
    return deepFreeze({
      receipts: { ...state.receipts, [String(receipt.runId)]: receipt },
    })
  } catch {
    return state
  }
}

interface ProjectionSchema<Value> {
  parse(value: unknown): Value
}

interface RunReceiptProjectionDefinition {
  readonly key: typeof RUN_RECEIPT_PROJECTION_KEY
  readonly stateSchema: ProjectionSchema<RunReceiptProjection>
  readonly stateVersion: number
  init(): RunReceiptProjection
  apply(state: RunReceiptProjection, event: SessionEvent): RunReceiptProjection
  readonly wire: {
    readonly viewSchema: ProjectionSchema<RunReceiptProjection>
    view(state: RunReceiptProjection): RunReceiptProjection
  }
}

const runReceiptProjectionSchema: ProjectionSchema<RunReceiptProjection> = { parse: parseProjection }

export const runReceiptProjection: RunReceiptProjectionDefinition = {
  key: RUN_RECEIPT_PROJECTION_KEY,
  stateSchema: runReceiptProjectionSchema,
  stateVersion: 2,
  init: () => EMPTY_RUN_RECEIPT_PROJECTION,
  apply: applyRunReceiptProjection,
  wire: {
    viewSchema: runReceiptProjectionSchema,
    view: state => state,
  },
}

interface HostProjectionRegistry {
  register(definition: RunReceiptProjectionDefinition): () => void
}

export interface RunReceiptProjectionHostContext {
  get?(name: string): unknown
  inject?(
    services: readonly string[],
    callback: (ctx: RunReceiptProjectionHostContext) => void,
  ): unknown
}

function projectionRegistry(value: unknown): HostProjectionRegistry | undefined {
  return typeof value === 'object' && value !== null && typeof (value as { register?: unknown }).register === 'function'
    ? value as HostProjectionRegistry
    : undefined
}

export function registerRunReceiptProjection(ctx: RunReceiptProjectionHostContext): boolean {
  const registry = projectionRegistry(ctx.get?.('sessionProjections'))
  if (registry === undefined) return false
  registry.register(runReceiptProjection)
  return true
}

export function installRunReceiptProjection(ctx: RunReceiptProjectionHostContext): void {
  if (ctx.inject === undefined) {
    registerRunReceiptProjection(ctx)
    return
  }
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    registerRunReceiptProjection(projectionCtx)
  })
}

export function createRunReceipt(
  plan: CompiledStrategyPlan,
  runId: CohortRunId,
  startedAt = Date.now(),
): RunReceipt {
  const producerByArtifact = new Map(
    plan.primitives.map(primitive => [String(primitive.output.name), primitive.stage]),
  )
  return deepFreeze({
    schemaVersion: 2,
    runId,
    strategy: plan.strategy,
    cohort: plan.cohort,
    planDigest: plan.planDigest,
    startedAt,
    elapsedMs: 0,
    outcome: 'running',
    stages: plan.primitives.map(primitive => ({
      id: primitive.stage,
      kind: primitive.kind,
      member: String(primitive.member),
      expectedChildren: primitive.kind === 'dsh-subagent-fanout' ? primitive.count : 1,
      after: [...new Set([
        ...primitive.after,
        ...primitive.inputs.flatMap(input => producerByArtifact.get(String(input)) ?? []),
      ])].sort(),
      status: 'pending' as const,
    })),
    participation: [],
  })
}

function elapsed(receipt: RunReceipt, now: number): number {
  return Math.max(receipt.elapsedMs, Math.max(0, now - receipt.startedAt))
}

export function setRunReceiptParticipation(
  receipt: RunReceipt,
  participation: readonly RunReceiptParticipant[],
  now = Date.now(),
): RunReceipt {
  return deepFreeze({
    ...receipt,
    elapsedMs: elapsed(receipt, now),
    participation: participation.map(item => ({ ...item })),
  })
}

export interface RunReceiptChildBinding {
  readonly stage: string
  readonly member: string
  readonly childIndex: number
}

export interface RunReceiptParticipationObserver {
  trackChild(agent: Agent, binding: RunReceiptChildBinding): void
  finish(): Promise<void>
  dispose(): void
}

interface TrackedChild {
  readonly agent: Agent
  readonly binding: RunReceiptChildBinding
}

interface StoredParticipant {
  readonly row: RunReceiptParticipant
  readonly stageOrder: number
  readonly treeOrder: number
}

function sameParticipant(left: RunReceiptParticipant, right: RunReceiptParticipant): boolean {
  return left.childId === right.childId
    && left.parentId === right.parentId
    && left.depth === right.depth
    && left.stage === right.stage
    && left.member === right.member
    && left.childIndex === right.childIndex
    && left.state === right.state
    && (left.state !== 'live' || (right.state === 'live' && left.registryStatus === right.registryStatus))
}

/** Sample Host lifecycle events and one cold tree listing; never drive, resume, or dispose an Agent. */
class HostRunReceiptParticipationObserver implements RunReceiptParticipationObserver {
  private readonly bindings = new Map<SessionId, TrackedChild>()
  private readonly live = new Map<SessionId, AgentStatus>()
  private readonly rows = new Map<SessionId, StoredParticipant>()
  private readonly stageOrder: ReadonlyMap<string, number>
  private readonly disposers: Array<() => void>
  private listening = true
  private finished = false

  constructor(
    private readonly ctx: Context,
    private readonly parentId: SessionId,
    stages: readonly string[],
    private readonly onChange: (participation: readonly RunReceiptParticipant[]) => void,
  ) {
    this.stageOrder = new Map(stages.map((stage, index) => [stage, index]))
    this.disposers = [
      ctx.on('agent/status', ({ agent, status }) => {
        this.guard(() => {
          if (ctx.agents.get(agent.id) !== agent) return
          this.live.set(agent.id, status)
          this.updateDirect(agent, status)
        })
      }),
      ctx.on('agent/created', ({ agent }) => {
        this.guard(() => {
          if (ctx.agents.get(agent.id) !== agent) return
          this.live.set(agent.id, agent.status)
          this.updateDirect(agent, agent.status)
        })
      }),
      ctx.on('agent/disposed', ({ agent }) => {
        this.guard(() => {
          if (ctx.agents.get(agent.id) !== undefined) return
          this.live.delete(agent.id)
          const tracked = this.bindings.get(agent.id)
          if (tracked?.agent !== agent) return
          this.setParticipant({
            childId: agent.id,
            parentId: this.parentId,
            depth: 1,
            ...tracked.binding,
            state: 'ended',
          }, 0, true)
        })
      }),
    ]
    for (const agent of ctx.agents.list()) this.live.set(agent.id, agent.status)
  }

  trackChild(agent: Agent, binding: RunReceiptChildBinding): void {
    this.guard(() => {
      const existing = this.bindings.get(agent.id)
      if (existing !== undefined) {
        if (existing.agent !== agent
          || existing.binding.stage !== binding.stage
          || existing.binding.member !== binding.member
          || existing.binding.childIndex !== binding.childIndex) {
          this.ctx.logger.warn('dsh-legion: Run Receipt child ' + JSON.stringify(agent.id) + ' was published twice')
        }
        return
      }
      this.bindings.set(agent.id, { agent, binding })
      const status = this.live.get(agent.id)
      if (this.ctx.agents.get(agent.id) === agent && status !== undefined) this.updateDirect(agent, agent.status)
    })
  }

  async finish(): Promise<void> {
    if (this.finished) return
    this.finished = true
    this.dispose()
    let entries: readonly SubagentDescendantListEntry[]
    try {
      entries = await this.ctx.subagents.listDescendants(this.parentId)
    } catch (error: unknown) {
      this.ctx.logger.warn('dsh-legion: failed to read cold Run Receipt child tree: ' + String(error))
      return
    }
    const rootByChild = new Map<SessionId, SessionId>()
    let changed = false
    for (const [treeOrder, entry] of entries.entries()) {
      if (entry.kind !== 'child') continue
      const direct = this.bindings.get(entry.id)
      const root = direct === undefined ? rootByChild.get(entry.parentId) : entry.id
      if (root === undefined) continue
      rootByChild.set(entry.id, root)
      const tracked = this.bindings.get(root)
      if (tracked === undefined) continue
      const row: RunReceiptParticipant = {
        childId: entry.id,
        parentId: entry.parentId,
        depth: entry.depth,
        ...tracked.binding,
        state: 'ended',
      }
      changed = this.setParticipant(row, treeOrder, false) || changed
    }
    if (changed) this.emit()
  }

  dispose(): void {
    if (!this.listening) return
    this.listening = false
    for (const dispose of this.disposers.splice(0).reverse()) dispose()
  }

  private updateDirect(agent: Agent, status: AgentStatus): void {
    const tracked = this.bindings.get(agent.id)
    if (tracked?.agent !== agent) return
    this.setParticipant({
      childId: agent.id,
      parentId: this.parentId,
      depth: 1,
      ...tracked.binding,
      state: 'live',
      registryStatus: status,
    }, 0, true)
  }

  private setParticipant(row: RunReceiptParticipant, treeOrder: number, emit: boolean): boolean {
    const previous = this.rows.get(row.childId)
    if (previous !== undefined && sameParticipant(previous.row, row) && previous.treeOrder === treeOrder) return false
    this.rows.set(row.childId, {
      row: deepFreeze({ ...row }),
      stageOrder: this.stageOrder.get(row.stage) ?? Number.MAX_SAFE_INTEGER,
      treeOrder,
    })
    if (emit) this.emit()
    return true
  }

  private emit(): void {
    const participation = [...this.rows.values()]
      .sort((left, right) => left.stageOrder - right.stageOrder
        || left.row.childIndex - right.row.childIndex
        || left.treeOrder - right.treeOrder
        || String(left.row.childId).localeCompare(String(right.row.childId)))
      .map(item => item.row)
    this.onChange(deepFreeze(participation))
  }

  private guard(operation: () => void): void {
    try {
      operation()
    } catch (error: unknown) {
      this.ctx.logger.warn('dsh-legion: failed to update Run Receipt participation: ' + String(error))
    }
  }
}

export function observeRunReceiptParticipation(
  ctx: Context,
  parentId: SessionId,
  stages: readonly string[],
  onChange: (participation: readonly RunReceiptParticipant[]) => void,
): RunReceiptParticipationObserver {
  return new HostRunReceiptParticipationObserver(ctx, parentId, stages, onChange)
}

export function settleRunReceiptStage(
  receipt: RunReceipt,
  stage: string,
  status: Exclude<RunReceiptStageStatus, 'pending'>,
  now = Date.now(),
): RunReceipt {
  let found = false
  const stages = receipt.stages.map((item) => {
    if (item.id !== stage) return item
    if (item.status !== 'pending') throw new Error(`dsh-legion: Run Receipt stage ${JSON.stringify(stage)} already settled`)
    found = true
    return { ...item, status }
  })
  if (!found) throw new Error(`dsh-legion: unknown Run Receipt stage ${JSON.stringify(stage)}`)
  return deepFreeze({ ...receipt, elapsedMs: elapsed(receipt, now), stages })
}

export function finishRunReceipt(
  receipt: RunReceipt,
  outcome: Exclude<RunReceiptOutcome, 'running'>,
  now = Date.now(),
): RunReceipt {
  return deepFreeze({ ...receipt, elapsedMs: elapsed(receipt, now), outcome })
}

export function publishRunReceipt(session: Session, receipt: RunReceipt): RunReceipt {
  session.append(RUN_RECEIPT_EVENT_TYPE, receipt)
  return receipt
}

export function summarizeRunReceipt(receipt: RunReceipt): RunReceiptSummary {
  if (receipt.outcome === 'running') throw new Error('dsh-legion: cannot summarize a running Receipt')
  const stageCounts = {
    total: receipt.stages.length,
    pending: 0,
    completed: 0,
    degraded: 0,
    cancelled: 0,
    failed: 0,
  }
  for (const stage of receipt.stages) stageCounts[stage.status] += 1
  const participationCounts = { total: receipt.participation.length, running: 0, idle: 0, ended: 0 }
  for (const participant of receipt.participation) {
    if (participant.state === 'ended') participationCounts.ended += 1
    else participationCounts[participant.registryStatus] += 1
  }
  return deepFreeze({
    runId: receipt.runId,
    outcome: receipt.outcome,
    elapsedMs: receipt.elapsedMs,
    stageCounts,
    participationCounts,
  })
}

export function renderRunReceiptSummary(summary: {
  readonly outcome: string
  readonly elapsedMs: number
  readonly stageCounts: { readonly total: number; readonly pending: number }
  readonly participationCounts: { readonly running: number; readonly idle: number; readonly ended: number }
}): string {
  const settled = summary.stageCounts.total - summary.stageCounts.pending
  const participation = summary.participationCounts
  return `Run receipt: ${summary.outcome} in ${String(summary.elapsedMs)}ms; stages ${String(settled)}/${String(summary.stageCounts.total)} settled; participation ${String(participation.running)} running, ${String(participation.idle)} idle, ${String(participation.ended)} ended`
}
