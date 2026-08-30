# Public contract v1

This document freezes the dsh-legion 1.x compatibility surface. The machine-readable vocabulary is `contracts/v1.json`; `pnpm run verify:contract` checks it against built exports.

## Stable authored data

- Canonical current Config Documents use version 3 and current nested spellings. Published 1.x materialize/export calls with no explicit target remain v2 until 2.0; legacy unversioned/v1/v2 documents migrate purely with model Strategy exposure off where the old contract requires it.
- Specialists, Catalog Layers, CohortSpec, StrategySpec, artifact contracts, and limits are readonly declarative data. The package root exports their canonical schemas, brands, helpers, compiled types, outcomes, Config v3 materializers, diagnostics, and ACP helpers.
- Catalog Layers add new names, replace complete same-name entries, disable by tombstone, and permit later revival.
- Specialist and Cohort are canonical. Published 1.x `profile` and `team` spellings remain accepted only as non-advertised compatibility exceptions for their documented window and never lead new surfaces.
- Strategy stages are exactly `delegate | fanout | synthesize`; every accepted stage is executable.
- Strategy limits are exactly agents, per-Cohort-Run concurrency, deadline, and accepted artifact bytes.

## Stable invocation and results

- Specialist requests allow only `kind?, specialist?, description, prompt, run_in_background?`; `description` and `prompt` are required, while calls may omit the explicit `kind: specialist` discriminator. The retired `profile` field remains an accepted, non-advertised 1.x compatibility alias with removal no earlier than 2.0.0 and cannot be combined with `specialist`.
- Strategy tool calls require `{ kind: strategy, strategy, objective, limits? }` and deployment `enableStrategies: true`.
- Branch fields cannot be mixed and invocation limits can only narrow authored limits.
- Cohort Runs have a branded identity and exactly four terminal outcomes: completed, degraded, cancelled, failed.
- Opaque Plans and execution snapshots bind one branded Strategy generation (policy + runtime Specialist catalog + orchestration), Objective, and limits before child admission.

## Run Receipt observation

- Full Run Receipt facts belong to the separately packaged `dsh-legion-receipts` companion; the root package keeps the bounded tool summary and grants the companion no execution authority.
- Standard DSH Web receives each live Session's baseline followed by complete replacements over official DSH Typert/Gateway. Client refresh and carrier reconnect recover that baseline only while the same parent Session and companion instance remain live.
- The companion appends no custom Session event, writes no Receipt facts to storage, and requires no DSH core change. Session disposal, companion reload, or Host restart ends full-fact availability, and the next companion instance starts empty.
- Remote facts that official Host observation cannot prove remain explicitly unavailable; known subtotals may report partial coverage. Receipt accounting units are token counts and elapsed time only.
- The existing bounded tool summary remains the terminal artifact for headless, missing-companion, and degraded deployments.
- Existing Durable Strategy source, journal contracts, and historical identifiers remain unchanged compatibility surfaces; this observation contract does not reinterpret them.

## Evidence receipt contracts

- Execution receipts are `legion-execution-receipt-v1` with exact envelope fields `schemaVersion, signerId, payload, signature`; their payload binds campaign identity, execution commit, pack digest/commitment, absolute execution window, execution identity, pair/arm/order/exposure/status, artifact, provenance, usage, monotonic timing, and optional infra receipt.
- Blind adjudication receipts are `legion-adjudication-receipt-v2` with exact envelope fields `schemaVersion, batchId, blinded, signerId, payload, signature`; their payload binds campaign identity/Strategy/window, catalog and execution commit, hard-budget assertion, pack/rubric/threshold digests, and the complete scored run set.
- Compatibility receipts are `dsh-legion-compatibility-receipt-v2`; they bind one exact tarball digest to requested/resolved DSH generation, platform, Node version, consumer lockfile, installed DSH packages, package version, capability mode, durable-mutation availability, deterministic capability diagnostics, and passed status.
- Held-out exposure requires externally registered, issuer-signed pre-execution pack commitments with embargo through the complete two-campaign window, distinct trusted executor, adjudicator, and pack-issuer Ed25519 principals/keys across campaigns, canonical disjoint execution identities, non-overlapping windows, and the current catalog generation.

## Authority and non-contracts

- DSH owns Agent/Session/subagent lifecycle, providers, tools, sandbox, approval, credentials, and cancellation.
- Model Strategy exposure defaults off and is owned by deployment configuration.
- Aggregate token and monetary-cost admission are not v1 fields because no authoritative Host reservation seam exists (ADR 0013).
- Model facts are point observations, not an atomic adapter-generation lease; DSH remains start authority (ADR 0007).
- Every published child is cleanup-owned; a provider that ignores disposal is reported as cleanup pending rather than falsely declared quiescent.
- No retry, route replay, hidden default branch, persistent Cohort runtime, mailbox, or task store is implied.
- Open benchmark packs and explicit opt-in do not constitute signed held-out evidence for automatic curated exposure.

Removing or reinterpreting these contracts after 1.0 requires a new major version. Additive optional fields and new versioned result contracts remain possible when old documents and invocations preserve their meaning.
## Additive v1.1 durable contract

- Durable execution is optional in config version 2 and defaults off.
- The journal vocabulary has eight schemaVersion 1 event families; the primary projection is `legion-run` state version 7. Unknown fields are rejected, unrelated DSH events are projection no-ops, and old checkpoints refold from the full journal.
- Run control actions are `inspect | resume | cancel | steer`; mutation actions require Host capabilities and fail closed before mutation when unavailable.
- Task execution and delivery are at least once, accepted commits require the active fence and generation, external effects are not exactly once, and mailbox acknowledgement follows durable incorporation.
- The npm package exports structural ports and pure replay/projection logic but no DSH Host persistence, projection, coordination, admission, or child-receipt service.

See [Journal Contract v1](journal-contract-v1.md) and `contracts/journal-v1.json`.
