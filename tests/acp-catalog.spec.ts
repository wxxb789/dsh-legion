import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SubagentRuntime, { type SubagentProvider } from '@deepseek-ai/dsh-subagent'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as legion from '../src/index.ts'

/**
 * A provider shaped exactly like the DSH ACP backend: no start-time
 * capabilities, no continuable activation, fresh out-of-process child.
 */
function acpProvider(name: string): SubagentProvider {
  return provider(name, { outputSchema: false, depthLimit: false, toolFilter: false, persona: false })
}

/** A local in-process backend that can honor every start-time capability. */
function localProvider(name: string): SubagentProvider {
  const result = provider(name, { outputSchema: true, depthLimit: true, toolFilter: true, persona: true })
  result.prepareContinuable = () => Promise.resolve({})
  return result
}

function provider(name: string, capabilities: SubagentProvider['capabilities']): SubagentProvider {
  return {
    name,
    capabilities,
    inheritsParentContext: false,
    start: () => Promise.resolve({
      id: SessionId(`${name}-child`),
      localAgent: undefined,
      result: Promise.resolve({
        output: [{ type: 'text' as const, text: 'acp child result' }],
        stopReason: 'completed' as const,
      }),
      dispose: () => Promise.resolve(),
    }),
  }
}

const sample = legion.defineAcpAgent({
  id: 'sample-agent',
  title: 'Sample Agent',
  description: 'Delegate to an external ACP agent.',
  command: 'npx',
  args: ['-y', 'sample-acp'],
  entrypoint: 'verified',
})

describe('ACP agent specs', () => {
  it('rejects an id the catalog vocabulary cannot name', () => {
    expect(() => legion.defineAcpAgent({
      id: 'Bad_Id',
      title: 'x',
      description: 'x',
      entrypoint: 'unverified',
    })).toThrow(legion.AcpCatalogError)
  })

  it('rejects a verified entry that declares no command', () => {
    expect(() => legion.defineAcpAgent({
      id: 'no-command',
      title: 'x',
      description: 'x',
      entrypoint: 'verified',
    })).toThrow(/marked verified but declares no command/)
  })

  it('accepts an unverified entry with no command', () => {
    const spec = legion.defineAcpAgent({
      id: 'unknown-agent',
      title: 'Unknown',
      description: 'Entrypoint not established.',
      entrypoint: 'unverified',
    })
    expect(spec.command).toBeUndefined()
    expect(Object.isFrozen(spec)).toBe(true)
  })
})

describe('ACP Specialists', () => {
  it('fixes every constraint an out-of-process child cannot honor', () => {
    const profile = legion.acpProfile(sample)
    expect(profile.subagentProvider).toBe('sample-agent')
    expect(profile.maxDepth).toBe('provider-managed')
    expect(profile.defaultRunInBackground).toBe(false)
    expect(profile.result).toBe('text')
    expect(profile.persona).toBeUndefined()
    expect(profile.toolFilter).toBeUndefined()
    expect(profile.routes).toBeUndefined()
    expect(profile.agentOptions).toBeUndefined()
  })

  it.each([
    ['persona', { persona: 'be terse' }],
    ['toolFilter', { toolFilter: { deny: ['write'] } }],
    ['routes', { routes: [{ id: 'primary', provider: 'p', model: 'm' }] }],
    ['agentOptions', { agentOptions: { provider: 'p', model: 'm' } }],
    ['promptFiles', { promptFiles: [{ root: 'bundled', path: 'x.md' }] }],
  ])('refuses an authored Specialist that sets %s', (_field, extra) => {
    expect(() => legion.assertAcpProfileCompatible('x', {
      ...legion.acpProfile(sample),
      ...extra,
    } as never)).toThrow(legion.AcpCatalogError)
  })

  it('refuses a numeric depth, a background default, and a structured result', () => {
    const base = legion.acpProfile(sample)
    expect(() => legion.assertAcpProfileCompatible('x', { ...base, maxDepth: 3 }))
      .toThrow(/provider-managed/)
    expect(() => legion.assertAcpProfileCompatible('x', { ...base, defaultRunInBackground: true }))
      .toThrow(/continuable activation/)
    expect(() => legion.assertAcpProfileCompatible('x', { ...base, result: 'review-v1' }))
      .toThrow(/structured output/)
  })
})

