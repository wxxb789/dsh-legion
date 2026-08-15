# dsh-legion Roadmap

This file tracks implementation status. Design rationale lives in ADRs and the OMO/Senpi research reports.

Product principles:

- Legion is customization-first. Users can define Profiles, Teams, and Strategies; the curated Default Catalog must use the same replaceable contracts and carry no hidden runtime privileges.
- Legion is type-driven. TypeScript should make internal illegal states unrepresentable, while runtime schemas validate every external configuration, model, plugin, persistence, and process boundary.

## v0.2 — Explainable profile compiler

- [x] Pure `Config + RuntimeSnapshot -> CompiledCatalog` seam.
- [x] Stable diagnostic codes and provider-capability preflight.
- [x] Detached EffectiveProfiles and deterministic ordering.
- [x] SHA-256 policy digest and runtime catalog digest.
- [x] `CompiledCatalog + invocation -> DelegationPlan` seam.
- [x] Tool schema, prompt, activation, and execution share one compiled catalog.
- [x] Versioned `findings-v1` and `review-v1` foreground result contracts.
- [x] Revalidate and leaf-project provider-owned structured output.
- [x] Human/JSON doctor CLI over the compiled catalog and explicit provider fixtures.
- [x] Profile-scoped prompt-fragment references with canonical path confinement and immutable content snapshots.
- [ ] Profile-scoped Skill contributions after DSH exposes one child-setup seam for one-shot, continuable activation, and cold resume.

## v0.3 — Deterministic pre-start route planning

- [x] Ordered exact route candidates per profile.
- [x] Registered LLM adapter and known exact-model metadata snapshot.
- [x] Preserve `unknown` for unlisted models or unavailable metadata.
- [x] Observe known reasoning controls and validate context/effective-output constraints.
- [x] Freeze one route plan before child start.
- [x] Select one route and start one child; no Legion-owned failure replay.
- [x] Route-specific additive prompt tuning.
- [x] Bounded tool-result explain snapshot with selected/rejected/skipped reasons.

Cross-route recovery is not part of v0.3. It requires a unified DSH recovery seam so provider retry and route switching share one owner and one cancellation/attempt/time/token/cost budget.

## v0.4 — Packaging and diagnostics hardening

- [x] Add and enforce a lockfile.
- [x] Windows CI and Node engines lower-bound job.
- [x] DSH peer minimum/latest compatibility matrix.
- [x] Packed harmless real delegation E2E with a scripted provider.
- [x] Config migration and rollback contract.
- [x] Release/tag/tarball/SBOM/provenance automation.

## v1.0 — Custom Teams and evidence-gated Strategies

Users can build their own Teams and orchestration Strategies. Legion ships a useful Default Catalog, but defaults are ordinary versioned data under the same public contracts.

- [ ] Public `TeamSpec`: named Member Slots reference Profiles and declare bounded participation constraints.
- [ ] Public Strategy contract that compiles an Objective and Team to bounded DSH workflow/subagent/goal operations.
- [ ] Strategy registration and validation shared by Legion defaults and third-party packages.
- [ ] Catalog layering: extend, replace, or disable default Profiles, Teams, and Strategies without hardcoded names.
- [ ] Default `independent-review`: one executor result, one bounded reviewer, evidence contract.
- [ ] Default `research-panel`: bounded independent findings and deterministic synthesis.
- [ ] Default `plan-execute-review`: plan digest, execution evidence, bounded repair round.
- [ ] Hard member/round/deadline/output/token/cost limits.
- [ ] Cancellation and partial/degraded result semantics.
- [ ] Authority monotonicity: catalog customization can narrow directly; widening remains subject to DSH policy and approval.
- [ ] Contract tests prove default entries can be recreated entirely through public user configuration.
- [ ] Seeded interleaving tests: terminal first-wins, no lease leaks, stale generation cannot commit, every waiter settles.

Default Strategies ship only after benchmarks show measurable value over direct delegation.

## Type-system gates

- [ ] Distinct `Authored*`, `Validated*`, `Effective*`, and `Compiled*` types at catalog boundaries.
- [ ] Branded Profile, Role, Team, Strategy, Decision, Attempt, and Artifact identities.
- [ ] Discriminated unions for Strategy kinds, execution modes, diagnostics, lifecycle observations, and terminal outcomes.
- [ ] Generic Strategy artifact input/output contracts that reject invalid stage wiring at compile time.
- [ ] Default Catalog declared with `as const satisfies` the public user catalog contract.
- [ ] Type-level tests for valid inference and expected compile failures.
- [ ] Runtime schema parity tests for every external versioned contract.

## Upstream DSH proposals

- Child reasoning-effort override at the AgentOptions/request seam.
- Per-child named preset composition with durable resume semantics.
- Unified scoped child-setup contributions for one-shot, continuable activation, and cold resume, enabling profile-local DSH Skill registrations.
- Redacted provider health only if startup-time health becomes a real requirement.
- Unified recovery seam before Legion attempts cross-route fallback.

## Non-goals

- Another Agent/Session/subagent/workflow/goal runtime.
- Senpi task store, residency manager, RPC runner, mailbox, live Team runtime, or TTL sweeper; Legion Teams are declarative policy inputs compiled to DSH.
- OMO hook injection, fixed mythology roles, current model leaderboard, or unbounded autonomy.
- Credential storage, provider auth, model adapter registry, sandbox, approval, or telemetry exporter.
