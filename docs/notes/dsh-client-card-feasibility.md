# Feasibility: shipping a DSH Web settings card from an out-of-tree package (`dsh-legion`)

Researched against DeepSeek Harness `0.1.0-rc.7` at a local checkout of `deepseek-harness`.
Every claim below cites a repository-relative path and line numbers. Where a fact was not
determinable from the source, that is stated explicitly.

## Verdict (short)

**Technically achievable, but not supported today.** Nothing in the discovery or load path
special-cases in-repo packages: the Host scans Loader entries for `dsh.client` and serves any
resolvable package's built `./client` file. The blocker is *packaging*, not policy:

1. The `clientBundle` tsdown preset that emits the required artifact is **unpublished** — it is a
   loose `.ts` file at `packages/client/tsdown.client.ts`, not exported by any package.
2. The client-side packages a card needs are all **publishable** (no `private: true`, all carry
   `publishConfig.access: public`), but the reachable registry mirror only shows **`0.0.1-rc.1`**
   for them, and `@deepseek-ai/dsh-client-ui-settings-plugins` — the package that *declares the
   `settings.plugin.item` slot* — resolves **404 / not published at all**.

That last point is the decisive one, and it is a *type-only* blocker, so it is soft. Details in §5.

---

## 1. The required artifact format

### 1.1 The preset, verbatim

The browser half is built by `clientBundle` in `packages/client/tsdown.client.ts`. The browser-face
tsdown options are produced by `clientConfig` (lines 170–274):

```ts
// packages/client/tsdown.client.ts:170-207
function clientConfig(id: string, entry: string): UserConfig {
  return {
    name: `${id}/client`,
    entry: { client: entry },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...CLIENT_EXTERNALS],
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
```

and the output shape (lines 262–272):

```ts
    outputOptions: {
      entryFileNames: 'client.js',
      sourcemapPathTransform: browserSourcePath,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
```

### 1.2 What "lazy-CJS factory" means

The banner/intro/footer wrap a plain CJS bundle into a **closure registered with the page loader**
rather than executed at script-load time. The emitted `packages/client/ui-theme/lib/client.js`
begins and ends exactly:

```js
window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-ui-theme",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		...
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
```

"Lazy" is enforced on the loader side: loading the script only *registers* the factory
(`packages/client/modules/src/client/system.ts:88-95`), and materialization happens later:

```ts
// packages/client/modules/src/client/system.ts:88-95
    win.__ModuleLoader__ = {
      load: (handoff: ClientPluginHandoff): void => {
        if (this.factories.has(handoff.id)) throw new Error(`client-modules: duplicate factory registration for "${handoff.id}" (bundle executed twice without invalidate?)`)
        this.factories.set(handoff.id, handoff.factory)
      },
    }
```

The injected `require` is **not** Node's — it is a synchronous module-table lookup
(`system.ts:142-156`):

```ts
  private makeRequire(edges: Set<string>): (spec: string) => unknown {
    return (spec: string): unknown => {
      edges.add(spec)
      if (this.seed.has(spec)) return this.seed.get(spec)
      if (this.statics.has(spec)) return this.statics.get(spec)
      const id = stripClientSuffix(spec)
      const record = this.loadCache.get(id)
      if (record !== undefined) return record.exports
      if (this.factories.has(id)) return this.materialize(id).exports
      throw new Error(
        `client-modules: require("${spec}") missed the module table — not a platform seed word, not a shell-own module, `
        + 'and no registered factory (a build-time externals drift, or a forbidden cross-plugin value import)',
      )
    }
  }
```

Because the factory form cannot deliver partial exports, a require cycle is fatal
(`system.ts:120-122`).

### 1.3 The exact externals set

`packages/client/tsdown.client.ts:62-65`:

```ts
const RUNTIME_STORE_EXEMPTION = '@deepseek-ai/dsh-client-runtime/client'

export const CLIENT_EXTERNALS: readonly string[] = [...PLATFORM_MODULES, RUNTIME_STORE_EXEMPTION]
```

