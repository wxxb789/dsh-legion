# Config documents are explicitly versioned and reversibly normalized

> **Terminology: ADR 0022.** The retired Legion nouns `Profile` and `Team` became Specialist and Cohort; retired machine spellings remain only where compatibility history requires them.

- Status: Accepted
- Date: 2026-08-15

Canonical current Legion configuration uses `configVersion: 3` with Specialist/Cohort names at every authored level. Published 1.x calls to `materializeConfig()` and `exportConfigDocument()` with no explicit target still return normalized v2 until 2.0; `materializeCurrentConfig()` and explicit export target 3 return v3. Legacy unversioned/v1/v2 documents migrate through the same pure normalization, emit path/replacement/removal diagnostics for retired spellings, and never mutate their source. Export to explicit v2, v1, or `legacy-unversioned` succeeds only when lossless; otherwise it rejects rather than discarding Cohort/Strategy policy.

Legion never rewrites a user's preset. Backup creation, hash guards, atomic replacement, and rollback file publication belong to the deployment/configuration owner. Future migrations must be ordered pure functions between adjacent versions, preserve source documents on failure, and add a new explicit rollback rule before the current version advances.
