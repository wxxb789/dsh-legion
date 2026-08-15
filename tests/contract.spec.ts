import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))

describe('public contract v1 candidate', () => {
  it('matches built exported vocabularies and default authority', () => {
    const result = spawnSync(process.execPath, ['scripts/verify-public-contract.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('public contract v1 candidate verified')
  })

  it('freezes strict Profile and Strategy request field sets', () => {
    const contract = JSON.parse(readFileSync(join(ROOT, 'contracts/v1.json'), 'utf8')) as {
      profileRequestFields: string[]
      strategyRequestFields: string[]
    }
    expect(contract.profileRequestFields).toEqual([
      'kind', 'profile', 'description', 'prompt', 'run_in_background',
    ])
    expect(contract.strategyRequestFields).toEqual(['kind', 'strategy', 'objective', 'limits'])
  })
})
