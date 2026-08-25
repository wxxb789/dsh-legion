# Host owns atomic coordination and global admission authority

> **Terminology: ADR 0022.** The retired Legion nouns `Profile` and `Team` became Specialist and Cohort; retired machine spellings remain only where compatibility history requires them.

- Status: Accepted
- Date: 2026-08-16

## Context

Legion can derive run state from a DSH Session journal, but journal append alone cannot atomically exclude concurrent owners. Per-run concurrency also cannot coordinate provider, tool, memory, token, or cost pressure across Sessions and plugin instances. Pretending local observations are global authority would make durability and scale claims unsafe.

## Decision

DSH or the embedding Host owns two narrow capabilities used by journal-durable execution: atomic Run Coordination with lease/fence compare-and-set semantics, and Host-global Admission with reservation, fairness, backpressure, and reconciliation across runs. Legion submits detached run identities and bounded resource requests; Host policy decides. Invocation and Strategy policy may narrow but never widen deployment ceilings.

Legion feature-detects these capabilities at activation and compiles one capability snapshot. Atomic coordination is mandatory for generally crash-safe durable mutation. Missing global admission permits only existing conservative per-run enforcement and must be reported; it forbids claims of globally stable concurrency or aggregate token/cost enforcement. Legion does not infer authority from projections, estimated context, output bytes, local price tables, or provider failure observations.

## Invariants

- Coordination and global admission authority live outside Legion's domain controller.
- Lease acquisition, renewal, assertion, release, and fence allocation use backend-appropriate atomic semantics.
- Admission reservations precede dispatch where the claimed resource guarantee requires them and reconcile against Host-owned observations.
- Provider adaptation, global fairness, and multi-run pressure remain Host policy.
- Capability absence is explicit in schema exposure, doctor, explain, and release claims.
- Legion adds no lock service, semaphore service, price authority, provider-health authority, global registry, state store, or WAL.
- DSH continues to own Session, subagent, workflow, Goal, persistence, provider, sandbox, approval, and UI lifecycles.

## Rejected alternatives

- Journal-only owner claims cannot prevent two writers.
- Process-local mutexes and counters do not coordinate other processes or Sessions.
- A Legion global scheduler, admission daemon, or database duplicates Host authority.
- Post-dispatch usage projections cannot enforce pre-dispatch budgets.
- Locally inferred prices or health turn observations into false authority.
- Patching private DSH internals creates an unsupported lifecycle fork.

## Compatibility

The v1.0 direct and ephemeral Strategy paths remain unchanged and default. Durable branches are opt-in and capability-gated. Existing per-Cohort-Run member, concurrency, deadline, and accepted-output limits remain valid. Any future DSH peer-minimum increase must update compatibility matrices, package metadata, receipts, packed tests, and release documentation together; this ADR alone changes no package requirement.

## Failure semantics

Missing atomic coordination fails closed: unsafe durable mutation is not exposed or admitted and a stable diagnostic is returned. Lease loss stops new admission and makes old-fence commits invalid. Missing global admission falls back only to documented per-run limits with an explicit diagnostic; no global-scale, aggregate token, or cost guarantee is claimed. Admission denial or reservation loss delays or suspends work without silently widening limits.

## Consequences

Legion remains a domain interpreter rather than infrastructure authority, and safety claims match actual Host capabilities. Full multi-process durability and global resource guarantees depend on new or existing public Host seams. Development fakes may test contracts but cannot be marketed as production coordination or admission.
