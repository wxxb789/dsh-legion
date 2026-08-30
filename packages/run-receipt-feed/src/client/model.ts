/** React-free current-Session Receipt model over the official reconnecting snapshot stream. */
import {
  RemoteSnapshotStream,
  RemoteStreamCarrierError,
  type ClientRemote,
} from '@deepseek-ai/dsh-api-gateway/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import {
  ReceiptFeedFrameSchema,
  type ReceiptFeedBaseline,
  type ReceiptFeedReplacement,
  type ReceiptSessionModel,
  type RunReceipt,
} from '../types.ts'

export type ReceiptRemote = Pick<ClientRemote, '$stream'> & {
  readonly legionReceipts: TypertClientRemote['legionReceipts']
}

type ReceiptStateStream = RemoteSnapshotStream<ReceiptFeedBaseline, ReceiptFeedReplacement>

export type ClientReceiptState =
  | 'opening'
  | 'ready-empty'
  | 'active'
  | 'partial'
  | 'reconnecting'
  | 'feed-unavailable'
  | 'invalid-frame'
  | 'stream-error'
  | 'settled'
  | 'direct-clear-empty'
  | 'new-instance-empty'

export interface ClientReceiptSnapshot {
  readonly sessionId: string | undefined
  readonly state: ClientReceiptState
  readonly model: ReceiptSessionModel | undefined
  readonly directClear: boolean
  readonly diagnostic: string | undefined
}

class InvalidReceiptFrameError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidReceiptFrameError'
  }
}

class ReceiptFeedUnavailableError extends Error {
  constructor(readonly code: string) {
    super(`Run Receipt feed unavailable: ${code}`)
    this.name = 'ReceiptFeedUnavailableError'
  }
}

function hasPartialFacts(receipt: RunReceipt): boolean {
  return receipt.participation.coverage.status !== 'complete'
    || receipt.timing.coverage.status !== 'complete'
    || receipt.tokenAccount.coverage !== 'complete'
}

function clearedTerminal(previous: ReceiptSessionModel | undefined, next: ReceiptSessionModel): boolean {
  return previous !== undefined
    && next.revision > previous.revision
    && previous.receipts.some(receipt => receipt.outcome !== 'running')
    && next.receipts.every(receipt => receipt.outcome === 'running')
}

function directClearState(
  previous: ClientReceiptSnapshot,
  next: ReceiptSessionModel,
  opening: boolean,
): boolean {
  if (clearedTerminal(previous.model, next)) return true
  if (!previous.directClear || previous.model === undefined
    || (opening && next.revision < previous.model.revision)) return false
  const activeIds = previous.model.receipts
    .filter(receipt => receipt.outcome === 'running')
    .map(receipt => receipt.runId)
  return activeIds.length > 0
    && next.receipts.length === activeIds.length
    && next.receipts.every(receipt => receipt.outcome === 'running' && activeIds.includes(receipt.runId))
}

function contentState(
  next: ReceiptSessionModel,
  previous: ReceiptSessionModel | undefined,
  opening: boolean,
): ClientReceiptState {
  if (next.receipts.length === 0) {
    if (previous === undefined || previous.receipts.length === 0) return 'ready-empty'
    if (opening && next.revision <= previous.revision) return 'new-instance-empty'
    return previous.receipts.some(receipt => receipt.outcome !== 'running')
      ? 'direct-clear-empty'
      : 'ready-empty'
  }
  if (next.receipts.some(hasPartialFacts)) return 'partial'
  return next.receipts.some(receipt => receipt.outcome === 'running') ? 'active' : 'settled'
}

/** Current-Session state; full Receipt facts live only in this non-persistent store. */
export class ClientReceiptModel {
  readonly store: SnapshotStore<ClientReceiptSnapshot>
  private selectionEpoch = 0
  private targetSessionId: string | undefined
  private control: ReceiptStateStream | undefined
  private transition = Promise.resolve()
  private readonly unsubscribe: () => void
  private disposed = false

  constructor(
    private readonly sessions: Pick<ISessions, 'list'>,
    private readonly remote: ReceiptRemote | undefined,
    unavailableReason?: string,
  ) {
    const sessionId = sessions.list.getSnapshot().current
    this.targetSessionId = sessionId === undefined ? undefined : String(sessionId)
    this.store = createSnapshotStore<ClientReceiptSnapshot>({
      sessionId: this.targetSessionId,
      state: remote === undefined ? 'feed-unavailable' : this.targetSessionId === undefined ? 'ready-empty' : 'opening',
      model: undefined,
      directClear: false,
      diagnostic: remote === undefined ? unavailableReason ?? 'remote namespace unavailable' : undefined,
    })
    this.unsubscribe = sessions.list.subscribe(() => { this.followCurrent() })
    if (remote !== undefined) this.schedule(this.targetSessionId)
  }

