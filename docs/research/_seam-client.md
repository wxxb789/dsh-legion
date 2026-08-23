# Seam Audit — DeepSeek Harness Client/Web Plane

Read-only audit of `Q:\repos\deepseek-harness` at **v0.1.1-rc.2**. Nothing was modified.
All `file:line` citations are relative to the harness root. Signatures are verbatim copies from source.

---

## 1. The slot registry API (`ctx.slots`)

### 1.1 Layering

| Layer | Package | Owns |
|---|---|---|
| Pure core | `@deepseek-ai/dsh-client-ui-slots` | `SlotMap`, registration semantics, declaration ledger, load-time validation, unload cascade. Zero runtime deps (React *types* only). |
| Cordis service | `@deepseek-ai/dsh-client-runtime` | `ctx.slots`, `slots/changed` event bridge, `ctx.effect` disposal, renderer/locale install, store-instance lifecycle. |

The runtime does **not** restate the type — it reuses the core's overloads verbatim:

```ts
  declare readonly register: SlotCore['register']
```
— packages/client/runtime/src/client/slots.ts:126

The doc comment there is load-bearing (packages/client/runtime/src/client/slots.ts:109-125): it MUST stay a prototype method, never an instance arrow, because the cordis service proxy rebinds `this.ctx` to the **caller's** context at call time. That rebinding routes the `ctx.effect` (and the unload cascade) into the calling plugin's fiber.

### 1.2 Full `register()` signature

Two overloads, differing only in the `inject` share (deliberately not folded, so `I` infers per-overload).

**Overload A — no inject** (packages/client/ui-slots/src/index.ts:741-757):

```ts
  register<
    K extends keyof SlotMap & string,
    const EntryKey extends EntryKeyOf<K> = EntryKeyOf<K>,
    const D extends ChildrenDecl = Record<never, never>,
    H extends StoreDecl | undefined = undefined,
    M = never,
    N extends (keyof LocaleNamespaceMap & string) | undefined = undefined,
    C extends SlotComponent<never> = SlotComponent<never>,
  >(
    options: BaseOptions<K, EntryKey, D, H, M, N> & { inject?: undefined },
    component: C
      & SlotComponent<ComposedProps<
        K, NoInfer<EntryKey>, keyof NoInfer<D> & keyof SlotMap & string,
        HandleOf<NoInfer<H>>, object, NoInfer<M>, NoInfer<N>
      >>
      & RendersCheck<C, D>,
  ): () => void
```

**Overload B — with inject** (packages/client/ui-slots/src/index.ts:768-785):

```ts
  register<
    K extends keyof SlotMap & string,
    I extends object,
    const EntryKey extends EntryKeyOf<K> = EntryKeyOf<K>,
    const D extends ChildrenDecl = Record<never, never>,
    H extends StoreDecl | undefined = undefined,
    M = never,
    N extends (keyof LocaleNamespaceMap & string) | undefined = undefined,
    C extends SlotComponent<never> = SlotComponent<never>,
  >(
    options: BaseOptions<K, EntryKey, D, H, M, N> & { inject: (...args: InjectParams<K, H>) => I },
    component: C
      & SlotComponent<ComposedProps<
        K, NoInfer<EntryKey>, keyof NoInfer<D> & keyof SlotMap & string,
        HandleOf<NoInfer<H>>, I, NoInfer<M>, NoInfer<N>
      >>
      & RendersCheck<C, D>,
  ): () => void
```

**Options shape** (packages/client/ui-slots/src/index.ts:527-550):

```ts
type BaseOptions<
  K extends keyof SlotMap & string,
  EntryKey extends EntryKeyOf<K>,
  D extends ChildrenDecl,
  H,
  M = never,
  N = undefined,
> = {
  /** Target slot key (the entry contributes INTO this slot). */
  name: K
  /** Child-slot declaration + render authorization + runtime spec, in one table. */
  children?: D
  /** Store seat: a shared handle (apply-constructed) or an exclusive factory (framework-called per entry x scope). */
  store?: H
  locale?: N
  /** Registrant identity label for diagnostics (the runtime Service wrapper stamps the caller's fiber name). */
  registrant?: string
} & KindOptions<K, EntryKey, M>
```

**Kind-specific option fields** (packages/client/ui-slots/src/index.ts:480-509) — `KindOptions` switches on `SlotMap[K]['kind']`:

- `keyed` → `{ key: EntryKey; priority?: number }`
- `list` → `{ id: string; order?: number; label?: SlotLabel; priority?: number }`
- `chain` → `{ select: ChainSelect<...>; priority?: number }`
- `single` → `{ priority?: number }`

**Load-time validation** (packages/client/ui-slots/src/index.ts:787-843, doc at :706-737) — misconfiguration fails loud; the render hot path re-checks nothing:

- registering into an undeclared slot throws (:789-791);
- declaring an already-declared child key throws, naming the first declarer (:825-832);
- one shared store handle under slots of different scopes throws — "one handle, one scope" (:835-843);
- `keyed` without `key`, `list` without `id`, `chain` without `select` each throw (:805-823).

**Shadowing.** For `single`/`keyed`/`list`, entries sharing a cell coexist at *distinct* priorities, sorted ascending, ties keeping registration order; the cell's lowest **live** entry renders. A second registration at an occupied cell's exact priority (default `0`) throws, naming the occupant — so priority-less composition keeps the historical one-occupant-per-cell fail-loud (:717-724).

