import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { CohortName, CohortRunId, StrategyName, StrategyPlanDigest } from './identity.ts'
import type { CompiledStrategyPlan } from './orchestration.ts'
import { deepFreeze } from './internal/value.ts'

export const RUN_RECEIPT_PROJECTION_KEY = 'legion/run-receipts'
export const RUN_RECEIPT_EVENT_TYPE = 'legion/run-receipt'

export type RunReceiptStageStatus = 'pending' | 'completed' | 'degraded' | 'cancelled' | 'failed'
export type RunReceiptOutcome = 'running' | Exclude<RunReceiptStageStatus, 'pending'>

export interface RunReceiptStage {
  readonly id: string
  readonly kind: 'dsh-delegate' | 'dsh-subagent-fanout'
  readonly member: string
  readonly expectedChildren: number
  readonly after: readonly string[]
  readonly status: RunReceiptStageStatus
}

export interface RunReceipt {
  readonly schemaVersion: 1
  readonly runId: CohortRunId
  readonly strategy: CompiledStrategyPlan['strategy']
  readonly cohort: CompiledStrategyPlan['cohort']
  readonly planDigest: CompiledStrategyPlan['planDigest']
  readonly startedAt: number
  readonly elapsedMs: number
  readonly outcome: RunReceiptOutcome
  readonly stages: readonly RunReceiptStage[]
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

function parseRunReceipt(value: unknown): RunReceipt {
  const source = record(value, [
    'schemaVersion', 'runId', 'strategy', 'cohort', 'planDigest',
    'startedAt', 'elapsedMs', 'outcome', 'stages',
  ], 'Run Receipt')
  if (source.schemaVersion !== 1) throw new Error('dsh-legion: invalid Run Receipt schemaVersion')
  const outcomes: readonly RunReceiptOutcome[] = [
    'running', 'completed', 'degraded', 'cancelled', 'failed',
  ]
  if (!outcomes.includes(source.outcome as RunReceiptOutcome)) {
    throw new Error('dsh-legion: invalid Run Receipt outcome')
  }
  if (!Array.isArray(source.stages)) throw new Error('dsh-legion: invalid Run Receipt stages')
  return deepFreeze({
    schemaVersion: 1,
    runId: CohortRunId(text(source.runId, 'Run Receipt runId')),
    strategy: StrategyName(text(source.strategy, 'Run Receipt strategy')),
    cohort: CohortName(text(source.cohort, 'Run Receipt cohort')),
    planDigest: StrategyPlanDigest(text(source.planDigest, 'Run Receipt planDigest')),
    startedAt: nonNegativeInteger(source.startedAt, 'Run Receipt startedAt'),
    elapsedMs: nonNegativeInteger(source.elapsedMs, 'Run Receipt elapsedMs'),
    outcome: source.outcome as RunReceiptOutcome,
    stages: source.stages.map((stage, index) => parseStage(stage, `Run Receipt stages[${String(index)}]`)),
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
  stateVersion: 1,
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
    schemaVersion: 1,
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
  })
}

function elapsed(receipt: RunReceipt, now: number): number {
  return Math.max(receipt.elapsedMs, Math.max(0, now - receipt.startedAt))
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
  return deepFreeze({
    runId: receipt.runId,
    outcome: receipt.outcome,
    elapsedMs: receipt.elapsedMs,
    stageCounts,
  })
}

export function renderRunReceiptSummary(summary: {
  readonly outcome: string
  readonly elapsedMs: number
  readonly stageCounts: { readonly total: number; readonly pending: number }
}): string {
  const settled = summary.stageCounts.total - summary.stageCounts.pending
  return `Run receipt: ${summary.outcome} in ${String(summary.elapsedMs)}ms; stages ${String(settled)}/${String(summary.stageCounts.total)} settled`
}
