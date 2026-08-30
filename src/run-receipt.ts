import type { Context } from '@deepseek-ai/cordis'
import type AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-compaction'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { ProjectionSnapshot, SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import type { SessionObservation, SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import { carrierKeyOf } from '@deepseek-ai/dsh-scope'
import type {
  SubagentDescendantListEntry,
  SubagentRunEndInfo,
  SubagentRunInfo,
} from '@deepseek-ai/dsh-subagent'
import type TokenMeter from '@deepseek-ai/dsh-token-meter'
import { deriveTurnTokenUsage, type TurnTokenUsage } from '@deepseek-ai/dsh-token-meter/client'
import {
  RECEIPT_FEED_LIMITS,
  RUN_RECEIPT_TOKEN_FIELDS,
  ReceiptPublicationResultSchema,
  type RunReceipt as PublishedRunReceipt,
  type RunReceiptEvidenceCoverage,
  type RunReceiptParticipant as PublishedRunReceiptParticipant,
  type RunReceiptPublisher,
  type RunReceiptStageStatus,
  type RunReceiptTiming,
  type RunReceiptTimingEvidence,
  type RunReceiptTokenAccount,
  type RunReceiptTokenAggregate,
  type RunReceiptTokenEvidence,
  type RunReceiptTokenField,
  type RunReceiptTokenSample,
} from 'dsh-legion-receipts'
import type { CohortRunId } from './identity.ts'
import type { CompiledStrategyPlan } from './orchestration.ts'
import { deepFreeze } from './internal/value.ts'

export type { RunReceiptStageStatus } from 'dsh-legion-receipts'
export type RunReceiptOutcome = PublishedRunReceipt['outcome']
export type LiveRunReceipt = PublishedRunReceipt

export type RunReceiptFeedStatus =
  | { readonly status: 'available'; readonly failure: null }
  | { readonly status: 'unavailable'; readonly failure: 'publisher-unavailable' }
  | { readonly status: 'rejected'; readonly failure: string }
  | { readonly status: 'incompatible'; readonly failure: string }

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
    readonly local: number
    readonly remote: number
    readonly running: number
    readonly idle: number
    readonly ended: number
  }>
  readonly tokenTotals: Readonly<Record<RunReceiptTokenField, number | null>>
  readonly unavailableCounts: Readonly<{
    readonly participation: number
    readonly timing: number
    readonly tokenDimensions: number
  }>
  readonly truncatedCounts: Readonly<{
    readonly participation: number
    readonly tokenSessions: number
  }>
  readonly coverage: Readonly<{
    readonly participation: RunReceiptEvidenceCoverage['status']
    readonly timing: RunReceiptEvidenceCoverage['status']
    readonly tokens: RunReceiptTokenAccount['coverage']
  }>
  readonly feed: RunReceiptFeedStatus
}

export interface RunReceiptChildBinding {
  readonly stage: string
  readonly member: string
  readonly childIndex: number
}

export interface RunReceiptObservation {
  readonly participation: PublishedRunReceipt['participation']
  readonly timing: RunReceiptTiming
  readonly tokenAccount: RunReceiptTokenAccount
}

export interface RunReceiptParticipationObserver {
  trackChild(childId: SessionId, agent: Agent | undefined, binding: RunReceiptChildBinding): void
  sample(): void
  finish(signal?: AbortSignal): Promise<void>
  dispose(): void
}

interface LifecycleRecord {
  readonly info: SubagentRunInfo
  readonly startedAt: number
  end?: SubagentRunEndInfo
  endedAt?: number
  binding?: RunReceiptChildBinding
  localAgent?: Agent
  parentId?: SessionId
  depth?: number
  root?: LifecycleRecord
  coldCut?: SessionCut | undefined
  coldTiming?: RunReceiptTimingEvidence
  coldToken?: RunReceiptTokenSample
  coldLifecycle?: true
}

interface SessionCut {
  readonly header: Session['header']
  readonly events: readonly SessionEvent[]
  readonly logRevision: number
}

interface ParticipantCandidate {
  readonly row: PublishedRunReceiptParticipant
  readonly record: LifecycleRecord
  readonly stageOrder: number
}

function coverage(
  reported: number,
  provisional: number,
  unavailable: number,
  truncated: number,
): RunReceiptEvidenceCoverage {
  const total = reported + provisional + unavailable + truncated
  return {
    status: total === 0 || provisional + unavailable + truncated === 0
      ? 'complete'
      : reported + provisional === 0
        ? 'unavailable'
        : 'partial',
    total,
    reported,
    provisional,
    unavailable,
    truncated,
  }
}