**Lifecycle.** The returned disposer removes the contribution **and collapses every child slot it declared**, recursively; child entries clear and their stale disposers become no-ops. One lifecycle axis, no dangling state (:726-728, impl `releaseEntry` :1129-1149).

### 1.3 The `SlotMap` declaration-merging pattern

```ts
/** Slot contract table. Owners extend via declaration merging; entries are {@link SlotEntryDef}. */
export interface SlotMap {}
```
— packages/client/ui-slots/src/index.ts:24

`SlotMap` and the standard-kit interfaces are declared **directly in the entry module** on purpose: consumer `declare module` augmentation merges with declarations lexically in the augmented module, **not with re-exports** (module doc, packages/client/ui-slots/src/index.ts:7-9).

One entry (packages/client/ui-slots/src/index.ts:100-122):

```ts
export interface SlotEntryDef {
  kind: SlotKind
  scope: SlotScope
  owner?: object
  keyProps?: Record<string, object>
  hookContext?: unknown
  inject?: object
}
```

Axes (packages/client/ui-slots/src/index.ts:88, :91):

```ts
export type SlotKind = 'single' | 'list' | 'keyed' | 'chain'
export type SlotScope = 'root' | 'session-maybe' | 'session'
```

Canonical augmentation form — the shipped `root` row (packages/client/runtime/src/client/slots.ts:25-43):

```ts
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'root': { kind: 'single'; scope: 'root'; owner: RootOwnerProps }
  }
}
```

Note the source's own warning at packages/client/runtime/src/client/slots.ts:33-40: **do not register into `root`**. It is a `single` slot, so a second entry shadows rather than joins; a dynamically registered entry gets a *lower* priority than the shipped one, making it the winner and erasing every seat `AppFrame` declares. Use `shell.overlay` for a frame-wide surface.

Sibling merge tables in the same module: `LocaleNamespaceMap` (:34), `SessionStandardProps` (:184), `SessionMaybeStandardProps` (:191), `GlobalStandardProps` (:198) — the latter three are declared **empty** at this zero-dependency layer and merged with real members by the runtime package.

### 1.4 `ComposedProps`

The component props contract — a five-share intersection, each share from its single source of truth (packages/client/ui-slots/src/index.ts:442-450):

```ts
export type ComposedProps<
  K extends keyof SlotMap & string,
  EntryKey extends EntryKeyOf<K>,
  S extends keyof SlotMap & string,
  H,
  I extends object,
  M = never,
  N = undefined,
> = PropsRuntime<K, EntryKey> & PropsRenderSlots<S> & PropsStore<H> & InjectFace<I> & MatchedShare<SlotMap[K], M> & PropsLocale<N>
```

Shares:

- `PropsRuntime<K, EntryKey>` (:211-221) — owner share + keyed key-props + slot inject face + scope standard kit (`SessionStandardProps` / `SessionMaybeStandardProps` / nothing) + `GlobalStandardProps`.
- `PropsRenderSlots<S>` (:336-363) — `renderSlot` narrowed to declared children; `renderSlotChain` when chain keys exist; `SessionProvider` when any declared child is `session`-scoped. Carries the phantom variance anchor `readonly __renders?: ((key: S) => void) | undefined` (:346) — generic method signatures compare loosely across differing key unions, so this contravariant marker is what actually enforces "component key set ⊆ children declaration" at the register call site.
- `PropsStore<H>` (packages/client/ui-slots/src/store.ts:123-125) — `{ useStore: SnapshotSelectorHook<T>; actions: BakedActions<T, A> }`. Components never see the instance: reads via `useStore`, writes only via declared actions.
- `InjectFace<I>` (:431-432) — the registrant's business face; a reserved `hooks` compartment arrives as bound `use<Name>` selector hooks, everything else passes through verbatim.
- `MatchedShare` (:302-303) — `{ matched: M }` on chain entries only.
- `PropsLocale<N>` (:80-85) — the `t` seat, present exactly when the registration declares `locale:`.

Registration-position component shape is the **bare call signature** (:370), not `FC`, so composed constraints check through clean parameter contravariance:

```ts
export type SlotComponent<P> = (props: P) => ReactNode
```

`RendersCheck<C, D>` (:518-524) enforces *declaring is claiming*: an entry that declares children MUST consume `renderSlot` (or `renderSlotChain` when all children are chains), else the constraint resolves to an unsatisfiable member naming the offending keys.

### 1.5 Store seats

```ts
export interface StoreSpec<T, A extends ActionsDecl<T>> {
  init: () => T
  persist?: string
  actions: A
}
```
— packages/client/ui-slots/src/store.ts:44-48

```ts
export interface StoreHandle<T, A extends ActionsDecl<T>> {
  readonly spec: StoreSpec<T, A>
  create(scopeKey?: string): StoreInstance<T, A>
}
```
— packages/client/ui-slots/src/store.ts:82-92

```ts
export type StoreFactory = () => StoreHandle<any, any>
export type StoreDecl = StoreHandle<any, any> | StoreFactory
export type DefineStore = <T, A extends ActionsDecl<T>>(spec: StoreSpec<T, A>) => StoreHandle<T, A>
```
— packages/client/ui-slots/src/store.ts:102, :106, :132

