import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { LEGION_SETTINGS_NAMESPACE } from '../src/settings.ts'
import { CLIENT_BANNER, CLIENT_EXTERNALS, CLIENT_FOOTER, CLIENT_INTRO } from '../tsdown.client.config.ts'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  name: string
  exports: Record<string, unknown>
  dsh?: { client?: { platform?: unknown; inject?: unknown } }
}

function bundle(): string {
  try {
    return readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  } catch {
    throw new Error('lib/client.js is missing — run `pnpm run build` before this suite')
  }
}

/** One recorded React element from the stub renderer. */
interface Element {
  type: unknown
  props: Record<string, unknown> | null
  children: unknown[]
}

function isElement(value: unknown): value is Element {
  return typeof value === 'object' && value !== null && 'type' in value && 'children' in value
}

/** Flatten a stub element tree into every node it contains. */
function walk(node: unknown, seen: Element[] = []): Element[] {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, seen)
    return seen
  }
  if (!isElement(node)) return seen
  seen.push(node)
  for (const child of node.children) walk(child, seen)
  return seen
}

/**
 * Materialize the shipped bundle exactly as the Host loader does: evaluate it
 * with a `window.__ModuleLoader__`, capture the handoff, and run its factory
 * against a require that answers only the platform module table.
 */
function materialize(): { id: string; exports: Record<string, unknown>; required: string[] } {
  const required: string[] = []
  let handoff: { id: string; factory: (require: (spec: string) => unknown) => unknown } | undefined
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(value: typeof handoff) { handoff = value },
      },
    },
    console,
  }
  runInNewContext(bundle(), sandbox, { filename: 'lib/client.js' })
  if (handoff === undefined) throw new Error('bundle did not register through __ModuleLoader__.load')
  const table: Record<string, unknown> = {
    react: {
      createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) =>
        ({ type, props, children }),
    },
    '@deepseek-ai/dsh-client-ui-primitives': {
      Button: function Button() { return null },
      Input: function Input() { return null },
    },
    '@deepseek-ai/dsh-client-runtime/client': {
      createSnapshotStore: (initial: unknown) => {
        let current = initial
        return { set: (next: unknown) => { current = next }, get: () => current }
      },
    },
  }
  const exports = handoff.factory((spec: string) => {
    required.push(spec)
    const entry = table[spec]
    // The Host throws exactly here when a bundle's externals drifted.
    if (entry === undefined) throw new Error(`require("${spec}") missed the module table`)
    return entry
  }) as Record<string, unknown>
  return { id: handoff.id, exports, required }
}

describe('client bundle artifact', () => {
  it('is wrapped as the loader factory form', () => {
    const source = bundle()
    expect(source.startsWith('window.__ModuleLoader__.load(')).toBe(true)
    // tsdown pretty-prints the wrapper, so pin the tokens rather than the lines.
    for (const token of [...CLIENT_BANNER.split('\n'), CLIENT_INTRO, CLIENT_FOOTER].flatMap(
      part => part.split(/[{};]/).map(piece => piece.trim()).filter(piece => piece.length > 3),
    )) {
      expect(source.replace(/\s+/g, ' '), token).toContain(token.replace(/\s+/g, ' '))
    }
  })

  it('registers under the package name, which the loader matches to its graph row', () => {
    expect(materialize().id).toBe(manifest.name)
  })

  it('requires nothing the Host module table cannot answer', () => {
    const { required } = materialize()
    expect(required.length).toBeGreaterThan(0)
    for (const spec of required) expect(CLIENT_EXTERNALS, spec).toContain(spec)
  })

  it('carries no unsubstituted build-time environment reads', () => {
    const source = bundle()
    expect(source).not.toMatch(/process\.env/)
    expect(source).not.toMatch(/import\.meta/)
  })

  it('is declared for discovery by the client module registry', () => {
    expect(manifest.dsh?.client?.platform).toBe('web')
    const client = manifest.exports['./client'] as { default?: string } | string | undefined
    const resolved = typeof client === 'string' ? client : client?.default
    expect(resolved).toBe('./lib/client.js')
  })
})

