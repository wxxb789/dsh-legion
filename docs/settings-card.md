# The Legion settings card

Legion ships both halves of its settings surface: the Host half registers the `legion` namespace (see [live reconfiguration](settings.md)), and the browser half draws it as a card on the Web **Settings → Plugins → Plugin configuration** tab.

DSH pairs the two automatically. The tab keys each card on the settings namespace it edits, so a plugin that registers both halves under the same namespace is matched without the tab ever learning what the namespace means.

## What the card edits

Four scalar policies, the ones worth changing while the harness runs:

| Control | Field | Effect |
|---|---|---|
| Tool name | `toolName` | Renames the delegation tool; the tool is republished under the new name. |
| Default profile | `defaultProfile` | Profile used when a call omits one. |
| Background delegation | `enableRunInBackground` | Whether the tool accepts `run_in_background`. |
| Model-callable Strategies | `enableStrategies` | The explicit authority gate; off by default. |

Profiles, routes, Teams, Strategies, and catalog layers stay in the configuration document on purpose. They are structured data whose validity depends on other entries, and a form that let them be edited field-by-field would publish half-built catalogs.

## How editing behaves

Every settings write is a durable, revision-fenced document mutation, so the card **stages** edits and writes them only when you press Save. What is on screen is exactly what a save would store.

Each control shows whether the user layer carries that field. That presence — not a value comparison — is what marks a field overridden: an override equal to the composition default is still an override. **Reset** clears the field so it re-inherits the composition layer, and takes effect on the next save like any other edit.

The boolean controls are tri-state: the dash inherits, `on` and `off` write an explicit value.

A save that does not land keeps your drafts and says so, rather than silently reverting to what the Host holds. The card renders nothing at all while the Host does not serve the namespace, because showing an empty shell would claim a surface the deployment never composed.

## Packaging

The browser half is an ordinary DSH client bundle: `lib/client.js`, declared by `exports["./client"]` and `dsh.client.platform: "web"`. The Host's client module registry discovers it by resolving `dsh-legion/package.json` from the composition root, then serves the bundle to the page. Mounting `dsh-legion` is all it takes — the web application is not rebuilt.

A negative discovery verdict is cached for the process lifetime, so a harness that started before the declaration existed needs a **restart**, not just a plugin reload.

## Why this half is unusual

Three DSH facts shape the implementation, and all three are worth knowing before editing it:

1. **The artifact is a wire format.** The loader fetches the bundle outside any module graph and evaluates it as a lazy CJS factory that calls `window.__ModuleLoader__.load({ id, factory })`. The `id` must equal the package name. `tsdown.client.config.ts` reproduces that shape; DSH's own preset for it is unpublished, so the constants there are a hand-maintained mirror with no compile-time link to upstream.

2. **Platform modules are resolved by the Host, not installed.** React and the DSH client packages are answered by the Host's frozen module table at load time. A `require` the table cannot answer throws at load. That is why the bundle's externals list must stay exactly the module table, and why `tests/client-bundle.spec.ts` executes the artifact under the loader's own protocol and asserts every requested specifier.

3. **A client bundle may not import another plugin's values.** Doing so either duplicates a runtime instance or requests a specifier the table cannot answer. So the card owns its chrome, its staged form, and its revision fencing rather than borrowing the ones DSH's own cards use.

Because none of those packages can be ordinary dependencies here, the surface Legion uses is declared locally in `src/client/dsh-client.d.ts`. That is a deliberate, minimal, hand-maintained coupling: an upstream change will not fail the build, it will fail the card at load time.

## Upstream requests that would remove the hand-maintenance

1. Publish the `settings.plugin.item` slot declaration so it need not be re-declared.
2. Publish the client bundle preset so the artifact format is versioned rather than copied.
3. Publish the client packages on the same line as the Host so a third party can typecheck against the version it targets.
