# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Host-sourced token accounting in Run Receipts.** Ephemeral Cohort Runs sample each reachable child Session through `ctx.tokenMeter.measure` and the Host token-usage projection only when registry status changes or a stage settles. Every sample keeps uncached input, cache reads, cache writes, and output disjoint, binds the reading to its child and tree position, and explicitly sums the per-Session rows because the Host publishes no delegation-tree roll-up. The bounded tool result exposes only fixed totals, and neither the Receipt nor its summary introduces a monetary or currency value.
- **Host-sourced live participation in Run Receipts.** Ephemeral Cohort Runs subscribe to the Host Agent registry's `agent/status`, `agent/created`, and `agent/disposed` events before backfilling its current listing; each published one-shot child is bound by its Host-enforced child/session identifier, and terminal reconciliation reads the cold `listDescendants` tree without loading Agents. Projection snapshots expose each child as either live with the registry's exact `idle | running` status or ended with no fabricated third status, while tool results stay bounded to fixed running/idle/ended counts.
- **A dependency-availability preflight over the compatibility policy contract.** `pnpm run verify:dependency-preflight` reads the declared Host package closure and every declared version line from `contracts/compatibility.json` — never from a second list of its own — resolves each declared package against the registry, and reports a gap by naming the package, the unsatisfiable range, and the versions the registry actually publishes. It classifies an unsatisfiable declared line as an **upstream publish gap** (exit 1) and a self-contradicting contract as a **local regression** (exit 2), so a red branch cannot misattribute blame; evidence it could not establish — an unreachable registry, an unreadable contract, a range grammar it does not evaluate, or a declared package the snapshot never recorded — is its own outcome (exit 3) rather than a pass; and drift between the declared latest-tested Host version and the highest version actually resolvable across the whole closure is an advisory that does not fail the gate. It runs in the quality job ahead of the packed profile install and in the rolling compatibility canary ahead of its live install, so the fast precise diagnostic precedes the slow ambiguous one. The condition that broke main was not a missing version: every declared line was published, and what could not resolve was the version an unpinned consumer actually installs — the highest the declared peer range admits — because that upstream build requires its siblings through `^0.1.1` while the registry holds only `0.1.1-rc.x`, and npm admits a prerelease only against a comparator carrying a prerelease on the same `major.minor.patch` tuple. The preflight therefore walks the resolution the way a package manager does: it seeds every declared line and the top of the declared peer range, resolves each `@deepseek-ai/dsh-*` range to the highest published version satisfying it, and follows that version's own requirements — so a gap several hops out, in a package the contract never names, is reported with the chain that reaches it. The gate records the registry answer it used, and CI keeps that recording as an artifact, so a live verdict can be replayed offline instead of re-run against a registry that has already moved. That recording then settled what the packed install failure actually is: across 34 packages and 321 published manifests, no `@deepseek-ai/dsh-*` range is stable-floored and every published range resolves, so the `>=0.1.1 <0.2.0-0` in the install error is synthesised by the package manager while auto-installing a peer it resolved to a prerelease — not published by anyone. The preflight reports that precondition as `LEGION_PRERELEASE_ONLY_RESOLUTION` and does not fail on it, because neither the contract nor the registry is wrong. The unit gate stays offline and deterministic against the recorded snapshots in `tests/fixtures/registry/`, which include the observed failure shape — a highest published version below the declared line while a dist-tag advertises a version that does not exist — and the live resolution path runs only where network dependence is already accepted. See [the solution note](docs/solutions/integration-issues/upstream-publish-gap-reads-as-a-legion-regression.md).

