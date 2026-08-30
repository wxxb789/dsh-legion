import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import type { ReceiptFeedFrame, RunReceiptFeed as RunReceiptFeedType } from '../src/index.ts'
import { nextFrame, receipt, replace, runId, settle } from './fixtures.ts'

const PACKAGE_ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const host = await import(pathToFileURL(resolve(PACKAGE_ROOT, 'lib/index.js')).href) as typeof import('../src/index.ts')
const { RECEIPT_FEED_LIMITS, ReceiptFeedFrameSchema, RunReceiptFeed } = host

interface FeedHarness {
  readonly ctx: Context
  readonly feed: RunReceiptFeedType
  session(id?: string): { readonly value: Session; dispose(): void }
}

const roots: Context[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function harness(): Promise<FeedHarness> {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(SessionStore)
  const feed = new RunReceiptFeed(ctx)
  return {
    ctx,
    feed,
    session(id = 'parent') {
      const value = ctx.sessions.prepare(SessionId(id))
      const dispose = ctx.sessions.enter(value)
      ctx.sessions.announce(value)
      return { value, dispose }
    },
  }
}

function follow(feed: RunReceiptFeedType, session: Session): {
  readonly abort: AbortController
  readonly iterator: AsyncIterator<ReceiptFeedFrame>
} {
  const abort = new AbortController()
  return { abort, iterator: feed.follow(String(session.id), abort.signal)[Symbol.asyncIterator]() }
}

describe('RunReceiptFeed public Host interface', () => {
  it('registers before a complete empty baseline and commits publication synchronously', async () => {
    const { feed, session } = await harness()
    const parent = session().value
    const first = follow(feed, parent)

    await expect(nextFrame(first.iterator)).resolves.toEqual({
      type: 'baseline',
      value: {
        schemaVersion: 1,
        sessionId: parent.id,
        revision: 0,
        feed: { status: 'available' },
        receipts: [],
      },
    })

    const firstReceipt = receipt(String(parent.id))
    expect(feed.publish(parent, replace(firstReceipt))).toEqual({ ok: true, changed: true, revision: 1 })
    await expect(nextFrame(first.iterator)).resolves.toMatchObject({
      type: 'replacement',
      value: { sessionId: parent.id, revision: 1, receipts: [firstReceipt] },
    })

    const second = follow(feed, parent)
    await expect(nextFrame(second.iterator)).resolves.toMatchObject({
      type: 'baseline',
      value: { sessionId: parent.id, revision: 1, receipts: [firstReceipt] },
    })
    first.abort.abort()
    second.abort.abort()
  })

  it('coalesces slow followers to complete latest replacements and shares one immutable frame', async () => {
    const { feed, session } = await harness()
    const parent = session().value
    const followers = [follow(feed, parent), follow(feed, parent)]
    await Promise.all(followers.map(({ iterator }) => nextFrame(iterator)))

    expect(feed.publish(parent, replace(receipt(String(parent.id), 1)))).toMatchObject({ revision: 1 })
    expect(feed.publish(parent, replace(receipt(String(parent.id), 2)))).toMatchObject({ revision: 2 })

    const frames = await Promise.all(followers.map(({ iterator }) => nextFrame(iterator)))
    expect(frames[0]).toBe(frames[1])
    expect(frames[0]?.type).toBe('replacement')
    if (frames[0]?.type !== 'replacement') throw new Error('expected a replacement frame')
    expect(Object.isFrozen(frames[0])).toBe(true)
    expect(Object.isFrozen(frames[0].value)).toBe(true)
    expect(frames[0]).toMatchObject({
      type: 'replacement',
      value: { revision: 2, receipts: [{ runId: runId(2) }, { runId: runId(1) }] },
    })
    followers.forEach(({ abort }) => { abort.abort() })
  })

  it('retains all active Receipts plus the latest terminal and direct-clear removes only terminal', async () => {
    const { feed, session } = await harness()
    const parent = session().value
    const activeOne = receipt(String(parent.id), 1)
    const activeTwo = receipt(String(parent.id), 2)
    expect(feed.publish(parent, replace(activeOne))).toMatchObject({ revision: 1 })
    expect(feed.publish(parent, replace(activeTwo))).toMatchObject({ revision: 2 })
    expect(feed.publish(parent, replace(settle(activeOne, 'completed')))).toMatchObject({ revision: 3 })

    const beforeClear = follow(feed, parent)
    await expect(nextFrame(beforeClear.iterator)).resolves.toMatchObject({
      value: { receipts: [{ runId: activeTwo.runId }, { runId: activeOne.runId, outcome: 'completed' }] },
    })
    expect(feed.publish(parent, { type: 'clear-terminal', sessionId: String(parent.id) }))
      .toEqual({ ok: true, changed: true, revision: 4 })
    await expect(nextFrame(beforeClear.iterator)).resolves.toMatchObject({
      value: { revision: 4, receipts: [{ runId: activeTwo.runId }] },
    })

    const settledTwo = settle(activeTwo, 'failed')
    expect(feed.publish(parent, replace(settledTwo))).toMatchObject({ revision: 5 })
    const activeThree = receipt(String(parent.id), 3)
    expect(feed.publish(parent, replace(activeThree))).toMatchObject({ revision: 6 })
    const final = follow(feed, parent)
    await expect(nextFrame(final.iterator)).resolves.toMatchObject({
      value: { receipts: [{ runId: activeThree.runId }, { runId: settledTwo.runId }] },
    })
    beforeClear.abort.abort()
    final.abort.abort()
  })

  it('rejects semantic failures without mutation and keeps duplicate publication inert', async () => {
    const { feed, session } = await harness()
    const parent = session().value
    const original = receipt(String(parent.id))
    expect(feed.publish(parent, replace(original))).toEqual({ ok: true, changed: true, revision: 1 })
    expect(feed.publish(parent, replace(structuredClone(original))))
      .toEqual({ ok: true, changed: false, revision: 1 })

    const wrongSession = { ...replace(original), sessionId: 'other' }
    expect(feed.publish(parent, wrongSession)).toEqual({ ok: false, code: 'session-key-mismatch' })
    const wrongRun = { ...replace(original), runId: runId(99) }
    expect(feed.publish(parent, wrongRun)).toEqual({ ok: false, code: 'run-key-mismatch' })
    const unknownDependency = {
      ...original,
      stages: original.stages.map(stage => ({ ...stage, after: ['missing'] })),
    }
    expect(feed.publish(parent, replace(unknownDependency))).toEqual({ ok: false, code: 'invalid-references' })
    const wrongAggregate = {
      ...original,
      participation: {
        ...original.participation,
        coverage: { ...original.participation.coverage, total: 1 },
      },
    }
    expect(feed.publish(parent, replace(wrongAggregate))).toEqual({ ok: false, code: 'invalid-aggregate' })

    const completed = settle(original, 'completed')
    expect(feed.publish(parent, replace(completed))).toEqual({ ok: true, changed: true, revision: 2 })
    expect(feed.publish(parent, replace(original))).toEqual({ ok: false, code: 'invalid-transition' })

    const observer = follow(feed, parent)
    const baseline = await nextFrame(observer.iterator)
    expect(baseline).toMatchObject({
      value: { revision: 2, receipts: [{ outcome: 'completed' }] },
    })
    const invalidFrame = structuredClone(baseline)
    if (invalidFrame.type !== 'baseline') throw new Error('expected baseline frame')
    Reflect.set(invalidFrame.value.receipts[0]!.stages[0]!, 'after', ['missing'])
    expect(ReceiptFeedFrameSchema.safeParse(invalidFrame).success).toBe(false)
    observer.abort.abort()
  })

  it('keeps participant and token evidence monotone', async () => {
    const { feed, session } = await harness()
    const parent = session('monotone').value
    const active = receipt(String(parent.id), 1, 1)
    expect(feed.publish(parent, replace(active))).toMatchObject({ revision: 1 })
    const ended = {
      ...active,
      timing: { ...active.timing, elapsedMs: active.timing.elapsedMs + 1 },
      participation: {
        ...active.participation,
        rows: active.participation.rows.map(row => ({
          ...row,
          state: 'ended' as const,
          timing: row.timing.status === 'reported' ? { ...row.timing, elapsedMs: 2 } : row.timing,
        })),
      },
      tokenAccount: {
        ...active.tokenAccount,
        sessions: active.tokenAccount.sessions.map(sample => ({ ...sample, logRevision: 1 })),
      },
    }
    expect(feed.publish(parent, replace(ended))).toMatchObject({ revision: 2 })
    expect(feed.publish(parent, replace({
      ...ended,
      participation: {
        ...ended.participation,
        rows: ended.participation.rows.map(row => ({ ...row, state: 'running' as const })),
      },
    }))).toEqual({ ok: false, code: 'invalid-transition' })
    expect(feed.publish(parent, replace({
      ...ended,
      tokenAccount: {
        ...ended.tokenAccount,
        sessions: ended.tokenAccount.sessions.map(sample => ({ ...sample, logRevision: 0 })),
      },
    }))).toEqual({ ok: false, code: 'invalid-transition' })
    expect(feed.publish(parent, replace({
      ...ended,
      participation: {
        ...ended.participation,
        rows: ended.participation.rows.map(row => ({ ...row, childId: 'replacement-child' })),
      },
      tokenAccount: {
        ...ended.tokenAccount,
        sessions: ended.tokenAccount.sessions.map(sample => ({ ...sample, childId: 'replacement-child' })),
      },
    }))).toEqual({ ok: false, code: 'invalid-transition' })
  })

  it('rejects remote token claims and impossible known token subtotals', async () => {
    const { feed, session } = await harness()
    const remoteParent = session('remote-truth').value
    const local = receipt(String(remoteParent.id), 1, 1)
    const forgedRemote = {
      ...local,
      participation: {
        ...local.participation,
        rows: local.participation.rows.map(row => ({
          ...row,
          source: 'remote' as const,
          timing: { status: 'reported' as const, elapsedMs: 1, source: 'host-lifecycle' as const },
        })),
      },
      tokenAccount: {
        ...local.tokenAccount,
        sessions: local.tokenAccount.sessions.map(sample => ({ ...sample, logRevision: null })),
      },
    }
    expect(feed.publish(remoteParent, replace(forgedRemote)))
      .toEqual({ ok: false, code: 'invalid-references' })

    const aggregateParent = session('aggregate-truth').value
    const aggregate = receipt(String(aggregateParent.id), 2, 1)
    const unavailableCoverage = {
      status: 'unavailable' as const,
      total: 1,
      reported: 0,
      provisional: 0,
      unavailable: 1,
      truncated: 0,
    }
    const unavailableToken = { status: 'unavailable' as const, reason: 'not-reported' as const }
    const impossible = {
      ...aggregate,
      tokenAccount: {
        coverage: 'partial' as const,
        sessions: aggregate.tokenAccount.sessions.map(sample => ({
          ...sample,
          totalTokens: { status: 'reported' as const, value: 0, source: 'session-fold' as const },
          uncachedInputTokens: { status: 'reported' as const, value: 100, source: 'session-fold' as const },
          outputTokens: unavailableToken,
          cacheReadTokens: unavailableToken,
          cacheWriteTokens: unavailableToken,
        })),
        totals: {
          totalTokens: { value: 0, coverage: aggregate.participation.coverage },
          uncachedInputTokens: { value: 100, coverage: aggregate.participation.coverage },
          outputTokens: { value: null, coverage: unavailableCoverage },
          cacheReadTokens: { value: null, coverage: unavailableCoverage },
          cacheWriteTokens: { value: null, coverage: unavailableCoverage },
        },
      },
    }
    expect(feed.publish(aggregateParent, replace(impossible)))
      .toEqual({ ok: false, code: 'invalid-aggregate' })
  })

  it('isolates Session lifecycles, removes disposed state, and starts a new service empty', async () => {
    const firstHarness = await harness()
    const firstLifecycle = firstHarness.session('reused')
    const other = firstHarness.session('other')
    expect(firstHarness.feed.publish(firstLifecycle.value, replace(receipt('reused')))).toMatchObject({ revision: 1 })
    expect(firstHarness.feed.publish(other.value, replace(receipt('other', 2)))).toMatchObject({ revision: 1 })

    const oldFollower = follow(firstHarness.feed, firstLifecycle.value)
    await nextFrame(oldFollower.iterator)
    const closing = oldFollower.iterator.next()
    firstLifecycle.dispose()
    await expect(closing).resolves.toEqual({ done: true, value: undefined })

    const replacementLifecycle = firstHarness.session('reused')
    const replacementFollower = follow(firstHarness.feed, replacementLifecycle.value)
    await expect(nextFrame(replacementFollower.iterator)).resolves.toMatchObject({
      type: 'baseline', value: { sessionId: 'reused', revision: 0, receipts: [] },
    })
    const otherFollower = follow(firstHarness.feed, other.value)
    await expect(nextFrame(otherFollower.iterator)).resolves.toMatchObject({
      value: { sessionId: 'other', revision: 1, receipts: [{ runId: runId(2) }] },
    })

    const nextHarness = await harness()
    const sameId = nextHarness.session('other').value
    const newInstance = follow(nextHarness.feed, sameId)
    await expect(nextFrame(newInstance.iterator)).resolves.toMatchObject({
      value: { sessionId: 'other', revision: 0, receipts: [] },
    })
    replacementFollower.abort.abort()
    otherFollower.abort.abort()
    newInstance.abort.abort()
  })

  it('closes active followers when the owning Fiber is disposed', async () => {
    const { ctx, feed, session } = await harness()
    const parent = session().value
    const follower = follow(feed, parent)
    await nextFrame(follower.iterator)
    const closing = follower.iterator.next()
    await ctx.fiber.dispose()
    roots.splice(roots.indexOf(ctx), 1)
    await expect(closing).resolves.toEqual({ done: true, value: undefined })
  })

  it('rejects every cap explicitly without changing delegation-facing state', async () => {
    const { feed, session } = await harness()
    const participantParent = session('participants').value
    const tooManyParticipants = receipt(
      String(participantParent.id),
      1,
      RECEIPT_FEED_LIMITS.participantsPerReceipt + 1,
    )
    expect(feed.publish(participantParent, replace(tooManyParticipants)))
      .toEqual({ ok: false, code: 'participant-cap' })

    const runParent = session('runs').value
    for (let index = 1; index <= RECEIPT_FEED_LIMITS.activeReceiptsPerSession; index += 1) {
      expect(feed.publish(runParent, replace(receipt(String(runParent.id), index))))
        .toMatchObject({ ok: true, changed: true, revision: index })
    }
    expect(feed.publish(runParent, replace(receipt(String(runParent.id), 99))))
      .toEqual({ ok: false, code: 'active-receipt-cap' })
    const runObserver = follow(feed, runParent)
    await expect(nextFrame(runObserver.iterator)).resolves.toMatchObject({
      value: { revision: RECEIPT_FEED_LIMITS.activeReceiptsPerSession },
    })
    runObserver.abort.abort()

    const followerParent = session('followers').value
    const followers = Array.from(
      { length: RECEIPT_FEED_LIMITS.processFollowers },
      () => follow(feed, followerParent),
    )
    await Promise.all(followers.map(({ iterator }) => nextFrame(iterator)))
    const excess = follow(feed, followerParent)
    await expect(nextFrame(excess.iterator)).resolves.toEqual({ type: 'unavailable', code: 'follower-cap' })
    await expect(excess.iterator.next()).resolves.toEqual({ done: true, value: undefined })
    followers.forEach(({ abort }) => { abort.abort() })
    const afterAbort = follow(feed, followerParent)
    await expect(nextFrame(afterAbort.iterator)).resolves.toMatchObject({ type: 'baseline' })
    afterAbort.abort.abort()

    const byteParent = session('bytes').value
    let byteRejected = false
    for (let index = 1; index <= RECEIPT_FEED_LIMITS.activeReceiptsPerSession; index += 1) {
      const large = receipt(String(byteParent.id), 100 + index, RECEIPT_FEED_LIMITS.participantsPerReceipt)
      const result = feed.publish(byteParent, replace(large))
      if (!result.ok) {
        expect(result).toEqual({ ok: false, code: 'session-byte-cap' })
        byteRejected = true
        break
      }
    }
    expect(byteRejected).toBe(true)
  })

  it('rejects a detached or mismatched Session witness', async () => {
    const { feed, session } = await harness()
    const detached = session('detached')
    detached.dispose()
    expect(feed.publish(detached.value, replace(receipt('detached'))))
      .toEqual({ ok: false, code: 'session-not-live' })
  })
})
