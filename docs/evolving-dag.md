# Evolving DAG

Durable Strategies compile to immutable typed plan versions. PlanDelta can add nodes or edges, supersede pending work, and narrow limits. It cannot rewrite completed history, introduce cycles, capture authored names, widen authority, or bypass version CAS. Every graph and activation is bounded.