- A **Prompt fragment budget** control on the settings card for `maxResourceBytes`, bounded by the same range the `Config` schema accepts. A draft outside that range is reported on the control itself instead of being sent for the Host to refuse, and `tests/client-bundle.spec.ts` pins the card's bounds against the schema so the two cannot drift.
- **The bundled preset now runs in PTC mode** — the Web client labels it PTC mode — by composing the official `@deepseek-ai/dsh-agent-tool-presentation` row at `mode: ptc`. Coordination is the work PTC mode is best at: one `run_code` program starts several delegations together, waits on them as values, and reduces their results without a model round trip per child, so the guidance Legion already injects ("start independent delegations together") stops being a suggestion and becomes an ordinary `Promise.all`. The agents that preset delegates to inherit the same mode, because `dsh-agent-presets` re-parents a child's scope onto the preset's standing scope. Selecting a presentation by composing the official row and owning one are opposite acts, and Legion still does only the first: its source declares no presentation, injects no `codeRuntime`, and names the reserved transport nowhere, so it tracks whatever PTC mode currently is. There is deliberately no Legion setting for this — a plugin key would compete with the official row for one decision. The row waits for the host's `codeRuntime`, so a deployment composing no TypeScript runtime fails the preset at mount, naming the row, instead of at the first request; both shipping bundles compose one.
- A missing TypeScript runtime is now reported as an install instruction rather than left to be inferred. Legion is a development coordinator and PTC mode is the mode it is built for, so when `ctx.codeRuntime` is absent it logs the package to add (`@deepseek-ai/dsh-code-runtime-worker-thread`) and the Host composition row that adds it, then keeps working in the native presentation. It is a notice, never a refusal: Legion delegates fine in native, and taking the runtime as an `inject` dependency would make the Legion row unmountable on exactly the deployments the notice exists to help. The probe is one read-only `ctx.get?.('codeRuntime')`, the same structural idiom `detectDurableCapabilities` already uses, and the suite asserts both that it stays a probe and that the notice fires only when a runtime is genuinely absent. Documentation follows the same line: a runtime-less deployment should install the runtime, and `mode: native` is for deliberately wanting native tools rather than for working around a missing one.
- The append-to-your-preset fragment carries no presentation row, because one composition selects one presentation and a second declaration is refused rather than merged — a row there would break exactly the base preset a PTC-mode user starts from. `tests/tool-presentation.spec.ts` pins both sides, with a negative control so a scan that could never fire cannot pass as a gate, and `docs/notes/code-mode-inheritance.md` records the evidence — including that profile `toolFilter` keeps its meaning under PTC mode, since the SDK binding table is built from the calling agent's visible set, so the `review` profile's deny of `write`/`edit` holds in both presentations.
- A child failure now carries the provider's own account when the Host supplies one: DSH 0.1.0-rc.8 added `SubagentResult.diagnostic`, and Legion appends it to the stop-reason sentence instead of replacing it, keeping it separate from the child's `output` as the contract requires. The field is read as `unknown` and validated rather than declared: the declared peer floor has since moved to 0.1.1-rc.1, where the member exists, but a validated read is also what keeps the sentence correct on a Host below the declared floor, whose `SubagentResult` carries no such member.

### Fixed

- **The settings card no longer comes and goes with sessions.** Legion's `cordis.patch.yml` was empty, so the package was mountable only from an Agent Preset — and both halves of a settings surface are process-wide. A namespace registration is an effect on the registering fiber, so `legion` was served exactly while a session using that preset was alive: the card appeared mid-session, vanished when the last one ended, was absent after a restart, and values already saved stayed in the user document with no way left to edit them. The Web half failed for a second, independent reason: the client module registry composes its table from the Host loader entries, and a preset subtree is plugged directly rather than created as a loader entry, so the card bundle was never discovered and never served to the page. The bundle patch now installs one Host-plane row that owns the namespace and the card and contributes nothing else — no tool, no prompt section, no projection, no service — because `tools` and `system-prompt` are layered registries and a Host row publishing a delegation surface would hand one to every agent in the process. See [ADR 0022](docs/adr/0022-host-plane-settings-row.md).
- Two concurrent sessions both get live reconfiguration. The Host refuses a duplicate namespace loudly, so the second preset row's registration used to be refused and that session silently fell back to its composition entry for the rest of its life. A row now registers only what nothing else serves; beside a served namespace it reads the stored section instead.
- `examples/legion.agent.cordis.fragment.yml` is valid YAML again. `enableDurableRuns` sat at column zero instead of under `config`, so the fragment the README names as the recommended install path could not be parsed at all. No gate had ever loaded it; the new presentation suite does, and caught it on its first run.
- Legion's `ctx.sessionProjections` unit is registered in a shape every DSH release the peer range admits can drive. DSH 0.1.1-rc.1 renamed `ProjectionDefinition.schema` to `stateSchema` and moved the client view into an optional `wire` member; Legion reaches that registry structurally, so the rename could not reach the compiler. The stale shape registered without complaint and then threw a `TypeError` inside the Host's own `restore()` the first time the persisted projection cache read a checkpoint row back. The Host catches that and recovers by refolding the whole log, so the cost was silent rather than loud: every cold snapshot discarded every unit's cached row and refolded the entire session from seq 0 for as long as Legion was mounted, at a price that grows with session length. `legionRunProjection` now carries both names over one parser, and omits `wire`, which is the correct classification: run state is host-only and no Legion surface reads it from a client snapshot.
- The declared DSH peer range now admits 0.1.1-rc.1. `>=0.1.0-rc.6 <0.2.0` did not: semver accepts a prerelease only against a comparator carrying a prerelease on the same `major.minor.patch`, so a range anchored on the `0.1.0` tuple rejects every `0.1.1-rc.x` build. The second clause is the assessment record — a DSH prerelease line enters the range once it has been tested — and later prereleases of the same line are admitted automatically.

