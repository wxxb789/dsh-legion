# Live reconfiguration through DSH settings

Legion registers one settings namespace, `legion`, whenever the Host mounts a settings provider. The namespace is resolved by the same `Config` schema as the `cordis.yml` entry, so there is nothing new to learn: every field documented for the composition entry is a field of the settings section.

## Layers

The Host resolves three layers, last one wins per field:

1. `Config` schema defaults.
2. Legion's composition entry, supplied as the `base` layer.
3. The stored user section.

A field's **presence** in the user section is what marks it overridden. Clearing a field lets it fall back to the composition entry.

## What a commit does

A committed change republishes the Legion tool generation: the catalog is recompiled, prompt fragments are reloaded through the ADR 0006 loader, and the tool schema and coordinator guidance are swapped. Delegations already in flight are unaffected — they hold the plan they started with.

Republication is serialized and last-commit-wins. Two commits landing together produce one republication for the newer one.

## Failure behaviour

| Situation | Result |
|---|---|
| No settings provider mounted | Legion runs on its composition entry; nothing is registered. |
| Stored section fails the schema or `materializeConfig` | The registration is refused, `LEGION_SETTINGS_REGISTRATION_REJECTED` is logged once, and the composition entry stays authoritative. |
| A commit cannot be materialized or its fragments cannot be loaded | The last published generation stays registered; the failure is logged. |
| The settings provider detaches | The composition entry becomes the source again and Legion republishes from it. |
| Legion's own fiber unloads | Republication stops; no generation is rebuilt against a disposing fiber. |

## Why serving this namespace is safe

DSH does not yet refuse to serve a namespace whose secrets it cannot prove redactable, and a serialized schema can carry secret defaults. That gap does not reach Legion: the `Config` schema declares no `role('secret')` field and holds no credential. It names providers, models, tools, personas, and prompt-fragment roots — the same policy data the `cordis.yml` entry already commits to the repository. Credentials stay in DSH's own `credentials` domain, which Legion never reads.

Keep it that way. A future field that would carry a secret belongs behind a credential reference, not in this section.

## Renaming `toolName`

A committed `toolName` change withdraws the old registration and registers the new one, because the Host keys tool registrations by name. The system-prompt section keeps the name it was first registered under.

## Inspecting the seam

```ts
import { detectSettingsCapabilities } from 'dsh-legion'

const snapshot = detectSettingsCapabilities(ctx)
// { liveReconfiguration: boolean, namespace: 'legion', diagnostics: readonly [...] }
```

Detection is read-only and registers nothing, so diagnostics can call it without changing what the deployment publishes.

## Web settings card

Legion registers the Host half only. DSH serves the namespace, but the **Plugin configuration** tab renders a card only for a namespace some browser half claims. DSH's `clientBundle` preset is not published yet, and its bundle-purity gate requires a third-party card to reproduce the loader artifact format and own its staging and revision fencing, so Legion defers the card. Until then, edit the namespace through the Host's settings document or any other settings consumer.
