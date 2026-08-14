# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/wxxb789/dsh-legion/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/wxxb789/dsh-legion/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/wxxb789/dsh-legion/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/wxxb789/dsh-legion/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/wxxb789/dsh-legion/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/wxxb789/dsh-legion/releases/tag/v0.1.0