### Changed

- **The assessed DSH line is now 0.1.2-alpha.1.** Legion follows the client Runtime split through `@deepseek-ai/dsh-client-store` and the feature-owned client contracts, selects official PTC mode with `mode: ptc`, uses the Host `ToolCallId` brand, derives prompt placement from `FIRST_PARTY_SECTION_ORDER`, and preflights the new `SubagentCapabilities.agentOptions` flag before child start. Provider snapshot v1 remains readable and defaults the newly introduced authority to `false`. CI compatibility channels resolve from `contracts/compatibility.json` instead of copying version literals. Because this Host line refuses persisted event types outside its generated vocabulary and exposes no plugin registration seam, Run Receipt events remain available for non-persistent Sessions but are not appended when `ctx.sessionPersistence` is mounted; journal Strategy mutation remains fail-closed. The complete source audit is in `docs/notes/dsh-0.1.2-alpha.1-upgrade.md`.
- **Upgrade cutover is explicit.** DSH 0.1.2-alpha.1 writes Subagent descriptor version 3 and has no reader for persisted version-2 children, so deployments must finish and recreate continuable children before switching unless upstream adds a tested migration. Back up Session artifacts before cutover; do not rewrite descriptor events by hand.
- **The client bundle now compiles against the Host's published feature-owner contracts.** Store values come from `@deepseek-ai/dsh-client-store`; SettingsScope comes from `dsh-client-ui-settings`; Context comes from Cordis; renderer and Session UI declaration merges are type-only. The bundle derives its package id from `package.json` and externalizes the bare imports it actually uses instead of copying DSH's platform table. The loader-protocol suite executes those requests against the supported Host table, so drift fails locally.
- The settings card now draws itself as a disclosure card, matching the chrome DSH's own plugin cards use as of 0.1.0-rc.8. The plugin configuration tab renders every card into one `<ul>`, so the card is a list item with a stacked name/description header, an `Unsaved` marker that survives collapsing, a read-only notice, and a footer that reports a save in flight — rather than an always-open `<section>` that read as a different kind of object than its neighbours.
- Boolean policies use an exclusive three-option radio group instead of a dropdown, so `Inherit` is visible as a distinct choice from the value it currently resolves to rather than hidden inside a collapsed list, and its exclusivity and arrow-key traversal reach assistive technology natively.
- Saving now judges the outcome from what the Host holds afterwards instead of treating "no exception" as success. The Host owns constraints no schema can express, so a write it silently refuses is reported as a save that did not land, with the drafts kept for correction.
- Retyping the value the section already holds is no longer an edit, and clearing a field the user layer never carried is no longer a pending change — whether that clear was staged through **Reset** or by choosing `Inherit`. Neither now marks the card dirty, arms the Save button, or sends an unset for a field nobody had overridden.
- **Reset** seeds the control with the composition layer's value, so it previews what the field re-inherits instead of blanking and implying the setting is about to disappear.
- Form controls are plain elements styled by the card's own stylesheet rather than the `Button`/`Input` atoms, for the reason DSH's own cards use plain elements: those atoms are toolbar-sized capsules, not settings-row density. The card still takes its disclosure chevron from `@deepseek-ai/dsh-client-ui-primitives`, so it uses the platform glyph rather than a copied path.
- Journal Strategy execution is now exposed on one condition instead of two independent ones: `durableActivationAvailable` gates the model-facing `execution` parameter on a bound durable Strategy activation adapter, not on Host capabilities alone. No build binds an adapter yet, so the parameter stays out of the published schema on every Host rather than advertising a request that always fails closed, and the strategy branch of the parameter schema now carries `execution` whenever it is exposed instead of silently dropping it.
- `LEGION_DURABLE_EXECUTION_ADAPTER_UNAVAILABLE` states that this build binds no activation adapter, instead of attributing the gap to the Host.
- Compatibility policy records DSH 0.1.0-rc.8 as the latest tested version, and the packed `latest-tested` matrix channel targets it. Neither 0.1.0-rc.7 nor 0.1.0-rc.8 changes a type Legion imports, and the three breaking changes in 0.1.0-rc.8 all miss this plugin: it never configures subagent report delivery, asserts nothing about report turn boundaries, and folds only its own `legion/*` events, never `assistant/message`. Durable mutation stays fail-closed because no release provides atomic run coordination; the 0.1.0-rc.8 Agent Teams packages carry their own durable mailbox and task DAG but are private and unpublished.
- **Legion tracks the current DSH release line.** The compatibility policy now declares `>=0.1.1-rc.1 <0.2.0`, a declared minimum of 0.1.1-rc.1, a latest-tested version of 0.1.1-rc.2, and an assessed-version list of exactly those two — advanced together in one change, because a version field advanced alone is how a claim goes stale between the contract, the manifest, the matrix, and the canary. The eleven DSH `devDependencies` move to 0.1.1-rc.2 with them and the lockfile is regenerated, so `typecheck` and the unit gate compile against the line Legion claims instead of one two release lines behind it. The narrowed range also excludes a stable `0.1.0`, which the Host has never published, so the only deployments it drops are those on a `0.1.0-rc.x` prerelease. Retiring that floor costs nothing measurable: `docs/notes/dsh-0.1.1-rc.2-upgrade.md` records that rc.1 and rc.2 are byte-identical across every package Legion imports or reaches structurally — no package added, removed, or renamed; the projection registration contract untouched; the client platform module table identical — so the two ends of the declared range differ in nothing Legion compiles against, and the packed `minimum` channel still installs the floor from the registry on four of the eight compatibility slots. The two shims written for the retired floor are kept rather than removed here: `SubagentResult.diagnostic` is still read as `unknown` and validated, and the projection unit still carries both the `stateSchema` and the `schema`/`view` spellings, so a deployment that ignores its peer warning cannot silently defeat its own projection cache. `scripts/verify-packed-delegation.mjs` now takes its fallback DSH version from the declared minimum instead of a second literal.
- Compatibility policy records DSH 0.1.1-rc.1 as the latest tested version, and the packed `latest-tested` matrix channel and the rolling compatibility canary both target it. `tests/release.spec.ts` now pins both CI channels against `contracts/compatibility.json` instead of against literals, so a policy bump that leaves the matrix behind fails the gate rather than publishing an untested claim. Durable mutation stays fail-closed: no release through 0.1.1-rc.1 provides atomic run coordination, and `withFileLock`'s new `waitMs` lengthens a wait without adding a guarantee.
- The package no longer declares a package-level `inject`. `agents`, `tools`, `subagents`, and `systemPrompt` are the services a delegation row uses, so they are declared as `DELEGATION_INJECT` on the inner plugin `apply` mounts for a non-settings row; the Host-plane settings row waits for none of them and mounts on a composition that serves settings without a subagent backend, where a package-level dependency would have left it pending with a missing card as the only symptom. `inject` accordingly left the public export list in `contracts/v1.json` and `DELEGATION_INJECT` joined it.
- A settings-card write naming a `defaultProfile` no row defines is now accepted and persisted rather than refused while the caller is still there to read why. The row that owns the namespace validates only catalog-independent facts, because a Profile name valid for the row that defines it is invalid for the row beside it and one owner cannot refuse a write on every catalog's behalf; each delegation row then fails to materialize the committed section, keeps its last published generation, and logs `LEGION_SETTINGS_REGISTRATION_REJECTED`. `docs/settings.md` states the write-time-versus-read-time consequence for a card user.
- The client bundle's module-table mirror drops three rows DSH 0.1.0-rc.8 removed — `dsh-client-web-react` (renamed to `dsh-client-ui-renderer` and delisted), `dsh-client-ui-attachment` (now an ordinary client plugin), and `dsh-client-schema-form` (deleted) — and is restated as `PLATFORM_MODULES` plus the new `PRELOADED_CLIENT_EXTERNALS`. Legion required none of the three, so no bundle behaviour changes; the list is what a reader trusts, and it was wrong.

