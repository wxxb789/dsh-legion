# dsh-legion Roadmap

This file tracks implementation status. Design rationale lives in ADRs and the OMO/Senpi research reports.

Product principle: Legion is customization-first. Users can define Profiles, Teams, and Strategies; the curated Default Catalog must use the same replaceable contracts and carry no hidden runtime privileges.

## v0.2 — Explainable profile compiler

- [x] Pure `Config + RuntimeSnapshot -> CompiledCatalog` seam.
- [x] Stable diagnostic codes and provider-capability preflight.
- [x] Detached EffectiveProfiles and deterministic ordering.
- [x] SHA-256 policy digest and runtime catalog digest.
- [x] `CompiledCatalog + invocation -> DelegationPlan` seam.
- [x] Tool schema, prompt, activation, and execution share one compiled catalog.
- [x] Versioned `findings-v1` and `review-v1` foreground result contracts.
- [x] Revalidate and leaf-project provider-owned structured output.
- [ ] Human/JSON doctor CLI over the compiled catalog.
- [ ] Profile-scoped skill and prompt-fragment references with canonical path confinement.

## v0.3 — Deterministic pre-start route planning

- [ ] Ordered exact route candidates per profile.
- [ ] Registered LLM adapter and known model metadata snapshot.
- [ ] Preserve `unknown` for unlisted models or unavailable metadata.
- [ ] Validate known reasoning/context/output constraints.
- [ ] Freeze one route plan before child start.
- [ ] Select one route and start one child; no Legion-owned failure replay.
- [ ] Route-specific additive prompt tuning.
- [ ] Bounded explain snapshot with selected/rejected reasons.

Cross-route recovery is not part of v0.3. It requires a unified DSH recovery seam so provider retry and route switching share one owner and one cancellation/attempt/time/token/cost budget.

## v0.4 — Packaging and diagnostics hardening

- [ ] Add and enforce a lockfile.
- [ ] Windows CI and Node engines lower-bound job.
- [ ] DSH peer minimum/latest compatibility matrix.
- [ ] Packed harmless real delegation E2E with a faux provider.
- [ ] Config migration and rollback contract.
- [ ] Release/tag/tarball/SBOM/provenance automation.

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

## Upstream DSH proposals

- Child reasoning-effort override at the AgentOptions/request seam.
- Per-child named preset composition with durable resume semantics.
- Redacted provider health only if startup-time health becomes a real requirement.
- Unified recovery seam before Legion attempts cross-route fallback.

## Non-goals

- Another Agent/Session/subagent/workflow/goal runtime.
- Senpi task store, residency manager, RPC runner, mailbox, live Team runtime, or TTL sweeper; Legion Teams are declarative policy inputs compiled to DSH.
- OMO hook injection, fixed mythology roles, current model leaderboard, or unbounded autonomy.
- Credential storage, provider auth, model adapter registry, sandbox, approval, or telemetry exporter.
