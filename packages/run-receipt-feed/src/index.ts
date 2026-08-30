import { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { ReceiptFeedState } from './feed.ts'
import type {
  ReceiptFeedFrame,
  ReceiptPublication,
  ReceiptPublicationResult,
} from './types.ts'

export * from './types.ts'

/** Host-only deep seam consumed optionally by Legion execution. */
export interface RunReceiptPublisher {
  publish(session: Session, publication: ReceiptPublication): ReceiptPublicationResult
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Live-process Run Receipt Remote owner and optional Host publisher. */
    legionReceipts: RunReceiptFeed
  }
}

/** Process-local full Receipt owner and read-only generated Remote namespace. */
export class RunReceiptFeed extends TypertRemoteService implements RunReceiptPublisher {
  static inject = ['sessions', 'typert']

  private readonly feed: ReceiptFeedState

  constructor(ctx: Context) {
    super(ctx, 'legionReceipts')
    this.feed = new ReceiptFeedState(ctx)
  }

  /** Validate and synchronously replace one Receipt or clear only retained terminal presentation. */
  publish(session: Session, publication: ReceiptPublication): ReceiptPublicationResult {
    return this.feed.publish(session, publication)
  }

  /** Follow one live Session with a complete baseline and latest-only complete replacements. */
  @Remote({ mode: 'stream' })
  follow(sessionId: string, signal: AbortSignal): AsyncIterable<ReceiptFeedFrame> {
    return this.feed.follow(sessionId, signal)
  }
}

export default RunReceiptFeed
