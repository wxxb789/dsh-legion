# Durable Recovery

Recovery folds the `legion-run` projection, acquires a Host lease with a larger fence, revalidates the environment, and derives a deterministic RecoveryPlan. Stale owners, attempts, generations, and continuations cannot commit. Read and idempotent work may be retried under policy; ambiguous non-idempotent work suspends. Child receipt evidence is optional and Host-owned. Checkpoint state other than version 5 is ignored and the complete journal is refolded. Recovery never implies exactly-once external execution.
