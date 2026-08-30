import { z } from 'zod'

export const RECEIPT_FEED_LIMITS = Object.freeze({
  activeReceiptsPerSession: 16,
  participantsPerReceipt: 256,
  serializedSessionReplacementBytes: 1_048_576,
  processFollowers: 64,
} as const)

export type RunReceiptStageStatus = 'pending' | 'completed' | 'degraded' | 'cancelled' | 'failed'
export type RunReceiptOutcome = 'running' | Exclude<RunReceiptStageStatus, 'pending'>
export type RunReceiptCoverageStatus = 'complete' | 'partial' | 'unavailable'

export interface RunReceiptEvidenceCoverage {
  readonly status: RunReceiptCoverageStatus
  readonly total: number
  readonly reported: number
  readonly provisional: number
  readonly unavailable: number
  readonly truncated: number
}

export interface RunReceiptStage {
  readonly id: string
  readonly kind: 'dsh-delegate' | 'dsh-subagent-fanout'
  readonly member: string
  readonly expectedChildren: number
  readonly after: readonly string[]
  readonly status: RunReceiptStageStatus
}

export type RunReceiptTimingEvidence =
  | {
      readonly status: 'reported'
      readonly elapsedMs: number
      readonly source: 'subagent-timing' | 'host-lifecycle'
    }
  | {
      readonly status: 'unavailable'
      readonly reason:
        | 'session-unavailable'
        | 'remote-unobservable'
        | 'not-reported'
        | 'capability-unavailable'
        | 'observation-failed'
    }

export interface RunReceiptParticipant {
  readonly childId: string
  readonly parentId: string
  readonly depth: number
  readonly stage: string
  readonly member: string
  readonly childIndex: number
  /** Host lifecycle identity, or null for a cold descendant with no observed edge. */
  readonly runId: string | null
  /** Host lifecycle provider, or null with an unobserved cold lifecycle. */
  readonly provider: string | null
  readonly source: 'session' | 'remote'
  readonly state: 'running' | 'idle' | 'ended'
  /** Present only when an observed Host lifecycle end supplied it. */
  readonly stopReason?: string
  readonly timing: RunReceiptTimingEvidence
}

export const RUN_RECEIPT_TOKEN_FIELDS = Object.freeze([
  'totalTokens',
  'uncachedInputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
] as const)
export type RunReceiptTokenField = typeof RUN_RECEIPT_TOKEN_FIELDS[number]

export type RunReceiptTokenEvidence =
  | {
      readonly status: 'reported' | 'provisional'
      readonly value: number
      readonly source: 'session-fold'
    }
  | {
      readonly status: 'unavailable'
      readonly reason:
        | 'not-reported'
        | 'session-unavailable'
        | 'remote-unobservable'
        | 'incomplete-turn'
        | 'capability-unavailable'
        | 'observation-failed'
    }

export interface RunReceiptTokenSample {
  readonly childId: string
  readonly logRevision: number | null
  readonly totalTokens: RunReceiptTokenEvidence
  readonly uncachedInputTokens: RunReceiptTokenEvidence
  readonly outputTokens: RunReceiptTokenEvidence
  readonly cacheReadTokens: RunReceiptTokenEvidence
  readonly cacheWriteTokens: RunReceiptTokenEvidence
}

export interface RunReceiptTokenAggregate {
  /** Known exact total or provisional subtotal; null only when coverage is unavailable. */
  readonly value: number | null
  readonly coverage: RunReceiptEvidenceCoverage
}

export interface RunReceiptTokenTotals {
  readonly totalTokens: RunReceiptTokenAggregate
  readonly uncachedInputTokens: RunReceiptTokenAggregate
  readonly outputTokens: RunReceiptTokenAggregate
  readonly cacheReadTokens: RunReceiptTokenAggregate
  readonly cacheWriteTokens: RunReceiptTokenAggregate
}

export interface RunReceiptTokenAccount {
  readonly coverage: RunReceiptCoverageStatus
  readonly totals: RunReceiptTokenTotals
  readonly sessions: readonly RunReceiptTokenSample[]
}

