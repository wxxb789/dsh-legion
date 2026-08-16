import { describe, expect, it } from 'vitest'
import { ArtifactDigest, TaskId } from '../src/durable-run/contract.ts'
import { deriveRunMetrics } from '../src/durable-run/metrics.ts'
import { buildReductionTree, createReducerEnvelope } from '../src/durable-run/reducer.ts'

const digest = (value: string) => ArtifactDigest('sha256:' + value.repeat(64))

describe('hierarchical reducer envelopes', () => {
  it('builds bounded deterministic levels and preserves source lineage', () => {
    const ids = ['task-e', 'task-a', 'task-c', 'task-b', 'task-d'].map(TaskId)
    const tree = buildReductionTree(ids, { maxInputs: 2 })
    expect(tree.levels[0]?.every(node => node.sourceTaskIds.length <= 2)).toBe(true)
    expect(tree.root.sourceTaskIds).toEqual([...ids].sort())
  })

  it('keeps conflicts, missing shards, evidence, and bounds without transcripts', () => {
    const envelope = createReducerEnvelope({
      reducerTaskId: TaskId('reducer-one'),
      level: 1,
      sourceTaskIds: [TaskId('task-a')],
      sourceEnvelopeDigests: [digest('a')],
      summary: 'Bounded summary.',
      consensus: [{ claim: 'stable' }],
      conflicts: [{
        claim: 'conflict', sources: [TaskId('task-a')], evidence: [digest('b')],
      }],
      missing: [{ taskId: TaskId('task-b'), reason: 'failed' }],
      evidence: [digest('b')],
      openRisks: ['risk'],
      inputBytes: 100,
      outputBytes: 25,
    }, { maxInputBytes: 1_000, maxOutputBytes: 100 })
    expect(envelope.conflicts).toHaveLength(1)
    expect(envelope.missing).toHaveLength(1)
    expect(envelope).not.toHaveProperty('transcript')
    expect(envelope.compressionRatio).toBe(4)
    expect(() => createReducerEnvelope({
      ...envelope,
      consensus: [{ transcript: 'raw' }],
    }, { maxInputBytes: 1_000, maxOutputBytes: 100 })).toThrow(/raw output/i)
  })
})

describe('derived run metrics', () => {
  it('derives chain and diamond critical steps', () => {
    const chain = {
      nodes: ['a', 'b', 'c'], edges: [['a', 'b'], ['b', 'c']] as const,
    }
    const diamond = {
      nodes: ['a', 'b', 'c', 'd'],
      edges: [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd']] as const,
    }
    expect(deriveRunMetrics({ ...chain, terminalTasks: 3, admissions: [] }).criticalSteps)
      .toBe(3)
    expect(deriveRunMetrics({ ...diamond, terminalTasks: 4, admissions: [] }).criticalSteps)
      .toBe(3)
  })

  it('counts half-open intervals with release before admit ties and honest scope', () => {
    const metrics = deriveRunMetrics({
      nodes: ['a', 'b'], edges: [], terminalTasks: 2,
      admissions: [
        { admittedAt: 0, releasedAt: 10 },
        { admittedAt: 10, releasedAt: 20 },
      ],
      parallelismScope: 'host-global-admitted',
      coordinatorContextBytes: 12,
      reducerInputBytes: 100,
      reducerOutputBytes: 25,
      evidenceCount: 4,
      attemptsStarted: 3,
      rejectedStaleResults: 1,
    })
    expect(metrics.maxObservedParallel).toBe(1)
    expect(metrics.parallelismScope).toBe('host-global-admitted')
    expect(metrics.reducerCompressionRatio).toBe(4)
    expect(metrics.evidenceYieldPerCompletedTask).toBe(2)
    expect(metrics.attemptsStarted).toBe(3)
    expect(metrics.rejectedStaleResults).toBe(1)
  })
})
