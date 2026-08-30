import { z } from 'zod'

/** Empty opening frame emitted before U3 adds Session-scoped replacements. */
export interface ReceiptFeedBaseline {
  readonly type: 'baseline'
  readonly sessions: readonly []
}

/** Strict shared boundary for the baseline-only U2 Remote contract. */
export const ReceiptFeedBaselineSchema: z.ZodType<ReceiptFeedBaseline> = z.strictObject({
  type: z.literal('baseline'),
  sessions: z.tuple([]),
})

/** One validated empty opening frame; it carries no retained feed state. */
export const EMPTY_RECEIPT_FEED_BASELINE: ReceiptFeedBaseline = Object.freeze(
  ReceiptFeedBaselineSchema.parse({ type: 'baseline', sessions: [] }),
)