Actions are pure immer-draft transforms and constitute the store's **complete write set** — the audit face (:19-28). `BakedActions` (:35-37) strips the draft parameter; that baked set is what components and inject factories receive.

Two registration forms:

- **Shared handle** — constructed in `apply` world, shared across one plugin's registrations. Pinned to one scope on first mount; cross-scope reuse throws. Never export a handle at module level — module-cache identity is a disguised singleton across plugin reloads (store.ts:78-81).
- **Exclusive factory** — pass the factory itself; the framework mints a per-entry handle and instantiates per entry × scope (runtime/src/client/slots.ts:114-116).

Instance lifecycle lives in the runtime, on the entry axis: handle → `{ scope, refs, instances }` (runtime/src/client/slots.ts:57-65), dropped with the last holding entry. Session instances are cleared with their persisted state on scope death:

```ts
  pruneStoreScope(sessionId: string): void
```
— packages/client/runtime/src/client/slots.ts:272

### 1.6 Chain slots

```ts
export type ChainSelect<O extends object, M> = (owner: O) => M | null
```
— packages/client/ui-slots/src/index.ts:257

Semantics (doc :246-256): selectors run at render time in chain order — ascending `priority`, default `0`, lower tries first, ties keep registration = assembly order. The first non-null return **elects** its entry and becomes the component's `matched` prop; `null` passes to the next; all-null falls to the owner's fallback. The selector **MUST be pure** — a function of the owner props only, no external mutable reads, no side effects. The decline decision lives in the selector, never in a mounted component probing its own props.

Dispatch options (packages/client/ui-slots/src/index.ts:233-244):

```ts
export interface ChainRenderOpts {
  fallback?: ReactNode
  overlay?: boolean
}
```

`overlay` keeps the fallback permanently mounted — an election hides it (wrapped, `display:none`) instead of unmounting, so fallback-held state (composer drafts, DOM state) survives a takeover. Chain kind only; sole consumer today is `conversation.composer`.

Chain dispatch is separate from `renderSlot` (packages/client/ui-slots/src/index.ts:357):

```ts
  renderSlotChain: <K extends ChainKeysOf<S>>(key: K, owner: OwnerOf<K>, opts?: ChainRenderOpts) => ReactNode
```

Crash semantics differ by kind (packages/client/ui-slots/src/index.ts:1082-1106): shadowing kinds abdicate — the entry retires from its cell one-shot so the next survivor renders. Chain crashes report with `abdicate: false`, because election alternatives resolve at select time. The registration stays on the ledger either way.

### 1.7 Other `ctx.slots` members

```ts
  inject(key: keyof SlotMap & string, callback: () => SlotInjectionEffect): () => void
```
— packages/client/runtime/src/client/slots.ts:143

Installs an effect for each **declaration lifetime** of a slot — the correct way to contribute into a seat whose declaring plugin may load later or reload. Runs synchronously if already declared; otherwise inside the declaring `register()` after commit. Collapse disposes; a later declaration runs it again. The controller belongs to the caller's fiber (packages/client/runtime/src/client/slots.ts:128-142).

```ts
  install(renderer: SlotRenderer): void
  installLocale(face: LocaleFace): void
  renderSlot<K extends keyof SlotMap & string>(key: K, owner: OwnerOf<K>): ReturnType<SlotRenderer['renderRoot']>
```
— packages/client/runtime/src/client/slots.ts:213, :230, :248

Both installs are boot-once (second call throws) and run through the caller's `ctx.effect`. `renderSlot` at ctx level renders **only `'root'`** — every other key renders inside components through the props face (:252-254).

Change propagation contract (packages/client/ui-slots/src/index.ts:668-676): versions bump and `onMutate` fires **synchronously** per mutation; `subscribeDeclaration` fires synchronously per declaration boundary; `subscribe` notifications are **microtask-batched**, so N same-tick mutations produce one notification per touched key. The runtime bridges `onMutate` to the cordis event `slots/changed` (packages/client/runtime/src/client/slots.ts:106).

---
## 2. Every declared slot id in the shell

Grepped `declare module '@deepseek-ai/dsh-client-ui-slots'` across `packages/client/**` (38 augmenting files) plus every `kind:`/`scope:` declaration. Tests and the `extensions/ui-cordis` demo are excluded below.

### 2.1 `shell.*` — exhaustive

**There is exactly ONE `shell.*` slot in the entire repository.**

| Slot id | Kind | Scope | Declared in |
|---|---|---|---|
| `shell.overlay` | `list` | `root` | packages/client/ui-layout/src/client/index.ts:83 (type) / :126 (runtime spec) |

A repo-wide grep for `shell.` returns only this slot; every other hit is the unrelated `shell` identifier of the conversation input controller (`shell.setDraft`, `shell.submit`, …) or prose. **No shipped package registers into `shell.overlay`** — a grep for `name: 'shell.overlay'` returns zero hits. It is a genuinely unowned extension seat.

Its contract, verbatim (packages/client/ui-layout/src/client/index.ts:73-83):

> Frame-wide floating layer, above every column and outside their scroll containers. Deliberately generic and unowned by any feature: a badge, a toast stack or a status pill all belong here, and entries order among themselves. The layer itself is click-through — entries opt back into pointer events — so an occupant never blocks the app underneath.
>
> This is the additive seat for a frame-wide surface of your own: a fresh `id` is added beside the shipped entries instead of replacing them.

