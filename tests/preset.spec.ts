import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

const PRESET = fileURLToPath(new URL('../presets/legion/agent.cordis.yml', import.meta.url))

describe('shipped Legion preset template', () => {
  it('is a loader-compatible composition with the Legion row and no Host service provider', async () => {
    const source = await readFile(PRESET, 'utf8')
    const rows = load(source, { schema: entryListSchema })
    expect(Array.isArray(rows)).toBe(true)
    if (!Array.isArray(rows)) throw new Error('expected preset rows')

    const named = rows as Array<{ id?: string; name?: string; config?: unknown }>
    const legion = named.find(row => row.id === 'tool-legion')
    expect(legion).toMatchObject({ name: 'dsh-legion' })
    expect(legion?.config).toMatchObject({
      defaultProfile: 'quick',
      resourceRoots: { bundled: 'resources' },
      profiles: {
        deep: { subagentProvider: 'spawn' },
        quick: { subagentProvider: 'spawn' },
        review: {
          subagentProvider: 'spawn',
          defaultRunInBackground: false,
          result: 'review-v1',
          promptFiles: [{ root: 'bundled', path: 'review.md' }],
        },
      },
    })
    expect(named.some(row => row.name === '@deepseek-ai/dsh-subagent')).toBe(false)
  })
})