export interface RunReceiptParticipation {
  readonly coverage: RunReceiptEvidenceCoverage
  readonly rows: readonly RunReceiptParticipant[]
}

export interface RunReceiptTiming {
  readonly elapsedMs: number
  readonly source: 'host-wall'
  readonly coverage: RunReceiptEvidenceCoverage
}

/** Strict, presentation-safe full facts for one live Cohort Run. */
export interface RunReceipt {
  readonly schemaVersion: 1
  readonly sessionId: string
  readonly runId: string
  readonly strategy: string
  readonly cohort: string
  readonly planDigest: string
  readonly startedAt: number
  readonly outcome: RunReceiptOutcome
  readonly timing: RunReceiptTiming
  readonly stages: readonly RunReceiptStage[]
  readonly participation: RunReceiptParticipation
  readonly tokenAccount: RunReceiptTokenAccount
}

/** Complete model for one live Session and one companion instance. */
export interface ReceiptSessionModel {
  readonly schemaVersion: 1
  readonly sessionId: string
  readonly revision: number
  readonly feed: { readonly status: 'available' }
  readonly receipts: readonly RunReceipt[]
}

export type ReceiptPublication =
  | {
      readonly type: 'replace'
      readonly sessionId: string
      readonly runId: string
      readonly receipt: RunReceipt
    }
  | {
      readonly type: 'clear-terminal'
      readonly sessionId: string
    }

export type ReceiptPublicationFailureCode =
  | 'feed-disposed'
  | 'session-not-live'
  | 'invalid-publication'
  | 'session-key-mismatch'
  | 'run-key-mismatch'
  | 'invalid-references'
  | 'invalid-aggregate'
  | 'invalid-transition'
  | 'active-receipt-cap'
  | 'participant-cap'
  | 'session-byte-cap'
  | 'revision-exhausted'

export type ReceiptPublicationResult =
  | { readonly ok: true; readonly changed: boolean; readonly revision: number }
  | { readonly ok: false; readonly code: ReceiptPublicationFailureCode }

export interface ReceiptFeedBaseline {
  readonly type: 'baseline'
  readonly value: ReceiptSessionModel
}

export interface ReceiptFeedReplacement {
  readonly type: 'replacement'
  readonly value: ReceiptSessionModel
}

export interface ReceiptFeedUnavailable {
  readonly type: 'unavailable'
  readonly code: 'feed-disposed' | 'invalid-session-id' | 'session-not-live' | 'follower-cap'
}

export type ReceiptFeedFrame = ReceiptFeedBaseline | ReceiptFeedReplacement | ReceiptFeedUnavailable

type ReceiptSemanticFailure = 'invalid-references' | 'invalid-aggregate' | 'invalid-transition'

function sameCoverage(left: RunReceiptEvidenceCoverage, right: RunReceiptEvidenceCoverage): boolean {
  return left.status === right.status
    && left.total === right.total
    && left.reported === right.reported
    && left.provisional === right.provisional
    && left.unavailable === right.unavailable
    && left.truncated === right.truncated
}

function expectedCoverage(
  reported: number,
  provisional: number,
  unavailable: number,
  truncated: number,
): RunReceiptEvidenceCoverage {
  const total = reported + provisional + unavailable + truncated
  const status = total === 0 || provisional + unavailable + truncated === 0
    ? 'complete'
    : reported + provisional === 0
      ? 'unavailable'
      : 'partial'
  return { status, total, reported, provisional, unavailable, truncated }
}

function validCoverage(value: RunReceiptEvidenceCoverage): boolean {
  return sameCoverage(value, expectedCoverage(
    value.reported,
    value.provisional,
    value.unavailable,
    value.truncated,
  ))
}