with `PLATFORM_MODULES` from `packages/client/web/src/platform.ts:8-16`:

```ts
export const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
] as const
```

So exactly **11 specifiers** stay external; **everything else must be inlined** — that is what
`noExternal` at line 207 enforces, overriding tsdown's default auto-externalization of
`dependencies`. A third-party build that leaves, say, `clsx` or `zod` external emits a
`require()` the frozen table cannot answer, and the card throws at materialization.

### 1.4 What a third-party config must reproduce

To be byte-compatible a non-repo tsdown/rolldown config must reproduce **all** of:

| Requirement | Source |
|---|---|
| `format: 'cjs'`, `platform: 'browser'` | `tsdown.client.ts:178-179` |
| output filename exactly `client.js` in `lib/` | `:174-176`, `:263` |
| banner `window.__ModuleLoader__.load({ id: "<pkg name>", factory: (require) => {` | `:269` |
| intro `var module = { exports: {} }; var exports = module.exports;` | `:271` |
| footer `return module.exports; } });` | `:270` |
| `external` = the 11 `CLIENT_EXTERNALS` specifiers, nothing more | `:186` |
| `noExternal` = everything not in that list | `:207` |
| the three `define` substitutions (`process.env.NODE_ENV`, `import.meta.env.MODE`, bare `import.meta.env`) | `:197-201` |
| `clean: false`, `dts: false` | `:181-185` |
| `sourcemap: true` (optional in practice; only affects devtools) | `:184` |

The `id` in the banner **must equal the package name**, because the Host composes the graph row id
from the Loader entry name (`packages/client/modules/src/index.ts:399`) and the loader verifies the
loaded script registered *that* id (`system.ts:104-108`):

```ts
    const task = this.loadBundle(url).then(() => {
      if (!this.factories.has(id)) {
        throw new Error(`client-modules: bundle ${url} loaded without registering "${id}" via __ModuleLoader__.load`)
      }
    })
```

CSS Modules support (`.module.css` → hashed class map + auto-injected
`<style data-plugin>`) is a preset-local rollup plugin (`tsdown.client.ts:226-261`); a third party
either reimplements it or avoids CSS Modules and injects its own `<style data-plugin="...">` tag
(the loader claims untagged style tags for the materializing plugin —
`system.ts:41-51`).

---

## 2. Required package.json fields, and where they are validated

### 2.1 The shape

From the cookbook (`docs/cookbook/adding-a-settings-card.md:82-90`) and confirmed by the real
manifests (`packages/client/ui-theme/package.json:16-45`,
`packages/client/ui-settings-plugins/package.json:16-43`):

```jsonc
{
  "exports": {
    ".":       { "types": "./lib/types/index.d.ts",        "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" }
  },
  "dsh": { "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-settings-plugins"] } }
}
```

Field semantics, from `packages/client/modules/src/index.ts:46-52`:

```ts
/** package.json `dsh.client` declaration fields, validated one by one after reading the file. */
interface DshClientDeclaration {
  inject?: string[]
  platform: string
  /** Boot phase-one prefetch mark; absent means lazy (fetched on demand). */
  immediately?: boolean
}
```

- `platform` — **required string**; must be exactly `"web"` or the package is silently skipped
  (`index.ts:350-353`).
- `inject` — optional `string[]`; **package-name edges**, not cordis service names. They ride into
  the boot graph row (`index.ts:150-158`) and order the loader's arrival, so the card's dependency
  bundles are materialized first.
- `immediately` — optional boolean; `true` = phase-one prefetch, absent = lazy fetch on demand.
  `ui-theme` sets it (`ui-theme/package.json:43`); `ui-settings-plugins` does not.

Note the **two different `inject` concepts**: the package.json one above (package-name graph edges)
versus the cordis-service `export const inject = [...]` in the client source
(`docs/cookbook/adding-a-settings-card.md:56`). They are unrelated and both are needed.