### Notes

- The card's stylesheet deliberately diverges from upstream's on one token. DSH's own plugin card CSS colours error copy with `--dsw-alias-label-error`, which the DSH theme palette does not declare; Legion uses `--dsw-alias-state-error-primary`, which it does, and a test pins every token the card names against that palette.
- `docs/notes/dsh-0.1.1-rc.1-upgrade.md` records the 0.1.1-rc.1 assessment. Its two load-bearing findings are the ones above; beyond them the release adds exactly one package (`@deepseek-ai/dsh-authorization`, a human-conversation credential seam Legion has no use for, since ADR 0007 fixes `liveAvailability.auth` as `'unknown'` by design), leaves every type Legion imports byte-identical, leaves the client module-table mirror exact, and leaves all three standing upstream asks unmet. Every direct dependency already resolves the maximum its range admits; the four ranges trailing the registry are held to DSH's own toolchain, which refuses TypeScript 7 outright (`peerDependencyRules.allowedVersions.typescript: '>=5 <7'`).
- `docs/notes/dsh-0.1.0-rc.8-upgrade.md` records the full assessment, including that the LLM default retry count rose from 2 to 5 upstream (inherited by every delegated child) and that `ContinuableStartSpec.childId` and `SubagentRuntime.drainContinuableChildren` are new seams worth an ADR-level look for the durable Strategy controller.