function unavailableToken(
  reason: Extract<RunReceiptTokenEvidence, { status: 'unavailable' }>['reason'],
): RunReceiptTokenEvidence {
  return { status: 'unavailable', reason }
}

function knownToken(value: number, provisional: boolean): RunReceiptTokenEvidence {
  return provisional
    ? { status: 'provisional', value, source: 'session-fold' }
    : { status: 'reported', value, source: 'session-fold' }
}

function emptyTokenAggregate(): RunReceiptTokenAggregate {
  return { value: 0, coverage: coverage(0, 0, 0, 0) }
}

function emptyTokenAccount(): RunReceiptTokenAccount {
  return {
    coverage: 'complete',
    totals: {
      totalTokens: emptyTokenAggregate(),
      uncachedInputTokens: emptyTokenAggregate(),
      outputTokens: emptyTokenAggregate(),
      cacheReadTokens: emptyTokenAggregate(),
      cacheWriteTokens: emptyTokenAggregate(),
    },
    sessions: [],
  }
}

function emptyObservation(): RunReceiptObservation {
  return {
    participation: { coverage: coverage(0, 0, 0, 0), rows: [] },
    timing: { elapsedMs: 0, source: 'host-wall', coverage: coverage(0, 0, 0, 0) },
    tokenAccount: emptyTokenAccount(),
  }
}

export function createRunReceipt(
  plan: CompiledStrategyPlan,
  runId: CohortRunId,
  sessionId: SessionId,
  startedAt = Date.now(),
): LiveRunReceipt {
  const producerByArtifact = new Map(
    plan.primitives.map(primitive => [String(primitive.output.name), primitive.stage]),
  )
  const observation = emptyObservation()
  return deepFreeze({
    schemaVersion: 1,
    sessionId: String(sessionId),
    runId: String(runId),
    strategy: String(plan.strategy),
    cohort: String(plan.cohort),
    planDigest: String(plan.planDigest),
    startedAt,
    outcome: 'running',
    timing: observation.timing,
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
    participation: observation.participation,
    tokenAccount: observation.tokenAccount,
  })
}

function elapsed(receipt: LiveRunReceipt, now: number): number {
  return Math.max(receipt.timing.elapsedMs, Math.max(0, now - receipt.startedAt))
}

export function setRunReceiptObservation(
  receipt: LiveRunReceipt,
  observation: RunReceiptObservation,
  now = Date.now(),
): LiveRunReceipt {
  return deepFreeze({
    ...receipt,
    timing: { ...observation.timing, elapsedMs: elapsed(receipt, now) },
    participation: observation.participation,
    tokenAccount: observation.tokenAccount,
  })
}

export function settleRunReceiptStage(
  receipt: LiveRunReceipt,
  stage: string,
  status: Exclude<RunReceiptStageStatus, 'pending'>,
  now = Date.now(),
): LiveRunReceipt {
  let found = false
  const stages = receipt.stages.map((item) => {
    if (item.id !== stage) return item
    if (item.status !== 'pending') {
      throw new Error(`dsh-legion: Run Receipt stage ${JSON.stringify(stage)} already settled`)
    }
    found = true
    return { ...item, status }
  })
  if (!found) throw new Error(`dsh-legion: unknown Run Receipt stage ${JSON.stringify(stage)}`)
  return deepFreeze({
    ...receipt,
    timing: { ...receipt.timing, elapsedMs: elapsed(receipt, now) },
    stages,
  })
}

export function finishRunReceipt(
  receipt: LiveRunReceipt,
  outcome: Exclude<RunReceiptOutcome, 'running'>,
  now = Date.now(),
): LiveRunReceipt {
  return deepFreeze({
    ...receipt,
    timing: { ...receipt.timing, elapsedMs: elapsed(receipt, now) },
    outcome,
    stages: outcome === 'failed' || outcome === 'cancelled'
      ? receipt.stages.map(stage => stage.status === 'pending' ? { ...stage, status: 'cancelled' as const } : stage)
      : receipt.stages,
  })
}

function publisher(ctx: Pick<Context, 'get'>): RunReceiptPublisher | undefined {
  const value: unknown = ctx.get('legionReceipts')
  return typeof value === 'object' && value !== null
    && typeof (value as { publish?: unknown }).publish === 'function'
    ? value as RunReceiptPublisher
    : undefined
}

