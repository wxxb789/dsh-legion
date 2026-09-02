import { describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
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

const quick = {
  description: 'Cheap exploration and summaries.',
  subagentProvider: 'spawn',
  maxDepth: 2,
  defaultRunInBackground: false,
}

const delegationEntry = { profiles: { quick }, defaultProfile: 'quick', toolName: 'crew' }
const settingsEntry = { role: 'settings' as const, profiles: {} }

/** A Host with the services a delegation row injects and one settings provider. */
async function host(settings?: SettingsFixture): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SubagentRuntime)
  ctx.subagents.registerProvider(provider())
  if (settings !== undefined) await settings.mount(ctx)
  return ctx
}

/** Let the serialized asynchronous republication settle. */
async function settle(): Promise<void> {
  for (let index = 0; index < 16; index += 1) await Promise.resolve()
}

function toolNames(ctx: Context): string[] {
  return ctx.tools.schemas().map(item => item.name).sort()
}

/** The published wire schema of one tool, or undefined while it is unpublished. */
function toolSchema(ctx: Context, name: string): { parameters: { properties: Record<string, unknown> } } | undefined {
  return ctx.tools.schemas().find(item => item.name === name) as
    { parameters: { properties: Record<string, unknown> } } | undefined
}

describe('the Host-plane settings row', () => {
  it('registers the namespace and publishes no delegation surface', async () => {
    const settings = new SettingsFixture()
    const ctx = await host(settings)
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    expect([...settings.registrations.keys()]).toEqual(['legion'])
    expect(toolNames(ctx)).toEqual([])
    await ctx.fiber.dispose()
  })

  it.each([
    ['legacy', { profiles: { quick } }, 1],
    ['canonical', { specialists: { quick } }, 1],
    ['mixed', { profiles: { quick }, specialists: { deep: quick } }, 2],
  ] as const)('warns for %s catalog aliases on a settings row', async (_name, catalog, count) => {
    const ctx = await host()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    await ctx.plugin(legion, { role: 'settings', ...catalog } as unknown as legion.LegionConfig)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(
      `the ${String(count)} Specialist, Cohort, and Strategy entries it declares are ignored`,
    ))
    await ctx.fiber.dispose()
  })

  it('registers the namespace when the settings provider attaches after the row', async () => {
    // Counterfactual: gate the row behind a boot-time synchronous service probe
    // and return when it misses, and this stays empty forever. Host rows
    // activate on service availability, not in composition file order, so the
    // row must wait through its injected scope rather than probe once.
    const ctx = await host()
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    const settings = new SettingsFixture()
    await settings.mount(ctx)
    await settle()
    expect([...settings.registrations.keys()]).toEqual(['legion'])
    await ctx.fiber.dispose()
  })

  it('registers on a Host offering no agents, tools, subagents, or systemPrompt', async () => {
    // Counterfactual: declare the four delegation services as package-level
    // inject and the fiber never reaches apply, so the namespace is never
    // registered and the only symptom is a PENDING fiber. A settings row
    // publishes no tool, no prompt section, and starts no child.
    const ctx = new Context()
    const settings = new SettingsFixture()
    await settings.mount(ctx)
    const row = ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    await row
    await settle()
    expect([...settings.registrations.keys()]).toEqual(['legion'])
    // The fiber is ACTIVE rather than PENDING on a service dependency it does
    // not use: compared against a bare no-op plugin on the same Host, which is
    // active by construction, so the state number itself is never hardcoded.
    const reference = ctx.plugin({ name: 'reference-row', apply: () => {} })
    await reference
    expect(row.state).toBe(reference.state)
    await ctx.fiber.dispose()
  })

  it('runs no registration at all without a settings provider', async () => {
    const ctx = await host()
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    expect(toolNames(ctx)).toEqual([])
    await ctx.fiber.dispose()
  })

  it('accepts a stored section its own empty catalog could never satisfy', async () => {
    // The namespace is process-wide and a catalog belongs to one row, so the
    // owner judges only what holds for any catalog. A defaultProfile naming a
    // Profile this row does not define is the delegation row's business.
    const settings = new SettingsFixture({ legion: { defaultProfile: 'quick' } })
    const ctx = await host(settings)
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    expect([...settings.registrations.keys()]).toEqual(['legion'])
    await ctx.fiber.dispose()
  })

  it('refuses a stored section no row could act on', async () => {
    const settings = new SettingsFixture({ legion: { toolName: '   ' } })
    const ctx = await host(settings)
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    expect([...settings.registrations.keys()]).toEqual([])
    await ctx.fiber.dispose()
  })
})

