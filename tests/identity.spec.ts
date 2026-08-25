import { describe, expect, it } from 'vitest'
import { CohortName, CohortRunId, SpecialistName } from '../src/identity.ts'

describe('domain identities', () => {
  it('brands Specialist and Cohort names', () => {
    expect(SpecialistName('quick')).toBe('quick')
    expect(CohortName('review')).toBe('review')
  })

  it('accepts only generated UUID-v4 Cohort Run identities', () => {
    expect(CohortRunId('team-run-123e4567-e89b-42d3-a456-426614174000'))
      .toBe('team-run-123e4567-e89b-42d3-a456-426614174000')
    expect(() => CohortRunId('team-run-123')).toThrow(/invalid Cohort Run identity/)
    expect(() => CohortRunId('quick')).toThrow(/invalid Cohort Run identity/)
  })
})