### 2.2 Root & frame

| Slot id | Kind | Scope | Package | file:line |
|---|---|---|---|---|
| `root` | single | root | client/runtime | packages/client/runtime/src/client/slots.ts:41 |
| `sidebar` | single | root | client/ui-layout | packages/client/ui-layout/src/client/index.ts:49 |
| `conversation` | single | session-maybe | client/ui-layout | packages/client/ui-layout/src/client/index.ts:62 |
| `details` | single | session | client/ui-layout | packages/client/ui-layout/src/client/index.ts:72 |
| `shell.overlay` | list | root | client/ui-layout | packages/client/ui-layout/src/client/index.ts:83 |

### 2.3 Sidebar

| Slot id | Kind | Scope | Package | file:line |
|---|---|---|---|---|
| `sidebar.brand.mark` | single | root | client/ui-sidebar | packages/client/ui-sidebar/src/client/contract/slots.ts:23 |
| `sidebar.brand.name` | single | root | client/ui-sidebar | packages/client/ui-sidebar/src/client/contract/slots.ts:28 |
| `sidebar.workspaces` | single | root | client/ui-sidebar | packages/client/ui-sidebar/src/client/contract/slots.ts:35 |
| `sidebar.settings` | single | root | client/ui-sidebar | packages/client/ui-sidebar/src/client/contract/slots.ts:41 |
| `sidebar.footer.action` | list | root | client/ui-sidebar | packages/client/ui-sidebar/src/client/contract/slots.ts:46 |
| `sidebar.workspaces.directoryFlow` | single | root | client/ui-workspace | packages/client/ui-workspace/src/client/contract/slots.ts:59 |

Runtime specs mirrored at packages/client/ui-sidebar/src/client/index.ts:48-52.

### 2.4 Conversation

| Slot id | Kind | Scope | file:line (contract) |
|---|---|---|---|
| `conversation.session` | single | session | packages/client/ui-conversation/src/client/contract/slots.ts:71 |
| `conversation.session.header` | single | session | packages/client/ui-conversation/src/client/contract/slots.ts:79 |
| `conversation.session.header.lineage` | single | session | packages/client/ui-conversation/src/client/contract/slots.ts:85 |
| `conversation.session.header.actions` | list | session | packages/client/ui-conversation/src/client/contract/slots.ts:100 |
| `conversation.session.header.utilities` | list | session | packages/client/ui-conversation/src/client/contract/slots.ts:105 |
| `conversation.view` | list | session | packages/client/ui-conversation/src/client/contract/slots.ts:113 |
| `conversation.chat.node` | keyed | session | packages/client/ui-conversation/src/client/contract/slots.ts:115 |
| `conversation.message.images` | single | session | packages/client/ui-conversation/src/client/contract/slots.ts:124 |
| `conversation.chat.commandview` | keyed | session | packages/client/ui-conversation/src/client/contract/slots.ts:133 |
| `conversation.chat.turnTail` | **chain** | session | packages/client/ui-conversation/src/client/contract/slots.ts:140 |
| `conversation.chat.assistant-actions` | list | session | packages/client/ui-conversation/src/client/contract/slots.ts:148 |
| `conversation.details.tool` | single | session | packages/client/ui-conversation/src/client/contract/slots.ts:163 |
| `conversation.composer` | **chain** | session | packages/client/ui-conversation/src/client/contract/slots.ts:171 |
| `conversation.hero.workspace` | single | root | packages/client/ui-conversation/src/client/contract/slots.ts:178 |
| `conversation.hero.brand.mark` | single | root | packages/client/ui-conversation/src/client/contract/slots.ts:183 |
| `conversation.hero.agentPreset` | single | root | packages/client/ui-conversation/src/client/contract/slots.ts:189 |
| `conversation.input.dock` | list | session | packages/client/ui-conversation/src/client/contract/slots.ts:205 |
| `conversation.composer.dock` | list | session | packages/client/ui-conversation/src/client/contract/slots.ts:214 |
| `conversation.input.left` | list | session | packages/client/ui-conversation/src/client/contract/slots.ts:223 |
| `conversation.input.right` | list | session | packages/client/ui-conversation/src/client/contract/slots.ts:231 |
| `conversation.composer.bar` | single | session-maybe | packages/client/ui-conversation/src/client/contract/slots.ts:245 |
| `conversation.input.attachments` | single | session-maybe | packages/client/ui-conversation/src/client/contract/slots.ts:247 |
| `conversation.input.plan` | single | session | packages/client/ui-conversation/src/client/contract/slots.ts:261 |
| `conversation.input.model` | single | session | packages/client/ui-conversation/src/client/contract/slots.ts:271 |

Contributed by other packages into the conversation namespace:

| Slot id | Kind | Scope | Package | file:line |
|---|---|---|---|---|
| `conversation.input.overlay` | list | session | client/ui-input-trigger | packages/client/ui-input-trigger/src/client/slots.ts:24 |
| `conversation.hero.workspace.directoryFlow` | single | root | client/ui-workspace | packages/client/ui-workspace/src/client/contract/slots.ts:57 |

Runtime specs at packages/client/ui-conversation/src/client/apply.ts:200-211, :243, :262-264, :287-289, :387-388, :450 and packages/client/ui-conversation/src/client/chat/register-node-renderers.ts:45-46.