export function publishRunReceipt(
  ctx: Pick<Context, 'get'>,
  session: Session,
  receipt: LiveRunReceipt,
): RunReceiptFeedStatus {
  const candidate: unknown = ctx.get('legionReceipts')
  if (candidate === undefined) return { status: 'unavailable', failure: 'publisher-unavailable' }
  const target = publisher(ctx)
  if (target === undefined) return { status: 'incompatible', failure: 'publisher-interface' }
  let result: unknown
  try {
    result = target.publish(session, {
      type: 'replace',
      sessionId: String(session.id),
      runId: receipt.runId,
      receipt,
    })
  } catch {
    return { status: 'incompatible', failure: 'publisher-threw' }
  }
  const parsed = ReceiptPublicationResultSchema.safeParse(result)
  if (!parsed.success) return { status: 'incompatible', failure: 'publisher-result' }
  return parsed.data.ok
    ? { status: 'available', failure: null }
    : { status: 'rejected', failure: parsed.data.code }
}

/** Clear only companion-retained terminal presentation; execution ignores the result. */
export function clearRunReceiptTerminal(ctx: Pick<Context, 'get'>, session: Session): void {
  const target = publisher(ctx)
  if (target === undefined) return
  try {
    target.publish(session, { type: 'clear-terminal', sessionId: String(session.id) })
  } catch {
    // Observation cannot change direct delegation behavior.
  }
}

function agentRegistry(ctx: Context): AgentRegistry | undefined {
  return ctx.get('agents')
}

function projectionRegistry(ctx: Context): SessionProjectionRegistry | undefined {
  return ctx.get('sessionProjections')
}

function tokenMeter(ctx: Context): TokenMeter | undefined {
  return ctx.get('tokenMeter')
}

function sessionQuery(ctx: Context): SessionQueryEngine | undefined {
  return ctx.get('sessionQuery')
}

function sessionTiming(
  projections: ProjectionSnapshot | undefined,
): RunReceiptTimingEvidence {
  const value: unknown = projections?.values.subagentTiming
  if (typeof value !== 'object' || value === null) {
    return { status: 'unavailable', reason: 'capability-unavailable' }
  }
  const settledMs = (value as { settledMs?: unknown }).settledMs
  const active = (value as { active?: unknown }).active
  if (!Number.isSafeInteger(settledMs) || (settledMs as number) < 0) {
    return { status: 'unavailable', reason: 'observation-failed' }
  }
  let activeMs = 0
  if (active !== undefined) {
    if (typeof active !== 'object' || active === null) {
      return { status: 'unavailable', reason: 'observation-failed' }
    }
    const since = (active as { since?: unknown }).since
    const through = (active as { through?: unknown }).through
    if (!Number.isSafeInteger(since) || !Number.isSafeInteger(through)) {
      return { status: 'unavailable', reason: 'observation-failed' }
    }
    activeMs = Math.max(0, (through as number) - (since as number))
  }
  return { status: 'reported', elapsedMs: (settledMs as number) + activeMs, source: 'subagent-timing' }
}

function completeTurns(events: readonly SessionEvent[]): {
  readonly windows: readonly SessionEvent[][]
  readonly incomplete: boolean
} {
  const windows: SessionEvent[][] = []
  let current: SessionEvent[] | undefined
  let turn: number | undefined
  let incomplete = false
  for (const event of events) {
    if (event.type === 'turn/start') {
      if (current !== undefined) incomplete = true
      current = [event]
      turn = event.data.turn
      continue
    }
    if (current === undefined) continue
    current.push(event)
    if (event.type !== 'turn/end') continue
    if (event.data.turn !== turn) {
      incomplete = true
    } else {
      windows.push(current)
    }
    current = undefined
    turn = undefined
  }
  return { windows, incomplete: incomplete || current !== undefined }
}

interface TokenDimension {
  sum: number
  missing: boolean
  observed: boolean
}

function dimension(): TokenDimension {
  return { sum: 0, missing: false, observed: false }
}

function addUsage(
  dimensions: Record<RunReceiptTokenField, TokenDimension>,
  usage: TurnTokenUsage,
): void {
  dimensions.totalTokens.sum += usage.totalTokens
  dimensions.uncachedInputTokens.sum += usage.uncachedInputTokens
  dimensions.outputTokens.sum += usage.outputTokens
  dimensions.totalTokens.observed = true
  dimensions.uncachedInputTokens.observed = true
  dimensions.outputTokens.observed = true
  for (const field of ['cacheReadTokens', 'cacheWriteTokens'] as const) {
    const value = usage[field]
    if (value === undefined) dimensions[field].missing = true
    else {
      dimensions[field].sum += value
      dimensions[field].observed = true
    }
  }
}

function safeCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function addCompactionUsage(
  dimensions: Record<RunReceiptTokenField, TokenDimension>,
  usage: TokenUsage,
): void {
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens } = usage
  if (!safeCount(inputTokens) || !safeCount(outputTokens)) {
    for (const field of RUN_RECEIPT_TOKEN_FIELDS) dimensions[field].missing = true
    return
  }
  dimensions.uncachedInputTokens.sum += inputTokens
  dimensions.outputTokens.sum += outputTokens
  dimensions.uncachedInputTokens.observed = true
  dimensions.outputTokens.observed = true
  const knownSubtotal = inputTokens
    + outputTokens
    + (safeCount(cacheReadTokens) ? cacheReadTokens : 0)
    + (safeCount(cacheWriteTokens) ? cacheWriteTokens : 0)
  if (safeCount(totalTokens) && totalTokens >= knownSubtotal) {
    dimensions.totalTokens.sum += totalTokens
    dimensions.totalTokens.observed = true
  } else if (totalTokens === undefined
    && safeCount(cacheReadTokens)
    && safeCount(cacheWriteTokens)
    && Number.isSafeInteger(knownSubtotal)) {
    dimensions.totalTokens.sum += knownSubtotal
    dimensions.totalTokens.observed = true
  } else {
    dimensions.totalTokens.missing = true
  }
  for (const [field, value] of [
    ['cacheReadTokens', cacheReadTokens],
    ['cacheWriteTokens', cacheWriteTokens],
  ] as const) {
    if (!safeCount(value)) dimensions[field].missing = true
    else {
      dimensions[field].sum += value
      dimensions[field].observed = true
    }
  }
}

function tokenEvidence(
  dimension: TokenDimension,
  incomplete: boolean,
): RunReceiptTokenEvidence {
  const missing = dimension.missing || incomplete
  if (!dimension.observed) {
    return unavailableToken(incomplete ? 'incomplete-turn' : 'not-reported')
  }
  if (!Number.isSafeInteger(dimension.sum)) return unavailableToken('observation-failed')
  return knownToken(dimension.sum, missing)
}

function sessionTokenSample(ctx: Context, record: LifecycleRecord): RunReceiptTokenSample {
  if (record.coldToken !== undefined) return record.coldToken
  const unavailable = (reason: Extract<RunReceiptTokenEvidence, { status: 'unavailable' }>['reason']) => ({
    childId: String(record.info.id),
    logRevision: null,
    totalTokens: unavailableToken(reason),
    uncachedInputTokens: unavailableToken(reason),
    outputTokens: unavailableToken(reason),
    cacheReadTokens: unavailableToken(reason),
    cacheWriteTokens: unavailableToken(reason),
  })
  let cut = record.coldCut
  if (cut === undefined) {
    const session = record.localAgent?.session
    if (session === undefined) return unavailable('session-unavailable')
    const meter = tokenMeter(ctx)
    if (meter === undefined) return unavailable('capability-unavailable')
    try {
      const measured = meter.measure(session)
      if (!Number.isSafeInteger(measured.logRevision)
        || measured.logRevision < 0
        || measured.logRevision > session.events.length) return unavailable('observation-failed')
      cut = {
        header: session.header,
        events: session.events.slice(0, measured.logRevision),
        logRevision: measured.logRevision,
      }
    } catch {
      return unavailable('observation-failed')
    }
  }
  const seedLength = cut.header.seedLength ?? 0
  if (!Number.isSafeInteger(seedLength) || seedLength < 0 || seedLength > cut.events.length) {
    return unavailable('observation-failed')
  }
  const own = cut.events.slice(seedLength)
  const { windows, incomplete } = completeTurns(own)
  const dimensions: Record<RunReceiptTokenField, TokenDimension> = {
    totalTokens: dimension(),
    uncachedInputTokens: dimension(),
    outputTokens: dimension(),
    cacheReadTokens: dimension(),
    cacheWriteTokens: dimension(),
  }
  for (const window of windows) {
    const usage = deriveTurnTokenUsage(window)
    if (usage === undefined) {
      for (const field of RUN_RECEIPT_TOKEN_FIELDS) dimensions[field].missing = true
    } else {
      addUsage(dimensions, usage)
    }
  }
  for (const event of own) {
    if (event.type === 'compaction/summary' && event.data.usage !== undefined) {
      addCompactionUsage(dimensions, event.data.usage)
    }
  }
  return {
    childId: String(record.info.id),
    logRevision: cut.logRevision,
    totalTokens: tokenEvidence(dimensions.totalTokens, incomplete),
    uncachedInputTokens: tokenEvidence(dimensions.uncachedInputTokens, incomplete),
    outputTokens: tokenEvidence(dimensions.outputTokens, incomplete),
    cacheReadTokens: tokenEvidence(dimensions.cacheReadTokens, incomplete),
    cacheWriteTokens: tokenEvidence(dimensions.cacheWriteTokens, incomplete),
  }
}