## [1.2.0] - 2026-08-17

### Added

- Optional live reconfiguration through the DSH settings service: Legion registers the `legion` namespace against its existing `Config` schema, layering the composition entry under the stored user section, and republishes its tool generation on commit.
- Structural `detectSettingsCapabilities` and `installSettingsSection` seams that take no peer dependency on `@deepseek-ai/dsh-settings`, so a composition without a settings provider runs none of the wiring and keeps its entry configuration verbatim.
- ADR 0021 and `docs/settings.md` covering layer resolution, failure behaviour, and the deferred browser card.
- Optional ACP delegation catalog: `defineAcpAgent`, `acpProfile`, `acpCatalogLayer`, `acpMountRows`, and `assertAcpProfileCompatible` turn any ACP-speaking CLI mounted through `@deepseek-ai/dsh-subagent-acp` into a Legion Profile, generating the Profile and its composition row from one descriptor so `subagentProvider` cannot drift from `providerName`.
- ACP Profiles fix every constraint an out-of-process child cannot honor (provider-managed depth, foreground-only, `text` result, no persona/toolFilter/routes) and report an unestablished entrypoint explicitly instead of shipping a guessed spawn command.
- Curated ACP agents for Codex, Claude Code, oh-my-pi, Kimi Code, ZCode, Grok Build, Pi, GitHub Copilot CLI, and Hermes, each spawn command taken from the agent's own documentation and re-checked against the npm registry.
- `renderAcpFragment` and `pnpm run render:acp` generate `examples/legion.acp.fragment.yml`, carrying the DSH provider rows and the Legion catalog layer in one document; a test fails if the shipped fragment drifts from the catalog.
- `docs/acp-delegation.md` covering the ACP Profile constraints, per-agent setup, incremental adoption, and the permission/credential boundary.
- A browser settings card for the `legion` namespace on the Web plugin configuration tab, shipped as `lib/client.js` with its own staged form, override badges, and revision fencing. Edits are staged and written only on save.
- `tests/client-bundle.spec.ts` executes the built bundle under the Host loader's own protocol — factory handoff, id match, and a require that answers only the platform module table — so an externals drift fails the suite instead of the page.
- `docs/settings-card.md` covering what the card edits and the three hand-maintained couplings shipping a third-party client bundle currently costs.

### Changed