### 2.5 Settings

| Slot id | Kind | Scope | Package | file:line |
|---|---|---|---|---|
| `settings.trigger` | single | root | client/ui-settings | packages/client/ui-settings/src/client/contract/slots.ts:23 |
| `settings.header` | single | root | client/ui-settings | packages/client/ui-settings/src/client/contract/slots.ts:29 |
| `settings.action` | list | root | client/ui-settings | packages/client/ui-settings/src/client/contract/slots.ts:35 |
| `settings.close` | single | root | client/ui-settings | packages/client/ui-settings/src/client/contract/slots.ts:41 |
| `settings.section` | list | root | client/ui-settings | packages/client/ui-settings/src/client/contract/slots.ts:53 |
| `settings.plugins.tab` | list | root | client/ui-settings | packages/client/ui-settings/src/client/contract/slots.ts:62 |
| `settings.onboarding` | list | root | client/ui-settings | packages/client/ui-settings/src/client/contract/slots.ts:73 |
| `settings.general.item` | list | root | client/ui-settings | packages/client/ui-settings/src/client/contract/slots.ts:88 |
| `settings.plugin.item` | keyed | root | client/ui-settings-plugins | packages/client/ui-settings-plugins/src/client/slot-contract.ts:19 |

Runtime specs at packages/client/ui-settings-general/src/client/index.ts:144-149.

### 2.6 Tools

| Slot id | Kind | Scope | Package | file:line |
|---|---|---|---|---|
| `tool.call.toolview` | keyed | session | client/ui-tool | packages/client/ui-tool/src/client/contract/slots.ts:24 |

Runtime spec at packages/client/ui-tool/src/client/apply.ts:31.

### 2.7 Totals

**39 production slot ids.** Exactly **one** is `shell.*` (`shell.overlay`); exactly **two** are chain slots (`conversation.chat.turnTail`, `conversation.composer`).

Additive seats a third-party plugin can take without displacing shipped UI (list/keyed kinds): `shell.overlay`, `sidebar.footer.action`, `settings.section`, `settings.action`, `settings.onboarding`, `settings.general.item`, `settings.plugins.tab`, `settings.plugin.item`, `conversation.view`, `conversation.session.header.actions`, `conversation.session.header.utilities`, `conversation.input.{dock,left,right,overlay}`, `conversation.composer.dock`, `conversation.chat.{node,commandview,assistant-actions}`, `tool.call.toolview`.

---

## 3. Declaring a client bundle in `package.json`

### 3.1 `dsh.client` manifest shape

The validated declaration (packages/client/modules/src/index.ts:50-63):

```ts
/** package.json `dsh.client` declaration fields, validated one by one after reading the file. */
interface DshClientDeclaration {
  inject?: string[]
  platform: string
  /** Boot phase-one prefetch mark; absent means lazy (fetched on demand). */
  immediately?: boolean
  external?: string[]
}
```

Validation (packages/client/modules/src/index.ts:126-146) — every failure is a loud throw:

- `dsh.client` present but not an object → "has a non-object dsh.client declaration" (:128-130)
- `platform` not a string → "dsh.client.platform must be a string" (:132-134)
- `inject` / `external` not string arrays → via `optionalStringArray` (:135-136)
- `immediately` not boolean → (:137-139)

### 3.2 `dsh.client.platform`

**`platform` is a hard filter, and the only accepted value on this plane is the literal `'web'`** (packages/client/modules/src/index.ts:447-450):

```ts
    if (decl === undefined || decl.platform !== 'web') {
      this.pkgMeta.set(pkgName, null)
      return null
    }
```

A non-`web` platform is cached as a **permanent negative verdict** — the package is silently not a client row. Immediately after the filter passes, a missing `./client` export *is* loud (packages/client/modules/src/index.ts:451-454):

```ts
    const clientRel = clientExportOf(pkgName, pkg.exports)
    if (clientRel === undefined) {
      throw new Error(`client-modules: ${pkgName} declares dsh.client but exports no "./client" bundle`)
    }
```

`exports["./client"]` accepts the string form or a one-level conditional object with a string `default` (packages/client/modules/src/index.ts:149-159).

Complete working manifest (packages/client/ui-layout/package.json, the shipped shape):

```json
{
  "name": "@deepseek-ai/dsh-client-ui-layout",
  "type": "module",
  "exports": {
    ".":          { "types": "./lib/types/index.d.ts",        "default": "./lib/index.js" },
    "./client":   { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./package.json": "./package.json"
  },
  "dsh": {
    "client": {
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-theme"
      ],
      "platform": "web"
    }
  },
  "scripts": { "bundle": "tsdown", "watch": "tsdown --watch" }
}
```

Field semantics, from the wire type (packages/client/modules/src/client/manifest.ts:51-64):

- **`inject`** — package-name dependency edges, **informational only** (preflight display / HMR diffing). The authoritative activation edges live in each package's `dsh.client` declaration and reach fibers through entry creation.
- **`external`** — real module-graph edges. Unlike `inject`, these *constrain code arrival*, because `require` is synchronous. A requested package row must precede its consumers. A type-only import is **not** a request (the transform erases it before resolution).
- **`immediately`** — stage-one prefetch mark; absent means lazy.

