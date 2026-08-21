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
 * Recursively freeze one resolved value, mirroring the Host provider, which
 * deep-freezes every value it hands out. A Legion path that mutated a resolved
 * section in place would throw here instead of corrupting a shared snapshot.
 */
function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const entry of Object.values(value)) deepFreeze(entry)
  return Object.freeze(value)
}

/** Structural JSON equality, the comparison both Host commit gates use. */
function deepEqualJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

/** What a write attempt did, so a test can assert accepted-versus-refused. */
type WriteVerdict = { readonly outcome: 'accepted' } | { readonly outcome: 'refused'; readonly reason: string }

/**
 * Stand-in for the Host settings provider, carrying the members a split
 * composition uses: a duplicate namespace fails loud, get answers only for a
 * registered namespace, describe hands back the detached raw layers, resolved
 * values are deep-frozen, notifications are gated on an actual change, and the
 * write path runs the OWNER's validate before anything is persisted.
 */
class FakeSettings {
  readonly registrations = new Map<string, {
    resolved: unknown
    base: unknown
    read: () => unknown
    validate?: (value: unknown) => void
  }>()
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
    const read = (section?: Record<string, unknown>) => {
      const layer = section ?? this.sections.get(namespace)
      const value = deepFreeze(resolve(mergeLayers(options?.base, layer)))
      options?.validate?.(value)
      return value
    }
    // The Host validates the stored section at registration, so an unusable
    // document fails the registration itself rather than the next read.
    const resolved = read()
    this.registrations.set(namespace, {
      resolved,
      base: options?.base,
      read: () => this.registrations.get(namespace)?.resolved,
      ...options?.validate === undefined ? {} : { validate: options.validate },
    })
    // Registered reads answer from the committed cache, exactly as the Host
    // scope does: a resolved value only moves when a commit moved it.
    const scopeRead = () => this.registrations.get(namespace)?.resolved
    const resolveCandidate = read
    this.candidates.set(namespace, resolveCandidate)
    return {
      get: scopeRead,
      watch: (callback: () => void) => {
        const set = this.watchers.get(namespace) ?? new Set<() => void>()
        set.add(callback)
        this.watchers.set(namespace, set)
        return () => { set.delete(callback) }
      },
    }
  }

  /** Per-namespace re-resolution against a candidate raw section. */
  private readonly candidates = new Map<string, (section?: Record<string, unknown>) => unknown>()

  get(namespace: string): unknown {
    return this.registrations.get(namespace)?.resolved
  }

  describe(): { ns: string; base?: unknown; user?: Record<string, unknown> }[] {
    return [...this.registrations.entries()].map(([ns, registration]) => {
      const user = this.sections.get(ns)
      return {
        ns,
        ...registration.base === undefined ? {} : { base: structuredClone(registration.base) },
        ...user === undefined ? {} : { user: structuredClone(user) },
      }
    })
  }

  /**
   * Merge a patch into the raw section, re-resolve, run the owner's validate,
   * and persist only when it passes. This is the Host write path: a validation
   * failure rejects BEFORE persistence, so a refused write leaves both the
   * document and every consuming row exactly as they were.
   */
  update(namespace: string, patch: Record<string, unknown>): WriteVerdict {
    const registration = this.registrations.get(namespace)
    if (registration === undefined) return { outcome: 'refused', reason: 'namespace is not registered' }
    const current = this.sections.get(namespace)
    const section = mergeLayers(current, patch) as Record<string, unknown>
    const resolveCandidate = this.candidates.get(namespace)
    let next: unknown
    try {
      next = resolveCandidate?.(section)
    } catch (error: unknown) {
      return { outcome: 'refused', reason: error instanceof Error ? error.message : String(error) }
    }
    this.commitSection(namespace, section, next)
    return { outcome: 'accepted' }
  }

  /** Commit a user section and announce it, as a settings write does. */
  commit(namespace: string, section: Record<string, unknown>): void {
    const resolveCandidate = this.candidates.get(namespace)
    let next: unknown
    try {
      next = resolveCandidate?.(section)
    } catch {
      // The Host keeps the last good resolved value for a section its owner
      // cannot resolve, and still announces that the raw document moved.
      next = this.registrations.get(namespace)?.resolved
    }
    this.commitSection(namespace, section, next)
  }

  /**
   * Swap the raw section, then notify exactly as the Host does: watchers fire
   * only when the RESOLVED value changed, the document event only when the RAW
   * section changed. A consumer that depends on a spurious notification is
   * therefore caught here rather than in a deployment.
   */
  private commitSection(namespace: string, section: Record<string, unknown>, next: unknown): void {
    const registration = this.registrations.get(namespace)
    const rawMoved = !deepEqualJson(this.sections.get(namespace), section)
    const resolvedMoved = registration !== undefined && !deepEqualJson(registration.resolved, next)
    this.sections.set(namespace, section)
    if (registration !== undefined && resolvedMoved) {
      registration.resolved = next
      for (const callback of this.watchers.get(namespace) ?? []) callback()
    }
    if (rawMoved) this.announce?.(namespace)
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

/** A Host with the three services a delegation row injects and one settings provider. */
async function host(settings?: FakeSettings): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SubagentRuntime)
  ctx.subagents.registerProvider(provider())
  if (settings !== undefined) provide(ctx, settings)
  return ctx
}

