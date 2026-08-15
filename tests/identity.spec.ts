import { describe, expect, it } from 'vitest'
import { TeamRunId } from '../src/identity.ts'

describe('domain identities', () => {
  it('accepts only generated UUID-v4 Team Run identities', () => {
    expect(TeamRunId('team-run-123e4567-e89b-42d3-a456-426614174000'))
      .toBe('team-run-123e4567-e89b-42d3-a456-426614174000')
    expect(() => TeamRunId('team-run-123')).toThrow(/invalid Team Run identity/)
    expect(() => TeamRunId('quick')).toThrow(/invalid Team Run identity/)
  })
})