Ordering is enforced by `orderByModuleGraph` (packages/client/modules/src/index.ts:188-220), which throws on a cycle ("a requested package row must precede its consumers, and factory-form CJS cannot deliver partial exports") and on a row declaring its own package in `external`. Note `stripClientSuffix` (manifest.ts:136-138): `<pkg>/client` and the bare package name resolve to the same exports.

### 3.3 `dsh.bundle.patch` — a different axis

**`dsh.bundle.patch` is unrelated to `dsh.client`.** It is host-side *profile composition*, not browser bundling: it declares a package as a **profile bundle** — one patch layer over the profile's entry list.

Consumed at packages/boot/app-boot/src/profile.ts:388-397:

```ts
  const layers = bundles.map((packageName): ProfileLayer => {
    const packageDir = resolveBundleDir(binName, packageName, installAnchor, dir)
    const bundleManifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as ProfileManifest
    const declared = bundleManifest.dsh?.bundle?.patch
    if (declared === undefined) {
      throw new Error(`${binName}: profile bundle ${JSON.stringify(packageName)} declares no dsh.bundle in its package.json`)
    }
    const patchPath = join(packageDir, declared)
    return { packageName, packageDir, patchPath, patches: loadOverlayPatches(binName, patchPath) }
  })
```

Listed in a profile's `dsh.profile.bundles` (profile.ts:387); a listed bundle **without** a `dsh.bundle` manifest fails loud — naming a bundle-less package as a layer is a misconfiguration, not "no patches" (profile.ts:357-361).

Shipped shape (packages/bundle/base/package.json):

```json
{
  "name": "@deepseek-ai/dsh-base",
  "exports": { "./cordis.patch.yml": "./cordis.patch.yml" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "files": ["cordis.patch.yml", "..."]
}
```

A third-party plugin shipping UI needs `dsh.client` only. It needs `dsh.bundle.patch` **only** if it also ships a reusable profile layer that mounts plugin rows.

### 3.4 Node-half scan/loader contract

**Scan** (`ClientModuleRegistry`, packages/client/modules/src/index.ts:282):

```ts
export class ClientModuleRegistry extends Service {
  static inject = ['webServer', 'loader']
```
— packages/client/modules/src/index.ts:282-283

Incremental **per package — there is no full-rescan code path** (module doc :11-20). Every cordis `internal/plugin` emission marks the fiber's entry name dirty; a microtask flush reconciles each dirty name against live loader entries (:316-326). The activation pass seeds the same dirty set with all current entries and flushes **synchronously**, so first scan and steady state share one implementation (:330-337).

Caching is aggressive and permanent: package metadata — **including the negative "not a client package" verdict** — is cached per name and never expires. Plugin-set changes take effect **on restart**; bundle content changes reach the graph only through `rebuilt()` (:16-20, :429-431, :438-439).

Error policy is split (:501-527): the activation pass aggregates failures into one loud `ClientPackageCompositionError` throw (FAILED fiber); in steady state one broken package must not poison the others, so failures warn while the last orderable graph stays served.

Public node-half API:

```ts
  graph(): WebBootGraph
  clientPath(id: string): string | undefined
  rebuilt(id: string): string | undefined
  onRebuilt(listener: (id: string, rev: string) => void): () => void
  onGraphChanged(listener: () => void): () => void
```
— packages/client/modules/src/index.ts:352, :361, :371, :396, :407

```ts
export function orderByModuleGraph(entries: readonly WebBootEntry[]): WebBootEntry[]
export function bootInjections(graph: WebBootGraph): IndexInjection[]
export function stripClientSuffix(spec: string): string
```
— packages/client/modules/src/index.ts:188, :241; packages/client/modules/src/client/manifest.ts:136

Bundles are served from `/plugins/<id>/client.js` (+ `.map`) with `cache-control: no-cache`; a registered-but-unreadable bundle returns a **loud 404** rather than an SPA-fallback HTML page (:529-565).

**Wire** (packages/client/modules/src/client/manifest.ts:51-76):

```ts
export interface WebBootEntry {
  /** Entry name == package name. */
  id: string
  /** Bundle endpoint, '/plugins/<id>/client.js?rev=<rev>'. */
  url: string
  /** Bundle content hash (cache-busting consistency anchor). */
  rev: string
  inject?: string[]
  immediately?: boolean
  external?: string[]
}

export interface WebBootGraph {
  rev: string
  entries: WebBootEntry[]
}
```

`rev` is a sha1 content hash shortened to 12 hex chars (packages/client/modules/src/index.ts:162-164).

**Browser loader contract** (packages/client/modules/src/client/manifest.ts:257-292):

```ts
export interface ClientModuleLoader {
  /** Discriminant against Node's internal loader shapes ('v1'/'v2'). */
  version: 'client'
  manifest: BootManifest
  loadCache: Map<string, ClientModuleRecord>
  import(specifier: string, parentURL: string, attrs: Record<string, unknown>): Promise<unknown>
  prefetch(id: string): Promise<void>
  invalidate(id: string): void
}
```

Mounted on `ctx.loader.internal` by the shell boot and provided as `ctx.modules` (manifest.ts:35-40, :252-256). The vendored cordis Loader's only call site is `EntryTree.import` → `internal.import`, which keeps entry governance (fiber lifecycle, inject waiting, update/refresh) entirely on the vendored side while this package owns **code arrival** (manifest.ts:3-7).

