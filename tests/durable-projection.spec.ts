import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import {
  EMPTY_LEGION_PROJECTION_STATE,
  applyLegionProjection,
  foldLegionProjection,
  legionRunProjection,
  registerLegionRunProjection,
} from '../src/durable-run/projection.ts'
import { restoreLegionProjection } from '../src/durable-run/replay.ts'
import { exportedEvent, pendingRun } from './durable-fixture.ts'

const runEvent = exportedEvent(pendingRun(), 0) as unknown as SessionEvent
const unrelated = {
  type: 'turn/start',
  seq: 1,
  time: 101,
  data: { turn: 1 },
} as SessionEvent

describe('legion-run projection', () => {
  it('returns the same state reference for unrelated events', () => {
    expect(applyLegionProjection(EMPTY_LEGION_PROJECTION_STATE, unrelated))
      .toBe(EMPTY_LEGION_PROJECTION_STATE)
  })

  it('restores checkpoint plus tail exactly like a full fold', () => {
    const fullEvents = [runEvent, unrelated]
    const full = foldLegionProjection(fullEvents)
    const checkpoint = foldLegionProjection([runEvent])
    expect(restoreLegionProjection(
      { stateVersion: legionRunProjection.stateVersion, state: checkpoint },
      [unrelated],
      fullEvents,
    )).toEqual(full)
  })

  it('refolds the full history when stateVersion mismatches', () => {
    const full = foldLegionProjection([runEvent])
    expect(restoreLegionProjection(
      { stateVersion: 999, state: EMPTY_LEGION_PROJECTION_STATE },
      [],
      [runEvent],
    )).toEqual(full)
  })

  it('rejects a malformed matching-version projection checkpoint', () => {
    expect(() => restoreLegionProjection(
      {
        stateVersion: legionRunProjection.stateVersion,
        state: { runs: { broken: { plans: [] } } } as never,
      },
      [],
      [runEvent],
    )).toThrow(/projection/)
  })

  it('registers the actual definition and disposes through Cordis effect', () => {
    let registered: unknown
    let disposed = false
    const registry = {
      register(definition: unknown) {
        registered = definition
        return () => { disposed = true }
      },
    }
    const context = {
      get: (key: string) => key === 'sessionProjections' ? registry : undefined,
      effect(callback: () => void | (() => void)) {
        const cleanup = callback()
        if (typeof cleanup === 'function') cleanup()
      },
    }
    expect(registerLegionRunProjection(context)).toBe(true)
    expect(registered).toBe(legionRunProjection)
    expect(legionRunProjection).toMatchObject({
      key: 'legion-run',
      stateVersion: 6,
    })
    expect(typeof legionRunProjection.schema.parse).toBe('function')
    expect(disposed).toBe(true)
  })

  it('satisfies the Host projection contract in both spellings', () => {
    const state = foldLegionProjection([runEvent])

    // DSH 0.1.0-rc.6 through 0.1.0-rc.8, below the declared floor: the registry
    // validates `view` output through `schema`, and restores a checkpoint row
    // the same way. The spelling is kept so a deployment that ignores its peer
    // warning cannot silently defeat that Host's projection cache.
    expect(legionRunProjection.schema.parse(legionRunProjection.view(state))).toEqual(state)

    // DSH 0.1.1-rc.1: the registry seeds a fold from `stateSchema.parse(row.val)`.
    // A unit without this member registers cleanly and then throws inside the
    // Host's own restore, taking every other unit in that session with it.
    expect(typeof legionRunProjection.stateSchema.parse).toBe('function')
    expect(legionRunProjection.stateSchema.parse(structuredClone(state))).toEqual(state)
    expect(legionRunProjection.stateSchema).toBe(legionRunProjection.schema)

    // Host-only by construction: run state is never pushed into a client snapshot.
    expect('wire' in legionRunProjection).toBe(false)
  })
})