function remoteTokenSample(record: LifecycleRecord): RunReceiptTokenSample {
  return {
    childId: String(record.info.id),
    logRevision: null,
    totalTokens: unavailableToken('remote-unobservable'),
    uncachedInputTokens: unavailableToken('remote-unobservable'),
    outputTokens: unavailableToken('remote-unobservable'),
    cacheReadTokens: unavailableToken('remote-unobservable'),
    cacheWriteTokens: unavailableToken('remote-unobservable'),
  }
}

function aggregateTokenField(
  samples: readonly RunReceiptTokenSample[],
  field: RunReceiptTokenField,
  unavailableParticipants: number,
  truncated: number,
): RunReceiptTokenAggregate {
  const evidence = samples.map(sample => sample[field])
  const reported = evidence.filter(item => item.status === 'reported').length
  const provisional = evidence.filter(item => item.status === 'provisional').length
  const unavailable = evidence.length - reported - provisional + unavailableParticipants
  const known = evidence.flatMap(item => item.status === 'unavailable' ? [] : [item.value])
  return {
    value: known.length === 0 && reported + provisional + unavailable + truncated > 0
      ? null
      : known.reduce((sum, item) => sum + item, 0),
    coverage: coverage(reported, provisional, unavailable, truncated),
  }
}

function tokenAccount(
  samples: readonly RunReceiptTokenSample[],
  unavailableParticipants: number,
  truncated: number,
): RunReceiptTokenAccount {
  const totals = {
    totalTokens: aggregateTokenField(samples, 'totalTokens', unavailableParticipants, truncated),
    uncachedInputTokens: aggregateTokenField(samples, 'uncachedInputTokens', unavailableParticipants, truncated),
    outputTokens: aggregateTokenField(samples, 'outputTokens', unavailableParticipants, truncated),
    cacheReadTokens: aggregateTokenField(samples, 'cacheReadTokens', unavailableParticipants, truncated),
    cacheWriteTokens: aggregateTokenField(samples, 'cacheWriteTokens', unavailableParticipants, truncated),
  }
  const statuses = RUN_RECEIPT_TOKEN_FIELDS.map(field => totals[field].coverage.status)
  return {
    coverage: statuses.every(status => status === 'complete')
      ? 'complete'
      : statuses.every(status => status === 'unavailable')
        ? 'unavailable'
        : 'partial',
    totals,
    sessions: samples,
  }
}

class HostRunReceiptParticipationObserver implements RunReceiptParticipationObserver {
  private readonly recordsByChild = new Map<SessionId, Map<SubagentRunInfo['runId'], LifecycleRecord>>()
  private readonly bound = new Map<SubagentRunInfo['runId'], LifecycleRecord>()
  private readonly agents = new Map<SessionId, Agent>()
  private readonly stageOrder: ReadonlyMap<string, number>
  private readonly unavailable = new Set<string>()
  private readonly disposers: Array<() => void>
  private listening = true
  private finished = false

  constructor(
    private readonly ctx: Context,
    private readonly parent: Agent,
    stages: readonly string[],
    private readonly onChange: (observation: RunReceiptObservation) => void,
  ) {
    this.stageOrder = new Map(stages.map((stage, index) => [stage, index]))
    const self = this
    this.disposers = [
      ctx.on('subagent/start', function (info: SubagentRunInfo) {
        self.onSubagentStart(carrierKeyOf(this), info)
      }),
      ctx.on('subagent/end', function (info: SubagentRunEndInfo) {
        self.onSubagentEnd(carrierKeyOf(this), info)
      }),
      ctx.on('agent/created', ({ agent }) => { self.onAgent(agent) }),
      ctx.on('agent/status', ({ agent }) => { self.onAgent(agent) }),
      ctx.on('agent/disposed', ({ agent }) => {
        if (agentRegistry(ctx)?.get(agent.id) === undefined) self.agents.delete(agent.id)
      }),
    ]
    for (const agent of agentRegistry(ctx)?.list() ?? []) this.agents.set(agent.id, agent)
  }

  trackChild(childId: SessionId, agent: Agent | undefined, binding: RunReceiptChildBinding): void {
    const candidates = [...(this.recordsByChild.get(childId)?.values() ?? [])]
      .filter(record => record.binding === undefined && record.parentId === this.parent.id)
    if (candidates.length !== 1) {
      this.unavailable.add(`direct:${String(childId)}`)
      this.emit()
      return
    }
    const record = candidates[0]!
    if (record.info.id !== childId || record.info.local !== (agent !== undefined)) {
      this.unavailable.add(`direct:${String(childId)}`)
      this.emit()
      return
    }
    record.binding = binding
    if (agent !== undefined) record.localAgent = agent
    record.depth = 1
    this.bound.set(record.info.runId, record)
    this.unavailable.delete(`direct:${String(childId)}`)
    if (agent !== undefined) this.agents.set(agent.id, agent)
    this.bindPendingNested(record)
    this.emit()
  }