describe('a delegation row beside a served namespace', () => {
  it('layers the stored section over its own entry rather than the owner base', async () => {
    // Counterfactual: revert the split so this row registers too, or make the
    // consume path resolve the stored section WITHOUT its own entry, and all
    // three of these fail together. The owner base carries no toolName, no
    // Profile, and enableRunInBackground true, so reading it would publish the
    // default tool name with an empty profile enum and a run_in_background
    // property; the stored section touches only enableRunInBackground.
    const settings = new SettingsFixture({ legion: { enableRunInBackground: false } })
    const ctx = await host(settings)
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    await ctx.plugin(legion, delegationEntry as unknown as legion.LegionConfig)
    expect(toolNames(ctx)).toEqual(['crew'])
    const schema = toolSchema(ctx, 'crew')
    expect((schema?.parameters.properties['specialist'] as { enum: string[] }).enum).toEqual(['quick'])
    expect(schema?.parameters.properties).not.toHaveProperty('run_in_background')
    expect(settings.registrations.size).toBe(1)
    await ctx.fiber.dispose()
  })

  it('publishes the stored override and republishes on a later commit', async () => {
    const settings = new SettingsFixture({ legion: { toolName: 'delegate' } })
    const ctx = await host(settings)
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    await ctx.plugin(legion, delegationEntry as unknown as legion.LegionConfig)
    expect(toolNames(ctx)).toEqual(['delegate'])
    settings.commit('legion', { toolName: 'ensemble' })
    await settle()
    expect(toolNames(ctx)).toEqual(['ensemble'])
    await ctx.fiber.dispose()
  })

  it('gives two delegation rows their own tool beside one settings row', async () => {
    // Counterfactual: revert the split to always-register and the second row's
    // register throws, so it never wires a source and never republishes. This
    // is the "two concurrent sessions both get live reconfiguration" claim:
    // one registration, two independent catalogs, both live.
    const settings = new SettingsFixture()
    const ctx = await host(settings)
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    await ctx.plugin(legion, { ...delegationEntry, toolName: 'crew' } as unknown as legion.LegionConfig)
    await ctx.plugin(legion, { ...delegationEntry, toolName: 'ensemble' } as unknown as legion.LegionConfig)
    expect(toolNames(ctx)).toEqual(['crew', 'ensemble'])
    expect(settings.registrations.size).toBe(1)
    settings.commit('legion', { profiles: { quick: { description: 'Narrowed.' } } })
    await settle()
    // Both rows kept their own toolName AND both re-derived from the one stored
    // section: a commit naming neither tool reaches both prompt sections. Under
    // always-register the second row's register throws, it falls back to a
    // static entry, and its section never carries the override.
    expect(toolNames(ctx)).toEqual(['crew', 'ensemble'])
    const sections = (await ctx.systemPrompt.assemble()).sections
    for (const name of ['tool:crew', 'tool:ensemble']) {
      expect(sections.find(entry => entry.name === name)?.text ?? '').toContain('Narrowed.')
    }
    await ctx.fiber.dispose()
  })

  it('merges a partial Profile override into the composed Profile', async () => {
    const settings = new SettingsFixture()
    const ctx = await host(settings)
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    await ctx.plugin(legion, delegationEntry as unknown as legion.LegionConfig)
    settings.commit('legion', { profiles: { quick: { description: 'Narrowed.' } } })
    await settle()
    const section = (await ctx.systemPrompt.assemble()).sections
      .find(entry => entry.name === 'tool:crew')?.text ?? ''
    expect(section).toContain('Narrowed.')
    // Proof the layering is recursive rather than wholesale: a section naming
    // only the description keeps the entry's own defaultRunInBackground, which
    // a replacement would have dropped back to the schema default.
    expect(section).toContain('foreground only')
    await ctx.fiber.dispose()
  })

  it('keeps its role even when the stored section names another', async () => {
    const settings = new SettingsFixture({ legion: { role: 'settings' } })
    const ctx = await host(settings)
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    await ctx.plugin(legion, delegationEntry as unknown as legion.LegionConfig)
    // A stored role that could withdraw every delegation surface in the
    // process is exactly what a composition fact must not be. The row still
    // publishes its tool, and it publishes it from its OWN entry: reading the
    // owner value would have carried the owner's empty Profile catalog.
    expect(toolNames(ctx)).toEqual(['crew'])
    expect((toolSchema(ctx, 'crew')?.parameters.properties['specialist'] as { enum: string[] }).enum)
      .toEqual(['quick'])
    await ctx.fiber.dispose()
  })

  it('accepts a catalog cross-reference the row beside it cannot act on', async () => {
    // ADR 0023 records this deliberately: a Profile name is valid for the row
    // that defines it and invalid for the row next to it, so the namespace
    // owner's validate is catalog-independent and cannot refuse on one
    // catalog's behalf. Both halves are asserted because they are one decision:
    // the write is ACCEPTED at the owner, and the consuming row keeps its last
    // published generation instead of publishing something it cannot compile.
    const settings = new SettingsFixture()
    const ctx = await host(settings)
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    await ctx.plugin(legion, delegationEntry as unknown as legion.LegionConfig)
    await expect(settings.service.update('legion', { defaultProfile: 'absent' }))
      .resolves.toBeUndefined()
    await settle()
    expect(toolNames(ctx)).toEqual(['crew'])
    await ctx.fiber.dispose()
  })

  it('refuses a write the namespace owner itself cannot resolve', async () => {
    // The other half of the same decision: what the owner CAN judge for every
    // catalog it still refuses at write time, before anything is persisted, so
    // the caller reads the reason and no row ever sees the section.
    const settings = new SettingsFixture()
    const ctx = await host(settings)
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    await ctx.plugin(legion, delegationEntry as unknown as legion.LegionConfig)
    await expect(settings.service.update('legion', { toolName: '   ' }))
      .rejects.toThrow()
    await settle()
    expect(toolNames(ctx)).toEqual(['crew'])
    await ctx.fiber.dispose()
  })

  it('keeps the published generation when a commit cannot be materialized', async () => {
    const settings = new SettingsFixture()
    const ctx = await host(settings)
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    await ctx.plugin(legion, delegationEntry as unknown as legion.LegionConfig)
    settings.commit('legion', { defaultProfile: 'absent', toolName: 'ensemble' })
    await settle()
    // A section this row cannot materialize costs it the WHOLE commit, not the
    // offending field: the tool keeps the name it was published under.
    expect(toolNames(ctx)).toEqual(['crew'])
    await ctx.fiber.dispose()
  })

  it('falls back to its entry when the stored section is unusable at mount', async () => {
    const settings = new SettingsFixture({ legion: { defaultProfile: 'absent', toolName: 'ensemble' } })
    const ctx = await host(settings)
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    await ctx.plugin(legion, delegationEntry as unknown as legion.LegionConfig)
    expect(toolNames(ctx)).toEqual(['crew'])
    await ctx.fiber.dispose()
  })

  it('never carries the role into a materialized or exported document', async () => {
    // The role is a mount-time fact about one row. A document that carried it
    // would let an exported catalog, a rollback, or a stored section put it
    // back where the settings layer could reach it.
    const materialized = legion.materializeConfig({ ...delegationEntry, role: 'settings' })
    expect(materialized).not.toHaveProperty('role')
    expect(legion.exportConfigDocument({ ...delegationEntry, role: 'settings' }))
      .not.toHaveProperty('role')
  })

  it('stops re-deriving once its own fiber is disposed', async () => {
    const settings = new SettingsFixture()
    const ctx = await host(settings)
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    const row = ctx.plugin(legion, delegationEntry as unknown as legion.LegionConfig)
    await row
    await row.dispose()
    settings.commit('legion', { toolName: 'delegate' })
    await settle()
    expect(toolNames(ctx)).toEqual([])
    await ctx.fiber.dispose()
  })

  it('keeps the namespace served after the delegation row unloads', async () => {
    const settings = new SettingsFixture()
    const ctx = await host(settings)
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    const row = ctx.plugin(legion, delegationEntry as unknown as legion.LegionConfig)
    await row
    expect(toolNames(ctx)).toEqual(['crew'])
    await row.dispose()
    // The whole point of the split: a session ending must not take the
    // configuration surface with it. The single descriptor pins that the
    // delegation row never registered a namespace of its own.
    expect([...settings.registrations.keys()]).toEqual(['legion'])
    expect(settings.registrations.size).toBe(1)
    await ctx.fiber.dispose()
  })
})