function hasDependencyCycle(stages: readonly RunReceiptStage[]): boolean {
  const byId = new Map(stages.map(stage => [stage.id, stage]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    for (const dependency of byId.get(id)?.after ?? []) {
      if (visit(dependency)) return true
    }
    visiting.delete(id)
    visited.add(id)
    return false
  }
  return stages.some(stage => visit(stage.id))
}

function validateReferences(receipt: RunReceipt): ReceiptSemanticFailure | undefined {
  const stages = new Map<string, RunReceiptStage>()
  for (const stage of receipt.stages) {
    if (stages.has(stage.id) || new Set(stage.after).size !== stage.after.length) return 'invalid-references'
    stages.set(stage.id, stage)
  }
  for (const stage of receipt.stages) {
    if (stage.after.includes(stage.id) || stage.after.some(dependency => !stages.has(dependency))) {
      return 'invalid-references'
    }
  }
  if (hasDependencyCycle(receipt.stages)) return 'invalid-references'

  const participants = new Map<string, RunReceiptParticipant>()
  for (const participant of receipt.participation.rows) {
    if (participants.has(participant.childId)) return 'invalid-references'
    participants.set(participant.childId, participant)
  }
  const parentIds = new Set([receipt.sessionId, ...participants.keys()])
  for (const participant of participants.values()) {
    const stage = stages.get(participant.stage)
    if (stage === undefined
      || participant.member !== stage.member
      || !parentIds.has(participant.parentId)
      || (participant.depth === 1 && participant.childIndex >= stage.expectedChildren)
      || (participant.source === 'remote' && participant.state === 'idle')
      || ((participant.runId === null) !== (participant.provider === null))
      || (participant.stopReason !== undefined
        && (participant.runId === null || participant.state !== 'ended'))
      || (participant.timing.status === 'reported'
        && participant.timing.source !== (participant.source === 'session' ? 'subagent-timing' : 'host-lifecycle'))) {
      return 'invalid-references'
    }
  }

  const samples = new Set<string>()
  for (const sample of receipt.tokenAccount.sessions) {
    const participant = participants.get(sample.childId)
    if (participant === undefined || samples.has(sample.childId)) return 'invalid-references'
    const evidence = RUN_RECEIPT_TOKEN_FIELDS.map(field => sample[field])
    if (participant.source === 'remote') {
      if (sample.logRevision !== null
        || evidence.some(value => value.status !== 'unavailable' || value.reason !== 'remote-unobservable')) {
        return 'invalid-references'
      }
    } else if (sample.logRevision === null && evidence.some(value => value.status !== 'unavailable')) {
      return 'invalid-references'
    }
    samples.add(sample.childId)
  }
  if (samples.size !== participants.size) return 'invalid-references'
  return undefined
}

function knownToken(evidence: RunReceiptTokenEvidence): number | undefined {
  return evidence.status === 'unavailable' ? undefined : evidence.value
}

function validateAggregate(receipt: RunReceipt): ReceiptSemanticFailure | undefined {
  const participation = receipt.participation
  if (!validCoverage(participation.coverage)
    || participation.coverage.reported !== participation.rows.length
    || participation.coverage.provisional !== 0) return 'invalid-aggregate'

  const timingReported = participation.rows.filter(row => row.timing.status === 'reported').length
  const timingUnavailable = participation.rows.length - timingReported + participation.coverage.unavailable
  const timingCoverage = expectedCoverage(
    timingReported,
    0,
    timingUnavailable,
    participation.coverage.truncated,
  )
  if (!validCoverage(receipt.timing.coverage)
    || !sameCoverage(receipt.timing.coverage, timingCoverage)) return 'invalid-aggregate'

  for (const sample of receipt.tokenAccount.sessions) {
    const parts = [
      sample.uncachedInputTokens,
      sample.outputTokens,
      sample.cacheReadTokens,
      sample.cacheWriteTokens,
    ].map(knownToken)
    const total = knownToken(sample.totalTokens)
    const knownParts = parts.filter((value): value is number => value !== undefined)
    const knownSubtotal = knownParts.reduce((sum, value) => sum + value, 0)
    if (total !== undefined && total < knownSubtotal) return 'invalid-aggregate'
    if (knownParts.length === parts.length && (total === undefined || total !== knownSubtotal)) {
      return 'invalid-aggregate'
    }
  }

  const aggregateStatuses: RunReceiptCoverageStatus[] = []
  for (const field of RUN_RECEIPT_TOKEN_FIELDS) {
    const values = receipt.tokenAccount.sessions.map(sample => sample[field])
    const reported = values.filter(value => value.status === 'reported').length
    const provisional = values.filter(value => value.status === 'provisional').length
    const unavailable = values.length - reported - provisional + participation.coverage.unavailable
    const fieldCoverage = expectedCoverage(reported, provisional, unavailable, participation.coverage.truncated)
    const aggregate = receipt.tokenAccount.totals[field]
    if (!validCoverage(aggregate.coverage) || !sameCoverage(aggregate.coverage, fieldCoverage)) {
      return 'invalid-aggregate'
    }
    const knownValues = values.map(knownToken).filter((value): value is number => value !== undefined)
    const value = knownValues.length === 0 && fieldCoverage.total > 0
      ? null
      : knownValues.reduce((sum, item) => sum + item, 0)
    if (aggregate.value !== value) return 'invalid-aggregate'
    aggregateStatuses.push(aggregate.coverage.status)
  }
  const tokenCoverage = aggregateStatuses.every(status => status === 'complete')
    ? 'complete'
    : aggregateStatuses.every(status => status === 'unavailable')
      ? 'unavailable'
      : 'partial'
  if (receipt.tokenAccount.coverage !== tokenCoverage) return 'invalid-aggregate'
  return undefined
}

function validateStaticTransitions(receipt: RunReceipt): ReceiptSemanticFailure | undefined {
  const byId = new Map(receipt.stages.map(stage => [stage.id, stage]))
  for (const stage of receipt.stages) {
    if (stage.status !== 'pending'
      && stage.after.some(dependency => byId.get(dependency)?.status === 'pending')) return 'invalid-transition'
  }
  if (receipt.outcome !== 'running' && receipt.stages.some(stage => stage.status === 'pending')) {
    return 'invalid-transition'
  }
  return undefined
}

function receiptSemanticFailure(receipt: RunReceipt): ReceiptSemanticFailure | undefined {
  return validateReferences(receipt) ?? validateAggregate(receipt) ?? validateStaticTransitions(receipt)
}

const NonNegativeSafeIntegerSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const PositiveSafeIntegerSchema = NonNegativeSafeIntegerSchema.min(1)
const BoundedTextSchema = z.string().min(1).max(512)
const NameSchema = z.string().regex(/^[a-z][a-z0-9-]*$/)
const RunIdSchema = z.string().regex(/^team-run-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)

export const RunReceiptEvidenceCoverageSchema: z.ZodType<RunReceiptEvidenceCoverage> = z.strictObject({
  status: z.enum(['complete', 'partial', 'unavailable']),
  total: NonNegativeSafeIntegerSchema,
  reported: NonNegativeSafeIntegerSchema,
  provisional: NonNegativeSafeIntegerSchema,
  unavailable: NonNegativeSafeIntegerSchema,
  truncated: NonNegativeSafeIntegerSchema,
})

export const RunReceiptStageSchema: z.ZodType<RunReceiptStage> = z.strictObject({
  id: BoundedTextSchema,
  kind: z.enum(['dsh-delegate', 'dsh-subagent-fanout']),
  member: NameSchema,
  expectedChildren: PositiveSafeIntegerSchema,
  after: z.array(BoundedTextSchema).max(256),
  status: z.enum(['pending', 'completed', 'degraded', 'cancelled', 'failed']),
})

export const RunReceiptTimingEvidenceSchema: z.ZodType<RunReceiptTimingEvidence> = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('reported'),
    elapsedMs: NonNegativeSafeIntegerSchema,
    source: z.enum(['subagent-timing', 'host-lifecycle']),
  }),
  z.strictObject({
    status: z.literal('unavailable'),
    reason: z.enum([
      'session-unavailable',
      'remote-unobservable',
      'not-reported',
      'capability-unavailable',
      'observation-failed',
    ]),
  }),
])