- A published generation is now derived from configuration, prompt-fragment resources, and runtime facts together, instead of runtime facts alone; reloads are serialized last-commit-wins and a failed reload keeps the last publishable generation registered.
- A committed `toolName` change withdraws the previous registration before registering the new name, because the Host keys tool registrations by name.
- Compatibility policy records DSH 0.1.0-rc.7 as the latest tested version, and the packed `latest-tested` matrix channel targets it. DSH 0.1.0-rc.7 changes no type Legion imports; durable mutation stays fail-closed because no published DSH release provides atomic run coordination.

## [1.1.0] - 2026-08-16

### Added

- Opt-in journal-native durable Strategy contracts with eight typed Session event families, projection state version 6, bounded replay/inspection, crash recovery, mailbox delivery, continuations, PlanDelta, and stair-step policies.
- Machine-readable journal contract and deterministic verifier covering strict unknown-field rejection, checkpoint refold, unrelated-event identity, delivery semantics, and Host capability requirements.
- Public structural Host ports for projection, atomic coordination, global admission, and child receipts without shipping or fabricating those Host services.

### Changed

- Durable mutation remains disabled by default and fails closed before mutation unless Session flush, projection registration, and atomic run coordination are all available.
- Documentation, examples, presets, packed verification, and release gates now distinguish structural compatibility on DSH 0.1.0-rc.6 from unavailable production durable activation.

### Security

- Accepted task commits are fenced by generation and owner lease; task delivery is at least once, mailbox acknowledgement follows durable incorporation, and ambiguous non-idempotent effects suspend instead of replaying automatically.

## [1.0.0] - 2026-08-15

### Added

- Stable machine-verified v1 runtime, declaration, package-entry, request, result, receipt, and authority contracts.
- Shared ChildRunLifecycle with cancellation-aware admission, late-publication ownership, execution/cleanup phase separation, and explicit cleanup-pending evidence.
- Trusted executor and blind-adjudicator receipts, issuer-signed pre-execution held-out pack commitments with pair-wide embargo, campaign/commit/time-bound execution receipts, canonical disjoint principals/identities, and exact compatibility closure receipts.

### Changed

- Strategy fanout uses runtime-bounded admission, cancels in-flight work once minSuccess is impossible, and enforces Team maxMembers across slot demand.
- Config ingestion rejects accessors/cycles, MaterializedConfig is deeply immutable, Plans and generations are opaque, and internal value/result codecs centralize invariants.
- Model route facts are explicitly point observations pending a Host generation lease; the misleading pre-1 `ModelFactsSnapshot` name is replaced by `ModelFactsObservations`.
- The pre-1 generic `resolveCatalogLayers` package-root export is removed; untrusted callers must use the strict `materializeConfig` ingestion seam.
- CI and tag releases share reusable gates; one exact tarball passes packed matrices before SBOM, attestation, checksums, a recoverable draft GitHub Release, idempotent npm publication, and final release publication.
- Exact Node/OS/DSH release inputs are committed; two isolated `git archive HEAD` source/build/pack rounds must match, the compared tarball is released unchanged, and a scheduled canary tracks the rolling peer range, and compatibility receipts match the exact committed DSH package closure.
- Profile request contracts distinguish allowed fields from required fields, and the default repair stage receives Objective, Plan, Execution, and Review evidence explicitly.

## [0.6.0] - 2026-08-15

### Added

- Default-off `enableStrategies` config v2 authority gate for explicit model-facing Strategy invocation through the existing single Legion tool.
- Strict discriminated Strategy requests with Objective and invocation-only narrowing limits, detached terminal outcomes, and bounded rendering.
- Atomic Profile/orchestration execution snapshots shared by schema, guidance, admission, and in-flight execution across provider lifecycle refreshes.
- Branded TeamRunId values and a machine-verified public contract v1 candidate manifest.

### Changed

