import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SubagentRuntime, { type SubagentProvider } from '@deepseek-ai/dsh-subagent'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as legion from '../src/index.ts'
import { SettingsFixture } from './settings-fixture.ts'

/** Minimal subagent backend; these tests only need a registered provider name. */
function provider(name = 'spawn'): SubagentProvider {
  return {
    name,
    capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    inheritsParentContext: false,
    start: () => Promise.resolve({
      id: SessionId(`${name}-child`),
      localAgent: undefined,
      result: Promise.resolve({
        output: [{ type: 'text' as const, text: 'child result' }],
        stopReason: 'completed' as const,
      }),
      dispose: () => Promise.resolve(),
    }),
  }
}

const baseConfig = {
  profiles: {
    quick: {
      description: 'Cheap exploration and summaries.',
      subagentProvider: 'spawn',
      maxDepth: 2,
      defaultRunInBackground: false,
    },
  },
  defaultProfile: 'quick',
}

async function setup(config: unknown, settings?: SettingsFixture): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SubagentRuntime)
  ctx.subagents.registerProvider(provider())
  if (settings !== undefined) await settings.mount(ctx)
  await ctx.plugin(legion, config as legion.LegionConfig)
  return ctx
}

/** Let the serialized asynchronous republication settle. */
async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

function toolNames(ctx: Context): string[] {
  return ctx.tools.schemas().map(item => item.name).sort()
}

describe('settings capability detection', () => {
  it('reports the seam unavailable without a mounted provider', async () => {
    const ctx = await setup(baseConfig)
    const snapshot = legion.detectSettingsCapabilities(ctx as never)
    expect(snapshot.liveReconfiguration).toBe(false)
    expect(snapshot.namespace).toBe(legion.LEGION_SETTINGS_NAMESPACE)
    expect(snapshot.diagnostics).toEqual(['LEGION_SETTINGS_SERVICE_UNAVAILABLE'])
    expect(Object.isFrozen(snapshot)).toBe(true)
    await ctx.fiber.dispose()
  })

  it('reports the seam available and registers exactly one namespace', async () => {
    const settings = new SettingsFixture()
    const ctx = await setup(baseConfig, settings)
    expect(legion.detectSettingsCapabilities(ctx as never).liveReconfiguration).toBe(true)
    expect(settings.registrations.size).toBe(1)
    expect([...settings.registrations.keys()]).toEqual([legion.LEGION_SETTINGS_NAMESPACE])
    // Cordis resolves the entry through the plugin schema before apply, so the
    // base layer is the resolved entry rather than the authored literal.
    expect((settings.registrations.get('legion')?.base as { defaultProfile: string }).defaultProfile)
      .toBe('quick')
    await ctx.fiber.dispose()
  })

  it('keeps every declared diagnostic code stable', () => {
    expect(legion.SETTINGS_DIAGNOSTIC_CODES).toEqual([
      'LEGION_SETTINGS_SERVICE_UNAVAILABLE',
      'LEGION_SETTINGS_REGISTRATION_REJECTED',
    ])
  })
})

describe('settings-sourced publication', () => {
  it('publishes the stored user section instead of the composition entry', async () => {
    const settings = new SettingsFixture({ legion: { toolName: 'delegate' } })
    const ctx = await setup(baseConfig, settings)
    expect(toolNames(ctx)).toEqual(['delegate'])
    await ctx.fiber.dispose()
  })

  it('republishes the tool under a committed rename', async () => {
    const settings = new SettingsFixture()
    const ctx = await setup(baseConfig, settings)
    expect(toolNames(ctx)).toEqual(['legion'])
    settings.commit('legion', { toolName: 'delegate' })
    await settle()
    expect(toolNames(ctx)).toEqual(['delegate'])
    await ctx.fiber.dispose()
  })

  it('retains composition Profiles when a user section patches one entry', async () => {
    const settings = new SettingsFixture()
    const ctx = await setup({
      profiles: {
        quick: baseConfig.profiles.quick,
        deep: { ...baseConfig.profiles.quick, description: 'Complex implementation.' },
      },
    }, settings)
    const before = ctx.tools.schemas().find(item => item.name === 'legion')
    expect((before?.parameters as { properties: Record<string, { enum?: string[] }> })
      .properties.specialist?.enum).toEqual(['deep', 'quick'])
    settings.commit('legion', { profiles: { quick: baseConfig.profiles.quick } })
    await settle()
    const after = ctx.tools.schemas().find(item => item.name === 'legion')
    expect((after?.parameters as { properties: Record<string, { enum?: string[] }> })
      .properties.specialist?.enum).toEqual(['deep', 'quick'])
    await ctx.fiber.dispose()
  })

  it('keeps the published generation when a commit cannot be materialized', async () => {
    const settings = new SettingsFixture()
    const ctx = await setup(baseConfig, settings)
    // routes and legacy agentOptions are mutually exclusive beyond the schema.
    settings.commit('legion', {
      profiles: {
        quick: {
          ...baseConfig.profiles.quick,
          agentOptions: { provider: 'p', model: 'm' },
          routes: [{ id: 'primary', provider: 'p', model: 'm' }],
        },
      },
    })
    await settle()
    expect(toolNames(ctx)).toEqual(['legion'])
    await ctx.fiber.dispose()
  })

  it('falls back to the composition entry when the stored section is unusable', async () => {
    const settings = new SettingsFixture({ legion: { defaultProfile: '../escape' } })
    const ctx = await setup(baseConfig, settings)
    expect(toolNames(ctx)).toEqual(['legion'])
    await ctx.fiber.dispose()
  })

  it('refuses a commit that leaves no Profile at all', async () => {
    const settings = new SettingsFixture()
    const ctx = await setup(baseConfig, settings)
    settings.commit('legion', { profiles: {} })
    await settle()
    expect(toolNames(ctx)).toEqual(['legion'])
    await ctx.fiber.dispose()
  })

  it('falls back to the composition entry when the settings service detaches', async () => {
    const settings = new SettingsFixture({ legion: { toolName: 'delegate' } })
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    ctx.subagents.registerProvider(provider())
    await settings.mount(ctx)
    await ctx.plugin(legion, baseConfig as unknown as legion.LegionConfig)
    expect(toolNames(ctx)).toEqual(['delegate'])
    await settings.unmount()
    await settle()
    expect(toolNames(ctx)).toEqual(['legion'])
    await ctx.fiber.dispose()
  })
})
