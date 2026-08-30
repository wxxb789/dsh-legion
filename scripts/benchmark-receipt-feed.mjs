import { readFile } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import {
  RECEIPT_FEED_LIMITS,
  RunReceiptFeed,
} from '../packages/run-receipt-feed/lib/index.js'

const thresholds = JSON.parse(await readFile(
  new URL('../benchmarks/receipt-feed-thresholds.json', import.meta.url),
  'utf8',
))
const limits = thresholds.limits
const benchmark = thresholds.benchmark

if (JSON.stringify(RECEIPT_FEED_LIMITS) !== JSON.stringify({
  activeReceiptsPerSession: limits.activeReceiptsPerSession,
  participantsPerReceipt: limits.participantsPerReceipt,
  serializedSessionReplacementBytes: limits.serializedSessionReplacementBytes,
  processFollowers: limits.processFollowers,
})) throw new Error('receipt feed benchmark thresholds drifted from the public Host limits')

function coverage(total) {
  return { status: 'complete', total, reported: total, provisional: 0, unavailable: 0, truncated: 0 }
}

function token(value) {
  return { status: 'reported', value, source: 'session-fold' }
}

function runId(index) {
  return `team-run-00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
}

function receipt(sessionId, receiptIndex, participantCount) {
  const rows = Array.from({ length: participantCount }, (_, participantIndex) => {
    const childId = `child-${String(receiptIndex)}-${String(participantIndex)}`
    return {
      childId,
      parentId: sessionId,
      depth: 1,
      stage: 'execute',
      member: 'executor',
      childIndex: participantIndex,
      runId: `lifecycle-${String(receiptIndex)}-${String(participantIndex)}`,
      provider: 'benchmark',
      source: 'session',
      state: 'running',
      timing: { status: 'reported', elapsedMs: participantIndex + 1, source: 'subagent-timing' },
    }
  })
  const sessions = rows.map((row, participantIndex) => ({
    childId: row.childId,
    logRevision: participantIndex,
    totalTokens: token(3),
    uncachedInputTokens: token(1),
    outputTokens: token(2),
    cacheReadTokens: token(0),
    cacheWriteTokens: token(0),
  }))
  const aggregate = value => ({ value, coverage: coverage(participantCount) })
  return {
    schemaVersion: 1,
    sessionId,
    runId: runId(receiptIndex),
    strategy: 'benchmark-strategy',
    cohort: 'benchmark-cohort',
    planDigest: `sha256:${'b'.repeat(64)}`,
    startedAt: receiptIndex,
    outcome: 'running',
    timing: { elapsedMs: receiptIndex, source: 'host-wall', coverage: coverage(participantCount) },
    stages: [{
      id: 'execute',
      kind: participantCount > 1 ? 'dsh-subagent-fanout' : 'dsh-delegate',
      member: 'executor',
      expectedChildren: Math.max(1, participantCount),
      after: [],
      status: 'pending',
    }],
    participation: { coverage: coverage(participantCount), rows },
    tokenAccount: {
      coverage: 'complete',
      totals: {
        totalTokens: aggregate(participantCount * 3),
        uncachedInputTokens: aggregate(participantCount),
        outputTokens: aggregate(participantCount * 2),
        cacheReadTokens: aggregate(0),
        cacheWriteTokens: aggregate(0),
      },
      sessions,
    },
  }
}

function publication(value) {
  return { type: 'replace', sessionId: value.sessionId, runId: value.runId, receipt: value }
}

async function host(participantCount, followerCount) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const feed = new RunReceiptFeed(ctx)
  const session = ctx.sessions.create(SessionId('receipt-feed-benchmark'))
  const receipts = Array.from(
    { length: limits.activeReceiptsPerSession },
    (_, index) => receipt(String(session.id), index + 1, participantCount),
  )
  for (const value of receipts) {
    const result = feed.publish(session, publication(value))
    if (!result.ok) return { ctx, feed, session, receipts, result, followers: [] }
  }
  const followers = Array.from({ length: followerCount }, () => {
    const abort = new AbortController()
    const iterator = feed.follow(String(session.id), abort.signal)[Symbol.asyncIterator]()
    return { abort, iterator }
  })
  const baselines = await Promise.all(followers.map(follower => follower.iterator.next()))
  if (baselines.some(result => result.done || result.value.type !== 'baseline')) {
    throw new Error('receipt feed benchmark did not receive one baseline per follower')
  }
  return { ctx, feed, session, receipts, result: undefined, followers, baselines }
}

async function closeHost(value) {
  for (const follower of value.followers) follower.abort.abort()
  await value.ctx.fiber.dispose()
}

async function probe(participantCount) {
  const value = await host(participantCount, 0)
  try {
    return value.result === undefined
  } finally {
    await closeHost(value)
  }
}

let low = 0
let high = limits.participantsPerReceipt
let maximum = 0
while (low <= high) {
  const middle = Math.floor((low + high) / 2)
  if (await probe(middle)) {
    maximum = middle
    low = middle + 1
  } else {
    high = middle - 1
  }
}

const value = await host(maximum, limits.processFollowers)
try {
  if (value.result !== undefined) throw new Error(`cap-saturating host setup failed: ${JSON.stringify(value.result)}`)
  let changing = value.receipts.at(-1)
  if (changing === undefined) throw new Error('receipt feed benchmark created no Receipt')
  const publish = () => {
    changing = {
      ...changing,
      timing: { ...changing.timing, elapsedMs: changing.timing.elapsedMs + 1 },
    }
    const result = value.feed.publish(value.session, publication(changing))
    if (!result.ok || !result.changed) throw new Error(`benchmark publication failed: ${JSON.stringify(result)}`)
  }

  for (let index = 0; index < benchmark.warmupPublications; index += 1) publish()
  const durations = []
  for (let index = 0; index < benchmark.measuredPublications; index += 1) {
    const started = performance.now()
    publish()
    durations.push(performance.now() - started)
  }
  durations.sort((left, right) => left - right)
  const p95 = durations[Math.ceil(durations.length * 0.95) - 1]
  const updates = await Promise.all(value.followers.map(follower => follower.iterator.next()))
  const first = updates[0]?.value
  const sharedReplacement = first !== undefined
    && !updates[0].done
    && first.type === 'replacement'
    && Object.isFrozen(first)
    && Object.isFrozen(first.value)
    && updates.every(update => !update.done && update.value === first)
  const serializedBytes = first?.type === 'replacement'
    ? Buffer.byteLength(JSON.stringify(first), 'utf8')
    : 0
  const byteSaturation = serializedBytes / limits.serializedSessionReplacementBytes
  const result = {
    schemaVersion: 1,
    activeReceipts: limits.activeReceiptsPerSession,
    participantsPerReceipt: maximum,
    exactParticipantCapCombinationValid: maximum === limits.participantsPerReceipt,
    followers: limits.processFollowers,
    serializedSessionReplacementBytes: serializedBytes,
    byteSaturation,
    measuredPublications: durations.length,
    publicationP95Milliseconds: p95,
    sharedReplacement,
  }
  if (byteSaturation < benchmark.minimumByteSaturation) {
    throw new Error(`receipt feed benchmark did not saturate the byte cap: ${JSON.stringify(result)}`)
  }
  if (!sharedReplacement) throw new Error(`followers did not share one immutable replacement: ${JSON.stringify(result)}`)
  if (p95 > benchmark.publicationP95Milliseconds) {
    throw new Error(`receipt feed publication p95 exceeded threshold: ${JSON.stringify(result)}`)
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
} finally {
  await closeHost(value)
}