export const RunReceiptParticipantSchema: z.ZodType<RunReceiptParticipant> = z.strictObject({
  childId: BoundedTextSchema,
  parentId: BoundedTextSchema,
  depth: PositiveSafeIntegerSchema,
  stage: BoundedTextSchema,
  member: NameSchema,
  childIndex: NonNegativeSafeIntegerSchema,
  runId: BoundedTextSchema.nullable(),
  provider: BoundedTextSchema.nullable(),
  source: z.enum(['session', 'remote']),
  state: z.enum(['running', 'idle', 'ended']),
  stopReason: BoundedTextSchema.optional(),
  timing: RunReceiptTimingEvidenceSchema,
}).transform(({ stopReason, ...participant }) => ({
  ...participant,
  ...stopReason === undefined ? {} : { stopReason },
}))

export const RunReceiptTokenEvidenceSchema: z.ZodType<RunReceiptTokenEvidence> = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('reported'),
    value: NonNegativeSafeIntegerSchema,
    source: z.literal('session-fold'),
  }),
  z.strictObject({
    status: z.literal('provisional'),
    value: NonNegativeSafeIntegerSchema,
    source: z.literal('session-fold'),
  }),
  z.strictObject({
    status: z.literal('unavailable'),
    reason: z.enum([
      'not-reported',
      'session-unavailable',
      'remote-unobservable',
      'incomplete-turn',
      'capability-unavailable',
      'observation-failed',
    ]),
  }),
])