### 2.2 Where the schema is validated

Hand-written narrowing in `packages/client/modules/src/index.ts:108-129` — there is **no
schemastery/zod schema** for this field:

```ts
function parseDshClient(pkgName: string, value: unknown): DshClientDeclaration | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null) {
    throw new Error(`client-modules: ${pkgName} has a non-object dsh.client declaration`)
  }
  const decl = value as Record<string, unknown>
  if (typeof decl.platform !== 'string') {
    throw new Error(`client-modules: ${pkgName} dsh.client.platform must be a string`)
  }
  if (decl.inject !== undefined && (!Array.isArray(decl.inject) || decl.inject.some(i => typeof i !== 'string'))) {
    throw new Error(`client-modules: ${pkgName} dsh.client.inject must be a string array`)
  }
  if (decl.immediately !== undefined && typeof decl.immediately !== 'boolean') {
    throw new Error(`client-modules: ${pkgName} dsh.client.immediately must be a boolean`)
  }
  ...
}
```

The `./client` export is resolved separately by `clientExportOf` (`index.ts:131-142`), which accepts
a bare string **or** a one-level conditional object with a string `default`:

```ts
function clientExportOf(pkgName: string, exportsField: unknown): string | undefined {
  if (typeof exportsField !== 'object' || exportsField === null) return undefined
  const client = (exportsField as Record<string, unknown>)['./client']
  if (client === undefined) return undefined
  if (typeof client === 'string') return client
  if (typeof client === 'object' && client !== null) {
    const fallback = (client as Record<string, unknown>).default
    if (typeof fallback === 'string') return fallback
  }
  throw new Error(`client-modules: ${pkgName} exports["./client"] must be a string or an object with a string default`)
}
```

Declaring `dsh.client` without a `./client` export is a hard error (`index.ts:354-357`).
Also required in practice: the built file must **exist** on disk at activation, or the package
throws `MissingClientBundleError` and fails the fiber (`index.ts:374-381`, `:65-80`).

---

## 3. Discovery: how a third-party client half is found

**It scans the Loader entries, not `node_modules`.** `packages/client/modules/src/index.ts:1-21`
states it, and the code confirms it. Activation seeds the dirty set from the live Loader entries
(`index.ts:233`):

```ts
    for (const entry of ctx.loader.entries()) this.dirty.add(entry.options.name)
```

and steady state re-marks on every cordis `internal/plugin` emission (`index.ts:218-228`):

```ts
    ctx.on('internal/plugin', (fiber) => {
      const entryName = fiber.entry?.options.name
      if (entryName === undefined) return
      this.dirty.add(entryName)
      ...
    })
```

Each dirty entry name is reconciled by `processOne` (`index.ts:384-401`) — the entry must be live
and enabled — and then resolved by `resolveMeta` (`index.ts:332-365`), which does a plain Node
resolution of `<entryName>/package.json`:

```ts
    const require = createRequire(ctx.baseUrl)
    this.resolvePkgJson = spec => require.resolve(`${spec}/package.json`)
```
(`index.ts:212-213`, anchored at `ctx.baseUrl` — the `cordis.yml` directory, per the comment at
`index.ts:205-208`).

**Consequences for an out-of-tree package.** The entry name is whatever `cordis.yml` mounts, and
resolution is anchored at the config-tree directory. So a third-party package is discovered exactly
when (a) it is installed such that `require.resolve` from the `cordis.yml` directory finds it, and
(b) a `cordis.yml` entry mounts it. There is **no allowlist, no scope check, and no in-repo
restriction anywhere in this path** — the slot contract says so explicitly
(`packages/client/ui-settings-plugins/src/client/slot-contract.ts:7-10`):

> Keying on the namespace is what lets a plugin distributed outside this repository contribute a
> card: it registers its own settings namespace on the Host and its own card under that key in the
> browser, and the tab pairs the two without ever learning what the namespace means.