- Legacy Profile tool requests remain accepted without a discriminator; Strategy and Profile fields cannot be mixed.
- `enableStrategies: true` participates in PolicyDigest, requires config v2, and cannot be silently removed by v1 rollback.
- The shipped preset and examples keep model Strategy exposure disabled.
- Packed compatibility now executes a real Config v2 Strategy, and tag publishing waits for Windows quality, profile installation, and minimum/latest packed DSH matrices.
- Aggregate token/cost limits remain absent until a Host-owned admission authority exists; v1 hard limits have explicit per-Team-Run scope.
- Foreground and Strategy paths now share one cancellation-aware ChildRunLifecycle; fanout admission is runtime-bounded and cleanup-pending is explicit.
- Materialized Config is deeply immutable, Plans and Strategy generations are opaque, Route facts are point observations, and result contracts use one codec registry.
- Signed evidence binds trusted execution receipts and complete campaign provenance; release compatibility, SBOM, attestation, and publish consume one exact tarball through reusable gates.

## [0.5.0] - 2026-08-15

### Added

- Config v2 ordered Catalog Layers spanning Profiles, Teams, and Strategies with replacement, extension-by-new-name, disable tombstones, revival, and provenance.
- Public bounded TeamSpec Member Slots, strict StrategySpec stages, artifact contracts/cardinality/availability, and hard plan limits.
- TypeScript `defineTeam`, `defineStrategy`, and `defineStrategyFor` authoring helpers with compile-time member and prior-artifact wiring checks.
- Immutable lowering to executable `dsh-delegate` and `dsh-subagent-fanout` primitive IR plus deterministic StrategyPlanDigest.
- Public `executeStrategyPlan()` adapter for every compiled plan with real one-shot DSH children, artifact handoff, deadline/output bounds, first-wins terminal arbitration, generation fencing, disposal, and explicit outcomes.
- Blocking deterministic direct-vs-strategy protocol benchmark with versioned structural and child-count thresholds.
- Offline real-model campaign scorer with 12-case review/research development packs, paired cluster bootstrap confidence intervals, safety/cost/latency gates, and two-held-out-campaign exposure validation.
- Ordinary defaults-as-data templates for `independent-review`, `research-panel`, and `plan-execute-review`, mirrored by the shipped preset.

### Changed

- Config v1 and legacy unversioned Profile documents migrate to v2 with empty orchestration namespaces; lossy Team/Strategy rollback is rejected.
- The plugin now validates Team/Strategy policy on every provider/adapter catalog refresh without treating transient Profile inactivity as permanent config failure.

## [0.4.0] - 2026-08-15

### Added

- Versioned `configVersion: 1` documents with pure normalization and a lossless legacy-unversioned rollback export.
- Committed pnpm 11 lockfile and frozen-install CI on Windows Node 22.19.0 and Ubuntu Node 24.
- Minimum/latest-compatible DSH peer matrix using isolated packed-tarball consumers.
- Harmless real packed delegation E2E through the official Agent loop and in-process spawn provider.
- Tag/version/CHANGELOG release verification, SPDX SBOM, SHA-256 checksums, build attestation, npm provenance, and GitHub Release automation.

### Changed

- Raise the installable DSH peer floor to the published `0.1.0-rc.6` generation.
- CI and release installs now require `pnpm install --frozen-lockfile`.
- Packed compatibility resolves and verifies one exact DSH generation across the entire consumer graph.
- Every workflow Action is commit-pinned; npm publishing uses OIDC Trusted Publishing without a long-lived token.

## [0.3.0] - 2026-08-15

### Added

- Up to eight ordered exact Route Candidates per Profile, with legacy `agentOptions` compatibility.
- Async DSH adapter/exact-model metadata observation and a pure immutable RoutePlan compiler.
- Known context/effective-output constraint rejection and preserved unknown metadata semantics.
- Route-specific additive instructions and branded RoutePlanDigest values.
- Bounded selected/rejected/skipped route evidence returned with foreground and continuable tool results.

### Changed

- The curated Default Catalog now uses the same public ordered-route contract available to users.
- Legion starts at most one selected child and never replays or switches routes after child failure.
- Adapter defaults used for output-budget admission are frozen into the initial activation and explicitly scoped as non-durable across continuable cold resume.

### Fixed

- Fail loud on invalid adapter metadata instead of misclassifying an adapter contract bug as an exact-model rejection.
- Bind selected route identity and bounded unknown causes into RoutePlanDigest and validate the plan before applying it.
- Track LLM adapter lifecycle in profile activation, recover from transient tool-name conflicts, and recheck the selected adapter at the start edge.