export const RunReceiptTokenSampleSchema: z.ZodType<RunReceiptTokenSample> = z.strictObject({
  childId: BoundedTextSchema,
  logRevision: NonNegativeSafeIntegerSchema.nullable(),
  totalTokens: RunReceiptTokenEvidenceSchema,
  uncachedInputTokens: RunReceiptTokenEvidenceSchema,
  outputTokens: RunReceiptTokenEvidenceSchema,
  cacheReadTokens: RunReceiptTokenEvidenceSchema,
  cacheWriteTokens: RunReceiptTokenEvidenceSchema,
})

export const RunReceiptTokenAggregateSchema: z.ZodType<RunReceiptTokenAggregate> = z.strictObject({
  value: NonNegativeSafeIntegerSchema.nullable(),
  coverage: RunReceiptEvidenceCoverageSchema,
})

export const RunReceiptTokenTotalsSchema: z.ZodType<RunReceiptTokenTotals> = z.strictObject({
  totalTokens: RunReceiptTokenAggregateSchema,
  uncachedInputTokens: RunReceiptTokenAggregateSchema,
  outputTokens: RunReceiptTokenAggregateSchema,
  cacheReadTokens: RunReceiptTokenAggregateSchema,
  cacheWriteTokens: RunReceiptTokenAggregateSchema,
})

export const RunReceiptTokenAccountSchema: z.ZodType<RunReceiptTokenAccount> = z.strictObject({
  coverage: z.enum(['complete', 'partial', 'unavailable']),
  totals: RunReceiptTokenTotalsSchema,
  sessions: z.array(RunReceiptTokenSampleSchema).max(RECEIPT_FEED_LIMITS.participantsPerReceipt),
})

export const RunReceiptParticipationSchema: z.ZodType<RunReceiptParticipation> = z.strictObject({
  coverage: RunReceiptEvidenceCoverageSchema,
  rows: z.array(RunReceiptParticipantSchema).max(RECEIPT_FEED_LIMITS.participantsPerReceipt),
})

export const RunReceiptTimingSchema: z.ZodType<RunReceiptTiming> = z.strictObject({
  elapsedMs: NonNegativeSafeIntegerSchema,
  source: z.literal('host-wall'),
  coverage: RunReceiptEvidenceCoverageSchema,
})

const RunReceiptObjectSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sessionId: BoundedTextSchema,
  runId: RunIdSchema,
  strategy: NameSchema,
  cohort: NameSchema,
  planDigest: DigestSchema,
  startedAt: NonNegativeSafeIntegerSchema,
  outcome: z.enum(['running', 'completed', 'degraded', 'cancelled', 'failed']),
  timing: RunReceiptTimingSchema,
  stages: z.array(RunReceiptStageSchema).min(1).max(256),
  participation: RunReceiptParticipationSchema,
  tokenAccount: RunReceiptTokenAccountSchema,
})

export const RunReceiptSchema: z.ZodType<RunReceipt> = RunReceiptObjectSchema.superRefine((receipt, ctx) => {
  const failure = receiptSemanticFailure(receipt)
  if (failure !== undefined) ctx.addIssue({ code: 'custom', message: failure })
})

export const ReceiptSessionModelSchema: z.ZodType<ReceiptSessionModel> = z.strictObject({
  schemaVersion: z.literal(1),
  sessionId: BoundedTextSchema,
  revision: NonNegativeSafeIntegerSchema,
  feed: z.strictObject({ status: z.literal('available') }),
  receipts: z.array(RunReceiptSchema).max(RECEIPT_FEED_LIMITS.activeReceiptsPerSession + 1),
}).superRefine((model, ctx) => {
  if (new Set(model.receipts.map(receipt => receipt.runId)).size !== model.receipts.length
    || model.receipts.some(receipt => receipt.sessionId !== model.sessionId)) {
    ctx.addIssue({ code: 'custom', message: 'invalid-references' })
  }
  const active = model.receipts.filter(receipt => receipt.outcome === 'running').length
  const terminal = model.receipts.length - active
  if (active > RECEIPT_FEED_LIMITS.activeReceiptsPerSession || terminal > 1) {
    ctx.addIssue({ code: 'custom', message: 'invalid-aggregate' })
  }
})

export const ReceiptPublicationSchema: z.ZodType<ReceiptPublication> = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('replace'),
    sessionId: BoundedTextSchema,
    runId: RunIdSchema,
    receipt: RunReceiptSchema,
  }),
  z.strictObject({
    type: z.literal('clear-terminal'),
    sessionId: BoundedTextSchema,
  }),
])

export const ReceiptPublicationResultSchema: z.ZodType<ReceiptPublicationResult> = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    changed: z.boolean(),
    revision: NonNegativeSafeIntegerSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    code: z.enum([
      'feed-disposed',
      'session-not-live',
      'invalid-publication',
      'session-key-mismatch',
      'run-key-mismatch',
      'invalid-references',
      'invalid-aggregate',
      'invalid-transition',
      'active-receipt-cap',
      'participant-cap',
      'session-byte-cap',
      'revision-exhausted',
    ]),
  }),
])

const ReceiptFeedBaselineObjectSchema = z.strictObject({
  type: z.literal('baseline'),
  value: ReceiptSessionModelSchema,
})

export const ReceiptFeedBaselineSchema: z.ZodType<ReceiptFeedBaseline> = ReceiptFeedBaselineObjectSchema

const ReceiptFeedReplacementObjectSchema = z.strictObject({
  type: z.literal('replacement'),
  value: ReceiptSessionModelSchema,
})

export const ReceiptFeedReplacementSchema: z.ZodType<ReceiptFeedReplacement> = ReceiptFeedReplacementObjectSchema

const ReceiptFeedUnavailableObjectSchema = z.strictObject({
  type: z.literal('unavailable'),
  code: z.enum(['feed-disposed', 'invalid-session-id', 'session-not-live', 'follower-cap']),
})

export const ReceiptFeedUnavailableSchema: z.ZodType<ReceiptFeedUnavailable> = ReceiptFeedUnavailableObjectSchema

export const ReceiptFeedFrameSchema: z.ZodType<ReceiptFeedFrame> = z.discriminatedUnion('type', [
  ReceiptFeedBaselineObjectSchema,
  ReceiptFeedReplacementObjectSchema,
  ReceiptFeedUnavailableObjectSchema,
])
