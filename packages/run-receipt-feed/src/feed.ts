import { Buffer } from 'node:buffer'
import type { Context } from '@deepseek-ai/cordis'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import {
  RECEIPT_FEED_LIMITS,
  RUN_RECEIPT_TOKEN_FIELDS,
  ReceiptPublicationSchema,
  type ReceiptFeedFrame,
  type ReceiptFeedReplacement,
  type ReceiptPublication,
  type ReceiptPublicationFailureCode,
  type ReceiptPublicationResult,
  type ReceiptSessionModel,
  type RunReceipt,
  type RunReceiptParticipant,
  type RunReceiptStage,
  type RunReceiptTokenEvidence,
} from './types.ts'

const TERMINAL_STAGE_STATUSES = new Set(['completed', 'degraded', 'cancelled', 'failed'])
let processFollowerCount = 0

interface SessionState {
  active: Map<string, RunReceipt>
  terminal: RunReceipt | undefined
  model: ReceiptSessionModel
  readonly followers: Set<ReplacementFollower>
}

type SemanticFailure = Extract<
  ReceiptPublicationFailureCode,
  'invalid-references' | 'invalid-aggregate' | 'invalid-transition'
>

function failure(code: ReceiptPublicationFailureCode): ReceiptPublicationResult {
  return Object.freeze({ ok: false, code })
}

function semanticFailure(messages: readonly string[]): SemanticFailure | undefined {
  return messages.find((message): message is SemanticFailure =>
    message === 'invalid-references' || message === 'invalid-aggregate' || message === 'invalid-transition')
}

function stableStage(previous: RunReceiptStage, next: RunReceiptStage): boolean {
  return previous.id === next.id
    && previous.kind === next.kind
    && previous.member === next.member
    && previous.expectedChildren === next.expectedChildren
    && previous.after.length === next.after.length
    && previous.after.every((dependency, index) => dependency === next.after[index])
}

function stableParticipant(previous: RunReceiptParticipant, next: RunReceiptParticipant): boolean {
  return previous.childId === next.childId
    && previous.parentId === next.parentId
    && previous.depth === next.depth
    && previous.stage === next.stage
    && previous.member === next.member
    && previous.childIndex === next.childIndex
    && previous.runId === next.runId
    && previous.provider === next.provider
    && previous.source === next.source
}

function validTokenTransition(previous: RunReceiptTokenEvidence, next: RunReceiptTokenEvidence): boolean {
  if (previous.status === 'unavailable' || next.status === 'unavailable') return true
  return next.value >= previous.value
}

function validateReplacement(previous: RunReceipt, next: RunReceipt): SemanticFailure | undefined {
  if (previous.sessionId !== next.sessionId
    || previous.runId !== next.runId
    || previous.strategy !== next.strategy
    || previous.cohort !== next.cohort
    || previous.planDigest !== next.planDigest
    || previous.startedAt !== next.startedAt
    || previous.stages.length !== next.stages.length
    || previous.stages.some((stage, index) => {
      const candidate = next.stages[index]
      return candidate === undefined || !stableStage(stage, candidate)
    })
    || next.timing.elapsedMs < previous.timing.elapsedMs) return 'invalid-transition'
  if (previous.outcome !== 'running' && next.outcome !== previous.outcome) return 'invalid-transition'

  for (const [index, stage] of previous.stages.entries()) {
    const nextStatus = next.stages[index]?.status
    if (nextStatus === undefined) return 'invalid-transition'
    if (stage.status === 'pending') {
      if (nextStatus !== 'pending' && !TERMINAL_STAGE_STATUSES.has(nextStatus)) return 'invalid-transition'
    } else if (nextStatus !== stage.status) return 'invalid-transition'
  }

  const participants = new Map(next.participation.rows.map(participant => [participant.childId, participant]))
  for (const participant of previous.participation.rows) {
    const candidate = participants.get(participant.childId)
    if (candidate === undefined || !stableParticipant(participant, candidate)) return 'invalid-transition'
    if (participant.state === 'ended' && candidate.state !== 'ended') return 'invalid-transition'
    if (participant.stopReason !== undefined && candidate.stopReason !== participant.stopReason) {
      return 'invalid-transition'
    }
    if (participant.timing.status === 'reported'
      && candidate.timing.status === 'reported'
      && candidate.timing.elapsedMs < participant.timing.elapsedMs) return 'invalid-transition'
  }

  const samples = new Map(next.tokenAccount.sessions.map(sample => [sample.childId, sample]))
  for (const sample of previous.tokenAccount.sessions) {
    const candidate = samples.get(sample.childId)
    if (candidate === undefined
      || (sample.logRevision !== null
        && candidate.logRevision !== null
        && candidate.logRevision < sample.logRevision)
      || RUN_RECEIPT_TOKEN_FIELDS.some(field => !validTokenTransition(sample[field], candidate[field]))) {
      return 'invalid-transition'
    }
  }
  return undefined
}

