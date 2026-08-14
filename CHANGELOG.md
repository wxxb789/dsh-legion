# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- Let the DSH continuation manager enforce depth and install persona/tool filters instead of incorrectly applying one-shot provider capability flags to continuable children.
- Prove profile-local package resolution with a real AgentPresets mount rather than only a mocked Loader importer.
- Cover foreground result, disposal, and combined failure settlement paths.

## [0.1.0] - 2026-08-14

### Added

- Semantic Legion profiles over the DeepSeek Harness subagent seam.
- Per-profile backend, child model route, persona, tool filter, depth, and background policy.
- One enum-backed model tool with generated coordinator guidance and live provider lifecycle filtering.
- Foreground settlement with strict stop-reason handling and guaranteed run disposal.
- Continuable background delegation through the DSH runtime.
- Cordis Loader integration tests and scripted provider contract tests.
- Installable empty DSH bundle layer for resolving the agent-plane plugin from user presets.
- Ready-to-copy Legion preset plus a fragment for existing user-owned presets.

[Unreleased]: https://github.com/wxxb789/dsh-legion/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/wxxb789/dsh-legion/releases/tag/v0.1.0
