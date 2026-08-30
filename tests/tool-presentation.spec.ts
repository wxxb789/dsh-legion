import { describe, expect, it, vi } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SubagentRuntime, { type SubagentProvider } from '@deepseek-ai/dsh-subagent'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as legion from '../src/index.ts'
import { DELEGATION_INJECT } from '../src/index.ts'

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const PRESET = fileURLToPath(new URL('../presets/legion/agent.cordis.yml', import.meta.url))
const FRAGMENT = fileURLToPath(new URL('../examples/legion.agent.cordis.fragment.yml', import.meta.url))

/** The official row that selects a presentation. A composition may carry it; Legion may not reimplement it. */
const PRESENTATION_ROW = '@deepseek-ai/dsh-agent-tool-presentation'

/** What owning a copy of the presentation mechanism would look like in Legion's source. */
const FORBIDDEN: readonly (readonly [RegExp, string])[] = [
  [/\bpresentAs\b/u, 'declares a tool presentation in code instead of composing the official row'],
  [/\bToolPresentationMode\b/u, 'types a presentation Legion does not own'],
  [/inject\([^)]*codeRuntime/u, 'takes the host-plane code runtime as a dependency, which would make the Legion row unmountable on exactly the deployments its notice exists to help'],
  [/['"`]run_code['"`]/u, 'hardcodes the reserved PTC mode transport name (import RUN_CODE_NAME if it is ever needed)'],
]

function stubProvider(): SubagentProvider {
  return {
    name: 'spawn',
    capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    inheritsParentContext: false,
    async start() {
      return {
        id: SessionId('presentation-child'),
        localAgent: undefined,
        result: Promise.resolve({
          output: [{ type: 'text' as const, text: 'child result' }],
          stopReason: 'completed' as const,
        }),
        async dispose() {},
      }
    },
    async prepareContinuable() { return {} },
  }
}

/** Mount Legion against a deployment that does or does not compose a code runtime. */
async function warningsFromMount(withRuntime: boolean): Promise<string[]> {
  const ctx = new Context()
  const warnings: string[] = []
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SubagentRuntime)
  ctx.subagents.registerProvider(stubProvider())
  if (withRuntime) ctx.provide('codeRuntime', {} as never)
  const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(item => String(item)).join(' '))
  })
  try {
    await ctx.plugin(legion, {
      toolName: 'legion',
      enableRunInBackground: true,
      profiles: {
        quick: {
          description: 'Focused work.',
          subagentProvider: 'spawn',
          routes: [{ id: 'primary', provider: 'models', model: 'model' }],
          maxDepth: 2,
          defaultRunInBackground: false,
        },
      },
      defaultProfile: 'quick',
    } as legion.LegionConfig)
    return warnings
  } finally {
    warn.mockRestore()
  }
}

async function sources(dir: string, found: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await sources(path, found)
    else if (entry.name.endsWith('.ts')) found.push(path)
  }
  return found
}

/**
 * Tool presentation — `native`, `ptc`, or `both` — is Host-owned end to end: declared once by the official
 * `@deepseek-ai/dsh-agent-tool-presentation` row on a preset's standing scope,
 * resolved along the scope chain, defaulted by the deployment's `dsh-tools` row.
 *
 * Legion's complete preset selects native mode because its Review Specialist's
 * allowlist must be a real read-only boundary. It still composes the official
 * row, so the mechanism stays upstream and delegated children inherit the same
 * choice through scope re-parenting. Trusted deployments can select PTC only
 * when every child may receive bash-equivalent code-runtime authority.
 *
 * That distinction is invisible to the compiler — Legion reaches none of these
 * symbols, so nothing else in the build would notice a copy appearing. This
 * suite is what makes it loud.
 */
describe('tool presentation is composed from the official row, never owned', () => {
  it('injects no code runtime', () => {
    // The wait for `codeRuntime` belongs to the official row, which fails a
    // preset at mount when the deployment composes none. Legion injecting it
    // would instead make the Legion row itself unmountable on native-only
    // deployments, where Legion works perfectly well.
    expect(DELEGATION_INJECT).not.toContain('codeRuntime')
    expect(DELEGATION_INJECT).toEqual(['tools', 'subagents', 'systemPrompt'])
    // Declared on the delegation half, not on the package: the Host-plane
    // settings row publishes none of these and must not wait for them.
    expect(legion).not.toHaveProperty('inject')
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

  it('ships a complete preset that selects native mode through the official row', async () => {
    const rows = load(await readFile(PRESET, 'utf8'), { schema: entryListSchema })
    if (!Array.isArray(rows)) throw new Error('expected preset rows')
    const named = rows as Array<{ id?: string; name?: string; config?: { mode?: unknown } }>

    const row = named.find(entry => entry.name === PRESENTATION_ROW)
    expect(row).toBeDefined()
    expect(row?.config?.mode).toBe('native')

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
    // base preset a PTC-mode user starts from, the official `ptc` one.
    const rows = load(await readFile(FRAGMENT, 'utf8'), { schema: entryListSchema })
    if (!Array.isArray(rows)) throw new Error('expected fragment rows')
    const named = rows as Array<{ name?: string }>
    expect(named.map(entry => entry.name)).toEqual(['dsh-legion'])
  })

  it('touches the code runtime only through a read-only presence probe', async () => {
    // The blanket ban was relaxed for exactly one use: a diagnostic that tells
    // an operator which package to install. A probe reads; an inject depends.
    // Only the first is safe here, and one of it is all Legion needs.
    let probes = 0
    for (const path of await sources(SRC)) {
      const text = await readFile(path, 'utf8')
      probes += [...text.matchAll(/ctx\.get\?\.\('codeRuntime'\)/gu)].length
    }
    expect(probes).toBe(1)
  })

  it('tells the operator what to install when no code runtime is composed', async () => {
    const withoutRuntime = await warningsFromMount(false)
    const notice = withoutRuntime.find(line => line.includes('codeRuntime'))
    expect(notice).toBeDefined()
    // Actionable means naming the package and the row, not reporting a state.
    expect(notice).toContain('@deepseek-ai/dsh-code-runtime-worker-thread')
    expect(notice).toContain('code-runtime')
    // A notice, never a refusal: Legion still published its tool.
    expect(notice).toContain('native')

    // And silent when the deployment already composes one, so the notice keeps
    // meaning something on the deployments that need it.
    const withRuntime = await warningsFromMount(true)
    expect(withRuntime.filter(line => line.includes('codeRuntime'))).toEqual([])
  })

  it('warns config authors about retired keys and names the replacement', async () => {
    const warnings = await warningsFromMount(true)
    const diagnostic = warnings.find(line => line.includes('LEGION_CONFIG_KEY_DEPRECATED'))

    expect(diagnostic).toContain('config.profiles')
    expect(diagnostic).toContain('config.specialists')
  })

  it('exposes no presentation knob in its own configuration surface', async () => {
    // Legion's config is the customization surface users read first. A
    // `toolPresentation`-shaped key here would look authoritative and would
    // quietly compete with the official row for one decision.
    const config = await readFile(join(SRC, 'config.ts'), 'utf8')
    expect(config).not.toMatch(/presentation|presentAs|toolMode|codeMode/iu)
  })
})