The bundle is then served over HTTP at `/plugins/<id>/client.js` (`index.ts:421-457`) and advertised
through `window.__DSH_BOOT__` (`index.ts:168-175`).

One caching caveat: package metadata, **including the negative "not a client package" verdict**, is
cached per name and never expires (`index.ts:188-191`) — plugin-set changes take effect on restart.

---

## 4. The bundle-purity gate: what it rejects, and where it applies

### 4.1 What it rejects

It is a rollup `resolveId` hook inside the preset (`packages/client/tsdown.client.ts:208-225`):

```ts
      name: 'dsh-client-bundle-purity',
      resolveId(source: string) {
        if (!source.startsWith('@deepseek-ai/')) return null
        if (CLIENT_EXTERNALS.includes(source)) return null // platform module: external wins
        if (VENDORED_LIBRARY.test(source)) return null // vendored library: inline, no shared identity
        if (INLINE_SAFE.test(source) || GENERATED_REMOTE.test(source)) return null // wire contribution: inline is the point
        throw new Error(
          `client bundle purity: "${source}" is not a platform module (CLIENT_EXTERNALS), an inline-safe wire layer, or a generated /remote contribution — `
          + 'cross-plugin value imports are forbidden; collaborate through cordis services (type-only imports are erased and never reach this gate)',
        )
      },
```

The three allow patterns (`:33`, `:41`, `:44`):

```ts
export const INLINE_SAFE = /^@deepseek-ai\/dsh-(host-apiproxy|session|llm|tools|brand)(\/|$)/
const VENDORED_LIBRARY = /^@deepseek-ai\/(cosmokit|schemastery)(\/|$)/
const GENERATED_REMOTE = /^@deepseek-ai\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*\/remote$/
```

So it rejects **any `@deepseek-ai/*` value import** that is not (a) one of the 11 externals,
(b) a vendored library, (c) an `INLINE_SAFE` wire layer, or (d) an exact `/remote` subpath.
Notably rejected, per `scripts/client-bundle-purity.spec.ts:92-96`:

```ts
    expect(() => resolveId('@deepseek-ai/dsh-client-connection')).toThrow(/purity/)
    expect(() => resolveId('@deepseek-ai/dsh-client-runtime')).toThrow(/purity/)
    expect(() => resolveId('@deepseek-ai/dsh-client-ui-layout/client')).toThrow(/purity/)
```

Crucially — and this is the escape hatch that makes a card possible at all — the error message
itself notes **"type-only imports are erased and never reach this gate."** Every in-repo card
therefore imports its collaborators as `import type` and reaches them through cordis DI at runtime
(e.g. `packages/client/ui-theme/src/client/index.ts:12-17`).

Non-`@deepseek-ai/` specifiers are never inspected (`:217`), so `react`, `zod`, `clsx` all pass
(`scripts/client-bundle-purity.spec.ts:62-68`).

### 4.2 Is it enforced for third-party bundles?

**No — not at build time, and not at load time as a gate.**

- **Build time**: it is a plugin inside the *unpublished* preset. A third-party build simply does
  not run it. The pinning test `scripts/client-bundle-purity.spec.ts` imports the preset by relative
  path (`:7 import { CLIENT_EXTERNALS, clientBundle } from '../packages/client/tsdown.client.ts'`),
  so it only covers this repository.
