# Evolving DAGs change only through validated Plan Deltas

- Status: Accepted
- Date: 2026-08-16

## Context

Static Strategy Plans are deterministic but cannot adapt to evidence discovered during a durable run. Arbitrary model-written code, callbacks, or mutable graph objects cannot be replayed safely, validated against authority, or explained after recovery.

## Decision

A Durable Strategy Run uses versioned immutable Plan Graphs. Dynamic change is proposed only as a versioned structured Plan Delta. Legion validates the proposal in a pure compiler, hygienically assigns final identities, computes the complete resulting graph, and commits a new plan version as typed Session events. Models return proposals through a declared structured result contract; they never append events or mutate projected state.

A Plan Delta may add bounded nodes and edges, refine or supersede pending work, and narrow completion or goal policy when explicitly authorized. It cannot rewrite completed history, accepted artifacts, running attempts, terminal generations, evidence, or authority. Commit uses the exact base plan version as compare-and-set evidence.

## Invariants

- Every committed plan is immutable, acyclic, bounded, typed, and digest-addressed.
- Plan evolution is monotonic with respect to history, authority, limits, and accepted evidence.
- Completed work and running attempt identity are never rewritten.
- Authored and generated identities cannot collide; reserved generated namespaces are hygienic.
- Artifact contracts, dependencies, Profiles, routes, effects, completion, and all hard limits validate before commit.
- The same proposal, base plan, authority, and environment inputs produce the same decision.
- Ready-frontier and result ordering remain canonical rather than arrival-driven.

## Rejected alternatives

- Arbitrary JavaScript, callbacks, closures, or model-written programs conceal authority and cannot replay deterministically.
- In-place graph mutation erases decision history and makes crash cuts ambiguous.
- Parsing plan changes from prose provides no trustworthy contract.
- Allowing deltas to widen permissions or limits grants hidden model authority.
- Silent renaming of colliding identifiers makes references and replay unstable.

## Compatibility

Existing v1.0 Strategies continue to compile and execute as frozen ephemeral plans. Durable compilation may lower the same declarative catalog data to an initial DAG, but Plan Delta support is opt-in and adds no strategy-name privilege. Existing Route Plan and Profile rules remain authoritative for each attempt.

## Failure semantics

Stale base versions, cycles, invalid artifact wiring, unsupported structured output, identity collisions, history rewrites, and authority or limit widening reject the whole proposal with stable diagnostics. No partial plan is committed and current state is unchanged. A topology or route change creates a new plan or attempt generation; it never mutates a running attempt.

## Consequences

Runs can evolve while preserving deterministic replay and reviewable history. The graph compiler and validator become deep modules with schema, compatibility, and property-test obligations. Full plan snapshots can grow, so hard node, version, and event-byte limits are required.
