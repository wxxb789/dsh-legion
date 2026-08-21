import { describe, expect, it } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { inject } from '../src/index.ts'

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const PRESET = fileURLToPath(new URL('../presets/legion/agent.cordis.yml', import.meta.url))

/** The official row that selects a presentation; a preset may carry it, Legion may not reimplement it. */
const PRESENTATION_ROW = '@deepseek-ai/dsh-agent-tool-presentation'

/** What owning a copy of the presentation mechanism would look like in Legion's source. */
const FORBIDDEN: readonly (readonly [RegExp, string])[] = [
  [/\bpresentAs\b/u, 'declares a tool presentation instead of inheriting the deployment default'],
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
 * `both` — is Host-owned end to end. It is declared once by the official
 * `@deepseek-ai/dsh-agent-tool-presentation` row on a preset's standing scope,
 * resolved along the scope chain, and defaulted by the deployment's `dsh-tools`
 * row. Legion's correct posture is therefore to declare NOTHING: it then runs in
 * whatever presentation its deployment selected, and its delegated children
 * inherit that same presentation because `agent-presets` re-parents a child's
 * scope onto the parent's preset standing scope.
 *
 * That inheritance is free only while Legion owns no copy of the mechanism. The
 * moment it declares a presentation, injects the code runtime, hardcodes the
 * reserved transport name, or grows a presentation knob of its own, it pins one
 * version of Code Mode and starts drifting from the official one. This suite
 * exists to make that regression loud, because nothing else in the build would
 * notice: Legion reaches none of these symbols, so no compiler is watching.
 */
describe('tool presentation is inherited, never owned', () => {
  it('injects no code runtime', () => {
    // A code presentation waits for the host-plane `codeRuntime`; that wait
    // belongs to the official row, which fails a preset at mount when the
    // deployment composes no runtime. Legion injecting it would make the Legion
    // row itself unmountable on native-only deployments.
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

  it('ships a preset that inherits the deployment presentation rather than pinning one', async () => {
    const rows = load(await readFile(PRESET, 'utf8'), { schema: entryListSchema })
    if (!Array.isArray(rows)) throw new Error('expected preset rows')
    const named = rows as Array<{ id?: string; name?: string }>

    // Omitting the row is what makes the template portable: selecting `code`
    // here would fail the mount on every deployment composing no TypeScript
    // runtime, and selecting `native` would opt Legion OUT of a deployment's
    // PTC mode. Users who want a fixed presentation add the official row
    // themselves — the README documents exactly that.
    expect(named.some(row => row.name === PRESENTATION_ROW)).toBe(false)

    // If a future edit does add it, it must be the official package and not a
    // Legion-owned reimplementation of the same decision.
    const presentationish = named.filter(row =>
      row.name !== undefined
      && row.name !== PRESENTATION_ROW
      && /presentation|code-?mode|\bptc\b/iu.test(row.name))
    expect(presentationish).toEqual([])
  })

  it('exposes no presentation knob in its own configuration surface', async () => {
    // Legion's config is the customization surface users read first. A
    // `toolPresentation`-shaped key here would look authoritative and would
    // quietly compete with the official row for the same decision.
    const config = await readFile(join(SRC, 'config.ts'), 'utf8')
    expect(config).not.toMatch(/presentation|presentAs|toolMode|codeMode/iu)
  })
})