describe('ACP catalog layer and mount rows', () => {
  it('derives Specialists and mount rows from one descriptor list', () => {
    const agents = [sample]
    const layer = legion.acpCatalogLayer(agents)
    const rows = legion.acpMountRows(agents)
    expect(layer.id).toBe(legion.ACP_CATALOG_LAYER_ID)
    expect(Object.keys(layer.profiles ?? {})).toEqual(['sample-agent'])
    expect(rows).toHaveLength(1)
    // The pairing this module exists to guarantee.
    expect(rows[0]?.config.providerName).toBe(layer.profiles?.['sample-agent']?.subagentProvider)
    expect(rows[0]?.name).toBe(legion.ACP_PROVIDER_PLUGIN)
    expect(rows[0]?.config.permission).toBe('reject')
  })

  it('omits a mount row for an entry with no established entrypoint', () => {
    const unverified = legion.defineAcpAgent({
      id: 'unknown-agent',
      title: 'Unknown',
      description: 'Entrypoint not established.',
      entrypoint: 'unverified',
    })
    expect(legion.acpMountRows([unverified])).toEqual([])
    // The Specialist still exists so the agent is nameable and documentable.
    expect(Object.keys(legion.acpCatalogLayer([unverified]).profiles ?? {})).toEqual(['unknown-agent'])
  })

  it('rejects duplicate agent ids', () => {
    expect(() => legion.acpCatalogLayer([sample, sample])).toThrow(/duplicate ACP agent id/)
  })
})