  /** Stop Session observation and await the active stream consumer. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe()
    this.selectionEpoch += 1
    this.transition = this.transition.then(async () => {
      const control = this.control
      this.control = undefined
      await control?.dispose()
    })
    await this.transition
  }

  private followCurrent(): void {
    if (this.disposed) return
    const current = this.sessions.list.getSnapshot().current
    const sessionId = current === undefined ? undefined : String(current)
    if (sessionId === this.targetSessionId) return
    this.targetSessionId = sessionId
    this.store.set({
      sessionId,
      state: this.remote === undefined ? 'feed-unavailable' : sessionId === undefined ? 'ready-empty' : 'opening',
      model: undefined,
      directClear: false,
      diagnostic: this.remote === undefined ? 'remote namespace unavailable' : undefined,
    })
    this.schedule(sessionId)
  }

  private schedule(sessionId: string | undefined): void {
    const epoch = ++this.selectionEpoch
    this.transition = this.transition.then(async () => {
      const previous = this.control
      this.control = undefined
      await previous?.dispose()
      if (!this.current(epoch, sessionId) || sessionId === undefined || this.remote === undefined) return
      const control = this.open(sessionId, epoch)
      this.control = control
      control.start()
    }).catch((error: unknown) => {
      this.fail(epoch, sessionId, error)
    })
  }

  private open(sessionId: string, epoch: number): ReceiptStateStream {
    const remote = this.remote!
    const stream = remote.$stream<ReceiptFeedBaseline | ReceiptFeedReplacement>({
      name: `Run Receipt feed (${sessionId})`,
      open: async function* (signal) {
        for await (const input of remote.legionReceipts.follow(sessionId, signal)) {
          const parsed = ReceiptFeedFrameSchema.safeParse(input)
          if (!parsed.success) throw new InvalidReceiptFrameError('Run Receipt feed emitted an invalid frame')
          if (parsed.data.type === 'unavailable') throw new ReceiptFeedUnavailableError(parsed.data.code)
          yield parsed.data
        }
      },
      ended: accepted => accepted
        ? new RemoteStreamCarrierError('Run Receipt feed ended before a replacement carrier arrived')
        : new Error('Run Receipt feed ended before its opening baseline'),
      carrierFailed: error => {
        if (!this.current(epoch, sessionId)) return
        const previous = this.store.getSnapshot()
        if (previous.state !== 'reconnecting' || previous.diagnostic !== error.message) {
          this.store.set({ ...previous, state: 'reconnecting', diagnostic: error.message })
        }
      },
    })
    return new RemoteSnapshotStream<ReceiptFeedBaseline, ReceiptFeedReplacement>(stream, {
      name: `Run Receipt feed (${sessionId})`,
      isSnapshot: (frame): frame is ReceiptFeedBaseline => frame.type === 'baseline',
      replace: frame => { this.acceptBaseline(epoch, sessionId, frame) },
      update: frame => { this.acceptReplacement(epoch, sessionId, frame) },
      failed: error => { this.fail(epoch, sessionId, error) },
    })
  }

  private acceptBaseline(epoch: number, sessionId: string, frame: ReceiptFeedBaseline): void {
    if (!this.current(epoch, sessionId)) return
    if (frame.value.sessionId !== sessionId) throw new InvalidReceiptFrameError('Run Receipt baseline crossed its Session address')
    const previous = this.store.getSnapshot()
    this.store.set({
      sessionId,
      state: contentState(frame.value, previous.model, true),
      model: frame.value,
      directClear: directClearState(previous, frame.value, true),
      diagnostic: undefined,
    })
  }

  private acceptReplacement(epoch: number, sessionId: string, frame: ReceiptFeedReplacement): void {
    if (!this.current(epoch, sessionId)) return
    const previous = this.store.getSnapshot()
    if (frame.value.sessionId !== sessionId || previous.model === undefined
      || frame.value.revision <= previous.model.revision) {
      throw new InvalidReceiptFrameError('Run Receipt replacement did not advance the current Session revision')
    }
    this.store.set({
      sessionId,
      state: contentState(frame.value, previous.model, false),
      model: frame.value,
      directClear: directClearState(previous, frame.value, false),
      diagnostic: undefined,
    })
  }

  private fail(epoch: number, sessionId: string | undefined, error: unknown): void {
    if (!this.current(epoch, sessionId)) return
    const previous = this.store.getSnapshot()
    const diagnostic = error instanceof Error ? error.message : String(error)
    if (error instanceof ReceiptFeedUnavailableError) {
      this.store.set({ sessionId, state: 'feed-unavailable', model: undefined, directClear: false, diagnostic })
      return
    }
    this.store.set({
      ...previous,
      state: error instanceof InvalidReceiptFrameError ? 'invalid-frame' : 'stream-error',
      diagnostic,
    })
  }

  private current(epoch: number, sessionId: string | undefined): boolean {
    return !this.disposed && epoch === this.selectionEpoch && sessionId === this.targetSessionId
  }
}
