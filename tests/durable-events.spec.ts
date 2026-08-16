import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { appendLegionEvent } from '../src/durable-run/events.ts'
import { foldLegionProjection } from '../src/durable-run/projection.ts'
import { pendingRun, runRecord } from './durable-fixture.ts'

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
    const terminal = pendingRun({ ...runRecord, status: 'completed' })
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
    expect(projected.runs[runRecord.runId]?.run).toEqual(runRecord)
  })
})
