# Optional Host settings are a configuration source, not a second config system

> **Terminology: ADR 0022.** The retired Legion nouns `Profile` and `Team` became Specialist and Cohort; retired machine spellings remain only where compatibility history requires them.

- Status: Accepted
- Date: 2026-08-17

DSH 0.1.0-rc.7 serves every registered settings namespace to configuration surfaces instead of an allowlist, so a plugin-owned namespace is now worth registering. Legion registers one namespace, `legion`, resolved by the same Schemastery `Config` schema the composition entry already uses. Settings are a *source* for that one schema; Legion gains no second configuration vocabulary, no settings-only fields, and no precedence rules of its own. The Host resolves schema defaults, then Legion's composition entry as the `base` layer, then the stored user section.

The seam is detected structurally rather than imported. `detectSettingsCapabilities` reads the `settings` service the same way `detectDurableCapabilities` reads coordination services (ADR 0020), so Legion takes no peer dependency on `@deepseek-ai/dsh-settings` and a deployment that never mounts a settings provider runs none of this code and keeps its composition entry verbatim. A settings provider that detaches restores the entry as the source; a stored section Legion cannot materialize fails the registration, is reported once, and leaves the entry authoritative.

Publication stays exactly as ADR 0014 defines it. `PublishedGeneration` already swapped an immutable definition and snapshot when provider or adapter facts changed; this ADR only widens the inputs of a generation from runtime facts to *(configuration, prompt-fragment resources, runtime facts)*. Configuration and its ADR 0006 resource snapshot move together, because a Specialist's fragments are named by the same document that names the Specialist.

Republication is asynchronous because loading fragments is, so it is serialized: one pass in flight, one pending follow-up, last commit wins. A failed reload degrades to staleness — the last publishable generation stays registered — instead of withdrawing the delegation surface. Renaming the tool is the one case the atomic swap cannot cover, since the Host keys registrations by name; the old name is withdrawn before the new one is registered, and the system-prompt section keeps the identity it was registered under.

Legion ships both halves. The browser card is an ordinary DSH client bundle keyed on the same namespace, so the plugin configuration tab pairs the two without either side learning about the other.

Shipping that half originally cost three hand-maintained couplings. DSH later published the `settings.plugin.item` slot declaration and same-line client contracts, which Legion now imports so surface drift fails `typecheck`. DSH's client bundle build preset remains unpublished, so `tsdown.client.config.ts` still mirrors its artifact format and `tests/client-bundle.spec.ts` executes the built artifact under the loader's own protocol. This surviving coupling is an accepted permanent limitation documented in `docs/settings-card.md`.
