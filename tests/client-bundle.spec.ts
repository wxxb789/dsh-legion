import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { Config } from '../src/config.ts'
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

/** Every `id` the rendered tree carries. */
function renderedIds(node: unknown): string[] {
  return walk(node).flatMap(element => typeof element.props?.id === 'string' ? [element.props.id] : [])
}

/**
 * Materialize the shipped bundle exactly as the Host loader does: evaluate it
 * with a `window.__ModuleLoader__`, capture the handoff, and run its factory
 * against a require that answers only the platform module table.
 */
/** One `<style>` the bundle injected into the stub document. */
interface StyleTag {
  dataset: Record<string, string>
  textContent: string
}

function materialize(options: { document?: boolean } = {}): {
  id: string
  exports: Record<string, unknown>
  required: string[]
  styles: StyleTag[]
} {
  const required: string[] = []
  const styles: StyleTag[] = []
  let handoff: { id: string; factory: (require: (spec: string) => unknown) => unknown } | undefined
  // The loader claims `style:not([data-plugin])` right after the factory
  // returns, so the stub records what the bundle injected and when.
  const stubDocument = {
    head: { appendChild(tag: StyleTag) { styles.push(tag) } },
    querySelector: (selector: string) =>
      styles.find(tag => selector.includes(tag.dataset.pluginCss ?? '\u0000')) ?? null,
    createElement: (): StyleTag => ({ dataset: {}, textContent: '' }),
  }
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(value: typeof handoff) { handoff = value },
      },
    },
    ...options.document === false ? {} : { document: stubDocument },
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
      IconChevronDownOutline14: function IconChevronDownOutline14() { return null },
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
  return { id: handoff.id, exports, required, styles }
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

  it('injects one loader-owned stylesheet before the factory returns', () => {
    const { styles } = materialize()
    expect(styles).toHaveLength(1)
    const tag = styles[0]!
    // claimStyles() keys ownership on data-plugin, and unload removes what it owns.
    expect(tag.dataset.plugin).toBe(manifest.name)
    expect(tag.dataset.pluginCss).toBe(`${manifest.name}/legion-card.css`)
    expect(tag.textContent).toContain('.dsh-legion-card')
  })

  it('styles every class the card actually renders', () => {
    const { styles } = materialize()
    const css = styles[0]!.textContent
    for (const className of [
      'dsh-legion-card', 'dsh-legion-card--open',
      'dsh-legion-card__header', 'dsh-legion-card__headtext', 'dsh-legion-card__name',
      'dsh-legion-card__description', 'dsh-legion-card__pending', 'dsh-legion-card__chevron',
      'dsh-legion-card__chevron--open', 'dsh-legion-card__body', 'dsh-legion-card__notice',
      'dsh-legion-card__row', 'dsh-legion-card__head', 'dsh-legion-card__label',
      'dsh-legion-card__badges', 'dsh-legion-card__badge', 'dsh-legion-card__reset',
      'dsh-legion-card__input', 'dsh-legion-card__input--invalid',
      'dsh-legion-card__toggle', 'dsh-legion-card__option', 'dsh-legion-card__radio',
      'dsh-legion-card__hint', 'dsh-legion-card__invalid',
      'dsh-legion-card__footer', 'dsh-legion-card__error',
      'dsh-legion-card__discard', 'dsh-legion-card__save',
    ]) {
      expect(css, className).toContain(`.${className}`)
    }
  })

  it('takes every colour from a theme token, so the card follows the active theme', () => {
    const css = materialize().styles[0]!.textContent
    // Parts that pin no colour: widths and line styles carry none, and these
    // keywords either inherit the theme or paint nothing. A declaration built
    // only from those cannot pin a light-mode value.
    const colourless = new Set([
      'inherit', 'none', 'transparent', 'currentColor', 'unset', 'initial',
      'solid', 'dashed', 'dotted', 'double', 'hidden',
    ])
    // Colour-bearing declarations only: border-radius and friends carry none.
    const declarations = [...css.matchAll(/(?:^|\s)(?:color|background|background-color|border|border-color)\s*:\s*([^;]+);/g)]
      .map(match => match[1]!.trim())
      .filter(value => !value.split(/\s+/).every(part => colourless.has(part) || /^[\d.]/.test(part)))
    expect(declarations.length).toBeGreaterThan(5)
    for (const value of declarations) expect(value, value).toContain('var(--dsw-alias-')
  })

  it('names only theme tokens the DSH palette actually defines', () => {
    const css = materialize().styles[0]!.textContent
    // The theme package is not installable here, so this is a pinned mirror of
    // the aliases declared in the DSH `ui-theme` palette
    // (`src/styles/design-platform.css`). It exists because a token the palette
    // does not define fails silently at run time: upstream's own card CSS
    // reaches for `--dsw-alias-label-error`, which is not declared anywhere,
    // and renders unthemed text as a result.
    const palette = new Set([
      '--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3', '--dsw-alias-bg-module-platform',
      '--dsw-alias-border-l2', '--dsw-alias-brand-primary',
      '--dsw-alias-label-dimmed', '--dsw-alias-label-primary',
      '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary',
      '--dsw-alias-state-error-primary',
    ])
    const used = new Set([...css.matchAll(/var\((--dsw-alias-[a-z0-9-]+)\)/g)].map(match => match[1]!))
    expect(used.size).toBeGreaterThan(5)
    for (const token of used) expect([...palette], token).toContain(token)
  })

  it('loads without a DOM, so a DOM-free harness can still materialize it', () => {
    expect(() => materialize({ document: false })).not.toThrow()
  })

  it('carries no unsubstituted build-time environment reads', () => {
    const source = bundle()
    expect(source).not.toMatch(/process\.env/)
    expect(source).not.toMatch(/import\.meta/)
  })

  it('declares the exact web platform literal the client registry matches', () => {
    expect(manifest.dsh?.client?.platform).toBe('web')
  })

  it('exports the client bundle the registry loads', () => {
    const client = manifest.exports['./client'] as { default?: string } | string | undefined
    const resolved = typeof client === 'string' ? client : client?.default
    expect(resolved).toBe('./lib/client.js')
  })
})

