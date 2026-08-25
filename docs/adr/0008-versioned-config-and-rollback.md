# Config documents are explicitly versioned and reversibly normalized

> **Terminology: ADR 0022.** The retired Legion nouns `Profile` and `Team` became Specialist and Cohort; retired machine spellings remain only where compatibility history requires them.

- Status: Accepted
- Date: 2026-08-15

Legion configuration currently has `configVersion: 2`. Omitting the field means the legacy unversioned v1 shape using the retired `profiles` namespace; explicit v1 follows the same pure `materializeConfig(unknown)` migration and gains empty Cohort/Strategy namespaces. Unknown future versions fail before any Cordis effect, and v1 cannot contain v2-only catalog fields. `exportConfigDocument()` returns normalized v2; export to explicit v1 or `legacy-unversioned` succeeds only when it is lossless, otherwise it rejects rather than discarding Cohort/Strategy policy.

Legion never rewrites a user's preset. Backup creation, hash guards, atomic replacement, and rollback file publication belong to the deployment/configuration owner. Future migrations must be ordered pure functions between adjacent versions, preserve source documents on failure, and add a new explicit rollback rule before the current version advances.
