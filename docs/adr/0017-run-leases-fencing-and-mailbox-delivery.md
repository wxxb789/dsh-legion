# Run ownership and mailbox delivery require leases and fencing

- Status: Accepted
- Date: 2026-08-16

## Context

An append-only journal records decisions but cannot exclude concurrent controller processes. Crash recovery can overlap an old activation, and late children can return after a replacement attempt starts. Task-addressed communication also needs durable reservation and acknowledgement without creating a second queue.

## Decision

Durable activation requires a Host-owned atomic run-coordination capability that grants a lease with a monotonically increasing fence. Owner fingerprints are diagnostic only. Attempts, mailbox reservations, continuation consumption, and result commits carry the active fence and relevant plan/task generation. Legion accepts semantic state changes only after asserting current ownership.

The Durable Mailbox is a Legion state-machine protocol represented entirely by typed events in the anchor Session journal. Messages move through queued, reserved, incorporated, and acknowledged states; expired reservations may be reclaimed. Acknowledgement occurs only after artifact references are incorporated into a durable recipient Context Manifest and any required DSH flush completes. Children report through DSH result/report seams and cannot mutate root mailbox state directly.

## Invariants

- At most one valid lease owns a run at a time under the Host coordination authority.
- Every successful reacquisition after expiry or release receives a strictly larger fence.
- A result commits only for the current run, plan applicability, task generation, attempt, fence, nonterminal task, and valid artifact contract.
- Mail delivery is at least once; incorporation is idempotent by mail, task generation, and context generation; acknowledgement is monotonic.
- One active reservation exists per mail item and recipient generation under the current owner.
- Only the controller appends root mailbox events; peer tasks exchange validated artifact references, not direct mutable state.
- No mailbox queue, mailbox directory, lease file, lock file, or coordination WAL is owned by Legion.

## Rejected alternatives

- Journaled owner IDs without atomic compare-and-set provide observability, not mutual exclusion.
- Process-local mutexes do not protect multi-process recovery.
- Exactly-once external execution cannot be guaranteed without cooperation from external systems.
- A separate queue or mailbox store splits durable truth.
- Acknowledging in-memory prompt insertion can lose mail after a crash.
- Direct peer mutation bypasses validation, ordering, and authority.

## Compatibility

The v1.0 ephemeral executor keeps its existing generation fencing and child lifecycle semantics and does not require durable leases or mailbox events. These protocols apply only to explicitly enabled journal-durable runs. Existing terminal first-wins and cancellation behavior remains intact.

## Failure semantics

Missing or lost atomic coordination closes new admission and prevents result, reservation, or continuation commits. Running children may settle, but stale results are rejected from semantic state. Expired reservations return to queued with an incremented reclaim count. Ambiguous non-idempotent work suspends as needs-attention. Duplicate delivery may occur, but duplicate incorporation into one context generation may not.

## Consequences

Crash recovery can safely replace an owner and reject stale work, while mailbox history remains replayable in the Session journal. The Host must supply real transactional coordination; Legion must implement renewal, reclaim, stale-result diagnostics, and crash-cut tests. The design promises exactly-once accepted commit for a logical result, not exactly-once external execution.