describe('client plugin behaviour', () => {
  function context(options: { lands?: boolean; writable?: boolean } = {}) {
    const lands = options.lands ?? true
    const registrations: Record<string, unknown>[] = []
    const dictionaries: string[] = []
    let listener: (() => void) | undefined
    const writes: { field: string; value?: unknown; kind: 'set' | 'unset' }[] = []
    let snapshot = {
      status: 'ready' as const,
      // The user layer overrides only toolName, and overrides it away from what
      // the composition layer holds, so a reset seeded from `base` is
      // distinguishable from one seeded from the effective value.
      value: {
        toolName: 'delegate', maxResourceBytes: 65536, enableRunInBackground: true,
      } as Record<string, unknown>,
      base: {
        toolName: 'legion', maxResourceBytes: 65536, enableRunInBackground: true,
      } as Record<string, unknown>,
      user: { toolName: 'delegate' } as Record<string, unknown>,
      revision: 1,
      writable: options.writable ?? true,
      mode: 'host' as const,
    }
    // The Host is the only authority on whether a value was accepted, so the
    // stub applies accepted writes to the layers the card reads back from.
    const apply = (next: { user: Record<string, unknown>; value: Record<string, unknown> }) => {
      if (!lands) return
      snapshot = { ...snapshot, ...next, revision: (snapshot.revision ?? 0) + 1 }
      listener?.()
    }
    const ctx = {
      settingsScope: {
        bind(spec: { namespace: string }) {
          bound.push(spec.namespace)
          return {
            getSnapshot: () => snapshot,
            subscribe: (fn: () => void) => { listener = fn; return () => { listener = undefined } },
            set: (field: string, value: unknown) => {
              writes.push({ field, value, kind: 'set' })
              apply({
                user: { ...snapshot.user, [field]: value },
                value: { ...snapshot.value, [field]: value },
              })
              return Promise.resolve()
            },
            unset: (field: string) => {
              writes.push({ field, kind: 'unset' })
              const { [field]: _dropped, ...user } = snapshot.user
              const base = snapshot.base as Record<string, unknown>
              apply({
                user,
                value: Object.hasOwn(base, field)
                  ? { ...snapshot.value, [field]: base[field] }
                  : Object.fromEntries(Object.entries(snapshot.value).filter(([key]) => key !== field)),
              })
              return Promise.resolve()
            },
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
    return {
      ctx,
      registrations,
      dictionaries,
      bound,
      writes,
      notify: () => listener?.(),
      setSnapshot: (next: typeof snapshot) => { snapshot = next },
    }
  }

  /** Mount the bundle and return the card's registration, face, and store. */
  function card(harness: ReturnType<typeof context>) {
    const { exports } = materialize()
    ;(exports.apply as (ctx: unknown) => void)(harness.ctx)
    const registration = harness.registrations[0]!
    const face = (registration.inject as () => Record<string, unknown>)()
    const store = (face.hooks as { legionCard: { get(): Record<string, unknown> } }).legionCard
    const render = () => (registration.component as (props: unknown) => unknown)({
      t: (key: string) => key,
      useLegionCard: () => store.get(),
      toggle: face.toggle as () => void,
      edit: face.edit as unknown,
      resetField: face.resetField as unknown,
      save: face.save as unknown,
      discard: face.discard as unknown,
    })
    return { exports, registration, face, store, render }
  }

  /** Let both the write and the read-back settle. */
  const settle = async () => { for (let tick = 0; tick < 6; tick += 1) await Promise.resolve() }

  it('registers one keyed card for the namespace the Host half owns', () => {
    const harness = context()
    const { registration } = card(harness)
    expect(harness.bound).toEqual([LEGION_SETTINGS_NAMESPACE])
    expect(harness.registrations).toHaveLength(1)
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

  it('bounds its byte control exactly where the Host schema does', () => {
    const range = materialize().exports.LEGION_MAX_RESOURCE_BYTES as { min: number; max: number }
    const authored = { profiles: { quick: { description: 'Quick work.' } } }
    expect(() => Config({ ...authored, maxResourceBytes: range.min } as never)).not.toThrow()
    expect(() => Config({ ...authored, maxResourceBytes: range.max } as never)).not.toThrow()
    expect(() => Config({ ...authored, maxResourceBytes: range.min - 1 } as never)).toThrow()
    expect(() => Config({ ...authored, maxResourceBytes: range.max + 1 } as never)).toThrow()
  })

  it('stages an edit and writes it only on save', async () => {
    const harness = context()
    const { face, store } = card(harness)
    ;(face.edit as (field: string, text: string) => void)('toolName', 'dispatch')
    // Staged, not written.
    expect(harness.writes).toEqual([])
    expect((store.get().toolName as { text: string }).text).toBe('dispatch')
    expect(store.get().dirty).toBe(true)
    ;(face.save as () => void)()
    await settle()
    expect(harness.writes).toEqual([{ field: 'toolName', value: 'dispatch', kind: 'set' }])
    expect(store.get().dirty).toBe(false)
    expect(store.get().failed).toBe(false)
  })

  it('treats retyping the stored value as no edit at all', () => {
    const harness = context()
    const { face, store } = card(harness)
    ;(face.edit as (field: string, text: string) => void)('toolName', 'dispatch')
    expect(store.get().dirty).toBe(true)
    ;(face.edit as (field: string, text: string) => void)('toolName', 'delegate')
    expect(store.get().dirty).toBe(false)
    expect(harness.writes).toEqual([])
  })

  it('treats inheriting a field the user layer never carried as no edit at all', async () => {
    const harness = context()
    const { face, store } = card(harness)
    // The section resolves this to the schema default, so the control shows
    // `true` while the user layer carries nothing. Choosing Inherit restates
    // that, and must not arm a save that would write an unset for nothing.
    expect((store.get().enableRunInBackground as { text: string }).text).toBe('true')
    ;(face.edit as (field: string, text: string) => void)('enableRunInBackground', '')
    expect(store.get().dirty).toBe(false)
    ;(face.save as () => void)()
    await settle()
    expect(harness.writes).toEqual([])
  })

  it('refuses a byte draft outside the schema range instead of sending it', () => {
    const range = materialize().exports.LEGION_MAX_RESOURCE_BYTES as { min: number; max: number }
    for (const draft of [String(range.min - 1), String(range.max + 1), '1.5', 'lots']) {
      const harness = context()
      const { face, store } = card(harness)
      ;(face.edit as (field: string, text: string) => void)('maxResourceBytes', draft)
      expect((store.get().maxResourceBytes as { invalid: boolean }).invalid, draft).toBe(true)
      expect(store.get().invalid, draft).toBe(true)
      ;(face.save as () => void)()
      expect(harness.writes, draft).toEqual([])
    }
  })

  it('accepts a byte draft at either end of the schema range', () => {
    const range = materialize().exports.LEGION_MAX_RESOURCE_BYTES as { min: number; max: number }
    for (const draft of [range.min, range.max]) {
      const harness = context()
      const { face, store } = card(harness)
      ;(face.edit as (field: string, text: string) => void)('maxResourceBytes', String(draft))
      expect((store.get().maxResourceBytes as { invalid: boolean }).invalid, String(draft)).toBe(false)
      expect(store.get().dirty, String(draft)).toBe(true)
    }
  })

  it('previews the composition layer when a field is reset', () => {
    const harness = context()
    const { face, store } = card(harness)
    ;(face.resetField as (field: string) => void)('toolName')
    // The user layer holds 'delegate' over a composition layer holding
    // 'legion', so the control must show what it re-inherits rather than what
    // it is about to stop holding.
    expect((store.get().toolName as { text: string }).text).toBe('legion')
    expect((store.get().toolName as { overridden: boolean }).overridden).toBe(false)
    expect(store.get().dirty).toBe(true)
  })

  it('does not become dirty resetting a field the user layer never carried', () => {
    const harness = context()
    const { face, store } = card(harness)
    ;(face.resetField as (field: string) => void)('maxResourceBytes')
    expect(store.get().dirty).toBe(false)
  })

  it('reports a save the Host did not take, and keeps the drafts', async () => {
    const harness = context({ lands: false })
    const { face, store } = card(harness)
    ;(face.edit as (field: string, text: string) => void)('toolName', 'dispatch')
    ;(face.save as () => void)()
    await settle()
    expect(harness.writes).toEqual([{ field: 'toolName', value: 'dispatch', kind: 'set' }])
    expect(store.get().failed).toBe(true)
    expect(store.get().dirty).toBe(true)
    expect((store.get().toolName as { text: string }).text).toBe('dispatch')
  })

  it('renders nothing while the Host does not serve the namespace', () => {
    const harness = context()
    harness.setSnapshot({
      status: 'unavailable', value: {}, base: {}, user: {},
      revision: undefined, writable: false, mode: 'host',
    } as never)
    expect(card(harness).render()).toBeNull()
  })

  it('discloses its controls only once the card is opened', () => {
    const harness = context()
    const { face, render } = card(harness)
    expect(renderedIds(render())).toEqual([])
    ;(face.toggle as () => void)()
    // A toggle's label names its group through `aria-labelledby`, since a
    // `<label for>` may only point at a form control.
    expect(renderedIds(render())).toEqual([
      'dsh-legion-tool-name',
      'dsh-legion-default-profile',
      'dsh-legion-max-resource-bytes',
      'dsh-legion-run-in-background-label',
      'dsh-legion-run-in-background',
      'dsh-legion-enable-strategies-label',
      'dsh-legion-enable-strategies',
    ])
  })

  it('renders the card as one list item, matching the tab that dispatches it', () => {
    const harness = context()
    const { face, render } = card(harness)
    ;(face.toggle as () => void)()
    const tree = render() as Element
    expect(tree.type).toBe('li')
    expect(walk(tree).length).toBeGreaterThan(5)
  })

  it('says a read-only document cannot be saved, and disables every control', () => {
    const harness = context({ writable: false })
    const { face, render } = card(harness)
    ;(face.toggle as () => void)()
    const nodes = walk(render())
    expect(nodes.some(node => node.props?.className === 'dsh-legion-card__notice')).toBe(true)
    const controls = nodes.filter(node => node.type === 'input')
    // Text fields, the byte field, and three radios per tri-state control.
    expect(controls.length).toBeGreaterThanOrEqual(9)
    for (const node of controls) expect(node.props?.disabled).toBe(true)
    // The disclosure header stays live: collapsing a card is not a write.
    const buttons = nodes.filter(node =>
      node.type === 'button' && node.props?.className !== 'dsh-legion-card__header')
    expect(buttons.length).toBeGreaterThan(0)
    for (const node of buttons) expect(node.props?.disabled, String(node.props?.className)).toBe(true)
  })

  it('offers the three boolean states as one exclusive radio group', () => {
    const harness = context()
    const { face, render } = card(harness)
    ;(face.toggle as () => void)()
    const nodes = walk(render())
    const group = nodes.find(node => node.props?.id === 'dsh-legion-run-in-background')
    expect(group?.props?.role).toBe('radiogroup')
    expect(group?.props?.['aria-labelledby']).toBe('dsh-legion-run-in-background-label')
    const radios = walk(group).filter(node => node.type === 'input')
    expect(radios).toHaveLength(3)
    expect(radios.map(radio => radio.props?.value)).toEqual(['', 'true', 'false'])
    expect(radios.every(radio => radio.props?.type === 'radio')).toBe(true)
    // One group, so exactly one option can be selected at a time.
    expect(radios.filter(radio => radio.props?.checked === true)).toHaveLength(1)
    expect(new Set(radios.map(radio => radio.props?.name))).toEqual(
      new Set(['dsh-legion-run-in-background']))
  })

  it('restates unsaved edits in the header label, which replaces its contents', () => {
    const harness = context()
    const { face, render } = card(harness)
    const label = () => (walk(render()).find(
      node => node.props?.className === 'dsh-legion-card__header')?.props?.['aria-label'])
    expect(label()).toBe('expand: title')
    ;(face.edit as (field: string, text: string) => void)('toolName', 'dispatch')
    expect(label()).toBe('expand: title (unsaved)')
  })
})
