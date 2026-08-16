import { describe, expect, it } from 'vitest'
import {
  ArtifactDigest,
  GoalVersion,
  PlanVersion,
  RunId,
  TaskId,
  trustedRecord,
} from '../src/durable-run/contract.ts'

describe('durable contracts', () => {
  it('strictly validates branded identities and versions', () => {
    expect(RunId('run-one')).toBe('run-one')
    expect(PlanVersion(1)).toBe(1)
    expect(GoalVersion(1)).toBe(1)
    expect(() => TaskId('')).toThrow(/LegionTaskId/)
    expect(() => ArtifactDigest('not-a-digest')).toThrow(/ArtifactDigest/)
  })

  it('owns and recursively freezes trusted records', () => {
    const source = { nested: { value: 1 } }
    const owned = trustedRecord(source)
    source.nested.value = 2
    expect(owned.nested.value).toBe(1)
    expect(Object.isFrozen(owned.nested)).toBe(true)
  })
})
