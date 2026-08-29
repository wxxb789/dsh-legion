import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { Fence, type RunRecord } from '../src/durable-run/contract.ts'
import { appendLegionEvent } from '../src/durable-run/events.ts'
import { foldLegionProjection } from '../src/durable-run/projection.ts'
import {
  attemptRecord,
  pendingRun,
  planVersion,
  runRecord,
  taskRecord,
} from './durable-fixture.ts'
import type { PendingLegionEvent } from '../src/durable-run/events.ts'


function sessionFake(): Session {
  const events: unknown[] = []
  return {
    events,
    append(type: string, data: unknown) {
      const event = { type, seq: events.length, time: 1, data }
      events.push(event)
      return event
    },
  } as unknown as Session
}

describe('durable event append', () => {
  it('accepts a pending event and lets Session assign seq and time', () => {
    const session = sessionFake()
    const event = appendLegionEvent(session, { runs: {} }, pendingRun())
    expect(event).toMatchObject({ type: 'legion/run-state', seq: 0 })
  })

  it('rejects header mismatch before Session.append', () => {
    const session = sessionFake()
    const pending = pendingRun({ ...runRecord, runId: 'another-run' as never })
    expect(() => appendLegionEvent(session, { runs: {} }, pending)).toThrow(/header/)
    expect(session.events).toHaveLength(0)
  })

  it('rejects an attempt from an old run fence before append', () => {
    const session = sessionFake()
    const staleAttempt: PendingLegionEvent = {
      type: 'legion/attempt-state',
      data: {
        schemaVersion: 1,
        runId: runRecord.runId,
        planVersion,
        correlationId: 'stale-attempt',
        taskId: taskRecord.taskId,
        attemptId: attemptRecord.attemptId,
        generation: attemptRecord.generation,
        fence: Fence(4),
        record: { ...attemptRecord, fence: Fence(4) },
      },
    }
    const state = {
      runs: {
        [runRecord.runId]: {
          run: { ...runRecord, fence: Fence(5) },
          plans: {},
          tasks: {
            [taskRecord.taskId]: {
              ...taskRecord,
              status: 'running' as const,
              currentAttempt: attemptRecord.attemptId,
            },
          },
          attempts: {},
        },
      },
    }
    expect(() => appendLegionEvent(session, state, staleAttempt))
      .toThrow(/attempt fence is not current/)
    expect(session.events).toHaveLength(0)
  })

  it('rejects plan-version regression and terminal rewrites', () => {
    const initial = pendingRun()
    const session = sessionFake()
    const first = appendLegionEvent(session, { runs: {} }, initial)
    const projected = foldLegionProjection([first])
    const invariant = {
      runs: {
        [runRecord.runId]: {
          run: runRecord,
          plans: {},
          tasks: {},
          attempts: {},
        },
      },
    }
    const terminalRecord: RunRecord = { ...runRecord, status: 'completed' }
    const terminal = pendingRun(terminalRecord)
    appendLegionEvent(session, invariant, terminal)
    const terminalInvariant = {
      runs: {
        [runRecord.runId]: {
          run: terminal.data.record as typeof runRecord,
          plans: {},
          tasks: {},
          attempts: {},
        },
      },
    }
    expect(() => appendLegionEvent(session, terminalInvariant, pendingRun())).toThrow(/terminal/)
    expect(() => appendLegionEvent(session, terminalInvariant, pendingRun({
      ...terminalRecord,
      terminalSummary: 'rewritten terminal facts',
      updatedAt: terminalRecord.updatedAt + 1,
    }))).toThrow(/terminal/)
    expect(projected.runs[runRecord.runId]?.run).toEqual(runRecord)
  })
})
