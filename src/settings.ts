/**
 * Optional DSH settings-service integration.
 *
 * DSH 0.1.0-rc.7 serves every registered settings namespace to configuration
 * surfaces instead of an allowlist, which makes a plugin-owned namespace worth
 * registering. Legion registers structurally rather than importing
 * `@deepseek-ai/dsh-settings`: the seam is a capability the Host may or may not
 * provide, exactly like the durable coordination services in
 * `durable-run/capabilities.ts`, so detecting it costs Legion no peer
 * dependency and no failure mode in a deployment that never mounts it.
 *
 * The wiring mirrors the Host's own optional-consumer contract. While a
 * settings service exists the composition entry becomes the `base` layer and
 * the resolved scope becomes the authoritative source; when the service
 * detaches, the source falls back to the entry so the consumer keeps running
 * exactly as composed.
 *
 * A namespace is process-wide and its registration rides the registrant's
 * fiber, while Legion's Profile catalog belongs to one composed row, so the two
 * halves are separated here. The Host-plane settings row REGISTERS the
 * namespace and keeps it served for the process; every delegation row CONSUMES
 * it, layering the stored user section over its own entry exactly as the Host
 * layers a `base`. Whichever half runs, the source seen by the consumer is the
 * same shape, so publication downstream never learns which one it got.
 */
import { deepFreeze } from './internal/value.ts'

/** Cordis service key of the optional DSH settings provider. */
export const LEGION_SETTINGS_SERVICE_KEY = 'settings'

/**
 * Legion's settings namespace. It is the join key a configuration surface uses
 * to pair a served namespace with a card, so it is public and stable.
 */
export const LEGION_SETTINGS_NAMESPACE = 'legion'

/** Stable diagnostic codes for an unusable settings seam. */
export const SETTINGS_DIAGNOSTIC_CODES = [
  'LEGION_SETTINGS_SERVICE_UNAVAILABLE',
  'LEGION_SETTINGS_REGISTRATION_REJECTED',
] as const

export type SettingsDiagnosticCode = typeof SETTINGS_DIAGNOSTIC_CODES[number]

/** What the current Host composition offers for live reconfiguration. */
export interface SettingsCapabilitySnapshot {
  /** Whether a settings provider able to register a namespace is mounted. */
  readonly liveReconfiguration: boolean
  /** The namespace Legion registers when one is mounted. */
  readonly namespace: string
  /** Ordered stable codes explaining every unavailable capability. */
  readonly diagnostics: readonly SettingsDiagnosticCode[]
}

/**
 * Owner-facing handle for one registered namespace, narrowed to the members
 * Legion uses. The Host contract is wider; Legion never widens its own reach
 * beyond reading and observing its own section.
 */
export interface SettingsScopeLike<Value> {
  /** Current resolved value: schema defaults, then the `base` layer, then the user layer. */
  get(): Value
  /**
   * Observe committed changes to the resolved value.
   * @param callback - invoked after each commit.
   * @returns the disposer removing this observer.
   */
  watch(callback: (next: Value, previous: Value) => void): () => void
}

/** Registration options Legion passes to the Host settings provider. */
export interface SettingsRegisterOptionsLike<Value> {
  /** The registrant's composition entry, layered under the user document. */
  readonly base?: Value
  /** Refuse a resolved section this consumer could not act on. */
  readonly validate?: (value: Value) => void
}

/** One namespace descriptor, narrowed to the layers a consuming row reads. */
export interface SettingsDescriptorLike {
  /** The described namespace. */
  readonly ns: string
  /** The raw stored user section, absent while the document carries none. */
  readonly user?: Record<string, unknown>
}

/** The subset of the Host settings provider Legion calls. */
export interface SettingsProviderLike {
  register<Value>(
    namespace: string,
    schema: unknown,
    options?: SettingsRegisterOptionsLike<Value>,
  ): SettingsScopeLike<Value>
  /** Resolved value of one namespace; `undefined` while nothing registers it. */
  get?(namespace: string): unknown
  /** One descriptor per registered namespace, carrying the detached raw layers. */
  describe?(): readonly SettingsDescriptorLike[]
}

/**
 * The Cordis members this seam uses, structurally typed so Legion depends on
 * the Host's shape rather than on a specific published package.
 */
