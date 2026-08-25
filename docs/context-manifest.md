# Context Manifest

ContextManifest is ordered immutable data with canonical slots, digests, trust, freshness, lineage, and bounded pages. Stable shared prefixes improve cache reuse but are never a correctness dependency. Large evidence remains referenced rather than copied into coordinator context.

## Capability requirements

Manifest construction and cache-prefix derivation are pure. Journal-native mail incorporation requires a current task generation and fence; durable delivery additionally requires Session append and an authoritative flush. A Host cache may reuse the shared prefix, but no cache service is required for correctness.

## Failure behavior

Unknown slots, duplicate pages, invalid trust or freshness metadata, missing required pages, stale mailbox generations, and digest mismatches are rejected. Required safe pages are preserved before optional pages. Mail is acknowledged only after the incorporated manifest has crossed the required durability barrier; an expired reservation is reclaimed instead of silently dropped.

## Limits

Manifests bound page count and bytes. Ordering is canonical by slot and code point. Eviction is deterministic and removes optional lower-value pages before required safe pages. The reusable prefix contains only specialist-policy, strategy-policy, and shared-run slots; task, generation, and timestamp identity stay outside it.

## Non-goals

The manifest is not a transcript store, vector database, cache-coherence protocol, mailbox database, or guarantee of provider-side cache hits. Trust, freshness, and lineage are immutable assertions, not permission to infer stronger evidence.
