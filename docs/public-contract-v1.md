# Public contract v1 candidate

This document freezes the intended dsh-legion 1.x compatibility surface. The machine-readable vocabulary is `contracts/v1.json`; `pnpm run verify:contract` checks it against built exports.

## Stable authored data

- Config Document version is 2. Legacy unversioned/v1 Profile documents migrate with model Strategy exposure off.
- Profiles, Catalog Layers, TeamSpec, StrategySpec, artifact contracts, and limits are readonly declarative data.
- Catalog Layers add new names, replace complete same-name entries, disable by tombstone, and permit later revival.
- Strategy stages are exactly `delegate | fanout | synthesize`; every accepted stage is executable.
- Strategy limits are exactly agents, per-Team-Run concurrency, deadline, and accepted artifact bytes.

## Stable invocation and results

- Legacy Profile tool calls remain `{ profile?, description, prompt, run_in_background? }`; explicit `kind: profile` is accepted.
- Strategy tool calls require `{ kind: strategy, strategy, objective, limits? }` and deployment `enableStrategies: true`.
- Branch fields cannot be mixed and invocation limits can only narrow authored limits.
- Team Runs have a branded identity and exactly four terminal outcomes: completed, degraded, cancelled, failed.
- Plans and execution snapshots bind policy, runtime Profile catalog, orchestration generation, Objective, and limits before child admission.

## Authority and non-contracts

- DSH owns Agent/Session/subagent lifecycle, providers, tools, sandbox, approval, credentials, and cancellation.
- Model Strategy exposure defaults off and is owned by deployment configuration.
- Aggregate token and monetary-cost admission are not v1 fields because no authoritative Host reservation seam exists (ADR 0013).
- No retry, route replay, hidden default branch, persistent Team runtime, mailbox, or task store is implied.
- Open benchmark packs and explicit opt-in do not constitute signed held-out evidence for automatic curated exposure.

Removing or reinterpreting these contracts after 1.0 requires a new major version. Additive optional fields and new versioned result contracts remain possible when old documents and invocations preserve their meaning.
