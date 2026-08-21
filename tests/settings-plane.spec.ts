import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SubagentRuntime, { type SubagentProvider } from '@deepseek-ai/dsh-subagent'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as legion from '../src/index.ts'

/** Minimal subagent backend; these tests only need a registered provider name. */
function provider(name = 'spawn'): SubagentProvider {
  return {
    name,
    capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
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

/** Whether a value is plain data, as the Host layering walk judges it. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** The Host layering these tests assert against: plain objects merge, everything else replaces. */
function mergeLayers(under: unknown, over: unknown): unknown {
  if (over === undefined) return under
  if (!isPlainObject(under) || !isPlainObject(over)) return over
  const merged: Record<string, unknown> = { ...under }
  for (const [key, value] of Object.entries(over)) {
    merged[key] = key in merged ? mergeLayers(merged[key], value) : value
  }
  return merged
}

/**
 * Stand-in for the Host settings provider, carrying the members a split
 * composition uses: a duplicate namespace fails loud, get answers only for a
 * registered namespace, and describe hands back the detached raw user layer.
 */
class FakeSettings {
  readonly registrations = new Map<string, { resolved: unknown; base: unknown }>()
  private readonly sections = new Map<string, Record<string, unknown>>()
  private readonly watchers = new Map<string, Set<() => void>>()
  registerCalls = 0
  /** Set by a test to fan the Host document event out through a real context. */
  announce?: (namespace: string) => void

  constructor(stored: Record<string, Record<string, unknown>> = {}) {
    for (const [ns, section] of Object.entries(stored)) this.sections.set(ns, section)
  }

  register(
    namespace: string,
    schema: unknown,
    options?: { base?: unknown; validate?: (value: unknown) => void },
  ) {
    if (this.registrations.has(namespace)) {
      throw new Error(`settings namespace "${namespace}" is already registered`)
    }
    this.registerCalls += 1
    const resolve = schema as (value: unknown) => unknown
    const read = () => {
      const value = resolve(mergeLayers(options?.base, this.sections.get(namespace)))
      options?.validate?.(value)
      return value
    }
    // The Host validates the stored section at registration, so an unusable
    // document fails the registration itself rather than the next read.
    const resolved = read()
    this.registrations.set(namespace, { resolved, base: options?.base })
    return {
      get: read,
      watch: (callback: () => void) => {
        const set = this.watchers.get(namespace) ?? new Set<() => void>()
        set.add(callback)
        this.watchers.set(namespace, set)
        return () => { set.delete(callback) }
      },
    }
  }

  get(namespace: string): unknown {
    return this.registrations.get(namespace)?.resolved
  }

  describe(): { ns: string; user?: Record<string, unknown> }[] {
    return [...this.registrations.keys()].map((ns) => {
      const user = this.sections.get(ns)
      return user === undefined ? { ns } : { ns, user: structuredClone(user) }
    })
  }

  /** Commit a user section and announce it, as a settings write does. */
  commit(namespace: string, section: Record<string, unknown>): void {
    this.sections.set(namespace, section)
    for (const callback of this.watchers.get(namespace) ?? []) callback()
    this.announce?.(namespace)
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

/** A Host with the three services a Legion row injects and one settings provider. */
async function host(settings?: FakeSettings): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SubagentRuntime)
  ctx.subagents.registerProvider(provider())
  if (settings !== undefined) ctx.provide('settings' as never, settings as never)
  if (settings !== undefined) {
    const emitter = ctx as unknown as { emit(name: string, ...args: unknown[]): void }
    settings.announce = namespace => { emitter.emit('settings/document-updated', namespace, 1) }
  }
  return ctx
}

/** Let the serialized asynchronous republication settle. */
async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

function toolNames(ctx: Context): string[] {
  return ctx.tools.schemas().map(item => item.name).sort()
}

describe('the Host-plane settings row', () => {
  it('registers the namespace and publishes no delegation surface', async () => {
    const settings = new FakeSettings()
    const ctx = await host(settings)
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    expect([...settings.registrations.keys()]).toEqual(['legion'])
    expect(toolNames(ctx)).toEqual([])
    await ctx.fiber.dispose()
  })

  it('keeps the namespace served after the delegation row unloads', async () => {
    const settings = new FakeSettings()
    const ctx = await host(settings)
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    const row = ctx.plugin(legion, delegationEntry as unknown as legion.LegionConfig)
    await row
    expect(toolNames(ctx)).toEqual(['crew'])
    await row.dispose()
    // The whole point of the split: a session ending must not take the
    // configuration surface with it.
    expect([...settings.registrations.keys()]).toEqual(['legion'])
    expect(settings.registerCalls).toBe(1)
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
    const settings = new FakeSettings({ legion: { defaultProfile: 'quick' } })
    const ctx = await host(settings)
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    expect([...settings.registrations.keys()]).toEqual(['legion'])
    await ctx.fiber.dispose()
  })

  it('refuses a stored section no row could act on', async () => {
    const settings = new FakeSettings({ legion: { toolName: '   ' } })
    const ctx = await host(settings)
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    expect([...settings.registrations.keys()]).toEqual([])
    await ctx.fiber.dispose()
  })
})

describe('a delegation row beside a served namespace', () => {
  it('layers the stored section over its own entry rather than the owner base', async () => {
    const settings = new FakeSettings({ legion: { maxResourceBytes: 2048 } })
    const ctx = await host(settings)
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    await ctx.plugin(legion, delegationEntry as unknown as legion.LegionConfig)
    // Reading the owner resolved value would have published the default name.
    expect(toolNames(ctx)).toEqual(['crew'])
    expect(settings.registerCalls).toBe(1)
    await ctx.fiber.dispose()
  })

  it('publishes the stored override and republishes on a later commit', async () => {
    const settings = new FakeSettings({ legion: { toolName: 'delegate' } })
    const ctx = await host(settings)
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    await ctx.plugin(legion, delegationEntry as unknown as legion.LegionConfig)
    expect(toolNames(ctx)).toEqual(['delegate'])
    settings.commit('legion', { toolName: 'ensemble' })
    await settle()
    expect(toolNames(ctx)).toEqual(['ensemble'])
    await ctx.fiber.dispose()
  })

  it('merges a partial Profile override into the composed Profile', async () => {
    const settings = new FakeSettings()
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
    const settings = new FakeSettings({ legion: { role: 'settings' } })
    const ctx = await host(settings)
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    await ctx.plugin(legion, delegationEntry as unknown as legion.LegionConfig)
    // A stored role that could withdraw every delegation surface in the
    // process is exactly what a composition fact must not be.
    expect(toolNames(ctx)).toEqual(['crew'])
    await ctx.fiber.dispose()
  })

  it('keeps the published generation when a commit cannot be materialized', async () => {
    const settings = new FakeSettings()
    const ctx = await host(settings)
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    await ctx.plugin(legion, delegationEntry as unknown as legion.LegionConfig)
    settings.commit('legion', { defaultProfile: 'absent' })
    await settle()
    expect(toolNames(ctx)).toEqual(['crew'])
    await ctx.fiber.dispose()
  })

  it('falls back to its entry when the stored section is unusable at mount', async () => {
    const settings = new FakeSettings({ legion: { defaultProfile: 'absent' } })
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
    const settings = new FakeSettings()
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
    const settings = new FakeSettings()
    const ctx = await host(settings)
    await ctx.plugin(legion, row?.config as unknown as legion.LegionConfig)
    expect([...settings.registrations.keys()]).toEqual(['legion'])
    expect(toolNames(ctx)).toEqual([])
    expect((await ctx.systemPrompt.assemble()).sections.map(entry => entry.name))
      .not.toContain('tool:legion')
    await ctx.fiber.dispose()
  })
})

