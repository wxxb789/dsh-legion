# Durable Strategy Runs

Durable Strategy Runs are explicit, opt-in controllers anchored to one DSH Session. Ephemeral v1.0 Profile and Strategy behavior remains the default. A Strategy caller requests journal mode with an execution object whose durability is journal; omission or durability ephemeral preserves the v1.0 executor. Deployment must enable durable runs before the journal field is accepted at all. Journal activation additionally requires a bound durable Strategy activation adapter; while no build binds one, `execution` stays out of the model-facing schema and a journal request fails closed instead of degrading to the ephemeral executor.

## Capability contract

Mutation requires DSH Session flush, a projection registry, and Host-owned atomic run coordination with monotonic fences. Host-global admission and durable child receipts add stronger scheduling and recovery evidence when available. Missing mandatory capabilities fail closed before mutation. The npm package exports structural ports and pure logic only; it ships no Host service implementation. Every DSH release the declared peer range admits, through 0.1.1-rc.2, therefore supports installation, compilation, validation, replay, and deterministic capability diagnostics, not production durable mutation.

## Run control

- `inspect` is bounded and read-only.
- `resume` consumes valid continuation data and performs one bounded activation.
- `cancel` records intent, closes admission, cancels Host-owned children, settles, and flushes.
- `steer` submits a validated PlanDelta proposal; it never rewrites committed history or widens authority.

## Delivery and failure semantics

Task execution is at least once; accepted commits are fenced exactly once per logical generation. External effects are not exactly once. Ambiguous non-idempotent work suspends for attention. Mail follows reserve, incorporate, flush, acknowledge, expiry, and reclaim semantics. Crash recovery is deterministic from typed Session events.

## Migration and rollback

Existing config version 2 documents remain valid with durable fields omitted; both Strategy exposure and durable runs remain off. V1.1 journal events are additive DSH Session facts, but v1.0 Legion cannot interpret them. Before rolling back the package, stop durable mutation, retain or archive the Session JSONL, and remove enableDurableRuns plus durable-only policy fields from deployment config. That rollback preserves the DSH journal but loses Legion's ability to inspect or resume the durable controller until v1.1 is restored. Never rewrite or downgrade committed v1.1 event payloads.

## Limits and non-goals

Every activation, graph, plan history, fan-out, output, context, milestone, and continuation is bounded. Legion does not own a journal, database, scheduler daemon, process-global run registry, workflow runtime, or autonomous resume loop.

See [Journal Contract v1](journal-contract-v1.md), ADRs 0015-0020, and [the advanced example](../examples/durable-stair-step.config.yml).