/** Mount a settings provider on an already-running context and wire its event fan-out. */
function provide(ctx: Context, settings: FakeSettings): void {
  ctx.provide('settings' as never, settings as never)
  const emitter = ctx as unknown as { emit(name: string, ...args: unknown[]): void }
  settings.announce = namespace => { emitter.emit('settings/document-updated', namespace, 1) }
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
    const settings = new FakeSettings()
    const ctx = await host(settings)
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    expect([...settings.registrations.keys()]).toEqual(['legion'])
    expect(toolNames(ctx)).toEqual([])
    await ctx.fiber.dispose()
  })

  it('registers the namespace when the settings provider attaches after the row', async () => {
    // Counterfactual: gate the row behind a boot-time synchronous service probe
    // and return when it misses, and this stays empty forever. Host rows
    // activate on service availability, not in composition file order, so the
    // row must wait through its injected scope rather than probe once.
    const ctx = await host()
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    const settings = new FakeSettings()
    provide(ctx, settings)
    await settle()
    expect([...settings.registrations.keys()]).toEqual(['legion'])
    await ctx.fiber.dispose()
  })

  it('registers on a Host offering no tools, subagents, or systemPrompt', async () => {
    // Counterfactual: declare the three delegation services as package-level
    // inject and the fiber never reaches apply, so the namespace is never
    // registered and the only symptom is a PENDING fiber. A settings row
    // publishes no tool, no prompt section, and starts no child.
    const ctx = new Context()
    const settings = new FakeSettings()
    provide(ctx, settings)
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
    // Counterfactual: revert the split so this row registers too, or make the
    // consume path resolve the stored section WITHOUT its own entry, and all
    // three of these fail together. The owner base carries no toolName, no
    // Profile, and enableRunInBackground true, so reading it would publish the
    // default tool name with an empty profile enum and a run_in_background
    // property; the stored section touches only enableRunInBackground.
    const settings = new FakeSettings({ legion: { enableRunInBackground: false } })
    const ctx = await host(settings)
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    await ctx.plugin(legion, delegationEntry as unknown as legion.LegionConfig)
    expect(toolNames(ctx)).toEqual(['crew'])
    const schema = toolSchema(ctx, 'crew')
    expect((schema?.parameters.properties['profile'] as { enum: string[] }).enum).toEqual(['quick'])
    expect(schema?.parameters.properties).not.toHaveProperty('run_in_background')
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

  it('gives two delegation rows their own tool beside one settings row', async () => {
    // Counterfactual: revert the split to always-register and the second row's
    // register throws, so it never wires a source and never republishes. This
    // is the "two concurrent sessions both get live reconfiguration" claim:
    // one registration, two independent catalogs, both live.
    const settings = new FakeSettings()
    const ctx = await host(settings)
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    await ctx.plugin(legion, { ...delegationEntry, toolName: 'crew' } as unknown as legion.LegionConfig)
    await ctx.plugin(legion, { ...delegationEntry, toolName: 'ensemble' } as unknown as legion.LegionConfig)
    expect(toolNames(ctx)).toEqual(['crew', 'ensemble'])
    expect(settings.registerCalls).toBe(1)
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
    // process is exactly what a composition fact must not be. The row still
    // publishes its tool, and it publishes it from its OWN entry: reading the
    // owner value would have carried the owner's empty Profile catalog.
    expect(toolNames(ctx)).toEqual(['crew'])
    expect((toolSchema(ctx, 'crew')?.parameters.properties['profile'] as { enum: string[] }).enum)
      .toEqual(['quick'])
    await ctx.fiber.dispose()
  })

  it('accepts a catalog cross-reference the row beside it cannot act on', async () => {
    // ADR 0022 records this deliberately: a Profile name is valid for the row
    // that defines it and invalid for the row next to it, so the namespace
    // owner's validate is catalog-independent and cannot refuse on one
    // catalog's behalf. Both halves are asserted because they are one decision:
    // the write is ACCEPTED at the owner, and the consuming row keeps its last
    // published generation instead of publishing something it cannot compile.
    const settings = new FakeSettings()
    const ctx = await host(settings)
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    await ctx.plugin(legion, delegationEntry as unknown as legion.LegionConfig)
    const verdict = settings.update('legion', { defaultProfile: 'absent' })
    await settle()
    expect(verdict).toEqual({ outcome: 'accepted' })
    expect(toolNames(ctx)).toEqual(['crew'])
    await ctx.fiber.dispose()
  })

  it('refuses a write the namespace owner itself cannot resolve', async () => {
    // The other half of the same decision: what the owner CAN judge for every
    // catalog it still refuses at write time, before anything is persisted, so
    // the caller reads the reason and no row ever sees the section.
    const settings = new FakeSettings()
    const ctx = await host(settings)
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    await ctx.plugin(legion, delegationEntry as unknown as legion.LegionConfig)
    const verdict = settings.update('legion', { toolName: '   ' })
    await settle()
    expect(verdict.outcome).toBe('refused')
    expect(toolNames(ctx)).toEqual(['crew'])
    await ctx.fiber.dispose()
  })

  it('keeps the published generation when a commit cannot be materialized', async () => {
    const settings = new FakeSettings()
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
    const settings = new FakeSettings({ legion: { defaultProfile: 'absent', toolName: 'ensemble' } })
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

  it('keeps the namespace served after the delegation row unloads', async () => {
    const settings = new FakeSettings()
    const ctx = await host(settings)
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    const row = ctx.plugin(legion, delegationEntry as unknown as legion.LegionConfig)
    await row
    expect(toolNames(ctx)).toEqual(['crew'])
    await row.dispose()
    // The whole point of the split: a session ending must not take the
    // configuration surface with it. registerCalls pins that the delegation row
    // never even attempted a registration of its own.
    expect([...settings.registrations.keys()]).toEqual(['legion'])
    expect(settings.registerCalls).toBe(1)
    await ctx.fiber.dispose()
  })
})

/**
 * A provider whose namespace becomes served between the served-check and the
 * register call: the first `get` answers undefined, every later one answers the
 * real registration. This is the ordering a second row hits when two rows
 * activate in the same tick.
 */
class RacingSettings extends FakeSettings {
  private missed = false

  override get(namespace: string): unknown {
    if (!this.missed) {
      this.missed = true
      return undefined
    }
    return super.get(namespace)
  }
}

describe('a row that loses the registration race', () => {
  it('consumes the served namespace instead of going blind', async () => {
    // Counterfactual: drop the duplicate-registration recovery in
    // registerOwnedSection and this row falls back to its static entry, so the
    // later commit never reaches it and the tool name never moves. Losing the
    // race must cost a row its registration, never its live reconfiguration.
    const settings = new RacingSettings()
    const ctx = await host(settings)
    await ctx.plugin(legion, settingsEntry as unknown as legion.LegionConfig)
    await ctx.plugin(legion, delegationEntry as unknown as legion.LegionConfig)
    expect(toolNames(ctx)).toEqual(['crew'])
    expect(settings.registerCalls).toBe(1)
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
