# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
