# Optional Host settings are a configuration source, not a second config system

- Status: Accepted
- Date: 2026-08-17

DSH 0.1.0-rc.7 serves every registered settings namespace to configuration surfaces instead of an allowlist, so a plugin-owned namespace is now worth registering. Legion registers one namespace, `legion`, resolved by the same Schemastery `Config` schema the composition entry already uses. Settings are a *source* for that one schema; Legion gains no second configuration vocabulary, no settings-only fields, and no precedence rules of its own. The Host resolves schema defaults, then Legion's composition entry as the `base` layer, then the stored user section.

The seam is detected structurally rather than imported. `detectSettingsCapabilities` reads the `settings` service the same way `detectDurableCapabilities` reads coordination services (ADR 0020), so Legion takes no peer dependency on `@deepseek-ai/dsh-settings` and a deployment that never mounts a settings provider runs none of this code and keeps its composition entry verbatim. A settings provider that detaches restores the entry as the source; a stored section Legion cannot materialize fails the registration, is reported once, and leaves the entry authoritative.

Publication stays exactly as ADR 0014 defines it. `PublishedGeneration` already swapped an immutable definition and snapshot when provider or adapter facts changed; this ADR only widens the inputs of a generation from runtime facts to *(configuration, prompt-fragment resources, runtime facts)*. Configuration and its ADR 0006 resource snapshot move together, because a Profile's fragments are named by the same document that names the Profile.

Republication is asynchronous because loading fragments is, so it is serialized: one pass in flight, one pending follow-up, last commit wins. A failed reload degrades to staleness — the last publishable generation stays registered — instead of withdrawing the delegation surface. Renaming the tool is the one case the atomic swap cannot cover, since the Host keys registrations by name; the old name is withdrawn before the new one is registered, and the system-prompt section keeps the identity it was registered under.

Legion registers only the Host half. The browser card half is deferred: DSH's `clientBundle` preset is unpublished and its bundle-purity gate requires a third-party card to reproduce the artifact format and re-implement staging and revision fencing. Until that is published, a served namespace with no card renders nothing, which is a missing surface rather than a broken one.