describe('client plugin behaviour', () => {
  function context() {
    const registrations: Record<string, unknown>[] = []
    const dictionaries: string[] = []
    let listener: (() => void) | undefined
    const writes: { field: string; value?: unknown; kind: 'set' | 'unset' }[] = []
    let snapshot = {
      status: 'ready' as const,
      value: { toolName: 'legion' } as Record<string, unknown>,
      base: {},
      user: { toolName: 'legion' } as Record<string, unknown>,
      revision: 1,
      writable: true,
      mode: 'host' as const,
    }
    const ctx = {
      settingsScope: {
        bind(spec: { namespace: string }) {
          bound.push(spec.namespace)
          return {
            getSnapshot: () => snapshot,
            subscribe: (fn: () => void) => { listener = fn; return () => { listener = undefined } },
            set: (field: string, value: unknown) => { writes.push({ field, value, kind: 'set' }); return Promise.resolve() },
            unset: (field: string) => { writes.push({ field, kind: 'unset' }); return Promise.resolve() },
          }
        },
      },
      slots: {
        inject(_name: string, register: () => unknown) { register() },
        register(options: Record<string, unknown>, component: unknown) {
          registrations.push({ ...options, component })
          return () => {}
        },
      },
      locale: {
        register(namespace: string) { dictionaries.push(namespace); return () => {} },
      },
      effect(callback: () => (() => void) | void) { callback() },
    }
    const bound: string[] = []
    return { ctx, registrations, dictionaries, bound, writes, notify: () => listener?.(), setSnapshot: (next: typeof snapshot) => { snapshot = next } }
  }

  it('registers one keyed card for the namespace the Host half owns', () => {
    const { exports } = materialize()
    const harness = context()
    ;(exports.apply as (ctx: unknown) => void)(harness.ctx)
    expect(harness.bound).toEqual([LEGION_SETTINGS_NAMESPACE])
    expect(harness.registrations).toHaveLength(1)
    const registration = harness.registrations[0]!
    expect(registration.name).toBe('settings.plugin.item')
    expect(registration.key).toBe(LEGION_SETTINGS_NAMESPACE)
    expect(harness.dictionaries).toEqual(['settings.legion'])
  })

  it('declares the browser services it needs', () => {
    expect(materialize().exports.inject).toEqual(
      ['slots', 'locale', 'connection', 'remote', 'settingsScope'],
    )
  })

  it('keeps the card namespace equal to the Host registration', () => {
    expect(materialize().exports.LEGION_NAMESPACE).toBe(LEGION_SETTINGS_NAMESPACE)
  })

  it('stages an edit and writes it only on save', async () => {
    const { exports } = materialize()
    const harness = context()
    ;(exports.apply as (ctx: unknown) => void)(harness.ctx)
    const face = (harness.registrations[0]!.inject as () => Record<string, unknown>)()
    const store = (face.hooks as { legionCard: { get(): Record<string, unknown> } }).legionCard
    ;(face.edit as (field: string, text: string) => void)('toolName', 'delegate')
    // Staged, not written.
    expect(harness.writes).toEqual([])
    expect((store.get().toolName as { text: string }).text).toBe('delegate')
    expect(store.get().dirty).toBe(true)
    ;(face.save as () => void)()
    await Promise.resolve()
    await Promise.resolve()
    expect(harness.writes).toEqual([{ field: 'toolName', value: 'delegate', kind: 'set' }])
  })

  it('renders nothing while the Host does not serve the namespace', () => {
    const { exports } = materialize()
    const harness = context()
    harness.setSnapshot({
      status: 'unavailable', value: undefined, base: {}, user: {},
      revision: undefined, writable: false, mode: 'host',
    } as never)
    ;(exports.apply as (ctx: unknown) => void)(harness.ctx)
    const registration = harness.registrations[0]!
    const face = (registration.inject as () => Record<string, unknown>)()
    const store = (face.hooks as { legionCard: { get(): unknown } }).legionCard
    const Card = registration.component as (props: unknown) => unknown
    const rendered = Card({
      t: (key: string) => key,
      useLegionCard: () => store.get(),
      edit: () => {}, resetField: () => {}, save: () => {}, discard: () => {},
    })
    expect(rendered).toBeNull()
  })

  it('renders its own chrome and controls when the namespace is served', () => {
    const { exports } = materialize()
    const harness = context()
    ;(exports.apply as (ctx: unknown) => void)(harness.ctx)
    const registration = harness.registrations[0]!
    const face = (registration.inject as () => Record<string, unknown>)()
    const store = (face.hooks as { legionCard: { get(): unknown } }).legionCard
    const Card = registration.component as (props: unknown) => unknown
    const rendered = Card({
      t: (key: string) => key,
      useLegionCard: () => store.get(),
      edit: () => {}, resetField: () => {}, save: () => {}, discard: () => {},
    })
    const nodes = walk(rendered)
    expect(nodes.length).toBeGreaterThan(5)
    const ids = nodes.flatMap(node => typeof node.props?.id === 'string' ? [node.props.id] : [])
    expect(ids).toContain('dsh-legion-tool-name')
    expect(ids).toContain('dsh-legion-default-profile')
    expect(ids).toContain('dsh-legion-run-in-background')
    expect(ids).toContain('dsh-legion-enable-strategies')
  })
})