**Lazy-CJS model** (manifest.ts:9-24) — the key operational fact:

> Executing a plugin bundle only **REGISTERS** its factory (`window.__ModuleLoader__.load({id, factory})`); every module body side effect — **including CSS injection** — lives inside the factory closure and runs at materialization, not at script execution.

Resolution branch order for `import`: seed word → shell instance; memoized record → exports; graph row → register its dependency factories and own factory; registered factory → materialize; anything else → **throw** (the runtime mirror of the build-time bundle purity gate). The synchronous `require` handed to factories walks the same order minus the load branch.

```ts
export interface ClientBundleRegistration {
  id: string
  factory: (require: (spec: string) => unknown) => Record<string, unknown>
}
```
— packages/client/modules/src/client/manifest.ts:191-200

```ts
export interface DshWindow {
  __DSH_BOOT__?: unknown
  __ModuleLoader__?: ClientModuleLoaderTarget
}
```
— packages/client/modules/src/client/manifest.ts:233-238

```ts
export function parseBootManifest(wire: unknown): BootManifest
```
— packages/client/modules/src/client/manifest.ts:147

The two parser-preloaded bundles are fixed (packages/client/modules/src/index.ts:223-229):

```ts
const CLIENT_MODULES_ID = '@deepseek-ai/dsh-client-modules'
const CLIENT_RUNTIME_ID = '@deepseek-ai/dsh-client-runtime'
const PARSER_PRELOAD_IDS = [CLIENT_MODULES_ID, CLIENT_RUNTIME_ID] as const
```

---
## 4. Publication status of `packages/client/*`

Audited every `package.json` under `packages/client/` for a `private` field.

**Result: NO package under `packages/client/` sets `private` at all.** The field is absent from all 40 manifests, and every one carries `"publishConfig": { "access": "public" }`. All are published at `0.1.1-rc.2` and are legitimately dependable.

### 4.1 The five packages asked about

| Requested | Package name | `private` | Status |
|---|---|---|---|
| **slots** | `@deepseek-ai/dsh-client-ui-slots` | absent | ✅ Published — depend on it |
| **runtime** | `@deepseek-ai/dsh-client-runtime` | absent | ✅ Published — depend on it |
| **ui-primitives** | `@deepseek-ai/dsh-client-ui-primitives` | absent | ✅ Published — depend on it |
| **schema-form** | — | — | ❌ **DOES NOT EXIST** |
| **ui-renderer** | `@deepseek-ai/dsh-client-ui-renderer` | absent | ✅ Published — but see caveat |

**`schema-form` correction.** `packages/client/schema-form/` exists as a directory but contains **only `lib/` and `node_modules/`** — stale build residue. There is **no `package.json`, no `src/`, no `tests/`**, and a repo-wide grep for `dsh-client-schema-form` across every `package.json` returns **zero dependents**. The package was removed; the directory is uncleaned artifacts. **Do not depend on it.** (Identical situation for `packages/client/web-react/`.)

**`ui-renderer` caveat.** Published, but it is the *machinery* implementing `SlotRenderer` — installed exactly once at boot by the shell via `ctx.slots.install(createSlotRenderer())`, and `install()` is boot-once: a second call throws (packages/client/runtime/src/client/slots.ts:213-214). A third-party plugin should **not** import it; it consumes rendering through the `renderSlot` props face.

### 4.2 Full inventory (all `private` absent, all publishable)

`@deepseek-ai/dsh-client-` + `connection`, `hmr`, `locale`, `modules`, `runtime`, `web`, and `ui-`: `agent-preset`, `attachment`, `brand-official`, `commands`, `conversation`, `deliverables`, `directory-picker-browse`, `directory-picker-native`, `goal`, `input-trigger`, `jobs`, `layout`, `message-feedback`, `model-selection`, `permission-presets`, `plan`, `primitives`, `reference`, `renderer`, `settings`, `settings-general`, `settings-models`, `settings-plugin-inventory`, `settings-plugins`, `sidebar`, `skill`, `slots`, `subagent`, `theme`, `tool`, `trajectory`, `user-questions`, `workflow-run`, `workspace`.

### 4.3 Recommended dependency set for a third-party UI plugin

Follow `ui-layout`'s shipped pattern: runtime deps as `peerDependencies`, slot contracts as `devDependencies` (types only, erased by the transform, so **not** a `dsh.client.external` request).

```json
{
  "peerDependencies": {
    "@deepseek-ai/dsh-client-runtime": "^0.1.1-rc.2",
    "@deepseek-ai/cordis": "^0.1.1-rc.2",
    "react": "^18.2.0"
  },
  "devDependencies": {
    "@deepseek-ai/dsh-client-ui-slots": "^0.1.1-rc.2",
    "@deepseek-ai/dsh-client-ui-layout": "^0.1.1-rc.2",
    "@deepseek-ai/dsh-client-ui-primitives": "^0.1.1-rc.2",
    "@types/react": "~18.3.1"
  }
}
```

---

## 5. Minimal working plugin

A third-party plugin adding a click-through status pill to the frame-wide overlay layer.

**`package.json`**