describe('a row that loses the registration race', () => {
  it('consumes the served namespace instead of going blind', async () => {
    // Counterfactual: drop the duplicate-registration recovery in
    // registerOwnedSection and this row falls back to its static entry, so the
    // later commit never reaches it and the tool name never moves. Losing the
    // race must cost a row its registration, never its live reconfiguration.
    const settings = new SettingsFixture({}, true)
    const ctx = await host(settings)
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    await ctx.plugin(legion, delegationEntry as unknown as legion.LegionConfig)
    expect(toolNames(ctx)).toEqual(['crew'])
    expect(settings.registrations.size).toBe(1)
    settings.commit('legion', { toolName: 'ensemble' })
    await settle()
    expect(toolNames(ctx)).toEqual(['ensemble'])
    await ctx.fiber.dispose()
  })
})

describe('the shipped bundle patch row', () => {
  it('mounts as composed and serves the namespace without publishing a tool', async () => {
    // The row a deployment actually gets, driven through the real plugin: the
    // patch file and the code that reads it cannot drift apart silently.
    const patchPath = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))
    const patch = load(await readFile(patchPath, 'utf8'), { schema: entryListSchema }) as {
      insert?: { id?: string; name?: string; config?: Record<string, unknown> }[]
    }[]
    const row = patch.flatMap(entry => entry.insert ?? []).find(entry => entry.name === 'dsh-legion')
    expect(row).toBeDefined()
    const settings = new SettingsFixture()
    const ctx = await host(settings)
    await ctx.plugin(legion, row?.config as unknown as legion.LegionConfig)
    expect([...settings.registrations.keys()]).toEqual(['legion'])
    expect(toolNames(ctx)).toEqual([])
    expect((await ctx.systemPrompt.assemble()).sections.map(entry => entry.name))
      .not.toContain('tool:legion')
    await ctx.fiber.dispose()
  })
})