  sample(): void {
    this.emit()
  }

  async finish(signal?: AbortSignal): Promise<void> {
    if (this.finished) return
    this.finished = true
    this.dispose()
    let entries: readonly SubagentDescendantListEntry[]
    try {
      entries = await this.ctx.subagents.listDescendants(this.parent.session.id, signal)
    } catch {
      this.unavailable.add('descendants:unavailable')
      this.emit()
      return
    }
    const rootByChild = new Map<SessionId, LifecycleRecord>()
    for (const entry of entries) {
      const direct = this.directRecord(entry.id)
      if (entry.depth === 1 && direct !== undefined) rootByChild.set(entry.id, direct)
      const root = direct ?? rootByChild.get(entry.parentId)
      if (root === undefined) continue
      rootByChild.set(entry.id, root)
      if (entry.kind === 'diagnostic') {
        this.unavailable.add(`diagnostic:${String(entry.id)}`)
        continue
      }
      if (this.hasBoundChild(entry.id)) continue
      if (!root.info.local) {
        this.unavailable.add(`nested-remote:${String(entry.id)}`)
        continue
      }
      const query = sessionQuery(this.ctx)
      if (query === undefined) {
        this.unavailable.add(`cold:${String(entry.id)}`)
        continue
      }
      const binding = root.binding
      if (binding === undefined) {
        this.unavailable.add(`cold:${String(entry.id)}`)
        continue
      }
      let observation: SessionObservation | undefined
      try {
        observation = await query.observeSession(entry.id, {
          projectionMode: 'all',
          ...signal === undefined ? {} : { signal },
        })
        const info: SubagentRunInfo = {
          runId: `cold:${String(entry.id)}` as SubagentRunInfo['runId'],
          provider: root.info.provider,
          id: entry.id,
          local: true,
        }
        const record: LifecycleRecord = {
          info,
          startedAt: observation.header.createdAt,
          end: { ...info, stopReason: 'completed' },
          endedAt: observation.events.at(-1)?.time ?? observation.header.createdAt,
          binding,
          parentId: entry.parentId,
          depth: entry.depth,
          coldLifecycle: true,
          coldCut: {
            header: observation.header,
            events: observation.events,
            logRevision: observation.cursor + 1,
          },
        }
        record.coldTiming = sessionTiming(observation.projections)
        record.coldToken = sessionTokenSample(this.ctx, record)
        record.coldCut = undefined
        this.bound.set(record.info.runId, record)
        this.unavailable.delete(`cold:${String(entry.id)}`)
      } catch {
        this.unavailable.add(`cold:${String(entry.id)}`)
      } finally {
        observation?.[Symbol.dispose]()
      }
    }
    this.emit()
  }

  dispose(): void {
    if (!this.listening) return
    this.listening = false
    for (const dispose of this.disposers.splice(0).reverse()) dispose()
  }

  private onSubagentStart(carrier: unknown, info: SubagentRunInfo): void {
    if (!this.listening) return
    if (carrier === this.parent) {
      const record: LifecycleRecord = {
        info,
        startedAt: Date.now(),
        parentId: this.parent.id,
        depth: 1,
      }
      const records = this.recordsByChild.get(info.id) ?? new Map<SubagentRunInfo['runId'], LifecycleRecord>()
      records.set(info.runId, record)
      this.recordsByChild.set(info.id, records)
      this.attachPendingNested(info.id, record)
      return
    }
    if (!isAgent(carrier)) return
    const root = this.rootRecord(carrier) ?? this.unboundRootRecord(carrier.id)
    const record: LifecycleRecord = {
      info,
      startedAt: Date.now(),
      parentId: carrier.id,
      depth: (root?.depth ?? 1) + 1,
      ...root === undefined ? {} : { root },
    }
    const records = this.recordsByChild.get(info.id) ?? new Map<SubagentRunInfo['runId'], LifecycleRecord>()
    records.set(info.runId, record)
    this.recordsByChild.set(info.id, records)
    this.bindNested(record)
    this.emit()
  }

  private unboundRootRecord(id: SessionId): LifecycleRecord | undefined {
    const candidates = [...(this.recordsByChild.get(id)?.values() ?? [])]
      .filter(record => record.parentId === this.parent.id && record.binding === undefined)
    return candidates.length === 1 ? candidates[0] : undefined
  }

  private bindNested(record: LifecycleRecord): void {
    const root = record.root
    if (root?.binding === undefined) return
    record.binding = root.binding
    record.depth = (root.depth ?? 1) + 1
    if (!record.info.local) {
      this.unavailable.add(`nested-remote:${String(record.info.runId)}`)
      return
    }
    this.bound.set(record.info.runId, record)
  }

