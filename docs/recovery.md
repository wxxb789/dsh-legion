# Durable Recovery

Recovery folds the legion-run projection, acquires a Host lease with a larger fence, rereads authoritative state, and derives a deterministic RecoveryPlan. Stale owners, attempts, generations, results, and continuations cannot commit.

## Capability requirements

Read-only replay and planning are pure. Resume and cancel require Session flush, projection registration, and Host-owned atomic run coordination. Durable child receipts are optional evidence; their absence is represented as unknown rather than success. Current DSH 0.1.0-rc.6 lacks mandatory coordination, so mutation fails closed.

## Failure behavior

Read effects may retry in a new generation. Idempotent writes may retry only with the same idempotency key. Ambiguous non-idempotent writes become needs-attention and never replay automatically. Receipt identities must match task, attempt, plan, generation, fence, route, environment, and context. Lease loss or failed flush prevents the next effect.

## Limits

Recovery examines bounded projected state and produces a finite task-ordered action list. One resume performs one activation; it does not scan Sessions or loop autonomously. Checkpoint state other than projection version 6 is ignored and the complete available journal is refolded.

## Non-goals

Recovery is not exactly-once external execution, cross-route failover within one attempt, a Host process supervisor, a daemon, or a replacement for provider receipts. Legion does not infer completion from a missing child or transcript.
