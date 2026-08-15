# Teams and Strategies compile to bounded DSH primitive IR

- Status: Accepted
- Date: 2026-08-15

Config v2 adds ordered Catalog Layers, TeamSpec Member Slots, and a closed declarative Strategy stage vocabulary. `compileOrchestrationCatalog()` validates profile references, member cardinality, artifact contract/cardinality/availability, limits, completion, and runtime profile activity; `compileStrategy()` binds an objective and only narrower invocation limits. Successful output is detached, deeply frozen IR composed of `dsh-delegate`, `dsh-workflow-fanout`, and `dsh-goal` primitives plus a StrategyPlanDigest—not an Agent, Session, workflow run, scheduler, or callback.

Layers extend by new names, replace complete same-name entries, and disable with tombstones; later definitions may revive a name. The exported `DEFAULT_CATALOG_LAYER`, shipped preset, and third-party/user layers use exactly this public data contract. There are no strategy-name branches or hidden default privileges. TypeScript helpers check prior-artifact contract/cardinality and Team member names at authoring time, while the same external data receives strict runtime validation.

The three curated strategies are compiler templates until benchmarked and connected through a thin DSH execution adapter. Workflow currently cannot deliver full Profile persona/tool/depth/resource policy, and continuable children do not yield awaitable per-turn artifacts, so Legion will not claim executable Team semantics by silently dropping policy or constructing a second runtime. Aggregate token/cost enforcement likewise remains gated on an upstream DSH budget seam; current hard limits cover members, concurrency, rounds, deadline, and output bytes in the compiled plan.
