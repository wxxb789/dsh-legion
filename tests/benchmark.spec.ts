import { describe, expect, it } from 'vitest'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))

describe('deterministic protocol benchmark', () => {
  it('passes the versioned direct-vs-strategy structural gate', () => {
    const result = spawnSync(process.execPath, ['scripts/benchmark-protocol.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    const report = JSON.parse(result.stdout) as {
      gateClass: string
      direct: { structuralScore: number; agents: number }
      strategy: { structuralScore: number; agents: number; outcomes: string[] }
      structuralDelta: number
      agentRatio: number
    }
    expect(report).toMatchObject({
      gateClass: 'deterministic-protocol',
      direct: { structuralScore: 1 / 6, agents: 2 },
      strategy: { structuralScore: 1, agents: 6, outcomes: ['completed', 'completed'] },
      structuralDelta: 5 / 6,
      agentRatio: 3,
    })
  })
})