export interface SettingsHostContext {
  get?(key: string): unknown
  inject?(services: readonly string[], callback: (scoped: SettingsHostContext) => void): unknown
  effect?(callback: () => (() => void) | void, label?: string): unknown
  on?(event: string, listener: (...args: never[]) => unknown): unknown
  fiber?: { readonly state: number }
}

/** The Host event announcing that one namespace's RAW user section moved. */
const SETTINGS_DOCUMENT_UPDATED = 'settings/document-updated'

/** Hooks a consumer hands to {@link installSettingsSection}. */
export interface SettingsSectionHooks<Value> {
  /**
   * Receive the active configuration source: the resolved settings scope while
   * one is attached, the composition entry otherwise. Called before the
   * matching `onChange` at attach and at detach.
   * @param current - thunk returning the currently authoritative value.
   */
  setSource(current: () => Value): void
  /** Re-judge everything derived from the source after an attach, detach, or commit. */
  onChange(): void
  /**
   * Reject a resolved section this consumer could not act on, for constraints
   * the schema cannot express.
   * @param value - the resolved section, schema-valid by construction.
   */
  validate?: (value: Value) => void
  /**
   * Report a stored section this row could not take. Owning the namespace, a
   * section the schema or {@link SettingsSectionHooks.validate} rejects fails
   * the registration itself; consuming one, it fails the resolution and is
   * reported once per distinct failure. Either way the source has already
   * fallen back to the composition entry when this runs.
   * @param error - the failure the provider or the resolution raised.
   */
  onError?: (error: unknown) => void
}

/**
 * Value mirror of the Cordis `FiberState` members {@link isUnloading} compares
 * against. A const enum has no runtime object to import, and the seam is
 * deliberately package-free.
 */
const FIBER_DISPOSED = 4
const FIBER_UNLOADING = 5

/** Whether the consumer's own fiber is tearing down, not just losing the service. */
function isUnloading(ctx: SettingsHostContext): boolean {
  const state = ctx.fiber?.state
  return state === FIBER_UNLOADING || state === FIBER_DISPOSED
}

/** Whether a value is plain data (not an array, null, or class instance). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Layer `over` onto `under`: plain objects merge recursively, every other
 * value — arrays included — replaces the lower layer wholesale.
 *
 * This mirrors the layering the Host applies between a registrant's `base` and
 * the stored user section. The Host keeps that walk private to its provider, so
 * a row that reads the raw section instead of owning the registration has to
 * reproduce it; reproducing it here, once, is what makes a consuming row resolve
 * the same value the owning row would have.
 * @param under - the lower layer, typically this row's composition entry.
 * @param over - the higher layer, typically the stored user section.
 * @returns the merged value; `under` unchanged when `over` is absent.
 */
export function layerSettingsSection(under: unknown, over: unknown): unknown {
  if (over === undefined) return under
  if (!isPlainObject(under) || !isPlainObject(over)) return over
  const merged: Record<string, unknown> = { ...under }
  for (const [key, value] of Object.entries(over)) {
    // A parsed document can carry an own '__proto__' key, and assigning it here
    // would set a prototype rather than a field. The schema declares no such
    // field, so no configuration Legion accepts can lose anything by skipping
    // it, and a stored section cannot reach the object graph through it.
    if (key === '__proto__') continue
    merged[key] = key in merged ? layerSettingsSection(merged[key], value) : value
  }
  return merged
}

/**
 * Read one namespace's raw stored user section from a provider that describes
 * it. Legion selects its own namespace and reads nothing else.
 * @param provider - the mounted settings provider.
 * @param namespace - the namespace to read.
 * @returns the raw user section, or undefined while the document carries none.
 */
function readUserSection(
  provider: SettingsProviderLike,
  namespace: string,
): Record<string, unknown> | undefined {
  const described = provider.describe?.()
  if (described === undefined) return undefined
  for (const descriptor of described) {
    if (descriptor.ns === namespace) return descriptor.user
  }
  return undefined
}

/** Whether a value exposes every named method. */
function hasMethods(value: unknown, methods: readonly string[]): boolean {
  if (typeof value !== 'object' || value === null) return false
  const source = value as Record<string, unknown>
  return methods.every(method => typeof source[method] === 'function')
}

