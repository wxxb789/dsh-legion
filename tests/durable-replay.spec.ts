import { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import { ContinuationId } from '../src/durable-run/contract.ts'
import { issueContinuation } from '../src/durable-run/continuation.ts'
import { createAuthorityEnvelope } from '../src/durable-run/plan-delta.ts'
import { explainLegionRun, parseExportedSessionEvents, replayExportedSessionEvents } from '../src/durable-run/replay.ts'
import { foldLegionProjection } from '../src/durable-run/projection.ts'
import {
  artifactDigest,
  attemptRecord,
  environmentDigest,
  exportedEvent,
  pendingRun,
  planRecord,
  planVersion,
  runId,
  taskRecord,
} from './durable-fixture.ts'

describe('durable replay', () => {
  it('preserves unrelated exported events while projecting only Legion facts', () => {
    const unrelated = { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } }
    const legion = exportedEvent(pendingRun(), 1)
    const source = [unrelated, legion].map(value => JSON.stringify(value)).join('\n')
    const events = parseExportedSessionEvents(source)
    expect(events).toHaveLength(2)
    expect(events[0]?.type).toBe('turn/start')
    expect(replayExportedSessionEvents(source, runId)).toMatchObject({ found: true })
  })

  it('rejects unknown Legion fields, malformed JSON, and sequence gaps', () => {
    const legion = exportedEvent(pendingRun(), 0)
    const withUnknown = {
      ...legion,
      data: { ...(legion.data as object), extra: true },
    }
    expect(() => parseExportedSessionEvents(JSON.stringify(withUnknown))).toThrow(/unknown field/)
    expect(() => parseExportedSessionEvents('{')).toThrow(/line 1/)
    expect(() => parseExportedSessionEvents([
      JSON.stringify(legion),
      JSON.stringify({ type: 'turn/start', seq: 2, time: 2, data: { turn: 1 } }),
    ].join('\n'))).toThrow(/not contiguous/)
  })

  it('produces bounded detached explain views without transcripts', () => {
    const events = parseExportedSessionEvents(JSON.stringify(exportedEvent(pendingRun(), 0)))
    const state = foldLegionProjection(events)
    const view = explainLegionRun(state, runId, { limit: 1 })
    expect(view.tasks).toEqual([])
    expect(view).not.toHaveProperty('transcript')
    expect(Object.isFrozen(view)).toBe(true)
    expect(view.run).not.toBe(state.runs[runId]?.run)
  })
  it('validates and projects the complete eight-event vocabulary', () => {
    const digest = `sha256:${'b'.repeat(64)}`
    const common = {
      schemaVersion: 1,
      runId,
      planVersion: 1,
      correlationId: 'all-events',
    }
    const continuationRecord = issueContinuation({
      continuationId: ContinuationId('continuation-one'),
      runId,
      anchorSessionId: SessionId('session-one'),
      owner: attemptRecord.owner,
      fence: attemptRecord.fence,
      planVersion,
      goalVersion: planRecord.goalVersion,
      environmentDigest,
      expectedInputs: [artifactDigest],
      limits: { activations: 1 },
      authority: createAuthorityEnvelope({
        profiles: {},
        maxDepth: 1,
        allowGoalRevision: false,
      }),
      issuedAt: 8,
    })
    const records = [
      exportedEvent(pendingRun(), 0),
      {
        type: 'legion/plan-state',
        seq: 1,
        time: 2,
        data: { ...common, record: planRecord },
      },
      {
        type: 'legion/task-state',
        seq: 2,
        time: 3,
        data: {
          ...common,
          taskId: taskRecord.taskId,
          generation: taskRecord.generation,
          record: taskRecord,
        },
      },
      {
        type: 'legion/attempt-state',
        seq: 3,
        time: 4,
        data: {
          ...common,
          taskId: attemptRecord.taskId,
          attemptId: attemptRecord.attemptId,
          generation: attemptRecord.generation,
          fence: attemptRecord.fence,
          record: attemptRecord,
        },
      },
      {
        type: 'legion/mail-state',
        seq: 4,
        time: 5,
        data: {
          ...common,
          mailId: 'mail-one',
          taskId: taskRecord.taskId,
          recipientGeneration: taskRecord.generation,
          record: {
            schemaVersion: 1,
            status: 'queued',
            message: {
              mailId: 'mail-one',
              runId,
              sender: { kind: 'controller', id: 'controller-one' },
              recipientTaskId: taskRecord.taskId,
              kind: 'decision',
              payload: [],
              idempotencyKey: 'mail-one',
              createdAt: 5,
            },
            recipientGeneration: taskRecord.generation,
            reclaimCount: 0,
            updatedAt: 5,
          },
        },
      },
      {
        type: 'legion/milestone',
        seq: 5,
        time: 6,
        data: {
          ...common,
          record: {
            schemaVersion: 1,
            milestoneId: 'milestone-one',
            title: 'First',
            summary: 'Visible progress.',
            acceptedAt: 6,
          },
        },
      },
      {
        type: 'legion/decision',
        seq: 6,
        time: 7,
        data: {
          ...common,
          record: {
            schemaVersion: 1,
            decisionId: 'decision-one',
            kind: 'review',
            summary: 'Reviewed.',
            digest,
          },
        },
      },
      {
        type: 'legion/continuation-state',
        seq: 7,
        time: 8,
        data: {
          ...common,
          continuationId: 'continuation-one',
          record: continuationRecord,
        },
      },
    ]
    const events = parseExportedSessionEvents(
      records.map(value => JSON.stringify(value)).join('\n'),
    )
    const state = foldLegionProjection(events)
    expect(state.runs[runId]).toMatchObject({
      plans: { 1: { nodeCount: 1 } },
      tasks: { 'task-one': { status: 'pending' } },
      attempts: { 'attempt-one': { status: 'prepared' } },
      mail: { 'mail-one': { status: 'queued' } },
      milestones: [{ milestoneId: 'milestone-one' }],
      decisions: [{ decisionId: 'decision-one' }],
      continuations: { 'continuation-one': { status: 'available' } },
    })
  })

})
