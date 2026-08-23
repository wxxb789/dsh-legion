# DSH Seam Audit — HTTP Routes, Commands, storage.domain

Harness checkout: `Q:\repos\deepseek-harness` @ v0.1.1-rc.2. Read-only audit; nothing in the harness was modified.
All citations are paths relative to the harness root. All signatures are copied verbatim from source.

---

## TOPIC A — Plugin HTTP routes

### A.1 Service key

The service key is **`webServer`** (not `httpServer`). It is declared by module augmentation:

```ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: WebServer
  }
```
— `packages/host/webserver/src/index.ts:22`

The class is a Cordis `Service` registered under that exact name:

```ts
export class WebServer extends Service {
```
— `packages/host/webserver/src/index.ts:73`

```ts
  constructor(ctx: Context, private config: Config) {
    super(ctx, 'webServer')
  }
```
— `packages/host/webserver/src/index.ts:88-90`

The package doc states the scope precisely: *"a node:http server plus the `webServer` service (HTTP and upgrade route registries, the structured index injection table with raw transform taps behind it, and the single fallback seat for everything no route claims)"* — `packages/host/webserver/src/index.ts:2-6`. It serves no files itself; the frontend plugin owns dist serving via the fallback hook.

### A.2 Route vocabulary

```ts
/** Route match kind: 'exact' matches the pathname verbatim; 'prefix' p matches p and p/<anything>. */
export type WebRouteKind = 'exact' | 'prefix'
```
— `packages/host/webserver/src/index.ts:38-39`

```ts
/** One named route registration. */
export interface WebRoute {
  kind: WebRouteKind
  /** Absolute pathname, no trailing slash. */
  path: string
  /** Owns the full response lifecycle (may hold the response open, e.g. SSE). */
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}
```
— `packages/host/webserver/src/index.ts:41-48`

```ts
/** One exact-path HTTP upgrade registration. */
export interface WebUpgradeRoute {
  /** Absolute pathname, no trailing slash. */
  path: string
  /** Owns protocol negotiation and the upgraded socket after dispatch. */
  handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>
}
```
— `packages/host/webserver/src/index.ts:50-56`

```ts
/** Gateway config: the listen address. */
export interface Config {
  /** Listen host; the two supported values are loopback and all-interfaces. */
  host: '127.0.0.1' | '0.0.0.0'
  /** Listen port; zero requests an OS-assigned port. */
  port: number
}
```
— `packages/host/webserver/src/index.ts:58-64`

### A.3 Full `WebServer` public interface (verbatim)

| Member | Citation |
|---|---|
| `get port(): number` | `packages/host/webserver/src/index.ts:93` |
| `get host(): Config['host']` | `packages/host/webserver/src/index.ts:98` |
| `register(route: WebRoute): () => void` | `packages/host/webserver/src/index.ts:108` |
| `registerUpgrade(route: WebUpgradeRoute): () => void` | `packages/host/webserver/src/index.ts:123` |
| `registerFallback(handler: WebRoute['handler']): () => void` | `packages/host/webserver/src/index.ts:139` |
| `tapIndex(transform: (html: string) => string): () => void` | `packages/host/webserver/src/index.ts:154` |
| `applyIndexTaps(html: string): string` | `packages/host/webserver/src/index.ts:274` |
| `collectIndexInjections(): IndexInjection[]` | `packages/host/webserver/src/index.ts:286` |
| `renderIndex(html: string): string` | `packages/host/webserver/src/index.ts:298` |
| `static Config: z<Config>` | `packages/host/webserver/src/index.ts:74` |

**Route registration.** Duplicate `(kind, path)` throws — collisions are treated as composition misconfiguration, not last-writer-wins:

```ts
  register(route: WebRoute): () => void {
    const table = route.kind === 'exact' ? this.exact : this.prefixes
    if (table.has(route.path)) {
      throw new Error(\`webserver: duplicate \${route.kind} route "\${route.path}"\`)
    }
    table.set(route.path, route)
    return () => { table.delete(route.path) }
  }
```
— `packages/host/webserver/src/index.ts:108-115`

**Upgrade routes.** Exact-path only (no prefix table); duplicates throw because one socket has one protocol owner:

```ts
  registerUpgrade(route: WebUpgradeRoute): () => void {
    if (this.upgrades.has(route.path)) {
      throw new Error(\`webserver: duplicate upgrade route "\${route.path}"\`)
    }
    this.upgrades.set(route.path, route)
    return () => { this.upgrades.delete(route.path) }
  }
```
— `packages/host/webserver/src/index.ts:123-129`

**Static fallback.** Single seat, second registration throws:

```ts
  registerFallback(handler: WebRoute['handler']): () => void {
    if (this.fallback !== undefined) {
      throw new Error('webserver: fallback already registered')
    }
    this.fallback = handler
    return () => { this.fallback = undefined }
  }
```
— `packages/host/webserver/src/index.ts:139-145`

The shipped owner of that seat is the frontend plugin — `ctx.webServer.registerFallback(async (req, res) => {` at `packages/host/frontend-static/src/index.ts:109`. A third-party plugin must **not** take it.

**Index transform taps.** Two layers. The structured table is preferred; `tapIndex` is the raw escape hatch and runs *after* row rendering:

```ts
  tapIndex(transform: (html: string) => string): () => void {
    this.indexTaps.push(transform)
    return () => {
      const at = this.indexTaps.indexOf(transform)
      if (at !== -1) this.indexTaps.splice(at, 1)
    }
  }
```
— `packages/host/webserver/src/index.ts:154-160`