/**
 * Report whether this Host composition can serve Legion's settings namespace.
 * Detection is read-only and never registers anything, so `doctor`-style
 * diagnostics can call it without changing what the deployment publishes.
 * @param ctx - the plugin context.
 * @returns the frozen capability snapshot.
 */
export function detectSettingsCapabilities(
  ctx: SettingsHostContext,
): SettingsCapabilitySnapshot {
  const available = hasMethods(ctx.get?.(LEGION_SETTINGS_SERVICE_KEY), ['register'])
  return deepFreeze({
    liveReconfiguration: available,
    namespace: LEGION_SETTINGS_NAMESPACE,
    diagnostics: available ? [] : ['LEGION_SETTINGS_SERVICE_UNAVAILABLE' as const],
  })
}

/**
 * Fall back to the composition entry when the scope this row read through goes
 * away. The disposer runs for two different reasons: a settings provider
 * detaching leaves the row running, so it must fall back and re-derive, while
 * the row's own unload would otherwise rebuild against a fiber whose
 * registrations are being released.
 */
function installEntryFallback<Value>(
  ctx: SettingsHostContext,
  scoped: SettingsHostContext,
  entry: Value,
  hooks: SettingsSectionHooks<Value>,
): void {
  scoped.effect?.(() => () => {
    if (isUnloading(ctx)) return
    hooks.setSource(() => entry)
    hooks.onChange()
  }, 'dsh-legion.settingsSection()')
}

/**
 * Own the namespace: register it, and read the Host-resolved scope from then
 * on. This is the half that runs for the row which finds the namespace
 * unserved — the Host-plane settings row in a composition that installed the
 * bundle patch, or a lone delegation row in one that did not.
 */
function registerOwnedSection<Value>(
  ctx: SettingsHostContext,
  scoped: SettingsHostContext,
  provider: SettingsProviderLike,
  namespace: string,
  schema: unknown,
  entry: Value,
  hooks: SettingsSectionHooks<Value>,
): void {
  let scope: SettingsScopeLike<Value>
  try {
    scope = provider.register<Value>(namespace, schema, {
      base: entry,
      ...hooks.validate === undefined ? {} : { validate: hooks.validate },
    })
  } catch (error: unknown) {
    // Two reasons to land here, and they want different answers. Another row
    // registered the namespace between the check and this call, in which case
    // this row should read what that row now serves rather than go blind; or
    // the stored section is one this row cannot act on, in which case its
    // composition entry is still a complete configuration.
    if (provider.get?.(namespace) !== undefined && typeof provider.describe === 'function') {
      consumeServedSection(ctx, scoped, provider, namespace, schema, entry, hooks)
      return
    }
    hooks.setSource(() => entry)
    hooks.onError?.(error)
    return
  }
  hooks.setSource(() => scope.get())
  installEntryFallback(ctx, scoped, entry, hooks)
  hooks.onChange()
  scope.watch(() => {
    if (isUnloading(ctx)) return
    hooks.onChange()
  })
}

/**
 * Consume a namespace something else already serves: layer the stored user
 * section over THIS row's composition entry and re-derive whenever the stored
 * section moves.
 *
 * The Host resolves a registration against the layer its own registrant
 * supplied, and that registrant here is the process-wide settings row rather
 * than this one, so its resolved value would answer with another entry
 * underneath. Reading the raw section and layering it locally is what keeps a
 * delegation row's configuration its own: schema defaults, then this row's
 * entry, then the user's stored overrides — the same order the Host applies.
 */