- **Load time**: there is no scanner over third-party bundle contents. What exists is a *runtime
  mirror by consequence*: an unsatisfiable `require()` throws
  (`system.ts:151-154`), and an unresolvable dynamic import throws
  (`system.ts:167-174`, whose message literally calls itself "the runtime mirror of the bundle
  purity gate"). `packages/client/modules/README.md:9` describes the same branch order.

**Therefore: an outside package is *unassisted*, not *blocked*.** The gate does not reject it; it
simply is not applied to it. But the same constraints bind in effect, because violating them
produces a runtime throw instead of a build error — a strictly worse failure mode. The repo's own
notes agree (`.agents/notes/implemented/architecture/2026-08-12-plugin-owned-settings-surface.md:61`):

> Two frictions remain for an author outside this repository... The browser half must be a
> `dsh.client` package built in the client module system's lazy-CJS factory format, and the
> `clientBundle` preset that emits it lives in `packages/client/tsdown.client.ts` rather than a
> published package.

---

## 5. Publishability — the decisive question

### 5.1 Repository intent: everything needed is publishable

I checked `private` and `publishConfig` on every client package a card touches. **None is
`private: true`; all declare `publishConfig.access: "public"`.** A repo-wide sweep for
`"private": true` across `packages/**` returned **zero** packages.

| Package | `private` | `publishConfig.access` | ships `lib/client.js`? |
|---|---|---|---|
| `@deepseek-ai/dsh-client-runtime` | (unset) | public | yes |
| `@deepseek-ai/dsh-client-modules` | (unset) | public | yes |
| `@deepseek-ai/dsh-client-ui-slots` | (unset) | public | no (node lib only) |
| `@deepseek-ai/dsh-client-ui-primitives` | (unset) | public | no |
| `@deepseek-ai/dsh-client-web-react` | (unset) | public | no |
| `@deepseek-ai/dsh-client-connection` | (unset) | public | yes |
| `@deepseek-ai/dsh-client-locale` | (unset) | public | yes |
| `@deepseek-ai/dsh-client-ui-settings` | (unset) | public | yes |
| `@deepseek-ai/dsh-client-schema-form` | (unset) | public | no |
| `@deepseek-ai/dsh-client-ui-theme` | (unset) | public | yes |
| `@deepseek-ai/dsh-client-ui-settings-plugins` | (unset) | public | yes |

(`files` arrays per each `package.json`; e.g. `ui-settings-plugins/package.json:77-82`.)

So by repository *intent*, the answer to "is it published?" is **yes, all of them are meant to be.**

### 5.2 Registry reality (with an explicit caveat)

**Caveat — measurement limitation.** Direct `registry.npmjs.org` access from this host fails with
`ERR_SSL_SSL/TLS_ALERT_HANDSHAKE_FAILURE`. The only reachable registry is a corporate Azure
Artifacts upstream-proxy feed (`pkgs.dev.azure.com/.../BingUF_OSS`). Such a feed usually mirrors
npmjs on demand, but a 404 there is **not conclusive proof** of absence from npmjs. Treat the
following as strong indicative evidence, not proof.

Observed through that mirror:

| Package | Resolved version |
|---|---|
| `@deepseek-ai/dsh-client-runtime` | `0.0.1-rc.1` |
| `@deepseek-ai/dsh-client-ui-slots` | `0.0.1-rc.1` |
| `@deepseek-ai/dsh-client-modules` | `0.0.1-rc.1` |
| `@deepseek-ai/dsh-client-ui-settings` | `0.0.1-rc.1` |
| `@deepseek-ai/dsh-settings` | `0.0.1-rc.1` |
| `@deepseek-ai/dsh-client-web` | `0.0.1-rc.1` |
| `@deepseek-ai/dsh-client-runtime@0.1.0-rc.7` | **E404 — no match for version** |
| **`@deepseek-ai/dsh-client-ui-settings-plugins`** | **E404 — package not found at all** |

Two distinct gaps:

1. **Version skew.** The published line is `0.0.1-rc.1`; this checkout is `0.1.0-rc.7`. The
   `ClientContext`, `SettingsScope`, and `SlotMap` types in an `0.0.1-rc.1` tarball are not
   guaranteed to match the `0.1.0-rc.7` Host the card must run against. I could not verify the
   contents of the `0.0.1-rc.1` tarball, so the extent of the drift is **not determinable here**.
2. **The slot declarer is missing.** `@deepseek-ai/dsh-client-ui-settings-plugins` is what declares
   `settings.plugin.item` in the `SlotMap` (`src/client/slot-contract.ts:16-21`). The cookbook's card
   imports it type-only for exactly that reason
   (`docs/cookbook/adding-a-settings-card.md:53-54`).

### 5.3 How much does the missing package actually block?

**It blocks type-checking, not execution.** The dependency on `ui-settings-plugins` is a
`import type {}` side-effect import purely to merge the `SlotMap` interface. It is erased before the
bundler runs (the purity gate's own error text confirms erased imports never reach it). At runtime
the card only calls `ctx.slots.inject('settings.plugin.item', ...)` — a **string key**. The section's
tab dispatches on that string; nothing checks provenance.

So an out-of-tree package can work around it by declaring the slot augmentation itself:

```ts
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'settings.plugin.item': { kind: 'keyed'; scope: 'root'; owner: { children?: never } }
  }
}
```

This is a **duplicate declaration** — fragile, unversioned, and it will silently diverge if the
upstream contract changes. It is a workaround, not a supported seam.

### 5.4 Answer to "is `@deepseek-ai/dsh-client-runtime` published?"

**Yes — it exists on the reachable registry, at `0.0.1-rc.1`, and it is not marked private.** It
ships `lib/client.js` and its `.d.ts` tree, and it is the home of `ClientContext`
(`packages/client/runtime/src/client/index.ts:112`: `export type ClientContext = Context`) and the
`SettingsScope` contract types (`:52-54`). Note that runtime exports the scope *contract* only —
the implementation and its Host transport live in `dsh-client-ui-settings`
(`runtime/src/client/index.ts:50-51`), which provides `ctx.settingsScope`
(`packages/client/ui-settings/tests/plugin.client.spec.ts:17-20`).

**The decisive blockers are therefore not "a private package". They are:**
1. the **unpublished `clientBundle` preset** (a build-reproduction burden, fully surmountable);
2. the **version skew** between published `0.0.1-rc.1` and this `0.1.0-rc.7` Host (unquantified);
3. the **absent `ui-settings-plugins` package** (type-only; workaroundable by re-declaring the slot).

None is an absolute wall. All three are "unassisted", matching §4.2's finding.

---

## 6. Worked example: a `legion` card

Below is the complete browser half for namespace `legion`. It deliberately uses **no CSS Modules**
(avoiding the preset-local plugin) and **no `@deepseek-ai` value imports** (satisfying the purity
rules even though nothing enforces them out of tree).

### 6.1 Source — `src/client/index.tsx`

```tsx
import { useSyncExternalStore } from 'react'
import type { ClientContext, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: merges ctx.settingsScope into Context. Erased before bundling.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'

// Slot declaration. Upstream this comes from
// @deepseek-ai/dsh-client-ui-settings-plugins/client, which is not on the
// registry; re-declared locally. Keep in sync with
// packages/client/ui-settings-plugins/src/client/slot-contract.ts.
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'settings.plugin.item': { kind: 'keyed'; scope: 'root'; owner: { children?: never } }
  }
}

export interface LegionSettings {
  enableStrategies?: boolean
}

/** cordis services this plugin needs (unrelated to package.json dsh.client.inject). */
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

function LegionCard({ scope }: { scope: SettingsScope<LegionSettings> }): JSX.Element {
  const snapshot = useSyncExternalStore(scope.subscribe, scope.get)
  const enabled = snapshot.value.enableStrategies ?? false
  return (
    <section>
      <h3>Legion</h3>
      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={e => void scope.set('enableStrategies', e.currentTarget.checked)}
        />
        Enable strategies
      </label>
      {'enableStrategies' in snapshot.user && (
        <button onClick={() => void scope.unset('enableStrategies')}>Reset</button>
      )}
    </section>
  )
}

export function apply(ctx: ClientContext): void {
  const scope = ctx.settingsScope.bind<LegionSettings>({ namespace: 'legion' })
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: 'legion',
    locale: 'settings.legion',
  }, () => <LegionCard scope={scope} />))
}
```

> Verification note: the precise `SettingsScope` member signatures
> (`subscribe`/`get`/`set`/`unset`) are described narratively in
> `docs/cookbook/adding-a-settings-card.md:70`; I did **not** read
> `packages/client/runtime/src/client/contract/settings-scope.ts` line by line, so treat the exact
> hook wiring above as illustrative and confirm it against that file before use.

### 6.2 `package.json` fragment

```jsonc
{
  "name": "dsh-legion",
  "type": "module",
  "exports": {
    ".":        { "types": "./lib/types/index.d.ts",        "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" }
  },
  "dsh": {
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-connection",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-settings"
      ]
    }
  },
  "files": ["lib/index.js", "lib/client.js", "lib/types/**/*.d.ts"]
}
```

Note the `dsh.client.inject` list holds **package names** (graph edges), deliberately omitting
`@deepseek-ai/dsh-client-ui-settings-plugins`: the tab need not be materialized before the card
registers, since `ctx.slots.inject` defers registration until the slot exists.

### 6.3 Build config — `tsdown.config.ts` (preset reproduced by hand)

```ts
import { defineConfig } from 'tsdown'

const ID = 'dsh-legion'

const CLIENT_EXTERNALS = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-client-runtime/client',
]

const MODE = process.env.NODE_ENV ?? 'production'

export default defineConfig([
  // Node half.
  {
    name: ID,
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  // Browser half — must match packages/client/tsdown.client.ts:170-273.
  {
    name: `${ID}/client`,
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...CLIENT_EXTERNALS],
    noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
    define: {
      'process.env.NODE_ENV': JSON.stringify(MODE),
      'import.meta.env.MODE': JSON.stringify(MODE),
      'import.meta.env': JSON.stringify({ MODE }),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
```

### 6.4 The Host half and mounting

The Host half registers namespace `legion` via `installSettingsSection` exactly as the cookbook
shows (`docs/cookbook/adding-a-settings-card.md:13-42`) using `@deepseek-ai/dsh-settings` (present
on the registry at `0.0.1-rc.1`). The card then appears once `cordis.yml` mounts `dsh-legion` and
the package resolves from the `cordis.yml` directory — no rebuild of the web application
(`docs/cookbook/adding-a-settings-card.md:80`).

---

## 7. Residual risks and non-determinable items

- **Not determinable from source:** whether the published `0.0.1-rc.1` tarballs contain
  `ClientContext`/`SettingsScope`/`SlotMap` shapes compatible with a `0.1.0-rc.7` Host. Requires
  downloading and diffing the tarball, which the TLS failure prevented here.
- **Not determinable from this host:** definitive npmjs.org publication status. All registry data
  above came from an Azure Artifacts mirror.
- **Not read line-by-line:** `packages/client/runtime/src/client/contract/settings-scope.ts`. The
  `SettingsScope` API surface used in §6.1 should be confirmed against it.
- **Unversioned coupling:** the locally re-declared `SlotMap` augmentation (§5.3) and the hand-copied
  banner/footer/externals (§6.3) both duplicate upstream constants with no compile-time link. Any
  upstream change to `PLATFORM_MODULES` or the wrapper strings silently breaks the card at runtime.
- **Metadata caching:** a negative verdict is cached forever (`modules/src/index.ts:188-191`), so
  iterating on the manifest requires a Host restart, not just a plugin reload.

## 8. Recommended asks upstream

If `dsh-legion` wants a supported path rather than a reproduced one, the minimal upstream requests
are, in priority order:

1. **Publish `@deepseek-ai/dsh-client-ui-settings-plugins`** so the `settings.plugin.item` slot
   declaration can be consumed instead of re-declared.
2. **Publish the `clientBundle` preset** (e.g. as `@deepseek-ai/dsh-client-tsdown`) so the artifact
   format is versioned rather than hand-copied. Recorded as deferred work at
   `packages/client/ui-settings-plugins/README.md:38`.
3. **Publish the `0.1.0-rc.7` line** of the client packages so third parties can match the Host.
