# Context Manifest

ContextManifest is ordered immutable data with canonical slots, digests, trust, freshness, and bounded pages. Stable shared prefixes improve cache reuse but are never a correctness dependency. Mail is acknowledged only after incorporation and the required durability barrier. Large evidence remains referenced rather than copied into coordinator context.
