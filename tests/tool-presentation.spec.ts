import { describe, expect, it } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { inject } from '../src/index.ts'

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const PRESET = fileURLToPath(new URL('../presets/legion/agent.cordis.yml', import.meta.url))
const FRAGMENT = fileURLToPath(new URL('../examples/legion.agent.cordis.fragment.yml', import.meta.url))

/** The official row that selects a presentation. A composition may carry it; Legion may not reimplement it. */
const PRESENTATION_ROW = '@deepseek-ai/dsh-agent-tool-presentation'

/** What owning a copy of the presentation mechanism would look like in Legion's source. */
const FORBIDDEN: readonly (readonly [RegExp, string])[] = [
  [/\bpresentAs\b/u, 'declares a tool presentation in code instead of composing the official row'],
  [/\bToolPresentationMode\b/u, 'types a presentation Legion does not own'],
  [/\bcodeRuntime\b/u, 'reaches the host-plane code runtime directly'],
  [/['"`]run_code['"`]/u, 'hardcodes the reserved Code Mode transport name (import RUN_CODE_NAME if it is ever needed)'],
]

async function sources(dir: string, found: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await sources(path, found)
    else if (entry.name.endsWith('.ts')) found.push(path)
  }
  return found
}

/**
 * Tool presentation — `native`, `code` (the Web client labels it PTC mode), or
 * `both` — is Host-owned end to end: declared once by the official
 * `@deepseek-ai/dsh-agent-tool-presentation` row on a preset's standing scope,
 * resolved along the scope chain, defaulted by the deployment's `dsh-tools` row.
 *
 * Legion's complete preset SELECTS Code Mode, because coordination is what Code
 * Mode is best at and because that preset owns its whole composition. It selects
 * it by composing the official row, which is the difference that matters: the
 * mechanism stays upstream, so the preset tracks whatever Code Mode currently is
 * and the agents it delegates to inherit the same mode through scope
 * re-parenting. Legion's own source owns no part of it.
 *
 * That distinction is invisible to the compiler — Legion reaches none of these
 * symbols, so nothing else in the build would notice a copy appearing. This
 * suite is what makes it loud.
 */
describe('Code Mode is composed from the official row, never owned', () => {
  it('injects no code runtime', () => {
    // The wait for `codeRuntime` belongs to the official row, which fails a
    // preset at mount when the deployment composes none. Legion injecting it
    // would instead make the Legion row itself unmountable on native-only
    // deployments, where Legion works perfectly well.
    expect(inject).not.toContain('codeRuntime')
    expect(inject).toEqual(['tools', 'subagents', 'systemPrompt'])
  })

  it('detects the offences it scans for', () => {
    // Without this, a scan that can never fire would read as a passing gate.
    // Each sample is the shape the real regression takes, quoted from the
    // upstream code that legitimately does it.
    const samples = [
      "  ctx.tools.presentAs('native')",
      "import type { ToolPresentationMode } from '@deepseek-ai/dsh-tools'",
      "  ctx.inject(['codeRuntime'], (runtimeCtx: Context) => {",
      "    if (schema.name === 'run_code') continue",
    ]
    for (const [index, [pattern]] of FORBIDDEN.entries()) {
      expect(pattern.test(samples[index] ?? '')).toBe(true)
    }
    expect(samples).toHaveLength(FORBIDDEN.length)
  })

  it('names no presentation symbol anywhere in the plugin source', async () => {
    const offences: string[] = []
    for (const path of await sources(SRC)) {
      const text = await readFile(path, 'utf8')
      for (const [pattern, why] of FORBIDDEN) {
        if (pattern.test(text)) offences.push(`${path.slice(SRC.length + 1)}: ${why}`)
      }
    }
    expect(offences).toEqual([])
  })

  it('ships a complete preset that selects Code Mode through the official row', async () => {
    const rows = load(await readFile(PRESET, 'utf8'), { schema: entryListSchema })
    if (!Array.isArray(rows)) throw new Error('expected preset rows')
    const named = rows as Array<{ id?: string; name?: string; config?: { mode?: unknown } }>

    const row = named.find(entry => entry.name === PRESENTATION_ROW)
    expect(row).toBeDefined()
    expect(row?.config?.mode).toBe('code')

    // One composition selects one presentation: a second declaration is refused
    // rather than merged, so nothing else here may answer the same question.
    const rival = named.filter(entry =>
      entry.name !== undefined
      && entry.name !== PRESENTATION_ROW
      && /presentation|code-?mode|\bptc\b/iu.test(entry.name))
    expect(rival).toEqual([])
  })

  it('ships a fragment that declares no presentation at all', async () => {
    // The fragment is appended to a preset that already made this choice, so a
    // row here would be that refused second declaration — breaking exactly the
    // base preset a PTC-mode user starts from, the official `code` one.
    const rows = load(await readFile(FRAGMENT, 'utf8'), { schema: entryListSchema })
    if (!Array.isArray(rows)) throw new Error('expected fragment rows')
    const named = rows as Array<{ name?: string }>
    expect(named.map(entry => entry.name)).toEqual(['dsh-legion'])
  })

  it('exposes no presentation knob in its own configuration surface', async () => {
    // Legion's config is the customization surface users read first. A
    // `toolPresentation`-shaped key here would look authoritative and would
    // quietly compete with the official row for one decision.
    const config = await readFile(join(SRC, 'config.ts'), 'utf8')
    expect(config).not.toMatch(/presentation|presentAs|toolMode|codeMode/iu)
  })
})