function participantCapExceeded(input: unknown): boolean {
  if (typeof input !== 'object' || input === null || Reflect.get(input, 'type') !== 'replace') return false
  const receipt = Reflect.get(input, 'receipt')
  if (typeof receipt !== 'object' || receipt === null) return false
  const participation = Reflect.get(receipt, 'participation')
  const tokenAccount = Reflect.get(receipt, 'tokenAccount')
  const rows = typeof participation === 'object' && participation !== null
    ? Reflect.get(participation, 'rows')
    : undefined
  const sessions = typeof tokenAccount === 'object' && tokenAccount !== null
    ? Reflect.get(tokenAccount, 'sessions')
    : undefined
  return (Array.isArray(rows) && rows.length > RECEIPT_FEED_LIMITS.participantsPerReceipt)
    || (Array.isArray(sessions) && sessions.length > RECEIPT_FEED_LIMITS.participantsPerReceipt)
}

function structureCapExceeded(input: unknown): boolean {
  if (typeof input !== 'object' || input === null || Reflect.get(input, 'type') !== 'replace') return false
  const receipt = Reflect.get(input, 'receipt')
  if (typeof receipt !== 'object' || receipt === null) return false
  const stages = Reflect.get(receipt, 'stages')
  return Array.isArray(stages)
    && (stages.length > 256 || stages.some((stage) => {
      if (typeof stage !== 'object' || stage === null) return false
      const after = Reflect.get(stage, 'after')
      return Array.isArray(after) && after.length > 256
    }))
}

function model(
  sessionId: string,
  revision: number,
  active: ReadonlyMap<string, RunReceipt>,
  terminal: RunReceipt | undefined,
): ReceiptSessionModel {
  const receipts = [...active.values()]
    .sort((left, right) => right.startedAt - left.startedAt
      || (left.runId === right.runId ? 0 : left.runId < right.runId ? 1 : -1))
  if (terminal !== undefined) receipts.push(terminal)
  return {
    schemaVersion: 1,
    sessionId,
    revision,
    feed: { status: 'available' },
    receipts,
  }
}

function emptyState(session: Session): SessionState {
  return {
    active: new Map(),
    terminal: undefined,
    model: deepFreeze(model(String(session.id), 0, new Map(), undefined)),
    followers: new Set(),
  }
}

/** Process-local Receipt state behind the public publication/follow seam. */
export class ReceiptFeedState {
  private readonly states = new Map<Session, SessionState>()
  private disposed = false

  constructor(private readonly ctx: Context) {
    ctx.on('session/disposed', (session) => { this.drop(session) })
    ctx.effect(() => () => {
      this.disposed = true
      for (const state of this.states.values()) this.closeFollowers(state)
      this.states.clear()
    }, 'legion-receipts.feed')
  }

  publish(session: Session, input: ReceiptPublication): ReceiptPublicationResult {
    if (this.disposed) return failure('feed-disposed')
    if (this.ctx.sessions.get(session.id) !== session) return failure('session-not-live')
    if (participantCapExceeded(input)) return failure('participant-cap')
    if (structureCapExceeded(input)) return failure('invalid-publication')
    const parsed = ReceiptPublicationSchema.safeParse(input)
    if (!parsed.success) {
      return failure(semanticFailure(parsed.error.issues.map(issue => issue.message)) ?? 'invalid-publication')
    }
    const operation = parsed.data
    if (operation.sessionId !== String(session.id)) return failure('session-key-mismatch')

    const current = this.states.get(session)
    if (operation.type === 'clear-terminal') {
      if (current?.terminal === undefined) {
        return Object.freeze({ ok: true, changed: false, revision: current?.model.revision ?? 0 })
      }
      return this.commit(session, current, new Map(current.active), undefined)
    }
    if (operation.runId !== operation.receipt.runId) return failure('run-key-mismatch')
    if (operation.receipt.sessionId !== operation.sessionId) return failure('session-key-mismatch')

    const previous = current?.active.get(operation.runId) ?? (
      current?.terminal?.runId === operation.runId ? current.terminal : undefined
    )
    if (previous !== undefined) {
      if (JSON.stringify(previous) === JSON.stringify(operation.receipt)) {
        return Object.freeze({ ok: true, changed: false, revision: current?.model.revision ?? 0 })
      }
      const transition = validateReplacement(previous, operation.receipt)
      if (transition !== undefined) return failure(transition)
    }

    const active = new Map(current?.active)
    let terminal = current?.terminal
    if (operation.receipt.outcome === 'running') {
      active.set(operation.runId, operation.receipt)
    } else {
      active.delete(operation.runId)
      terminal = operation.receipt
    }
    if (active.size > RECEIPT_FEED_LIMITS.activeReceiptsPerSession) return failure('active-receipt-cap')
    return this.commit(session, current, active, terminal)
  }