function consumeServedSection<Value>(
  ctx: SettingsHostContext,
  scoped: SettingsHostContext,
  provider: SettingsProviderLike,
  namespace: string,
  schema: unknown,
  entry: Value,
  hooks: SettingsSectionHooks<Value>,
): void {
  const resolveSection = schema as (input: unknown) => Value
  // A stored section this row cannot act on is reported once per distinct
  // failure: the source is re-read on every republication, and a document
  // nobody has touched must not fill the log with the same line.
  let reported: string | undefined
  hooks.setSource((): Value => {
    const section = readUserSection(provider, namespace)
    if (section === undefined) return entry
    try {
      const value = resolveSection(layerSettingsSection(entry, section))
      hooks.validate?.(value)
      reported = undefined
      return value
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error)
      if (detail !== reported) {
        reported = detail
        hooks.onError?.(error)
      }
      return entry
    }
  })
  installEntryFallback(ctx, scoped, entry, hooks)
  hooks.onChange()
  // The Host emits no event for register or unregister, and its resolved-value
  // event belongs to the owning layers. What moves this row is the RAW stored
  // section, which is what the document-updated event announces.
  scoped.on?.(SETTINGS_DOCUMENT_UPDATED, (updated: string) => {
    if (updated !== namespace || isUnloading(ctx)) return
    hooks.onChange()
  })
}
/**
 * Install the optional-settings wiring for one namespace. The wiring rides the
 * scoped fiber, so a composition that never mounts a settings service runs none
 * of this and the row keeps its entry config.
 *
 * Which half runs is decided by what the Host already serves rather than by
 * configuration: an unserved namespace is registered and owned, a served one is
 * consumed. A duplicate registration, which the Host refuses loudly, is
 * therefore impossible however many Legion rows a deployment composes.
 * @param ctx - the row plugin context owning the wiring.
 * @param namespace - the Legion-owned settings namespace.
 * @param schema - schema resolving the namespace, typically the plugin Config.
 * @param entry - this row's composition entry, layered under the user section.
 * @param hooks - source sink, change notification, and optional validation.
 */
export function installSettingsSection<Value>(
  ctx: SettingsHostContext,
  namespace: string,
  schema: unknown,
  entry: Value,
  hooks: SettingsSectionHooks<Value>,
): Promise<void> {
  // Cordis resolves an injected scope on a later tick, so the caller needs the
  // attach to be awaitable: a consumer that publishes from this source has to
  // know whether the source is the scope or the entry before it publishes.
  const attached = ctx.inject?.([LEGION_SETTINGS_SERVICE_KEY], (scoped) => {
    const provider = scoped.get?.(LEGION_SETTINGS_SERVICE_KEY) as SettingsProviderLike | undefined
    if (provider === undefined) return
    // Consuming needs BOTH members: one to see that the namespace is served,
    // one to read the layer under it. A provider offering neither is answered by
    // registering, so an unexpected Host shape degrades to a loud refusal and a
    // logged diagnostic rather than to a row that silently reads nothing.
    const served = provider.get?.(namespace) !== undefined && typeof provider.describe === 'function'
    if (!served) {
      registerOwnedSection(ctx, scoped, provider, namespace, schema, entry, hooks)
      return
    }
    consumeServedSection(ctx, scoped, provider, namespace, schema, entry, hooks)
  })
  // A fiber-level rejection is already reported through onError or the Host's
  // own diagnostics; the consumer's publication must not hang on it.
  return Promise.resolve(attached).then(() => undefined, () => undefined)
}

/**
 * Register the namespace for the lifetime of the composing fiber and hold no
 * other opinion about it.
 *
 * This is the Host-plane half. A configuration surface can offer a namespace
 * only while something serves it, and a registration is an effect on the
 * registering fiber, so a namespace registered from an Agent Preset exists
 * exactly while a session using that preset does. Registering it from the Host
 * composition instead makes the surface offer Legion for the whole process.
 * @param ctx - the settings row plugin context.
 * @param namespace - the Legion-owned settings namespace.
 * @param schema - schema resolving the namespace, typically the plugin Config.
 * @param base - this row's entry, the layer under the stored user section.
 * @param hooks - optional row-independent validation and failure reporting.
 * @returns a promise settling once the attach has been attempted.
 */
export function registerSettingsNamespace<Value>(
  ctx: SettingsHostContext,
  namespace: string,
  schema: unknown,
  base: Value,
  hooks: Pick<SettingsSectionHooks<Value>, 'validate' | 'onError'> = {},
): Promise<void> {
  const attached = ctx.inject?.([LEGION_SETTINGS_SERVICE_KEY], (scoped) => {
    const provider = scoped.get?.(LEGION_SETTINGS_SERVICE_KEY) as SettingsProviderLike | undefined
    if (provider === undefined) return
    try {
      provider.register<Value>(namespace, schema, {
        base,
        ...hooks.validate === undefined ? {} : { validate: hooks.validate },
      })
    } catch (error: unknown) {
      // Another row got there first, or the stored section is unusable. Either
      // way this row contributes nothing else, so there is nothing to withdraw.
      hooks.onError?.(error)
    }
  })
  return Promise.resolve(attached).then(() => undefined, () => undefined)
}
