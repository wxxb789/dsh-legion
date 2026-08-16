# Evolving DAG

Durable Strategies compile to immutable typed plan versions. A validated PlanDeltaProposal is the only supported evolution input: it may add nodes or edges, supersede pending work, and narrow limits. It cannot rewrite completed history, introduce cycles, choose final generated task identities, widen authority, or bypass base-version compare-and-set.

## Capability requirements

Pure proposal materialization, validation, and graph evolution need no Host service. Committing a new plan version requires DSH Session flush, Session projection registration, and Host-owned atomic run coordination with a current fence. Model output is only a proposal; Legion validates it before any journal append.

## Failure behavior

Malformed, stale-base, cyclic, authority-widening, history-rewriting, identity-colliding, and limit-widening proposals are rejected atomically. No partial graph is published. A started or completed task is never changed in place. On current DSH 0.1.0-rc.6, missing coordination makes plan mutation unavailable and fails closed before append.

## Limits

The deployment supplies maximum nodes and plan versions. One proposal has a bounded operation count, generated task IDs live under the reserved @legion/delta/<delta>/<local> namespace, and authored Strategy limits may only narrow. Each activation still obeys its physical start and concurrency bounds.

## Non-goals

PlanDelta is not model-written code, a generic workflow language, a mutable scheduler graph, or permission to switch routes within an attempt. It does not create a second journal or task store. Goal lifecycle remains owned by DSH Session.
