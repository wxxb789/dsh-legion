# Durable Strategy Runs use the DSH Session journal

> **Terminology: ADR 0022.** The retired Legion nouns `Profile` and `Team` became Specialist and Cohort; retired machine spellings remain only where compatibility history requires them.

- Status: Accepted
- Date: 2026-08-16

## Context

V1.0 executes a frozen Strategy Plan inside one live invocation. That path is deliberately ephemeral and cannot reconstruct an interrupted run. V1.1 needs opt-in durable Strategy Runs without transferring persistence, Session, child, or workflow lifecycle ownership from DeepSeek Harness (DSH) to Legion.

## Decision

Legion may implement one domain-specific, bounded activation controller for its typed Strategy DAG IR. Each Durable Strategy Run is anchored permanently to the invoking DSH Session. All durable run, plan, task, attempt, mailbox, milestone, and continuation facts are typed plugin-owned Session events in that Session's existing DSH journal. Current state and bounded explain views are derived through DSH Session projections and the DSH projection cache. DSH owns physical append, flush, persistence, Session loading, child execution, cancellation, sandbox, approval, and UI lifecycles.

The controller runs only when explicitly invoked or resumed, advances a bounded amount of work, records a terminal outcome or one-shot continuation, and yields. It is an interpreter for Legion's bounded domain IR, not a generic workflow runtime or background scheduler.

## Invariants

- One anchor Session and its DSH journal are the canonical durable history for a run.
- Child Sessions keep native histories; the anchor stores stable references and bounded result envelopes, not copied transcripts.
- Every external progression follows the required DSH flush barrier.
- Replay is a pure fold of typed events; projection checkpoints are disposable accelerators, never authority.
- Legion creates no database, state file, task directory, mailbox directory, snapshot store, journal, or WAL.
- There is no process-global run registry, scanner, timer, daemon, or autonomous resumption loop.
- DSH remains the sole physical lifecycle and persistence owner.

## Rejected alternatives

- A Legion database, task directory, mailbox directory, or WAL duplicates DSH durability and creates split-brain recovery.
- A process-global scheduler or resident Cohort runtime duplicates DSH workflow and subagent lifecycles.
- Copying child transcripts into the anchor journal wastes storage and confuses ownership.
- Reconstructing Promises, handles, queues, or JavaScript stacks makes replay process-dependent.

## Compatibility

The v1.0 direct Specialist and ephemeral Strategy paths remain supported and are the default. Durable execution is additive, explicit, deployment-authorized, and Session-anchored. Omitting durability settings preserves v1.0 configuration, results, release gates, and behavior.

## Failure semantics

A missing Session persistence, projection, flush, or atomic coordination capability prevents safe durable activation and produces a stable diagnostic. Invalid or incompatible events fail projection or resume explicitly; Legion never silently invents state. A crash loses only unflushed progress: recovery starts from the last durable journal state and applies effect-aware reconciliation. Ambiguous non-idempotent effects suspend for attention rather than replay automatically.

## Consequences

Durable orchestration becomes inspectable and recoverable using one source of truth, while Legion owns only domain meaning. Event schemas, projection compatibility, bounded event sizes, and semantic flush barriers become public correctness obligations. Durable mode depends on suitable DSH/Host capabilities and cannot be presented as available when they are absent.
