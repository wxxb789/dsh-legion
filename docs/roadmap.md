# dsh-legion Roadmap

This file tracks implementation status. Design rationale lives in ADRs and the OMO/Senpi research reports.

Product principles:

- Legion is customization-first. Users can define Specialists, Cohorts, and Strategies; the curated Default Catalog must use the same replaceable contracts and carry no hidden runtime privileges.
- Legion is type-driven. TypeScript should make internal illegal states unrepresentable, while runtime schemas validate every external configuration, model, plugin, persistence, and process boundary.

## v0.2 — Explainable specialist compiler

- [x] Pure `Config + RuntimeSnapshot -> CompiledCatalog` seam.
- [x] Stable diagnostic codes and provider-capability preflight.
- [x] Detached EffectiveSpecialists and deterministic ordering.
- [x] SHA-256 policy digest and runtime catalog digest.
- [x] `CompiledCatalog + invocation -> DelegationPlan` seam.
- [x] Tool schema, prompt, activation, and execution share one compiled catalog.
- [x] Versioned `findings-v1` and `review-v1` foreground result contracts.
- [x] Revalidate and leaf-project provider-owned structured output.
- [x] Human/JSON doctor CLI over the compiled catalog and explicit provider fixtures.
- [x] Specialist-scoped prompt-fragment references with canonical path confinement and immutable content snapshots.

## v0.3 — Deterministic pre-start route planning

- [x] Ordered exact route candidates per specialist.
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

## v1.0 — Custom Cohorts and evidence-gated Strategies

Users can build their own Cohorts and orchestration Strategies. Legion ships a useful Default Catalog, but defaults are ordinary versioned data under the same public contracts.

- [x] Public `CohortSpec`: named Member Slots reference Specialists and declare bounded participation constraints.
- [x] Public Strategy contract that compiles an Objective and Cohort to executable bounded DSH subagent primitive IR.
- [x] Strategy registration and validation shared by Legion defaults and third-party Catalog Layers.
- [x] Catalog layering: extend, replace, or disable default Specialists, Cohorts, and Strategies without hardcoded names.
- [x] Blocking deterministic direct-vs-strategy protocol benchmark with versioned thresholds; it is not model-quality evidence.
- [x] Frozen 12-case review/research development packs plus offline paired-bootstrap campaign and exposure scorers.
- [x] Default-off `enableStrategies` authority gate exposes active user/default Strategies through the single Legion tool only by explicit deployment opt-in.
- [x] Execute default `plan-execute-review`: plan, execution evidence, structured review, and one bounded repair delegate.
- [x] Hard member/agent, concurrency, deadline, and accepted-output limits are compiled and enforced.
- [x] Direct/fanout cancellation, degraded outcomes, bounded disposal, and terminal first-wins normalization.
- [x] Authority monotonicity: invocation customization only narrows limits; final widening remains subject to DSH policy and approval.
- [x] Contract tests prove default entries can be recreated entirely through public user configuration.
- [x] Seeded fanout ordering, terminal first-wins, every-waiter/no-lease checks, and catalog-generation commit fencing.

Default Strategies ship as ordinary off-by-default data; automatic model exposure requires benchmarks showing measurable value over direct delegation.

## v1.1 — Journal-native evolving workflows (Milestone 8: release hardening implemented)

V1.1 adds an opt-in, Session-anchored durable Strategy controller while preserving DSH ownership of physical execution and durability. The existing v1.0 ephemeral path remains unchanged and is the default. Milestones 1–8 provide the typed journal vocabulary, pure projection and replay, deterministic static Plan Graph compilation, a bounded activation interpreter, public Host coordination/fencing/recovery contracts, journal-native mailbox transitions, and ordered cache-stable Context Manifests. The assessed DSH 0.1.2-alpha.1 composition supplies neither atomic coordination nor a persistence registration seam for out-of-repository `legion/*` events, so unsafe journal mutation remains deliberately unavailable while read-only inspection and ephemeral execution remain usable.

