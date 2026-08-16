# Context Manifests are ordered immutable cache-stable arenas

- Status: Accepted
- Date: 2026-08-16

## Context

Durable DAG tasks need bounded, inspectable context assembled from policy, goals, evidence, and mailbox artifacts. Arbitrary prompt concatenation harms reproducibility and prefix-cache reuse, while copying transcripts into controller state violates DSH child-history ownership.

## Decision

Legion represents each task context as a versioned immutable Context Manifest of digest-addressed Context Pages. Pages carry source artifact references, semantic slots, stable order keys, trust, freshness, pinning, estimated size, and lineage. Rendering uses one canonical slot order: DSH system/tool material, Profile policy, Strategy and shared-run policy, Goal, task intent, then task-specific evidence and mail; DSH owns the live model/tool tail.

Shared immutable pages form a cache-stable prefix arena. Task-specific and volatile material follows that prefix. Compaction or selection creates a new manifest generation and digest rather than mutating or reordering an existing generation. The controller journal stores metadata, references, and digests—not prompt copies or child transcripts.

## Invariants

- Equal effective inputs produce byte-identical ordering, shared-prefix bytes, and digests.
- Existing manifest generations are immutable and never reordered.
- Volatile identifiers, timestamps, nonces, and environment observations stay out of the early shared prefix.
- Required policy and acceptance criteria cannot be evicted.
- Selection and eviction are pure, deterministic, bounded, and preserve trust, freshness, and lineage.
- Each attempt records the exact manifest generation and route plan digest it used.
- Reducers consume bounded envelopes and evidence references rather than child transcripts.
- Artifact bytes remain in existing DSH/workspace facilities; Legion creates no blob or context store.

## Rejected alternatives

- Insertion-order prompt assembly makes replay and cache behavior nondeterministic.
- LRU-only eviction can discard rarely accessed but authoritative criteria.
- In-place compaction changes historical meaning and invalidates digests.
- Copying full transcripts into the root journal duplicates DSH history and expands coordinator context.
- Treating external evidence as instructions loses trust boundaries.

## Compatibility

V1.0 prompt composition and ephemeral Strategy execution remain the default and unchanged. Context Manifests are additive durable-run semantics and continue to honor existing Profile, Prompt Fragment, Skill, tool, and Route Plan authority. They do not transfer DSH ownership of system prompts, tools, or child histories.

## Failure semantics

A manifest that exceeds bounds after deterministic optional-page eviction, lacks required pages, has invalid references, or violates trust/freshness requirements fails before child start. Digest or generation mismatch rejects incorporation or result commit. Expired evidence remains inspectable but must be revalidated before controlling irreversible work.

## Consequences

Task context becomes reproducible, explainable, sharded, and more cache-friendly. Implementations must maintain canonical serialization, slot ordering, token/byte estimates, and deterministic eviction tests. Cache reuse is an optimization claim; correctness never depends on a provider cache hit.
