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

  it('records canonical aliases and the non-runtime Run Receipt observation contract', () => {
    const contract = JSON.parse(readFileSync(join(ROOT, 'contracts/v1.json'), 'utf8')) as {
      canonicalVocabulary?: unknown
      runReceiptObservation?: unknown
    }

    expect(contract.canonicalVocabulary).toEqual({
      cohort: {
        retiredAlias: 'team',
        compatibility: 'accepted-non-advertised-1.x',
      },
      specialist: {
        retiredAlias: 'profile',
        compatibility: 'accepted-non-advertised-1.x',
      },
    })
    expect(contract.runReceiptObservation).toEqual({
      accountingUnits: ['tokens', 'elapsed-time'],
      companionPackage: 'dsh-legion-receipts',
      consumer: 'standard-dsh-web',
      executionAuthority: 'none',
      fullFactLifetime: 'live-session-and-companion-instance',
      fullFactStream: 'baseline-then-complete-replacements',
      fullFactTransport: 'official-dsh-typert-gateway',
      hostRestartBehavior: 'starts-empty',
      remoteMissingFacts: 'explicit-unavailable',
      sessionEventTransport: 'none',
      storage: 'none',
      terminalArtifact: 'bounded-tool-summary',
      unchangedCompatibilitySurfaces: [
        'contracts/journal-v1.json',
        'historical-identifiers',
        'src/durable-run/**',
      ],
    })
  })
})
