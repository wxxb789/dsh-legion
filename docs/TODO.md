# TODO

## Publication readiness

These are external publication operations or optional release hardening tasks. They are not unresolved runtime or architecture defects in the `1.0.0` codebase.

### Required before creating `v1.0.0`

- [ ] Confirm the npm account or organization owns, or is allowed to create, the `dsh-legion` package.
- [ ] Confirm `dsh-legion@1.0.0` is not already occupied by a different artifact.
- [ ] If this is the first npm publication, confirm whether npm requires package ownership/bootstrap before a Trusted Publisher can be configured.
- [ ] Configure npm Trusted Publishing for repository `wxxb789/dsh-legion` and workflow `.github/workflows/release.yml`.
- [x] Keep GitHub OIDC enabled for the release job through `id-token: write`.
- [ ] Confirm repository/organization policy allows GitHub Actions to create Releases, upload assets, and write build attestations.
- [ ] Create and push the `v1.0.0` tag only after all external publication prerequisites are confirmed. Until then, npm publication and the GitHub Release remain intentionally untriggered.

### Recommended release hardening

- [ ] Add a protected GitHub Environment such as `npm-production` to the release job, optionally with required reviewers for the irreversible publication step.
- [ ] When `dsh-legion@<version>` already exists during recovery, compare npm `dist.integrity` with the SHA-512 integrity of the verified local tarball. Fail closed if the version exists but the artifact identity differs.
- [ ] When a GitHub Release already exists, inspect `isDraft` before recovery:
  - allow asset refresh and continuation for a draft;
  - fail closed if the Release is already public while the npm version is absent.
- [ ] Manually dispatch the rolling compatibility canary once before publication and confirm that the newest DSH version satisfying the peer range remains compatible. The canary is informative and does not replace the pinned release matrix.

## Runtime premise — not a TODO

`dsh-legion` is a DeepSeek Harness Cordis plugin, not a standalone application. It must run inside a compatible DeepSeek Harness composition. Dependencies on DSH packages are intentional peer/runtime dependencies supplied by the Host. A bare extracted tarball without its declared DSH peers is not a valid execution environment; clean packed-consumer tests install the exact supported DSH generation before loading or executing the plugin.