## [0.2.2] - 2026-08-15

### Added

- Profile-scoped Prompt Fragment references through explicit deployment-owned Resource Roots.
- Immutable ResourceSnapshot and branded ResourceDigest propagation through catalogs, plans, and tool results.
- Strict relative-path, realpath, link, file-type, byte-budget, UTF-8, NUL, and read-generation validation.
- Packed preset, doctor CLI, one-shot, and real continuation-manager coverage for Prompt Fragments.

### Changed

- The curated review Profile now consumes the same public Prompt Fragment contract available to user Profiles.
- Profile-local Skills remain DSH-registry owned and are explicitly gated on a future unified child-setup seam.

## [0.2.1] - 2026-08-15

### Added

- Canonical customization-first domain model for user-defined Profiles, Teams, and Strategies.
- ADR requiring the curated Default Catalog to use the same replaceable contracts as user configuration.
- Type-driven contract rules for authored/validated/effective/compiled states, branded identities, discriminated unions, and runtime validation boundaries.
- `dsh-legion doctor` and `explain` CLI with human and versioned JSON output over explicit provider fixtures.
- Programmatic `ExplainViewV1`, deterministic profile states, configured/active default distinction, and stable summary diagnostics.
- Branded ProfileName, PolicyDigest, and CatalogDigest values plus compile-time contract tests.

### Fixed

- Reject unknown configuration, provider-fixture, and model-tool fields before they enter policy digests or plugin effects.
- Runtime-validate ExplainViewV1 JSON, digest, profile eligibility, diagnostic, default, and summary invariants.
- Eliminate shared-output clean races by cleaning once before independent library and CLI builds.

## [0.2.0] - 2026-08-15

### Added

- Deterministic EffectiveProfile compiler with stable diagnostics and SHA-256 policy/catalog digests.
- One CompiledCatalog shared by tool schema, prompt guidance, activation, and execution, with detached per-invocation DelegationPlan compilation at the start edge.
- Versioned foreground result contracts: `findings-v1` and `review-v1`.
- Contract-specific revalidation and leaf projection for provider-owned structured output.
- Real DSH continuation-manager integration coverage for durable child route, lineage, persona, and settlement.

### Fixed

- Let the DSH continuation manager enforce depth and install persona/tool filters instead of incorrectly applying one-shot provider capability flags to continuable children.
- Prove profile-local package resolution with a real AgentPresets mount rather than only a mocked Loader importer.
- Cover foreground result, disposal, and combined failure settlement paths.
- Clarify that a clean local checkout must build `lib/` before profile installation, without requiring profile-level build approval.
- Validate the bundle manifest, patch, packed file inventory, and packed-tarball installation into a real profile preset mount.
- Move self-contained non-empty and identifier constraints into the Schemastery Config while retaining cross-field guards in `apply()`.
- Mark the pre-ADR Host runtime, team, and DAG design reports as superseded historical explorations.
- Make `pnpm test` self-contained by building ignored runtime artifacts before unit tests.
- Extend the packed-profile smoke through provider registration and preset-scoped Legion tool discovery.

## [0.1.0] - 2026-08-14

### Added

- Semantic Legion profiles over the DeepSeek Harness subagent seam.
- Per-profile backend, child model route, persona, tool filter, depth, and background policy.
- One enum-backed model tool with generated coordinator guidance and live provider lifecycle filtering.
- Foreground settlement with strict stop-reason handling and guaranteed run disposal.
- Continuable background delegation through the DSH runtime.
- Cordis Loader integration tests and scripted provider contract tests.
- Installable empty DSH bundle layer for resolving the agent-plane plugin from user presets.
- Ready-to-copy Legion preset plus a fragment for existing user-owned presets.

[Unreleased]: https://github.com/wxxb789/dsh-legion/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/wxxb789/dsh-legion/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/wxxb789/dsh-legion/compare/v0.6.0...v1.0.0
[0.6.0]: https://github.com/wxxb789/dsh-legion/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/wxxb789/dsh-legion/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/wxxb789/dsh-legion/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/wxxb789/dsh-legion/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/wxxb789/dsh-legion/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/wxxb789/dsh-legion/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/wxxb789/dsh-legion/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/wxxb789/dsh-legion/releases/tag/v0.1.0
