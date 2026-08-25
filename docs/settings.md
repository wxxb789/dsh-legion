# Live reconfiguration through DSH settings

Legion serves one settings namespace, `legion`, whenever the Host mounts a settings provider. The namespace is resolved by the same `Config` schema as the `cordis.yml` entry, so there is nothing new to learn: every field documented for the composition entry is a field of the settings section.

## Which row owns it

A namespace is process-wide; a Specialist catalog belongs to the row that composed it. Legion splits along that line.

The **settings row** owns the namespace. It is the Host-plane row the bundle patch installs — `role: settings`, no Specialists — and it contributes nothing else: no tool, no prompt section, no projection, no service. Registering a namespace is an effect on the registering fiber, so this row is what keeps the card on the Settings → Plugins tab for the whole process instead of only while a session using the Legion preset happens to be alive.

Every **delegation row** — the ordinary `role: delegation` row in your Agent Preset — consumes what that row serves. It never registers the namespace a second time (the Host refuses a duplicate loudly), so any number of concurrent sessions read the same stored section and each republishes its own tool.

Which half a row runs is decided by what the Host already serves, not by configuration. A deployment that mounts no settings row at all still works: the single delegation row finds the namespace unserved, registers it, and behaves exactly as it did before — for as long as that row's fiber lives.

The `role` is read from the row's composition entry and is deliberately never taken from the settings layer. A stored section that could flip a row to `settings` would withdraw every delegation surface in the deployment from inside the document meant to configure it.

That split moves one class of error from write time to read time, and a card user sees the difference. A write the schema rejects is refused as you save it, with the reason on the card. A write that only a catalog can judge — a `defaultProfile` naming a Specialist no row defines, most of all — is accepted and saved by the row that owns the namespace, and then materializes nowhere: each delegation row keeps the generation it last published and logs `LEGION_SETTINGS_REGISTRATION_REJECTED`. The card shows the value it stored; the Host log is where you find out it took effect nowhere.

## Layers

Three layers resolve a delegation row's configuration, last one wins per field:

1. `Config` schema defaults.
2. **That row's own** composition entry.
3. The stored user section.

Plain objects merge recursively; arrays and scalars replace the layer below wholesale. This is the order the Host applies to a registrant's `base`, applied by each delegation row to its own entry — so the preset that names your Specialists stays underneath your edits, and the settings row's empty catalog never gets between them.

A field's **presence** in the user section is what marks it overridden. Clearing a field lets it fall back to the composition entry.

## What a commit does

A committed change republishes the Legion tool generation: the catalog is recompiled, prompt fragments are reloaded through the ADR 0006 loader, and the tool schema and coordinator guidance are swapped. Delegations already in flight are unaffected — they hold the plan they started with.

Republication is serialized and last-commit-wins. Two commits landing together produce one republication for the newer one.

## Failure behaviour

| Situation | Result |
|---|---|
| No settings provider mounted | Legion runs on its composition entry; nothing is registered yet. Both halves attach through an injected scope and wait for a provider instead of going inert, so a settings provider composed after the row still reaches it. `detectSettingsCapabilities` reports `LEGION_SETTINGS_SERVICE_UNAVAILABLE` for the moment it is asked; no row logs it, because a provider that is not there yet is not a failure. |
| Stored section fails the schema | The owner refuses the write while the caller is still there to read why, so the card reports it and nothing is persisted. |
| Stored section fails `materializeConfig` | The owner accepts and persists it, because that check is catalog-dependent and the owner judges no catalog. Each delegation row then falls back — it keeps its last published generation, or its composition entry if it never published one — and logs `LEGION_SETTINGS_REGISTRATION_REJECTED` once per distinct failure. |
| A stored section one row cannot materialize | Only that row falls back and logs; every other row keeps publishing. The namespace owner validates what holds for any catalog — a blank `toolName`, an inverted `durableRunPolicy`, an unusable resource root — and leaves catalog cross-references such as `defaultProfile` to each row, because a Specialist name valid for the row that defines it is invalid for the row beside it. |
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

Legion ships the browser half too: the namespace appears as a card on **Settings → Plugins → Plugin configuration**. See [the settings card](settings-card.md) for what it edits, how staging works, and the hand-maintained couplings it carries.
