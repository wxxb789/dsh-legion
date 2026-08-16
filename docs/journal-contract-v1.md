# Journal Contract v1

The machine-readable contract is [`contracts/journal-v1.json`](../contracts/journal-v1.json). Run `pnpm run verify:journal-contract` after building.

## Ownership and availability

DSH Session owns the physical append-only journal and persistence. Legion owns the eight typed event families and the pure `legion-run` projection at state version 6. This package does **not** provide DSH persistence, projection registry, atomic coordination, global admission, or child-receipt Host services. DSH 0.1.0-rc.6 can install and exercise the structural contracts and pure replay logic, but lacks the published coordination/projection services required for production durable mutation.

Durable execution is opt-in. Before any mutation, Legion requires `sessions.flush`, `sessionProjections.register`, and atomic `legionRunCoordination` acquire/renew/assert/release operations. Missing mandatory capabilities produce deterministic diagnostics and fail closed. No process map, file lock, private WAL, or implicit single-process fallback satisfies this contract.

## Event families

The schemaVersion 1 families are run, plan, task, attempt, mail, milestone, decision, and continuation. Payload validators reject unknown fields. Unrelated DSH Session events preserve projection state identity. Projection checkpoints with a state version other than 6 are discarded and the full journal is folded. Exported JSONL sequence numbers must be contiguous.

## Delivery and receipts

Task execution is at least once. A logical result is accepted once by matching run, task, attempt, generation, owner, and fence. Exactly-once external effects are not promised. Mail is reserved, incorporated into an immutable context manifest, flushed when required, and only then acknowledged; expired reservations can be reclaimed. Milestone receipts bind visible artifacts, verification, progress, and the next decision.

## Replay

`dsh-legion replay --input <session.jsonl> --run <run-id> [--json]` validates exported events, folds the projection, and renders a bounded inspection view. It never resumes work or scans child transcripts.