- [x] Accept ADRs 0015–0020 and update repository ownership and domain vocabulary.
- [x] Authorize only a bounded interpreter for typed Legion DAG IR over plugin-owned events in the invoking DSH Session journal.
- [x] Require DSH Session projections and existing projection cache for derived durable state; no Legion snapshot or state store.
- [x] Require Host-owned atomic coordination for crash-safe durable mutation and fail closed when it is unavailable.
- [x] Keep global admission Host-owned; without it, enforce only existing per-run limits and make no global-scale or aggregate token/cost claim.
- [x] Implement journal event vocabulary, pure projection, replay, and bounded inspection.
- [x] Implement opt-in static durable DAG execution while retaining ephemeral parity.
- [x] Implement public lease/fence Host contracts, fail-closed capability detection, stale-result rejection, deterministic effect-aware recovery, and safe programmatic run controls; production mutation remains capability-gated.
- [x] Implement journal-native mailbox delivery and ordered cache-stable Context Manifests.
- [x] Implement validated Plan Deltas and one-shot Continuations.
- [x] Implement the public Stair-step policy.
- [x] Implement sanitized environment snapshots, immutable per-attempt Specialist/Route/context bindings, cache-prefix dispatch grouping, optional Host admission with honest per-run fallback, bounded hierarchical reducers, and derived parallelism metrics. Cross-route recovery remains disabled without a unified Host seam.
- [x] Implement deterministic protocol, compatibility, packaging, and release gates; defer large live-model scale certification. Tag publication still requires the evidence listed in `docs/TODO.md`.

V1.1 non-goals remain a second journal/WAL/database/task or mailbox store, a generic scheduler/workflow runtime, a process-global run registry or daemon, exactly-once external side effects, arbitrary model-written code, captured stacks, and silent authority expansion.

## v1.2 — Host-sourced live configuration

Legion keeps one configuration vocabulary. The DSH settings service, which from 0.1.0-rc.7 serves every registered namespace instead of an allowlist, becomes an additional *source* for the existing `Config` schema rather than a second configuration system.

- [x] Register the `legion` namespace structurally, with no peer dependency on `@deepseek-ai/dsh-settings` and no behaviour change when no provider is mounted.
- [x] Layer the composition entry under the stored user section and restore it when the provider detaches.
- [x] Widen a published generation's inputs to configuration, prompt-fragment resources, and runtime facts, with serialized last-commit-wins republication.
- [x] Degrade a rejected registration or unpublishable commit to the last publishable generation instead of withdrawing the delegation surface.
- [x] Ship the browser settings card as an ordinary DSH client bundle, verified by executing the artifact under the loader's protocol.
- [x] Ship the separate `dsh-legion-receipts` Host/Client companion, which streams live-Session baselines and complete replacements through official DSH Typert/Gateway and renders the current Session in `shell.overlay`.

The official DSH Client Test Runtime renders the companion overlay and verifies DOM, interaction, accessibility, Session switching, and reconnect behavior. Full Receipt facts remain process-local observation state for one live Session and companion instance; Host restart starts empty, while the bounded terminal tool summary remains available without Web or the companion. The root installs the exact same-version companion package; remote-only facts that official DSH seams cannot prove remain unavailable, and known aggregates report partial coverage rather than false totals.

## v1.2 — Optional ACP delegation

DSH owns the Agent Client Protocol backend. Legion contributes the delegation policy for agents mounted through it, as ordinary opt-in catalog data.

- [x] Public ACP agent descriptor, Specialist factory, catalog layer, and composition-row generator sharing one descriptor list.
- [x] Authoring-time rejection of Specialist fields an out-of-process child cannot honor.
- [x] Curated entries for the nine requested agents, with per-entry entrypoint provenance and no guessed spawn command.
- [x] Generated example fragment with a drift test.

## Type-system gates

- [x] Distinct authored Config/Spec, materialized catalog, Effective Specialist/Cohort, and Compiled Plan types at catalog boundaries.
- [x] Branded Specialist, Cohort, Strategy, Member Slot, Artifact, Cohort Run, Route/Strategy decision digests; Member Slot replaces a separate Role identity.
- [x] Discriminated Strategy stages, compile results, and completed/degraded/cancelled/failed Cohort Run outcomes.
- [x] Generic Strategy artifact input/output contracts reject forward, duplicate, contract, and cardinality wiring at compile time.
- [x] Default Catalog declared with `as const satisfies` the public user catalog contract.
- [x] Type-level tests for valid inference and expected compile failures.
- [x] Runtime schema parity tests for external Cohort/Strategy config contracts.

## Post-v1 evidence activation

- [ ] Complete two paired held-out real-model quality campaigns per curated Strategy with safety/cost/latency gates.
- [ ] Automatically expose `independent-review` and `research-panel` only after their signed evidence passes; explicit deployment opt-in remains available.

## Non-goals

- Another Agent/Session/subagent/workflow/goal runtime.
- Senpi task store, residency manager, RPC runner, mailbox directory, live Host `Team` runtime, or TTL sweeper. The sole exception is ADRs 0015–0020: an opt-in, bounded, Session-anchored durable Strategy controller whose mailbox and run facts are typed events in the existing DSH journal.
- OMO hook injection, fixed mythology roles, current model leaderboard, or unbounded autonomy.
- Credential storage, provider auth, model adapter registry, sandbox, approval, or telemetry exporter.
