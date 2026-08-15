# Config documents are explicitly versioned and reversibly normalized

- Status: Accepted
- Date: 2026-08-15

Legion configuration has `configVersion: 1`. Omitting the field means the legacy unversioned v1 shape, so existing presets migrate through the same pure `materializeConfig(unknown)` trust boundary without semantic drift. Unknown future versions fail before any Cordis effect. `exportConfigDocument()` returns either a normalized explicit v1 document or a detached `legacy-unversioned` rollback document; rematerializing either must produce the same effective config and policy digest.

Legion never rewrites a user's preset. Backup creation, hash guards, atomic replacement, and rollback file publication belong to the deployment/configuration owner. Future migrations must be ordered pure functions between adjacent versions, preserve source documents on failure, and add a new explicit rollback rule before the current version advances.
