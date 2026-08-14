# dsh-legion Roadmap

This file tracks implementation status. Design rationale lives in ADRs and the OMO/Senpi research reports.

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

## v1.0 — Evidence-gated quality protocols

These ship only after benchmarks show measurable value over direct delegation.

- [ ] `independent-review`: one executor result, one bounded reviewer, evidence contract.
- [ ] `research-panel`: bounded independent findings and deterministic synthesis.
- [ ] `plan-execute-review`: plan digest, execution evidence, bounded repair round.
- [ ] Compile protocols to DSH workflow/subagent/goal primitives.
- [ ] Hard member/round/deadline/output/token/cost limits.
- [ ] Cancellation and partial/degraded result semantics.
- [ ] Seeded interleaving tests: terminal first-wins, no lease leaks, stale generation cannot commit, every waiter settles.

## Upstream DSH proposals

- Child reasoning-effort override at the AgentOptions/request seam.
- Per-child named preset composition with durable resume semantics.
- Redacted provider health only if startup-time health becomes a real requirement.
- Unified recovery seam before Legion attempts cross-route fallback.

## Non-goals

- Another Agent/Session/subagent/workflow/goal runtime.
- Senpi task store, residency manager, RPC runner, mailbox, Team runtime, or TTL sweeper.
- OMO hook injection, fixed mythology roles, current model leaderboard, or unbounded autonomy.
- Credential storage, provider auth, model adapter registry, sandbox, approval, or telemetry exporter.