```json
{
  "name": "acme-dsh-status-pill",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    ".":        { "types": "./lib/types/index.d.ts",        "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./package.json": "./package.json"
  },
  "dsh": {
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-ui-layout"]
    }
  },
  "peerDependencies": {
    "@deepseek-ai/dsh-client-runtime": "^0.1.1-rc.2",
    "@deepseek-ai/cordis": "^0.1.1-rc.2",
    "react": "^18.2.0"
  },
  "devDependencies": {
    "@deepseek-ai/dsh-client-ui-slots": "^0.1.1-rc.2",
    "@deepseek-ai/dsh-client-ui-layout": "^0.1.1-rc.2",
    "@types/react": "~18.3.1"
  },
  "files": ["lib/client.js", "lib/index.js", "lib/types/**/*.d.ts"]
}
```

**`src/client/index.tsx`** — the `./client` bundle entry

```tsx
import type { Context } from '@deepseek-ai/cordis'
// Type-only: erased by the transform, so NOT a dsh.client.external request.
import type { ComposedProps } from '@deepseek-ai/dsh-client-ui-slots'
// Pulls in ui-layout's SlotMap augmentation declaring 'shell.overlay'.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'

/** Required services — cordis fiber inject. */
export const inject = ['slots']

/**
 * Props compose from the single source of truth. 'shell.overlay' is
 * list/root with no owner share and no children, so only the global
 * standard kit lands here.
 */
type PillProps = ComposedProps<'shell.overlay', never, never, undefined, object>

function StatusPill(_props: PillProps) {
  // The overlay layer is click-through; opt back into pointer events.
  return (
    <div style={{ position: 'absolute', right: 16, bottom: 16, pointerEvents: 'auto' }}>
      acme: ok
    </div>
  )
}

export function apply(ctx: Context): void {
  // slots.inject() ties the contribution to shell.overlay's DECLARATION
  // lifetime, so it survives an ui-layout reload. Disposal rides this
  // plugin's fiber via the caller-bound ctx.effect.
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      {
        name: 'shell.overlay',
        id: 'acme.status-pill', // list kind REQUIRES id; duplicate id at the same priority throws
        order: 100,
        registrant: 'acme-dsh-status-pill',
      },
      StatusPill,
    ),
  )
}
```

Why this is the minimum:

- `platform: 'web'` and `exports["./client"]` are jointly mandatory — the scan drops the package silently without the former and throws on the latter (packages/client/modules/src/index.ts:447-454).
- `inject = ['slots']` makes cordis wait for the service; `dsh.client.inject` is informational graph metadata only (manifest.ts:58-59).
- `id` is required by the `list` kind (index.ts:490-496; runtime throw at index.ts:814).
- `slots.inject()` over a bare `register()` handles the declaration lifetime — collapse disposes, redeclaration re-runs (runtime/src/client/slots.ts:128-142).
- No `dsh.client.external` is needed: every import here is type-only and erased before resolution (packages/client/modules/src/index.ts:57-62).

### 5.1 Chain-slot variant

Taking over the composer requires a **pure** selector; declining happens in `select`, never inside a mounted component:

```tsx
import type { ComposedProps } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

interface Match { readonly reason: string }

type ComposerProps = ComposedProps<
  'conversation.composer', never, never, undefined, object, Match
> // -> props.matched: Match

export function apply(ctx: Context): void {
  ctx.slots.inject('conversation.composer', () =>
    ctx.slots.register(
      {
        name: 'conversation.composer',
        // MUST be pure: a function of owner props only. null passes on.
        select: owner => (shouldTakeOver(owner) ? { reason: 'acme' } : null),
        priority: -10, // ascending; lower tries FIRST
        registrant: 'acme-composer',
      },
      AcmeComposer,
    ),
  )
}
```

The elected entry receives the selector's non-null result as `props.matched` (index.ts:302-303). If every selector declines, the owner's `ChainRenderOpts.fallback` renders — and for `conversation.composer` the owner passes `overlay: true`, so the shipped composer is hidden rather than unmounted and its draft state survives the takeover (index.ts:236-243).

---

## 6. Traps worth carrying forward

1. **Never register into `root`.** Single slot; a dynamically registered entry wins by priority and erases every seat `AppFrame` declares. Use `shell.overlay` (runtime/src/client/slots.ts:33-40).
2. **Never register into `sidebar` / `conversation` / `details`** for the same reason — replacing the column takes its inner seats with it (ui-layout/src/client/index.ts:40-72).
3. **Never export a `StoreHandle` at module level** — module-cache identity is a disguised singleton across plugin reloads (store.ts:78-81).
4. **One handle, one scope** — reusing a shared handle under slots of different scopes throws at registration (index.ts:835-843).
5. **Declaring is claiming** — declaring children without consuming `renderSlot` is a compile error (`RendersCheck`, index.ts:518-524).
6. **Chain selectors must be pure.** No external mutable reads, no side effects (index.ts:253-256).
7. **Plugin-set changes need a restart.** The `dsh.client` scan caches per name — including negative verdicts — and never expires (modules/src/index.ts:16-20).
8. **CSS injection runs at materialization, not script execution** — the lazy-CJS factory model (manifest.ts:9-16).
9. **Type-only imports are not `external` requests**; only value imports beyond the baseline need declaring (modules/src/index.ts:57-62).
10. **`dsh.bundle.patch` ≠ `dsh.client`** — the former is host-side profile-layer composition (app-boot/src/profile.ts:388-397), irrelevant to shipping browser UI.
