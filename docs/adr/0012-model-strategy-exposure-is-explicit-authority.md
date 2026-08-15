# Model Strategy exposure is explicit deployment authority

- Status: Accepted
- Date: 2026-08-15

Config v2 adds `enableStrategies`, defaulting to `false`. Catalog presence, compilation, programmatic execution, and model-callable authority are separate facts: Teams and Strategies may be inspected and executed by trusted package callers while remaining absent from the model tool. Only an explicit deployment-owned `true` exposes currently active Strategies through the existing single `legion` tool. The shipped preset and examples remain off; an opt-in is not evidence that curated defaults passed the real-model quality gate.

When enabled, requests use a strict `kind: strategy` branch with only Strategy name, Objective, and narrowing limits. Legacy Profile calls without a discriminator remain compatible, but fields cannot cross branches. Schema and prompt guidance are projections of one immutable `StrategyExecutionSnapshot`; execution captures that same generation and never reads a later catalog. Provider changes affect only future admission. Disabling the gate removes the Strategy schema, names, guidance, parser admission, and plugin execution path without changing the public pure compiler/executor exports.

The flag changes model authority and therefore participates in PolicyDigest. It is v2-only when true and cannot be silently removed by v1 rollback. Automatic curated-default exposure remains separately gated by ADR 0011 signed held-out evidence.
