# Releases are built once from a frozen dependency graph

- Status: Accepted
- Date: 2026-08-15

The pnpm 11 lockfile is committed and CI/release installs use `--frozen-lockfile`. Compatibility is verified from the packed tarball in isolated consumers, including the exact Node 22.19.0 lower bound, Windows, the minimum published DSH peer generation, and the latest version satisfying the declared peer range. The packed delegation test uses the real DSH Agent loop and in-process subagent provider with a scripted credential-free LLM.

A release tag must equal `v<package.json version>` and match a dated CHANGELOG heading. The tag workflow reruns all gates, creates one npm tarball, then derives an SPDX SBOM from the unpacked tarball, a SHA-256 checksum manifest, GitHub build attestation, npm provenance publication, and GitHub Release assets from that immutable artifact. Repository contents are read-only in normal CI; only the tag release job receives `contents: write`, `id-token: write`, and `attestations: write`. npm authentication uses Trusted Publishing exclusively, so the workflow carries no long-lived registry token.
