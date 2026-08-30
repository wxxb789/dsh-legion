import type {
  ReceiptFeedFrame,
  RunReceipt,
  RunReceiptEvidenceCoverage,
  RunReceiptTokenAccount,
  RunReceiptTokenEvidence,
  RunReceiptTokenField,
} from '../src/types.ts'

function completeCoverage(total: number): RunReceiptEvidenceCoverage {
  return {
    status: 'complete',
    total,
    reported: total,
    provisional: 0,
    unavailable: 0,
    truncated: 0,
  }
}

function reported(value: number): RunReceiptTokenEvidence {
  return { status: 'reported', value, source: 'session-fold' }
}

function tokenValues(index: number): Readonly<Record<RunReceiptTokenField, RunReceiptTokenEvidence>> {
  const input = index + 1
  const output = index + 2
  return {
    totalTokens: reported(input + output),
    uncachedInputTokens: reported(input),
    outputTokens: reported(output),
    cacheReadTokens: reported(0),
    cacheWriteTokens: reported(0),
  }
}

function tokenAccount(count: number): RunReceiptTokenAccount {
  const sessions = Array.from({ length: count }, (_, index) => ({
    childId: `child-${String(index)}`,
    logRevision: index,
    ...tokenValues(index),
  }))
  const aggregate = (field: RunReceiptTokenField) => ({
    value: sessions.reduce((sum, sample) => {
      const evidence = sample[field]
      return sum + (evidence.status === 'unavailable' ? 0 : evidence.value)
    }, 0),
    coverage: completeCoverage(count),
  })
  const totals = {
    totalTokens: aggregate('totalTokens'),
    uncachedInputTokens: aggregate('uncachedInputTokens'),
    outputTokens: aggregate('outputTokens'),
    cacheReadTokens: aggregate('cacheReadTokens'),
    cacheWriteTokens: aggregate('cacheWriteTokens'),
  }
  return { coverage: 'complete', totals, sessions }
}

export function runId(index: number): string {
  return `team-run-00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
}

export function receipt(
  sessionId: string,
  index = 1,
  participantCount = 0,
): RunReceipt {
  const rows = Array.from({ length: participantCount }, (_, childIndex) => ({
    childId: `child-${String(childIndex)}`,
    parentId: sessionId,
    depth: 1,
    stage: 'execute',
    member: 'executor',
    childIndex,
    source: 'session' as const,
    state: 'running' as const,
    timing: {
      status: 'reported' as const,
      elapsedMs: childIndex + 1,
      source: 'subagent-timing' as const,
    },
  }))
  return {
    schemaVersion: 1,
    sessionId,
    runId: runId(index),
    strategy: 'strategy',
    cohort: 'cohort',
    planDigest: `sha256:${'a'.repeat(64)}`,
    startedAt: index,
    outcome: 'running',
    timing: {
      elapsedMs: index,
      source: 'host-wall',
      coverage: completeCoverage(participantCount),
    },
    stages: [{
      id: 'execute',
      kind: participantCount > 1 ? 'dsh-subagent-fanout' : 'dsh-delegate',
      member: 'executor',
      expectedChildren: Math.max(1, participantCount),
      after: [],
      status: 'pending',
    }],
    participation: {
      coverage: completeCoverage(participantCount),
      rows,
    },
    tokenAccount: tokenAccount(participantCount),
  }
}

export function replace(receiptValue: RunReceipt) {
  return {
    type: 'replace' as const,
    sessionId: receiptValue.sessionId,
    runId: receiptValue.runId,
    receipt: receiptValue,
  }
}

export function settle(receiptValue: RunReceipt, outcome: Exclude<RunReceipt['outcome'], 'running'>): RunReceipt {
  return {
    ...receiptValue,
    outcome,
    timing: { ...receiptValue.timing, elapsedMs: receiptValue.timing.elapsedMs + 1 },
    stages: receiptValue.stages.map(stage => ({ ...stage, status: outcome })),
    participation: {
      ...receiptValue.participation,
      rows: receiptValue.participation.rows.map(row => ({ ...row, state: 'ended' as const })),
    },
  }
}

export async function nextFrame(iterator: AsyncIterator<ReceiptFeedFrame>): Promise<ReceiptFeedFrame> {
  const next = await iterator.next()
  if (next.done) throw new Error('receipt feed closed before the next frame')
  return next.value
}
