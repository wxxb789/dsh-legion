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

/** The subset of the Host settings provider Legion calls. */
export interface SettingsProviderLike {
  register<Value>(
    namespace: string,
    schema: unknown,
    options?: SettingsRegisterOptionsLike<Value>,
  ): SettingsScopeLike<Value>
}

/**
 * The Cordis members this seam uses, structurally typed so Legion depends on
 * the Host's shape rather than on a specific published package.
 */
export interface SettingsHostContext {
  get?(key: string): unknown
  inject?(services: readonly string[], callback: (scoped: SettingsHostContext) => void): unknown
  effect?(callback: () => (() => void) | void, label?: string): unknown
  fiber?: { readonly state: number }
}

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
   * Report a registration this Host refused — a stored section the schema or
   * {@link SettingsSectionHooks.validate} rejects fails the registration
   * itself. The source has already fallen back to the entry when this runs.
   * @param error - the failure the provider raised.
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
 * Install the optional-settings consumer wiring for one namespace. The
 * registration rides the scoped fiber, so a composition that never mounts a
 * settings service runs none of this and the consumer keeps its entry config.
 * @param ctx - consumer plugin context owning the wiring.
 * @param namespace - the consumer-owned settings namespace.
 * @param schema - schema resolving the namespace, typically the plugin Config.
 * @param entry - the consumer's composition entry, used as the `base` layer.
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
    let scope: SettingsScopeLike<Value>
    try {
      scope = provider.register<Value>(namespace, schema, {
        base: entry,
        ...hooks.validate === undefined ? {} : { validate: hooks.validate },
      })
    } catch (error: unknown) {
      // A stored section this consumer cannot act on must not take it down:
      // the composition entry is still a complete configuration.
      hooks.setSource(() => entry)
      hooks.onError?.(error)
      return
    }
    hooks.setSource(() => scope.get())
    scoped.effect?.(() => () => {
      // This disposer runs for two different reasons. A settings provider
      // detaching leaves the consumer running, so it must fall back to its
      // composition entry and re-derive. The consumer's own unload runs it too,
      // and there re-deriving would rebuild against a fiber whose
      // registrations are being released.
      if (isUnloading(ctx)) return
      hooks.setSource(() => entry)
      hooks.onChange()
    }, 'dsh-legion.settingsSection()')
    hooks.onChange()
    scope.watch(() => {
      if (isUnloading(ctx)) return
      hooks.onChange()
    })
  })
  // A fiber-level rejection is already reported through onError or the Host's
  // own diagnostics; the consumer's publication must not hang on it.
  return Promise.resolve(attached).then(() => undefined, () => undefined)
}
