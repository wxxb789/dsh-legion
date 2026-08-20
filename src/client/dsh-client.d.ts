/**
 * Local ambient declarations for the DSH browser platform.
 *
 * Legion's browser half imports React and two DSH client packages. Neither of
 * them can be an ordinary dependency here:
 *
 * - Every one of these specifiers is a *platform module*. The client bundle
 *   marks them external and the Host's frozen module table answers the
 *   `require` at load time, so the package never needs to be installed for the
 *   artifact to work.
 * - The DSH client packages are published only on an older line than the Host
 *   this plugin targets, and the package that declares the
 *   `settings.plugin.item` slot is not published at all.
 *
 * So the surface Legion actually uses is declared here, narrowly. This is a
 * hand-maintained coupling: it mirrors the upstream contracts rather than
 * importing them, and an upstream change will not break the build — it will
 * break the card at run time. Keep the surface minimal for that reason, and
 * see `docs/settings-card.md` for the upstream requests that would remove it.
 */

declare module 'react' {
  /** Anything React can render. */
  export type ReactNode = unknown

  /** A component function over its props. */
  export type FunctionComponent<Props> = (props: Props) => ReactNode

  /**
   * Create one React element.
   * @param type - intrinsic tag name or component function.
   * @param props - element props, or null.
   * @param children - child nodes.
   */
  export function createElement(
    type: string | FunctionComponent<never>,
    props?: Record<string, unknown> | null,
    ...children: ReactNode[]
  ): ReactNode
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  /** Client-side sync state of one settings namespace. */
  export interface SettingsScopeSnapshot<Value> {
    status: 'loading' | 'ready' | 'unavailable'
    value: Value | undefined
    base: unknown
    user: unknown
    revision: number | undefined
    writable: boolean
    mode: 'host' | 'memory'
  }

  /** Reactive owner handle over one namespace's durable section. */
  export interface SettingsScope<Value> {
    getSnapshot(): SettingsScopeSnapshot<Value>
    subscribe(listener: () => void): () => void
    set(field: string, value: unknown): Promise<void>
    unset(field: string): Promise<void>
  }

  /** A published snapshot a slot component reads through its bound selector. */
  export interface SnapshotStore<State> {
    set(next: State): void
  }

  /**
   * Create a snapshot store seeded with an initial state.
   * @param initial - the first published state.
   */
  export function createSnapshotStore<State>(initial: State): SnapshotStore<State>

  /** The browser plugin context. */
  export interface ClientContext {
    settingsScope: {
      bind<Value>(spec: { namespace: string }): SettingsScope<Value>
    }
    slots: {
      inject(name: string, register: () => unknown): void
      register(options: Record<string, unknown>, component: unknown): unknown
    }
    locale: {
      register(namespace: string, dictionaries: Record<string, unknown>): () => void
    }
    effect(callback: () => (() => void) | void, label?: string): unknown
  }
}

declare module '@deepseek-ai/dsh-client-ui-primitives' {
  /** Shared props for every `ic_ds_*` glyph; colour rides `currentColor`. */
  export interface IconProps {
    size?: number | undefined
    className?: string | undefined
  }

  /** `ic_ds_chevron_down_outline_14`, the disclosure affordance DSH's own cards use. */
  export const IconChevronDownOutline14: (props: IconProps) => unknown
}
