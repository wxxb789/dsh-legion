# The Legion settings card

Legion ships both halves of its settings surface: the Host half registers the `legion` namespace (see [live reconfiguration](settings.md)), and the browser half draws it as a card on the Web **Settings → Plugins → Plugin configuration** tab.

DSH pairs the two automatically. The tab keys each card on the settings namespace it edits, so a plugin that registers both halves under the same namespace is matched without the tab ever learning what the namespace means.

## What the card edits

Five scalar policies, the ones worth changing while the harness runs:

| Control | Field | Effect |
|---|---|---|
| Tool name | `toolName` | Renames the delegation tool; the tool is republished under the new name. |
| Default profile | `defaultProfile` | Profile used when a call omits one. |
| Prompt fragment budget | `maxResourceBytes` | Maximum combined prompt-fragment bytes loaded for one profile. |
| Background delegation | `enableRunInBackground` | Whether the tool accepts `run_in_background`. |
| Model-callable Strategies | `enableStrategies` | The explicit authority gate; off by default. |

Profiles, routes, Teams, Strategies, and catalog layers stay in the configuration document on purpose. They are structured data whose validity depends on other entries, and a form that let them be edited field-by-field would publish half-built catalogs.

## How editing behaves

Every settings write is a durable, revision-fenced document mutation, so the card **stages** edits and writes them only when you press Save. What is on screen is exactly what a save would store. Staged edits survive collapsing the card, and the header says so.

Each control shows whether the user layer carries that field. That presence — not a value comparison — is what marks a field overridden: an override equal to the composition default is still an override. **Reset** stages a clear so the field re-inherits the composition layer, and seeds the control with the value it will re-inherit, so the reset previews its own outcome rather than blanking the control.

Only a real change counts as an edit. Retyping the value the section already holds, or clearing a field the user layer never carried — through **Reset** or by choosing `Inherit` — leaves the card clean and the Save button disarmed.

The boolean controls are tri-state: `Inherit` takes the composition layer's value, `On` and `Off` write an explicit one. All three are visible at once rather than collapsed into a list, because inheriting is a different decision from the value it happens to resolve to today. They are a radio group, so the exclusivity and the arrow-key traversal are the browser's rather than re-implemented.

The Host is the only authority on whether a value was accepted — its validators own constraints no schema can express — so a save reads the section back and reports whether the staged value is what the Host now holds. A save that did not land keeps your drafts and says so, rather than silently reverting. Where the schema's own range is known, as for the byte budget, the control refuses the draft itself instead of sending a write the Host would reject.

The card renders nothing at all while the Host does not serve the namespace, because showing an empty shell would claim a surface the deployment never composed. A read-only document is shown as one: the controls are disabled and the card says why.

## How it is drawn

The plugin configuration tab renders every contributed card into one list, so this card is a list item with the same disclosure chrome DSH's own plugin cards use: a stacked name and description, an `Unsaved` marker, and a footer carrying Discard and Save. Its geometry and its `--dsw-alias-*` tokens mirror the upstream card stylesheet, with one deliberate divergence — upstream colours error copy with `--dsw-alias-label-error`, which the theme palette does not declare, so this card uses `--dsw-alias-state-error-primary`, which it does.

Form controls are plain elements styled by the card's own stylesheet, for the same reason DSH's own cards use plain elements: the `Button` and `Input` atoms are toolbar-sized capsules, not settings-row density. The disclosure chevron does come from `@deepseek-ai/dsh-client-ui-primitives`, so the card uses the platform glyph rather than a copied path.

## Packaging

The browser half is an ordinary DSH client bundle: `lib/client.js`, declared by `exports["./client"]` and `dsh.client.platform: "web"`. The Host's client module registry discovers it by resolving `dsh-legion/package.json` from the composition root, then serves the bundle to the page. Mounting `dsh-legion` is all it takes — the web application is not rebuilt.

A negative discovery verdict is cached for the process lifetime, so a harness that started before the declaration existed needs a **restart**, not just a plugin reload.

## Why this half is unusual

Three DSH facts shape the implementation, and all three are worth knowing before editing it:

1. **The artifact is a wire format.** The loader fetches the bundle outside any module graph and evaluates it as a lazy CJS factory that calls `window.__ModuleLoader__.load({ id, factory })`. The `id` must equal the package name. `tsdown.client.config.ts` reproduces that shape; DSH's own preset for it is unpublished, so the constants there are a hand-maintained mirror with no compile-time link to upstream.

2. **Platform modules are resolved by the Host, not installed.** React and the DSH client packages are answered by the Host's frozen module table at load time. A `require` the table cannot answer throws at load. That is why the bundle's externals list must stay exactly the module table, and why `tests/client-bundle.spec.ts` executes the artifact under the loader's own protocol and asserts every requested specifier.

3. **A client bundle may not import another plugin's values.** Doing so either duplicates a runtime instance or requests a specifier the table cannot answer. So the card owns its chrome, its staged form, and its revision fencing rather than borrowing the ones DSH's own cards use. `PluginCard`, `ValueField`, and `CardForm` live in `@deepseek-ai/dsh-client-ui-settings-plugins`, which is not in the module table; `src/client/` mirrors their behaviour and geometry instead, and diverges only where upstream is wrong.

Because none of those packages can be ordinary dependencies here, the surface Legion uses is declared locally in `src/client/dsh-client.d.ts`. That is a deliberate, minimal, hand-maintained coupling: an upstream change will not fail the build, it will fail the card at load time. The card keeps its React surface to `createElement` and holds its disclosure state in its own store rather than reaching for hooks, so that declaration stays one function wide.

## Upstream requests that would remove the hand-maintenance

1. Publish the `settings.plugin.item` slot declaration so it need not be re-declared.
2. Publish the client bundle preset so the artifact format is versioned rather than copied.
3. Publish the client packages on the same line as the Host so a third party can typecheck against the version it targets.
4. Put the settings-card layout in the module table — `PluginCard` and the field controls, or their equivalent in `ui-primitives` — so a third-party card inherits the tab's chrome instead of re-deriving it from upstream source each release.