```ts
  renderIndex(html: string): string {
    return this.applyIndexTaps(renderIndexInjections(html, this.collectIndexInjections()))
  }
```
— `packages/host/webserver/src/index.ts:298-300`

The structured table is collected by one `emit` per render, so rows are read fresh each time:

```ts
  collectIndexInjections(): IndexInjection[] {
    const table: IndexInjection[] = []
    this.ctx.emit('webserver/index-inject', table)
    return table
  }
```
— `packages/host/webserver/src/index.ts:286-290`

Event declaration:

```ts
    'webserver/index-inject'(table: IndexInjection[]): void
```
— `packages/host/webserver/src/index.ts:34`

Row union:

```ts
/** One structured index injection row. */
export type IndexInjection =
  /** Assign a JSON-serializable value to a \`globalThis\` property, ahead of later script rows. */
  | { kind: 'global'; name: string; value: unknown }
  /** Inline classic script. \`text\` must not contain \`</script\`, which would close the element early. */
  | { kind: 'script'; placement: IndexInjectionPlacement; text: string }
  /**
   * External classic script, executed in table order: a parser-blocking tag
   * when served, an awaited fetch-and-execute in the worker form (whose
   * loader resolves worker-only URLs such as \`/plugins/...\`).
   */
  | { kind: 'script-src'; placement: IndexInjectionPlacement; src: string }
  /** A \`<style>\` element in the head. \`text\` must not contain \`</style\`, which would close the element early. */
  | { kind: 'style'; text: string }
  /** Raw markup fragment. */
  | { kind: 'html'; placement: IndexInjectionPlacement; html: string }
```
— `packages/host/webserver/src/injections.ts:14-29`

```ts
export type IndexInjectionPlacement = 'head' | 'body'
```
— `packages/host/webserver/src/injections.ts:12`

```ts
export function renderIndexInjections(html: string, rows: readonly IndexInjection[]): string {
```
— `packages/host/webserver/src/injections.ts:82`

### A.4 Matching and dispatch semantics

- Exact table is consulted first; the prefix table then resolves **longest-prefix-wins**:
  `private match(pathname: string): WebRoute | undefined` — `packages/host/webserver/src/index.ts:257`; the length comparison is `if (best === undefined || prefix.length > best.path.length) best = route` — `packages/host/webserver/src/index.ts:263`.
- A prefix `p` matches `p` and `p/<anything>` only — `pathname !== prefix && !pathname.startsWith(\`\${prefix}/\`)` — `packages/host/webserver/src/index.ts:262`. So prefix `/plugins` does **not** match `/pluginsfoo`.
- No method routing: the registry keys on pathname only. Handlers gate on `req.method` themselves — see the 405 gate at `packages/client/hmr/src/index.ts:172-176`.
- Unmatched + no fallback ⇒ 404 (`packages/host/webserver/src/index.ts:174-177`). A rejecting handler is contained: logged, then 400 (or `res.destroy()` if headers were already sent) — `packages/host/webserver/src/index.ts:186-194`.
- Registration order is irrelevant to dispatch (`packages/host/webserver/src/index.ts:68-70`).

### A.5 ⚠️ `/plugins` is already claimed

`/plugins` is registered as a **prefix** route by the client-modules bundle server:

```ts
      () => ctx.webServer.register({ kind: 'prefix', path: '/plugins', handler: this.serveBundle }),
```
— `packages/client/modules/src/index.ts:340`

Because duplicate `(kind, path)` throws, a plugin **cannot** register prefix `/plugins`. It *can* register **exact** `/plugins/mine/state`, since exact and prefix live in separate tables (`packages/host/webserver/src/index.ts:79-80`) and the exact table is consulted first (`packages/host/webserver/src/index.ts:258`). That shadows the bundle server for that one pathname. **Recommendation:** use a distinct namespace such as `/x-mine/state` unless you deliberately intend to shadow a bundle path.

Other existing route owners for reference: `packages/client/connection/src/index.ts:173` (`/api`), `:181` (upgrade), `packages/client/hmr/src/index.ts:166` (SSE), `packages/client/connection/src/rpc-host.ts:112`.

### A.6 Minimal plugin: GET /plugins/mine/state → JSON

```ts
// src/index.ts of a third-party DSH plugin
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

export const name = 'my-plugin'
export const inject = ['webServer']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/plugins/mine/state',
    handler: (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405)
        res.end()
        return
      }
      const body = JSON.stringify({ ok: true, port: ctx.webServer.port })
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(req.method === 'HEAD' ? undefined : body)
    },
  }), 'my-plugin: /plugins/mine/state')
}
```

The `ctx.effect(...)` wrapper is the established idiom — every in-tree consumer registers this way so the disposer unregisters the route on unmount (`packages/client/connection/src/index.ts:173`, `packages/client/modules/src/index.ts:339-342`).

### A.7 Is Typert Remote the preferred alternative?

**Yes, for anything a first-party client surface consumes.** Evidence:

- apiproxy explicitly registers no routes: *"Transport-agnostic by design: this package registers no routes — physical carriers wrap `ctx.apiProxy` themselves."* — `packages/host/apiproxy/src/index.ts:7-8`. It provides `apiProxy: ApiProxy` on `Context` (`packages/host/apiproxy/src/index.ts:33-38`) via `export class ApiProxyService extends Service implements ApiProxy` (`:69`).
- The gateway does live method dispatch over Cordis Services: *"Live Typert Remote dispatch over Cordis Services and registered providers. Transport, request correlation, and response envelopes belong to Connection."* — `packages/api/gateway/src/index.ts:2-3`.
- The seam a plugin implements:
  ```ts
  export abstract class TypertRemoteService<out T = never> extends Service<T> {
  ```
  — `packages/typert/protocol/src/index.ts:147`
  ```ts
    protected constructor(ctx: Context, serviceKey: string, options: TypertGatewayBindingOptions = {}) {
  ```
  — `packages/typert/protocol/src/index.ts:157`
  ```ts
  export function Remote<This extends object, Args extends unknown[], Result>(
    _method: (this: This, ...args: Args) => Result,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
  ): void
  export function Remote(exportName: string): RemoteMethodDecorator
  ```
  — `packages/typert/protocol/src/index.ts:168-177`
  ```ts
  export function bindTypertRemote<Service extends object>(
    service: Service,
    serviceKey: string,
    options: TypertGatewayBindingOptions = {},
  ): TypertGatewayBinding<Service> {
  ```
  — `packages/typert/protocol/src/index.ts:135-139`
  ```ts
  export function RemoteScope(
    key: Extract<keyof TypertContextMap, string>,
    exportName?: string,
  ): RemoteMethodDecorator {
  ```
  — `packages/typert/protocol/src/index.ts:204-207`

`CommandRuntime` is itself a worked example: `export class CommandRuntime extends TypertRemoteService` (`packages/interaction/commands/src/index.ts:250`) with `@Remote` on `list` (`:284`) and `execute` (`:328`).

**Decision rule.** Typed method calls consumed by a DSH client plugin over the existing `/api` carrier ⇒ `TypertRemoteService` + `@Remote`; you get correlation, cancellation, and codec handling for free and register no route. Raw HTTP semantics that are *not* a method call — SSE streams, webhooks from third parties, file/blob downloads, non-DSH clients — ⇒ `ctx.webServer.register`. Note that even in-tree, the SSE case chose a raw route (`packages/client/hmr/src/index.ts:166`).

---

## TOPIC B — Commands

### B.1 Service key and injection

```ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    commands: CommandRuntime
  }
}
```
— `packages/interaction/commands/src/index.ts:104-108`

```ts
export const name = 'commands'
```
— `packages/interaction/commands/src/index.ts:26`

```ts
export class CommandRuntime extends TypertRemoteService {
```
— `packages/interaction/commands/src/index.ts:250`

```ts
  constructor(ctx: Context) {
    super(ctx, 'commands')
  }
```
— `packages/interaction/commands/src/index.ts:261-263`

The declarative form is the module-level `inject` array, which is what `command-goal` uses:

```ts
export const inject = ['commands', 'goals']
```
— `packages/goal/command-goal/src/index.ts:13`

`ctx.inject([...], cb)` is the callback form, used when activation must wait on dynamically computed keys — e.g. `const fiber = ctx.inject(backendServices, (domainCtx) => {` at `packages/storage/storage-domain/src/index.ts:206`.

### B.2 Registration signature

```ts
  register(definition: CommandDefinition): () => void {
    const registered = normalizeDefinition(definition)
    return this.layers.effect(
      this.ctx,
      layer => layer.commands.insert(registered.definition.name, registered),
      { label: 'commands.register()' },
    )
  }
```
— `packages/interaction/commands/src/index.ts:270-277`

The returned value is documented as *"the exact effect disposer that unregisters this definition"* (`:269`). Because `register` already routes through `this.layers.effect(this.ctx, ...)`, it is **already an effect bound to the calling context** — unlike `webServer.register`, you do **not** wrap it in `ctx.effect` (and `command-goal` does not).

### B.3 The Command interfaces

```ts
/** Plugin-owned command registration. */
export interface CommandDefinition {
  /** Lowercase command name without the leading slash. */
  readonly name: string
  /** Human-readable summary used in discovery UI. */
  readonly description: string
  /** Optional free-form input hint advertised to capable clients. */
  readonly input?: CommandInputDescriptor
  /**
   * Whether \`command/run\` records \`rawInput\`. Defaults to true. A command
   * whose domain event owns the payload sets this false to avoid duplicating
   * that payload in the session log.
   */
  readonly recordInput?: boolean
  /** Execute against the receiving agent without sending the command to the model. */
  readonly handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>
}
```
— `packages/interaction/commands/src/index.ts:53-69`

```ts
/** Invocation passed to one registered command handler. */
export interface CommandInvocation {
  /** Pairing id already written to this invocation's \`command/run\` event. */
  readonly commandId: CommandId
  /** Exact agent whose UI received the command. */
  readonly agent: Agent
  /** Exact text following the registered command name, including separator whitespace. */
  readonly rawInput: string
  /**
   * Durably admitted image blocks accompanying this invocation, in submission
   * order; empty unless the definition declares \`input.images\`. The handler
   * owns their model-visible use — the registry never schedules them itself —
   * and a handler whose grammar cannot use them in this invocation returns an
   * error so the dispatching composer retains the originals.
   */
  readonly attachments: readonly ImageBlock[]
  /** Cancellation signal owned by the dispatching UI request. */
  readonly signal: AbortSignal
}
```
— `packages/interaction/commands/src/index.ts:33-51`

