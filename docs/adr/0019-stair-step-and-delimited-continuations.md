# Stair-step advancement yields through one-shot continuations

- Status: Accepted
- Date: 2026-08-16

## Context

Long-lived resident schedulers accumulate hidden state and recover poorly. Durable work still needs to make visible incremental progress, pause at semantic boundaries, incorporate evidence, and resume without reconstructing a JavaScript call stack.

## Decision

Legion adds Stair-step as a public replaceable advancement-policy contract. It repeatedly chooses the smallest visible, verifiable increment that retires meaningful risk, executes a bounded DAG slice, commits a milestone receipt, and then advances, revises, suspends, or stops. Defaults use the same contract as user catalog data and receive no name-based privilege.

Every durable controller activation is bounded. When it yields, it issues a delimited affine one-shot Continuation represented as immutable data and a typed Session event. The token binds run and anchor Session identity, plan and goal versions, expected inputs, context/environment/authority digests, remaining limits, fence, and expiry. Resume consumes the available token durably before starting new effects. Continuous advancement may cross several milestones but still yields at activation limits; checkpoint advancement flushes and returns after each accepted milestone.

## Invariants

- Each accepted milestone has a visible artifact or reference, verification evidence, risks retired, and an explainable next decision.
- Advancement and no-progress limits are deployment-owned and invocation-narrowable only.
- Stair-step expands hygienically and passes the same graph validator as authored policy.
- A continuation is immutable, bounded, non-executable, Session-anchored, fence-bound, and consumable at most once.
- Issuance flushes before return; consumption commits before new effects.
- Resume revalidates current plan, environment, authority, limits, expected inputs, and ownership.
- No continuation contains closures, capabilities, handles, stacks, Promises, or live child state.

## Rejected alternatives

- A privileged built-in strategy name violates customization-first contracts.
- Giant speculative plans delay evidence and amplify rework; arbitrary tiny edits need not retire risk.
- Raw call/cc, captured closures, VM stacks, and multi-shot continuations can duplicate effects and preserve stale authority.
- A process-global daemon or timer creates an untracked runtime.
- Measuring progress only by tokens, time, or tool calls rewards activity rather than outcomes.

## Compatibility

V1.0 ephemeral Strategies remain the default and do not require continuation tokens. Durable advancement is explicitly enabled. Existing catalog layering and public Strategy contracts apply equally to shipped and user-defined Stair-step policies.

## Failure semantics

Consumed, expired, malformed, stale-fence, incompatible-plan, changed-authority, or incompatible-environment tokens are rejected deterministically and lead to recovery, replanning, or attention rather than implicit continuation. Verification failure or the configured no-progress bound suspends with durable diagnostics and open risks. Checkpoint mode never reports a continuation before its event is flushed.

## Consequences

Durable runs can make inspectable progress without a resident scheduler and can resume from semantic state rather than process memory. Callers must retain and present continuation handles where required. More activations and flush barriers trade throughput for bounded recovery and explicit human checkpoints.