  private attachPendingNested(parentId: SessionId, root: LifecycleRecord): void {
    for (const records of this.recordsByChild.values()) {
      for (const record of records.values()) {
        if (record.root !== undefined || record.parentId !== parentId) continue
        record.root = root
        this.bindNested(record)
        if (record.info.local) this.attachPendingNested(record.info.id, record)
      }
    }
  }

  private bindPendingNested(root: LifecycleRecord): void {
    this.bindNested(root)
    this.attachPendingNested(root.info.id, root)
    for (const records of this.recordsByChild.values()) {
      for (const record of records.values()) {
        if (record.root === root) this.bindNested(record)
      }
    }
  }

  private onSubagentEnd(carrier: unknown, info: SubagentRunEndInfo): void {
    if (!this.listening) return
    const record = this.recordsByChild.get(info.id)?.get(info.runId)
    if (record === undefined) return
    if (carrier !== this.parent
      && (!isAgent(carrier) || record.parentId !== carrier.id)) return
    record.end = info
    record.endedAt = Date.now()
    this.emit()
  }

  private onAgent(agent: Agent): void {
    if (!this.listening) return
    const registry = agentRegistry(this.ctx)
    if (registry?.get(agent.id) !== agent) return
    this.agents.set(agent.id, agent)
    if (this.directRecord(agent.id) !== undefined || this.rootRecord(agent) !== undefined) this.emit()
  }

  private directRecord(id: SessionId): LifecycleRecord | undefined {
    return [...(this.recordsByChild.get(id)?.values() ?? [])]
      .find(record => record.binding !== undefined && record.parentId === this.parent.id)
  }

  private hasBoundChild(id: SessionId): boolean {
    return [...this.bound.values()].some(record => record.info.id === id)
  }

  private rootRecord(agent: Agent): LifecycleRecord | undefined {
    const direct = this.directRecord(agent.id)
    if (direct !== undefined) return direct
    let parentId = agent.session.header.parentSession
    const seen = new Set<SessionId>()
    while (parentId !== undefined && !seen.has(parentId)) {
      seen.add(parentId)
      const direct = this.directRecord(parentId)
      if (direct !== undefined) return direct
      parentId = this.agents.get(parentId)?.session.header.parentSession
    }
    return undefined
  }

  private participant(record: LifecycleRecord): ParticipantCandidate | undefined {
    const binding = record.binding
    const parentId = record.parentId
    const depth = record.depth
    if (binding === undefined || parentId === undefined || depth === undefined) return undefined
    const ended = record.end !== undefined
    let state: PublishedRunReceiptParticipant['state']
    if (ended) state = 'ended'
    else if (!record.info.local) state = 'running'
    else {
      const agent = this.agents.get(record.info.id)
      if (agent === undefined || agentRegistry(this.ctx)?.get(record.info.id) !== agent) return undefined
      state = agent.status
      record.localAgent ??= agent
    }
    const timing = record.info.local
      ? record.coldTiming ?? sessionTiming(this.liveProjections(record))
      : {
          status: 'reported' as const,
          elapsedMs: Math.max(0, (record.endedAt ?? Date.now()) - record.startedAt),
          source: 'host-lifecycle' as const,
        }
    return {
      row: {
        childId: String(record.info.id),
        parentId: String(parentId),
        depth,
        stage: binding.stage,
        member: binding.member,
        childIndex: binding.childIndex,
        runId: record.coldLifecycle === true ? null : String(record.info.runId),
        provider: record.coldLifecycle === true ? null : record.info.provider,
        source: record.info.local ? 'session' : 'remote',
        state,
        timing,
        ...record.end === undefined || record.coldLifecycle === true
          ? {}
          : { stopReason: String(record.end.stopReason) },
      },
      record,
      stageOrder: this.stageOrder.get(binding.stage) ?? Number.MAX_SAFE_INTEGER,
    }
  }

  private liveProjections(record: LifecycleRecord): ProjectionSnapshot | undefined {
    const session = record.localAgent?.session
    if (session === undefined) return undefined
    try {
      return projectionRegistry(this.ctx)?.snapshot(session, ['subagentTiming'])
    } catch {
      return undefined
    }
  }