describe('curated ACP agent catalog', () => {
  const ids = legion.ACP_AGENT_CATALOG.map(agent => agent.id)

  it('covers the nine requested agents', () => {
    expect([...ids].sort()).toEqual([
      'claude-code', 'codex', 'github-copilot', 'grok-build', 'hermes',
      'kimi-code', 'oh-my-pi', 'pi', 'zcode',
    ])
  })

  it('gives every entry a source reference and a usable description', () => {
    for (const agent of legion.ACP_AGENT_CATALOG) {
      expect(agent.reference, agent.id).toMatch(/^https:\/\//)
      expect(agent.description.length, agent.id).toBeGreaterThan(10)
      expect(agent.title.length, agent.id).toBeGreaterThan(1)
    }
  })

  it('ships a command only for a verified entrypoint', () => {
    for (const agent of legion.ACP_AGENT_CATALOG) {
      if (agent.entrypoint === 'verified') expect(agent.command, agent.id).toBeTruthy()
      else expect(agent.command, agent.id).toBeUndefined()
    }
  })

  it('never pins @xai-official/grok@1.0.4, a version npm does not publish', () => {
    const args = legion.ACP_AGENT_CATALOG.flatMap(agent => [...agent.args ?? []])
    expect(args.some(arg => arg.includes('grok@'))).toBe(false)
  })

  it('uses the renamed Claude adapter, not the deprecated one', () => {
    const claude = legion.ACP_AGENT_CATALOG.find(agent => agent.id === 'claude-code')
    expect(claude?.args).toContain('@agentclientprotocol/claude-agent-acp')
    expect(claude?.args?.some(arg => arg.includes('@zed-industries/'))).toBe(false)
  })

  it('compiles into a layer whose every Specialist is ACP-compatible', () => {
    const layer = legion.acpCatalogLayer(legion.ACP_AGENT_CATALOG)
    expect(Object.keys(layer.profiles ?? {}).sort()).toEqual([...ids].sort())
    for (const [name, profile] of Object.entries(layer.profiles ?? {})) {
      expect(() => legion.assertAcpProfileCompatible(name, profile)).not.toThrow()
    }
  })

  it('emits a mount row for every verified entry and none for the others', () => {
    const rows = legion.acpMountRows(legion.ACP_AGENT_CATALOG)
    const verified = legion.ACP_AGENT_CATALOG.filter(agent => agent.entrypoint === 'verified')
    expect(rows).toHaveLength(verified.length)
    expect(rows.map(row => row.config.providerName).sort())
      .toEqual(verified.map(agent => agent.id).sort())
    // Every generated row names a Specialist that exists in the generated layer.
    const layer = legion.acpCatalogLayer(legion.ACP_AGENT_CATALOG)
    for (const row of rows) {
      expect(layer.profiles?.[row.config.providerName]?.subagentProvider)
        .toBe(row.config.providerName)
    }
  })

  it('defaults every generated mount to rejecting the child permission prompts', () => {
    for (const row of legion.acpMountRows(legion.ACP_AGENT_CATALOG)) {
      expect(row.config.permission, row.config.providerName).toBe('reject')
    }
  })

  it('keeps the whole curated catalog error-free against zero-capability providers', () => {
    const catalog = legion.compileCatalog(
      legion.materializeConfig({
        configVersion: 2,
        specialists: {
          quick: {
            description: 'Local delegation.',
            subagentProvider: 'spawn',
            maxDepth: 2,
            defaultRunInBackground: false,
          },
        },
        catalogLayers: [legion.acpCatalogLayer(legion.ACP_AGENT_CATALOG)],
      } as never),
      {
        providers: Object.fromEntries([
          ['spawn', {
            capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
            continuable: true,
          }],
          ...ids.map(id => [id, {
            capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
            continuable: false,
          }] as const),
        ]),
      },
    )
    expect(catalog.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(Object.keys(catalog.activeSpecialists).sort()).toEqual(['quick', ...ids].sort())
  })
})

describe('shipped ACP example fragment', () => {
  it('matches what the catalog renders today', () => {
    const committed = readFileSync(
      new URL('../examples/legion.acp.fragment.yml', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n')
    const rendered = legion.renderAcpFragment(legion.ACP_AGENT_CATALOG).replace(/\r\n/g, '\n')
    // Regenerate with: pnpm run render:acp
    expect(committed).toBe(rendered)
  })
})

describe('ACP catalog against the real compiler', () => {
  // catalogLayers is a config v2 field; the ACP layer is opt-in v2 data.
  const config = {
    configVersion: 2,
    specialists: {
      quick: {
        description: 'Local delegation.',
        subagentProvider: 'spawn',
        maxDepth: 2,
        defaultRunInBackground: false,
      },
    },
    defaultProfile: 'quick',
    catalogLayers: [legion.acpCatalogLayer([sample])],
  }

  async function setup(providers: SubagentProvider[]): Promise<Context> {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    for (const item of providers) ctx.subagents.registerProvider(item)
    await ctx.plugin(legion, config as unknown as legion.LegionConfig)
    return ctx
  }

  function specialistEnum(ctx: Context): string[] {
    const schema = ctx.tools.schemas().find(item => item.name === 'legion')
    const parameters = schema?.parameters as { properties: Record<string, { enum?: string[] }> }
    return parameters.properties.specialist?.enum ?? []
  }

  it('compiles clean and stays inactive while the ACP provider is unmounted', async () => {
    const ctx = await setup([localProvider('spawn')])
    expect(specialistEnum(ctx)).toEqual(['quick'])
    await ctx.fiber.dispose()
  })

  it('activates the ACP Specialist once its provider is registered', async () => {
    const ctx = await setup([localProvider('spawn'), acpProvider('sample-agent')])
    expect(specialistEnum(ctx)).toEqual(['quick', 'sample-agent'])
    await ctx.fiber.dispose()
  })

  it('produces no error diagnostic against a zero-capability provider', () => {
    const catalog = legion.compileCatalog(
      legion.materializeConfig(config as never),
      {
        providers: {
          spawn: {
            capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
            continuable: true,
          },
          'sample-agent': {
            capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
            continuable: false,
          },
        },
      },
    )
    expect(catalog.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(Object.keys(catalog.activeSpecialists).sort()).toEqual(['quick', 'sample-agent'])
  })
})