```ts
/** Expected command outcome rendered directly by the dispatching UI. */
export type CommandResult =
  | {
    readonly kind: 'success'
    readonly text?: string
    /** Earlier authoritative domain event that owns a richer presentation. */
    readonly sourceEventSeq?: number
  }
  | { readonly kind: 'error'; readonly text: string }
```
— `packages/interaction/commands/src/types.ts:26-34`

```ts
/** Immutable metadata for a command's optional unstructured input. */
export interface CommandInputDescriptor {
  /** Placeholder shown before the user supplies free-form input. */
  readonly hint: string
  readonly images?: boolean
}
```
— `packages/interaction/commands/src/types.ts:12-24` (comment on `images` elided for length; full text at `:15-22`)

```ts
/** Handler-free immutable command view returned to UI adapters. */
export interface CommandDescriptor {
  readonly name: string
  readonly description: string
  readonly input?: CommandInputDescriptor
}
```
— `packages/interaction/commands/src/types.ts:49-57`

```ts
export interface CommandExecution {
  /** Pairing id carried by this execution's lifecycle events. */
  readonly commandId: CommandId
  /** The handler's normalized outcome. */
  readonly result: CommandResult
}
```
— `packages/interaction/commands/src/types.ts:42-47`

```ts
/** Syntactically valid slash command before registry resolution. */
export interface ParsedCommand {
  readonly name: string
  readonly rawInput: string
}
```
— `packages/interaction/commands/src/index.ts:71-77`

### B.4 Rest of the runtime surface

```ts
  @Remote
  list(agent: Agent): readonly CommandDescriptor[] {
```
— `packages/interaction/commands/src/index.ts:284-285`

```ts
  find(agent: Agent, name: string): CommandDefinition | undefined {
```
— `packages/interaction/commands/src/index.ts:298`

```ts
  @Remote
  async execute(
    agent: Agent,
    line: string,
    images: readonly EncodedImageAttachment[],
    signal: AbortSignal,
  ): Promise<CommandExecution | undefined> {
```
— `packages/interaction/commands/src/index.ts:328-334`

```ts
export function parseCommand(line: string): ParsedCommand | undefined {
```
— `packages/interaction/commands/src/index.ts:116`

### B.5 Validation and lifecycle

**Name grammar** — `const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/u` (`packages/interaction/commands/src/index.ts:28`); the dispatch parser is `/^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u` (`:117`).

**Registration-time throws** (all in `normalizeDefinition`, `packages/interaction/commands/src/index.ts:170-214`): name not matching `COMMAND_NAME` (`:171`), non-string description (`:174`), empty description (`:177`), non-function handler (`:180`), non-string/empty `input.hint` (`:186,:190`), non-boolean `input.images` (`:193`). Duplicate global name throws with a scope hint: `command "${name}" is already registered (for a per-agent variant, mount a command-injected plugin under that agent's \`agent.ctx\`)` — `packages/interaction/commands/src/index.ts:94`.

**Scoping.** Global vs. per-agent shadowing: *"Plain-context definitions are global; definitions registered through a command-injected child of an agent context shadow globals for that agent."* — `packages/interaction/commands/src/index.ts:246-249`. Resolution is `private view(agent: Agent): Map<string, RegisteredCommand>` → `this.layers.merge(agent, layer => layer.commands)` (`:435-437`).

**Result validation.** `normalizeResult` (`:217`) throws `TypeError` if the handler returns a non-`CommandResult`, a non-string `success.text`, a non-safe-integer/negative `sourceEventSeq`, an empty `error.text`, or an unknown `kind`. Results are frozen (`:230`, `:240`).

**Durable lifecycle.** `command/run` is appended *before* the handler runs, `command/done` after settlement; a thrown/aborted handler settles as `kind: 'error'` (`:302-313`). Both are log-only, non-surface events drained at ordinary checkpoints (`:416-421`). Event payloads:

```ts
    'command/run': { commandId: CommandId; name: string; args?: string; source: CommandSource }
```
— `packages/interaction/commands/src/types.ts:96`

```ts
    'command/done': {
      commandId: CommandId
      kind: 'success' | 'error'
      text?: string
      sourceEventSeq?: number
    }
```
— `packages/interaction/commands/src/types.ts:103-108`

```ts
    'commands/change'(): void
```
— `packages/interaction/commands/src/types.ts:80` (unfiltered registry notification; observer failures contained and cannot veto — `:75-78`, impl `packages/interaction/commands/src/index.ts:440-454`)

**Abort.** `withAbort` (`:146`) stops awaiting an uncooperative handler once the UI request aborts; non-`Error` rejections are wrapped (`:161-163`). Cancellation is honored *before* the handler runs when image admission awaited slow storage (`:376-384`).

**Images.** Admission is enforced in the registry, not the composer: images sent to a command without `input.images` (`:359-361`), an absent attachment store (`:362-365`), or an exceeded limit each settle as an error result before the handler runs.

### B.6 Worked example — `/goal` registration, quoted verbatim

```ts
/** Register the Codex-shaped \`/goal\` command for every composed command adapter. */
export function apply(ctx: Context): void {
  ctx.commands.register({
    name: 'goal',
    description: 'set or view the goal for a long-running task',
    input: { hint: '[<objective>|clear|edit <objective>|pause|resume]', images: true },
    handler: invocation => executeGoalCommand(ctx, invocation),
  })
}
```
— `packages/goal/command-goal/src/index.ts:188-196`

with, at module scope:

```ts
export const name = 'command-goal'
export const inject = ['commands', 'goals']
```
— `packages/goal/command-goal/src/index.ts:12-13`

