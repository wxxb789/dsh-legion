# V1 deep Modules own child lifecycle and publication

> **Terminology: ADR 0022.** The retired Legion nouns `Profile` and `Team` became Specialist and Cohort; retired machine spellings remain only where compatibility history requires them.

- Status: Accepted
- Date: 2026-08-15

V1 concentrates cross-cutting races behind two internal Modules. `ChildRunLifecycle` owns cancellation-aware admission, late run publication, execution settlement, and cleanup state for both foreground Specialist calls and Strategy members. Execution terminal and cleanup are separate phases: cancellation during cleanup cannot rewrite completed work; a provider that ignores disposal is reported as cleanup pending while the Module retains the late disposer. `PublishedGeneration` is implemented by one stable delegating Tool Adapter: active-to-active provider refresh atomically swaps an immutable schema/prompt/execution definition and snapshot instead of unregistering the last-known-good tool.

Strategy fanout uses bounded worker admission under the per-Cohort-Run concurrency limit, stops new admission after cancellation or impossible `minSuccess`, and retains canonical member-index ordering. Duplicate artifact producers are illegal at compile time. Config ingestion is the sole external trust seam; MaterializedConfig is detached, readonly, and deeply frozen, while the typed Catalog Layer resolver remains package-internal. Compiled Strategy Plans and Strategy generation identities are opaque compiler products.

Route model facts remain candidate-local point observations, not an adapter-generation lease. Same-name Adapter replacement cannot be closed inside Legion without copying Host registry ownership, so ADR 0007 and the roadmap require a future Host resolve/reserve/start lease rather than hiding that limitation behind a frozen value name.
