import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import {
  canPublishRunReceipt,
  RUN_RECEIPT_EVENT_TYPE,
  observeRunReceiptParticipation,
  publishRunReceipt,
  type RunReceipt,
} from '../src/run-receipt.ts'
import { CohortName, CohortRunId, StrategyName, StrategyPlanDigest } from '../src/identity.ts'
import { mountTestTokenAccounting } from './token-meter-test-service.ts'

const receipt: RunReceipt = {
  schemaVersion: 3,
  runId: CohortRunId('team-run-00000000-0000-4000-8000-000000000000'),
  strategy: StrategyName('compatibility-strategy'),
  cohort: CohortName('compatibility-cohort'),
  planDigest: StrategyPlanDigest(`sha256:${'0'.repeat(64)}`),
  startedAt: 1,
  elapsedMs: 0,
  outcome: 'running',
  stages: [],
  participation: [],
  tokenAccount: {
    totals: {
      totalTokens: 0,
      uncachedInputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    sessions: [],
  },
}

describe('Run Receipt persistence compatibility', () => {
  it('enables the event only when no persistence backend can reopen the Session', () => {
    const ephemeral = { get: () => undefined }
    const persistent = { get: (key: string) => key === 'sessionPersistence' ? {} : undefined }

    expect(canPublishRunReceipt(ephemeral)).toBe(true)
    expect(canPublishRunReceipt(persistent)).toBe(false)
  })

  it('does not append an event that the Host persistence vocabulary cannot reopen', () => {
    const session = Session.create(SessionId('unsupported-receipt-session'))
    const persistent = { get: (key: string) => key === 'sessionPersistence' ? {} : undefined }

    if (canPublishRunReceipt(persistent)) publishRunReceipt(session, receipt)
    expect(session.events).toEqual([])
  })

  it('publishes when no persistence backend can reopen the Session', () => {
    const session = Session.create(SessionId('supported-receipt-session'))

    publishRunReceipt(session, receipt)
    expect(session.events.map(event => event.type)).toEqual([RUN_RECEIPT_EVENT_TYPE])
  })

  it('degrades only the Host-owned cold listing when Session Query is absent', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await mountTestTokenAccounting(ctx)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SubagentRuntime)
    const warning = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    const observer = observeRunReceiptParticipation(
      ctx as never,
      SessionId('queryless-parent'),
      [],
      () => undefined,
    )

    try {
      await expect(observer.finish()).resolves.toBeUndefined()
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining('load @deepseek-ai/dsh-session-query'),
      )
    } finally {
      observer.dispose()
      await ctx.fiber.dispose()
    }
  })
})
