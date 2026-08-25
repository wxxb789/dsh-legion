import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))

describe('public contract v1', () => {
  it('matches built exported vocabularies and default authority', () => {
    const result = spawnSync(process.execPath, ['scripts/verify-public-contract.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('public contract v1 verified')
  })

  it('freezes canonical Specialist and Strategy request field sets with the legacy alias', () => {
    const contract = JSON.parse(readFileSync(join(ROOT, 'contracts/v1.json'), 'utf8')) as {
      cohortRunOutcomes: string[]
      specialistRequestFields: string[]
      specialistRequiredFields: string[]
      profileRequestFields: string[]
      strategyRequestFields: string[]
    }
    expect(contract.cohortRunOutcomes).toEqual([
      'completed', 'degraded', 'cancelled', 'failed',
    ])
    expect(contract.specialistRequestFields).toEqual([
      'kind', 'specialist', 'description', 'prompt', 'run_in_background',
    ])
    expect(contract.specialistRequiredFields).toEqual(['description', 'prompt'])
    expect(contract.profileRequestFields).toEqual([
      'kind', 'profile', 'description', 'prompt', 'run_in_background',
    ])
    expect(contract.strategyRequestFields).toEqual([
      'kind', 'strategy', 'objective', 'limits', 'execution',
    ])
  })
})