  private emit(): void {
    const records = [...this.bound.values()]
    const candidates = records
      .flatMap(record => {
        const participant = this.participant(record)
        return participant === undefined ? [] : [participant]
      })
      .sort((left, right) => left.stageOrder - right.stageOrder
        || left.row.childIndex - right.row.childIndex
        || left.row.depth - right.row.depth
        || left.row.childId.localeCompare(right.row.childId))
    const dynamicUnavailable = records.length - candidates.length
    const maximum = RECEIPT_FEED_LIMITS.participantsPerReceipt
    const kept = candidates.slice(0, maximum)
    const truncated = Math.max(0, candidates.length - kept.length)
    const unavailable = this.unavailable.size + dynamicUnavailable
    const rows = kept.map(candidate => candidate.row)
    const samples = kept.map(candidate => candidate.row.source === 'remote'
      ? remoteTokenSample(candidate.record)
      : sessionTokenSample(this.ctx, candidate.record))
    const timingReported = rows.filter(row => row.timing.status === 'reported').length
    const timingUnavailable = rows.length - timingReported + unavailable
    const observation: RunReceiptObservation = {
      participation: {
        coverage: coverage(rows.length, 0, unavailable, truncated),
        rows,
      },
      timing: {
        elapsedMs: 0,
        source: 'host-wall',
        coverage: coverage(timingReported, 0, timingUnavailable, truncated),
      },
      tokenAccount: tokenAccount(samples, unavailable, truncated),
    }
    this.onChange(deepFreeze(observation))
  }
}

function isAgent(value: unknown): value is Agent {
  return typeof value === 'object' && value !== null
    && typeof (value as { id?: unknown }).id === 'string'
    && typeof (value as { session?: unknown }).session === 'object'
}

export function observeRunReceiptParticipation(
  ctx: Context,
  parent: Agent,
  stages: readonly string[],
  onChange: (observation: RunReceiptObservation) => void,
): RunReceiptParticipationObserver {
  return new HostRunReceiptParticipationObserver(ctx, parent, stages, onChange)
}

export function summarizeRunReceipt(
  receipt: LiveRunReceipt,
  feed: RunReceiptFeedStatus,
): RunReceiptSummary {
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
  const rows = receipt.participation.rows
  const participationCounts = {
    total: rows.length,
    local: rows.filter(row => row.source === 'session').length,
    remote: rows.filter(row => row.source === 'remote').length,
    running: rows.filter(row => row.state === 'running').length,
    idle: rows.filter(row => row.state === 'idle').length,
    ended: rows.filter(row => row.state === 'ended').length,
  }
  return deepFreeze({
    runId: receipt.runId as CohortRunId,
    outcome: receipt.outcome,
    elapsedMs: receipt.timing.elapsedMs,
    stageCounts,
    participationCounts,
    tokenTotals: Object.fromEntries(
      RUN_RECEIPT_TOKEN_FIELDS.map(field => [field, receipt.tokenAccount.totals[field].value]),
    ) as Readonly<Record<RunReceiptTokenField, number | null>>,
    unavailableCounts: {
      participation: receipt.participation.coverage.unavailable,
      timing: receipt.timing.coverage.unavailable,
      tokenDimensions: RUN_RECEIPT_TOKEN_FIELDS.reduce(
        (sum, field) => sum + receipt.tokenAccount.totals[field].coverage.unavailable,
        0,
      ),
    },
    truncatedCounts: {
      participation: receipt.participation.coverage.truncated,
      tokenSessions: Math.max(...RUN_RECEIPT_TOKEN_FIELDS.map(field => receipt.tokenAccount.totals[field].coverage.truncated)),
    },
    coverage: {
      participation: receipt.participation.coverage.status,
      timing: receipt.timing.coverage.status,
      tokens: receipt.tokenAccount.coverage,
    },
    feed,
  })
}

export function renderRunReceiptSummary(summary: {
  readonly outcome: string
  readonly elapsedMs: number
  readonly stageCounts: { readonly total: number; readonly pending: number }
  readonly participationCounts: {
    readonly local: number
    readonly remote: number
    readonly running: number
    readonly idle: number
    readonly ended: number
  }
  readonly tokenTotals: { readonly totalTokens: number | null }
  readonly coverage: { readonly participation: string; readonly timing: string; readonly tokens: string }
  readonly feed: { readonly status: string; readonly failure: string | null }
}): string {
  const settled = summary.stageCounts.total - summary.stageCounts.pending
  const participation = summary.participationCounts
  const tokenTotal = summary.tokenTotals.totalTokens
  return `Run receipt: ${summary.outcome} in ${String(summary.elapsedMs)}ms; stages ${String(settled)}/${String(summary.stageCounts.total)} settled; participation ${String(participation.local)} local, ${String(participation.remote)} remote, ${String(participation.running)} running, ${String(participation.idle)} idle, ${String(participation.ended)} ended; known tokens ${tokenTotal === null ? 'unavailable' : String(tokenTotal)}; coverage ${summary.coverage.participation}/${summary.coverage.timing}/${summary.coverage.tokens}; feed ${summary.feed.status}${summary.feed.failure === null ? '' : ` (${summary.feed.failure})`}`
}
