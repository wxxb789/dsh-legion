import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { EMPTY_RECEIPT_FEED_BASELINE, type ReceiptFeedBaseline } from './types.ts'

export type * from './types.ts'
export { EMPTY_RECEIPT_FEED_BASELINE, ReceiptFeedBaselineSchema } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Live-process Run Receipt Remote owner. */
    legionReceipts: RunReceiptFeed
  }
}

/** Resolve when one Remote generation is cancelled, without retaining listeners. */
async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return
  await new Promise<void>((resolve) => {
    const aborted = () => {
      signal.removeEventListener('abort', aborted)
      resolve()
    }
    signal.addEventListener('abort', aborted, { once: true })
    if (signal.aborted) aborted()
  })
}

/** Baseline-only U2 Remote service; U3 will add the bounded read model. */
export class RunReceiptFeed extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'legionReceipts')
  }

  /** Emit one empty baseline, then remain alive only until carrier cancellation. */
  @Remote({ mode: 'stream' })
  async *follow(signal: AbortSignal): AsyncIterable<ReceiptFeedBaseline> {
    signal.throwIfAborted()
    yield EMPTY_RECEIPT_FEED_BASELINE
    await waitForAbort(signal)
  }
}

export default RunReceiptFeed
