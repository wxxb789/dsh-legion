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

- [x] Public `TeamSpec`: named Member Slots reference Profiles and declare bounded participation constraints.
- [x] Public Strategy contract that compiles an Objective and Team to executable bounded DSH subagent primitive IR.
- [x] Strategy registration and validation shared by Legion defaults and third-party Catalog Layers.
- [x] Catalog layering: extend, replace, or disable default Profiles, Teams, and Strategies without hardcoded names.
- [x] Blocking deterministic direct-vs-strategy protocol benchmark with versioned thresholds; it is not model-quality evidence.
- [x] Frozen 12-case review/research development packs plus offline paired-bootstrap campaign and exposure scorers.
- [ ] Complete two paired held-out real-model quality campaigns per Strategy with safety/cost/latency gates.
- [ ] Model-enable default `independent-review` after real-model benchmarks. (IR and direct subagent adapter complete.)
- [ ] Model-enable default `research-panel` after real-model benchmarks. (IR and fanout/synthesis adapter complete.)
- [x] Execute default `plan-execute-review`: plan, execution evidence, structured review, and one bounded repair delegate.
- [ ] Hard member/concurrency/deadline/output limits are compiled and execution enforces deadline/output; aggregate token/cost awaits a DSH budget seam.
- [x] Direct/fanout cancellation, degraded outcomes, bounded disposal, and terminal first-wins normalization.
- [x] Authority monotonicity: invocation customization only narrows limits; final widening remains subject to DSH policy and approval.
- [x] Contract tests prove default entries can be recreated entirely through public user configuration.
- [x] Seeded fanout ordering, terminal first-wins, every-waiter/no-lease checks, and catalog-generation commit fencing.

Default Strategies ship only after benchmarks show measurable value over direct delegation.

## Type-system gates

- [x] Distinct authored Config/Spec, materialized catalog, Effective Profile/Team, and Compiled Plan types at catalog boundaries.
- [ ] Branded Profile, Team, Strategy, Member Slot, and Artifact identities are complete; Role/Decision/Attempt arrive with execution.
- [ ] Discriminated Strategy stages and compile results are complete; lifecycle observations and terminal outcomes await execution.
- [x] Generic Strategy artifact input/output contracts reject forward, duplicate, contract, and cardinality wiring at compile time.
- [x] Default Catalog declared with `as const satisfies` the public user catalog contract.
- [x] Type-level tests for valid inference and expected compile failures.
- [x] Runtime schema parity tests for external Team/Strategy config contracts.

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