  async *follow(sessionId: string, signal: AbortSignal): AsyncIterable<ReceiptFeedFrame> {
    signal.throwIfAborted()
    if (this.disposed) {
      yield deepFreeze({ type: 'unavailable', code: 'feed-disposed' } as const)
      return
    }
    if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 512) {
      yield deepFreeze({ type: 'unavailable', code: 'invalid-session-id' } as const)
      return
    }
    const session = this.ctx.sessions.get(SessionId(sessionId))
    if (session === undefined) {
      yield deepFreeze({ type: 'unavailable', code: 'session-not-live' } as const)
      return
    }
    if (processFollowerCount >= RECEIPT_FEED_LIMITS.processFollowers) {
      yield deepFreeze({ type: 'unavailable', code: 'follower-cap' } as const)
      return
    }

    let state = this.states.get(session)
    if (state === undefined) {
      state = emptyState(session)
      this.states.set(session, state)
    }
    const follower = new ReplacementFollower(() => {
      state.followers.delete(follower)
      processFollowerCount -= 1
      if (state.followers.size === 0
        && state.model.revision === 0
        && state.active.size === 0
        && state.terminal === undefined
        && this.states.get(session) === state) this.states.delete(session)
    })
    processFollowerCount += 1
    state.followers.add(follower)
    const abort = (): void => { follower.close() }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    try {
      yield deepFreeze({ type: 'baseline', value: state.model } as const)
      yield* follower.read(signal)
    } finally {
      signal.removeEventListener('abort', abort)
      follower.close()
    }
  }

  private commit(
    session: Session,
    current: SessionState | undefined,
    active: Map<string, RunReceipt>,
    terminal: RunReceipt | undefined,
  ): ReceiptPublicationResult {
    const revision = (current?.model.revision ?? 0) + 1
    if (!Number.isSafeInteger(revision)) return failure('revision-exhausted')
    const nextModel = model(String(session.id), revision, active, terminal)
    const frame = { type: 'replacement', value: nextModel } as const
    if (Buffer.byteLength(JSON.stringify(frame), 'utf8') > RECEIPT_FEED_LIMITS.serializedSessionReplacementBytes) {
      return failure('session-byte-cap')
    }
    deepFreeze(frame)

    const state = current ?? emptyState(session)
    state.active = active
    state.terminal = terminal
    state.model = nextModel
    if (current === undefined) this.states.set(session, state)
    for (const follower of state.followers) follower.push(frame)
    return Object.freeze({ ok: true, changed: true, revision })
  }

  private drop(session: Session): void {
    const state = this.states.get(session)
    if (state === undefined) return
    this.states.delete(session)
    this.closeFollowers(state)
  }

  private closeFollowers(state: SessionState): void {
    for (const follower of state.followers) follower.close()
  }
}

class ReplacementFollower {
  private pending: ReceiptFeedReplacement | undefined
  private waiting: (() => void) | undefined
  private closed = false

  constructor(private readonly onClose: () => void) {}

  push(frame: ReceiptFeedReplacement): void {
    if (this.closed) return
    this.pending = frame
    this.waiting?.()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.pending = undefined
    this.waiting?.()
    this.onClose()
  }

  async *read(signal: AbortSignal): AsyncIterable<ReceiptFeedReplacement> {
    while (!this.closed && !signal.aborted) {
      const frame = this.pending
      if (frame !== undefined) {
        this.pending = undefined
        yield frame
        continue
      }
      await this.wait()
    }
  }

  private wait(): Promise<void> {
    return new Promise((resolve) => {
      const finish = (): void => {
        if (this.waiting === finish) this.waiting = undefined
        resolve()
      }
      this.waiting = finish
      if (this.closed || this.pending !== undefined) finish()
    })
  }
}