Note the shape: no `ctx.effect` wrapper, handler delegates to a plain function taking `(ctx, invocation)`, and domain errors are converted to `{ kind: 'error', text }` rather than thrown (`packages/goal/command-goal/src/index.ts:177-185`). Attachments are forwarded to the model via `invocation.agent.followup(createUserMessage({...}))` (`:116-122`) — the registry never schedules them.

### B.7 Minimal registration example

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'

export const name = 'command-mine'
export const inject = ['commands']

export function apply(ctx: Context): void {
  ctx.commands.register({
    name: 'mine',
    description: 'show my plugin state',
    input: { hint: '[status|reset]' },
    handler: (invocation: CommandInvocation): CommandResult => {
      const arg = invocation.rawInput.trim().toLowerCase()
      if (arg !== '' && arg !== 'status') {
        return { kind: 'error', text: 'Usage: /mine [status]' }
      }
      return { kind: 'success', text: \`agent: \${invocation.agent.session.id}\` }
    },
  })
}
```

---

## TOPIC C — `ctx.storage.domain`

### C.1 Two service keys

The hub:

```ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    storage: Storage
  }
}
```
— `packages/storage/storage/src/index.ts:30-34`

The facility is reachable **two** ways — through the hub form and as its own context service:

```ts
declare module '@deepseek-ai/dsh-storage' {
  interface StorageForms {
    domain: DomainFacility
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    storageDomain: DomainFacility
  }
}
```
— `packages/storage/storage-domain/src/index.ts:29-39`

Both are provided in `apply`: `domainCtx.storage.mount('domain', facility)` (`packages/storage/storage-domain/src/index.ts:209`) and `domainCtx.provide('storageDomain', facility)` (`:217`). For `inject`, use `'storageDomain'` — it is a real Cordis service key; `ctx.storage.domain` is a getter on the hub with no independent lifecycle signal.

### C.2 Hub interface

```ts
export class Storage extends Service {
  /** Named backend table; multiple backends stay mounted side by side. */
  readonly backend: BackendRegistry = new BackendRegistry()
```
— `packages/storage/storage/src/index.ts:47-49`

```ts
  mount<K extends keyof StorageForms>(form: K, facility: StorageForms[K]): () => void {
```
— `packages/storage/storage/src/index.ts:64`

```ts
  form<K extends keyof StorageForms>(form: K): StorageForms[K] {
```
— `packages/storage/storage/src/index.ts:82`

```ts
  /** Domain data form; present once the domain layer plugin is loaded. */
  get domain(): StorageForms extends { domain: infer D } ? D : never {
    return this.form('domain' as keyof StorageForms)
  }
```
— `packages/storage/storage/src/index.ts:89-92`

`.domain` throws `StorageError('form-not-mounted', ...)` when the domain plugin is absent (`packages/storage/storage/src/index.ts:83-85`).

```ts
export function storageBackendServiceKey(name: string): string {
  return \`storage.backend.\${name}\`
}
```
— `packages/storage/storage/src/index.ts:26-28`

### C.3 Facility interface

```ts
export class DomainFacility {
```
— `packages/storage/storage-domain/src/index.ts:69`

```ts
  async open<S extends DomainSpec>(spec: S): Promise<Domain<S>> {
```
— `packages/storage/storage-domain/src/index.ts:100`

```ts
  get(name: string): DomainImpl | undefined {
```
— `packages/storage/storage-domain/src/index.ts:165`

```ts
  async closeAll(): Promise<void> {
```
— `packages/storage/storage-domain/src/index.ts:175`

```ts
export const name = 'storage-domain'
/** The storage hub must be present before the form can mount. */
export const inject = ['storage']
```
— `packages/storage/storage-domain/src/index.ts:42-44`

```ts
export interface Config {
  /** Default backend name for every domain without an explicit route. Required: there is no universally correct medium. */
  backend: string
  /** Per-domain overrides: domain name → backend name. */
  routes?: Record<string, string>
}
```
— `packages/storage/storage-domain/src/index.ts:52-57`

**Ownership:** *"the CALLER owns the returned handle and closes it via `Domain.close()` (typically as its own `ctx.effect` disposer) — the facility does not tie the domain to any consumer fiber. Domains still open when the facility unmounts are closed by the plugin disposer."* — `packages/storage/storage-domain/src/index.ts:93-97`.

**Single-open enforcement:** a name reserved by an in-flight or completed open rejects with `already-open` (`:71-72`, `:101-103`).

### C.4 The KV surface — no flat get/set/delete/list

There is **no** flat KV. The shape is *domain → (tables | global singleton)*.

```ts
/** One open domain, typed by its spec. */
export interface Domain<S extends DomainSpec> {
  /** Domain name from the spec. */
  readonly name: string
  /** Global singleton handle; a spec without \`global\` has no usable handle (\`never\`). */
  readonly global: DomainGlobalHandleOf<S>
  table<N extends keyof S['tables'] & string>(name: N): KvTable<TableKeyOf<S, N>, TableValueOf<S, N>>
  close(): Promise<void>
}
```
— `packages/storage/storage-domain/src/domain.ts:96-119` (doc comments on `table`/`close` elided; full text at `:102-107` and `:110-117`)

```ts
export interface KvTable<K extends string, V> {
  get(key: K): V | undefined
  entries(): IterableIterator<[K, V]>
  keys(): IterableIterator<K>
  /** Current record count. */
  readonly size: number
  put(key: K, value: V): Promise<void>
  delete(key: K): Promise<boolean>
  update(key: K, fn: (current: V) => V): Promise<V>
}
```
— `packages/storage/storage-domain/src/domain.ts:42-90` (individual member citations: `get`:48, `entries`:55, `keys`:61, `size`:64, `put`:72, `delete`:80, `update`:89)

```ts
/** Handle on a domain's global singleton. */
export interface DomainGlobal<G> {
  get(): G
  set(value: G): Promise<void>
}
```
— `packages/storage/storage-domain/src/domain.ts:18-35` (`get`:23, `set`:34)

```ts
export type DomainGlobalHandleOf<S extends DomainSpec> =
  S extends { readonly global: DomainGlobalSpec<infer G> } ? DomainGlobal<G> : never
```
— `packages/storage/storage-domain/src/domain.ts:93-94`

**Read/write asymmetry.** Reads (`get`/`entries`/`keys`/`size`) are **synchronous from authoritative in-memory state**; every write is async. `entries()`/`keys()` return a **snapshot**, not a live view (`:52-53`). Returned records are the stored objects themselves — *"no defensive copies) and must not be mutated in place — replace via `put`/`update`"* (`:38-40`).

`delete` returns `false` when already absent, with **no write and no event** in that case (`:78-79`, impl `:319`). `update` rejects with `missing-key` on an absent key (`:87`, impl `:334-339`) and evaluates `fn` at its queue slot, so concurrent updates never interleave (`:83-85`).

### C.5 Spec declaration and schema validation

```ts
export interface DomainSpec {
  /** Domain name; must match \`UNIT_NAME_RE\` (doubles as the backend unit name). */
  readonly name: string
  /** Domain format version; a medium stamped with a different version rejects at open. */
  readonly version: number
  /** Optional global singleton slot. */
  readonly global?: DomainGlobalSpec<unknown>
  /** Table declarations keyed by table name; each name must match \`UNIT_NAME_RE\`. */
  readonly tables: Record<string, DomainTableSpec>
}
```
— `packages/storage/storage-domain/src/spec.ts:34-44`

```ts
export interface DomainGlobalSpec<G> {
  /** Validates the stored global at the durable boundary. */
  readonly schema: ZodType<G>
  /** Value served when the medium holds no global yet; not written until the first \`set\`. */
  readonly initial: G
}
```
— `packages/storage/storage-domain/src/spec.ts:14-20`

```ts
export interface DomainTableSpec<K extends string = string, V = unknown> {
  /** Validates every stored record at the durable boundary. */
  readonly valueSchema: ZodType<V>
  /** Phantom carrier for the key type; never present at runtime. */
  readonly __key?: K
}
```
— `packages/storage/storage-domain/src/spec.ts:27-32`

```ts
export function defineDomain<S extends DomainSpec>(spec: S): S {
```
— `packages/storage/storage-domain/src/spec.ts:79`

```ts
export function domainTable<K extends string, V>(schema: ZodType<V>): DomainTableSpec<K, V> {
  return { valueSchema: schema }
}
```
— `packages/storage/storage-domain/src/spec.ts:63-65`

```ts
export function descriptorOf(spec: DomainSpec): KvUnitDescriptor {
```
— `packages/storage/storage-domain/src/spec.ts:105`

Type projections: `TableKeyOf` (`:47`), `TableValueOf` (`:51`), `GlobalValueOf` (`:55`).

**Schema flavor split.** Record schemas are **zod**; plugin `Config` is **schemastery** — `packages/storage/storage-domain/src/index.ts:4-6` and `spec.ts:5-7`.

**When validation runs — this is the critical detail.** Validation happens at the **durable read boundary only**, i.e. at `open()`. It is **not** re-checked on `put`/`set`:

- At open, every stored record is parsed: `records.set(key, parseRecord(spec.name, table, key, () => tableSpec.valueSchema.parse(raw)))` — `packages/storage/storage-domain/src/index.ts:121`; the global likewise at `:132`. Failure ⇒ `DomainError('invalid-record', ...)` carrying `{ table, key }` (`:181-192`).
- `DomainGlobal.set` says outright: *"must satisfy the spec's schema (not re-checked here — validation happens at the durable read boundary)"* — `packages/storage/storage-domain/src/domain.ts:31-32`. Type-safety is compile-time; a cast that lies persists bad data that then fails the *next* `open()`.

`defineDomain` fails loud at module load (before any medium is touched) on: name outside `UNIT_NAME_RE` (`spec.ts:80-82`), non-integer/negative version (`:83-85`), table name outside `UNIT_NAME_RE` (`:86-90`), and a global schema accepting `null` (`:91-96`) — because `null` is the medium's "never written" sentinel and a stored `null` would silently revert to `initial` on reopen.

```ts
export const UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/
```
— `packages/storage/storage/src/backend.ts:10` (note: **no hyphens**, unlike command names)

### C.6 Events

```ts
    'domain/changed'(change: DomainChanged): void
```
— `packages/storage/storage-domain/src/events.ts:46`

```ts
/** One durable domain change; a closed union — switch on \`operation\`. */
export type DomainChanged = DomainChangedPut | DomainChangedDeleted
```
— `packages/storage/storage-domain/src/events.ts:33-34`

```ts
export interface DomainChangedBase {
  /** Owning domain name. */
  readonly domain: string
  /** Table name; \`''\` for a global-singleton write. */
  readonly table: string
  /** Record key; \`''\` for a global-singleton write. */
  readonly key: string
}
```
— `packages/storage/storage-domain/src/events.ts:10-18`

```ts
export interface DomainChangedPut extends DomainChangedBase {
  readonly operation: 'put'
  /** The new snapshot. */
  readonly value: unknown
}
```
— `packages/storage/storage-domain/src/events.ts:20-25`

```ts
export interface DomainChangedDeleted extends DomainChangedBase {
  readonly operation: 'deleted'
  readonly value?: never
}
```
— `packages/storage/storage-domain/src/events.ts:27-31`

Guarantees: emitted **once per write, strictly after the backend acknowledged durability**; events of one domain arrive in its write-chain order (`events.ts:38-44`). Never carries the old value — a diffing consumer keeps its own previous snapshot (`events.ts:3-5`). A throwing listener is contained and logged, and cannot retroactively reject the already-committed write (`domain.ts:246-261`). A no-op `delete` emits nothing (`domain.ts:319`).

### C.7 Durability and ordering model

From `packages/storage/storage-domain/src/domain.ts:1-8` verbatim:

> *"Reads are synchronous from memory; every write queues on the chain, awaits backend durability FIRST, then mutates memory, then emits `domain/changed` — a rejected backend write leaves memory untouched (no divergence between reads and the medium), and events carry values that equal the in-memory state at emission, in write order."*

- **One write chain per domain**, serializing all writes across all tables and the global: `private chain: Promise<void> = Promise.resolve()` (`domain.ts:149`), `enqueue` at `:263-270`.
- Backend contract: *"the unit only guarantees that each single call is atomic on the medium and durable once resolved (a crash after resolution followed by a re-open observes the write)"* — `packages/storage/storage/src/backend.ts:60-64`. The unit does **not** serialize concurrent writes; the domain layer's single chain is what supplies ordering.
- **No transactions.** There is no multi-key atomic commit. `update` is the only read-modify-write primitive and covers exactly one key.
- **Close semantics:** new writes reject immediately with `closed`, already-queued writes drain and *still emit* their events, then the unit is released and the name freed for reopen; idempotent (`domain.ts:110-118`, `:226-244`). Reads stay valid while draining and throw `closed` only after teardown finishes (`:152-153`, `:272-276`).

### C.8 Scoping: global, not per-session

**Domains are process-global and session-independent.** Nothing in the spec, the facility, or the backends carries a session or agent key:

- `DomainSpec` has `name`/`version`/`global`/`tables` only — `packages/storage/storage-domain/src/spec.ts:34-44`. No scope field.
- `DomainFacility.open(spec)` keys the open-domain table by `spec.name` alone — `packages/storage/storage-domain/src/index.ts:141`; a second open of the same name anywhere in the process throws `already-open` (`:101-103`).
- `KvUnitDescriptor` is `{ name, version, tables, hasGlobal }` — `packages/storage/storage/src/backend.ts:46-55`. No scope.
- The facility is provided once on the plugin context (`packages/storage/storage-domain/src/index.ts:217`), not per agent — contrast `CommandRuntime`, which explicitly has per-agent `ScopedLayers` (`packages/interaction/commands/src/index.ts:251`).

⇒ Session scoping, if wanted, must be encoded **by the caller into the record key**. There is exactly one live handle per domain name per process, so a plugin should open its domain once at `apply` and share the handle.

### C.9 Cross-session and cross-process persistence — where the bytes live

**Values survive across sessions and process restarts** for both shipped backends; the medium location is set by *assembly config*, not by the domain package.

#### storage-json — `packages/storage/storage-json`

One human-readable file per unit under a configured root, published by atomic whole-file rewrite (`packages/storage/storage-json/src/index.ts:1-5`).

```ts
export interface Config {
  /** Directory holding one \`<unit>.json\` file per unit. */
  root: string
}
```
— `packages/storage/storage-json/src/index.ts:27-30`

`root` deliberately has **no default**: *"a `process.cwd()` fallback would scatter unit files wherever the process happens to start; assemblies state the location explicitly."* — `packages/storage/storage-json/src/index.ts:21-26`.

Exact path formula — `<root>/<domainName>.json`:

```ts
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const path = join(this.root, \`\${descriptor.name}.json\`)
```
— `packages/storage/storage-json/src/index.ts:64-65`

The root is created owner-only (`0o700`). Registers under the name `'json'`: `ctx.storage.backend.register('json', backend)` — `packages/storage/storage-json/src/index.ts:107`, and provides `storageBackendServiceKey('json')` (`:113`). Tests confirm the on-disk name is the unit name plus a committed sidecar: `join(root, 'shape.json')` and `join(root, 'shape.committed.json')` — `packages/storage/storage-json/tests/json-backend.spec.ts:91-92`.

#### storage-sqlite — `packages/storage/storage-sqlite`

*"one database file hosts every unit"* — `packages/storage/storage-sqlite/src/index.ts:2`. Uses `node:sqlite`'s `DatabaseSync` (`:10`).

```ts
  path: string
```
— `packages/storage/storage-sqlite/src/index.ts:34`, documented at `:26-33`: *"Filesystem path to the SQLite database file. The special value `:memory:` opens an in-process database (tests). On filesystems with POSIX modes, missing directories and databases are created owner-only"*.

```ts
  path: z.string().required(),
```
— `packages/storage/storage-sqlite/src/index.ts:46`

```ts
export async function openDatabase(path: string, journalMode: JournalMode): Promise<DatabaseSync> {
  const actual = path === ':memory:' ? path : resolve(path)
```
— `packages/storage/storage-sqlite/src/schema.ts:61-62`

The file is created exclusively with mode `0o600`: `const handle = await open(path, 'wx', 0o600)` — `packages/storage/storage-sqlite/src/schema.ts:45`. A `journalMode` option exists for filesystems where WAL shared-memory files do not work, e.g. network mounts (`packages/storage/storage-sqlite/src/index.ts:36-39`). Schema version mismatch fails loud (`packages/storage/storage-sqlite/src/schema.ts:84-87`).

#### Cross-process caveat

Durability across restarts is guaranteed (`packages/storage/storage/src/backend.ts:62-64`), but **two live processes over one medium are not coordinated by this layer**. The write chain (`domain.ts:149`) is per-`DomainImpl`, hence per-process, and reads are served from a per-process in-memory snapshot loaded once at `open()` (`index.ts:117-124`). `domain/changed` is a Cordis in-process emit (`domain.ts:253`); the events module notes cross-process change push over RPC frames is a *"later phase"* (`events.ts:5-6`). Concurrent multi-process writers would observe last-writer-wins with stale reads.

#### Version migration

`version` is stamped on the medium at first materialization; a differing version rejects `open` with `version-mismatch` (`packages/storage/storage/src/backend.ts:34-37`, `packages/storage/storage-domain/src/index.ts:88-90`). There is **no migration hook** — bumping `version` makes existing data unreadable, so a plugin owns its own upgrade path.

### C.10 Error codes

`DomainError` codes observed at the seam: `already-open` (`index.ts:102`), `backend-not-found` (pass-through from the hub, `index.ts:88`), `facet-unsupported` (`index.ts:110`), `invalid-record` (`index.ts:185`), `closed` (`domain.ts:265`, `:274`), `missing-key` (`domain.ts:336`), plus backend `version-mismatch`/`malformed-medium`. `StorageError` codes: `duplicate-mount` (`storage/src/index.ts:66`), `form-not-mounted` (`storage/src/index.ts:84`), `closed`/`malformed-medium` (`storage-json/src/index.ts:51,90`).

### C.11 Minimal snippet

```ts
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import {
  defineDomain, domainTable,
  type Domain,
} from '@deepseek-ai/dsh-storage-domain'

const NoteRecord = z.object({
  text: z.string(),
  updatedAt: z.number(),
})
type NoteRecord = z.infer<typeof NoteRecord>

// Module-load-time validation: bad name/version/global throws here.
const MINE = defineDomain({
  name: 'mine',              // UNIT_NAME_RE: /^[a-z][a-z0-9_]*$/ — no hyphens
  version: 1,
  global: {
    schema: z.object({ enabled: z.boolean() }),
    initial: { enabled: false },
  },
  tables: {
    notes: domainTable<string, NoteRecord>(NoteRecord),
  },
})

export const name = 'my-plugin'
export const inject = ['storageDomain']

export function apply(ctx: Context): void {
  ctx.effect(() => {
    const opening: Promise<Domain<typeof MINE>> = ctx.storage.domain.open(MINE)

    void opening.then(async (domain) => {
      const notes = domain.table('notes')

      // Reads are synchronous from memory.
      const existing = notes.get('welcome')
      const count = notes.size

      // Writes await durability, then emit domain/changed.
      await notes.put('welcome', { text: 'hello', updatedAt: Date.now() })
      await notes.update('welcome', cur => ({ ...cur, updatedAt: Date.now() }))
      const removed: boolean = await notes.delete('stale')

      // Global singleton: get() serves `initial` until the first set().
      const flags = domain.global.get()
      await domain.global.set({ enabled: !flags.enabled })

      void existing; void count; void removed
    })

    // The CALLER owns close().
    return async () => { (await opening).close() }
  }, 'my-plugin: mine domain')

  // Observe durable changes (in-process only).
  ctx.on('domain/changed', (change) => {
    if (change.domain !== 'mine') return
    if (change.operation === 'put') ctx.logger.info(\`put \${change.table}/\${change.key}\`)
    else ctx.logger.info(\`deleted \${change.table}/\${change.key}\`)
  })
}
```

Assembly-side config (not the plugin's concern, shown for completeness):

```yaml
storage: {}
storage-json:
  root: /path/to/state          # -> /path/to/state/mine.json
storage-domain:
  backend: json
  routes:
    mine: json                  # optional per-domain override
```

---

## Cross-topic notes

1. **Effect wrapping differs per seam.** `webServer.register` returns a bare disposer ⇒ wrap in `ctx.effect`. `commands.register` is *already* an effect on `this.ctx` (`packages/interaction/commands/src/index.ts:272`) ⇒ do not wrap. `storage.domain.open` returns a handle the caller must close ⇒ wrap in `ctx.effect` with an async disposer.
2. **Name grammars are not the same.** Commands: `/^[a-z][a-z0-9_-]*$/u` (hyphens allowed) — `packages/interaction/commands/src/index.ts:28`. Storage units/tables: `/^[a-z][a-z0-9_]*$/` (hyphens **forbidden**, must be safe as a file name and a SQL identifier) — `packages/storage/storage/src/backend.ts:9-10`.
3. **Collision handling is uniformly fail-loud.** Duplicate routes, duplicate command names, duplicate form mounts, and double-open of a domain all throw rather than silently overwriting.
4. **Schema validation is a read-boundary property, not a write-boundary one**, for storage domains. Commands validate at registration and normalize handler results at return. Routes validate nothing.
