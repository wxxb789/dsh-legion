# Prompt references resolve to confined immutable snapshots

- Status: Accepted
- Date: 2026-08-15

Profile Prompt Fragments use explicit `{ root, path }` references. Deployment-owned Resource Roots are slash-separated relative directories below the plugin/config base; profile paths are relative, canonical, link-free paths below one named root. An asynchronous loader resolves and validates roots before the pure catalog compiler receives detached UTF-8 content snapshots. The compiler and DelegationPlan carry a ResourceDigest, while provider lifecycle refreshes reuse the immutable snapshot rather than rereading files.

The loader rejects unknown roots, absolute paths, `.`/`..`, backslashes, missing entries, symbolic links/junctions, non-regular files, invalid UTF-8, NUL, duplicate references, more than 32 files, and per-profile content above the configured bounded byte budget. It opens the canonical file once, checks type and size on the handle before and after reading, and publishes only a complete generation. It does not claim portable elimination of every TOCTOU or hardlink race; a party that can modify the authorized directory is part of the deployment trust boundary.

Fragments are appended to the child persona through the existing DSH child composition seam. Providers that cannot apply persona/system composition fail capability preflight instead of receiving a silent user-prompt fallback. File edits take effect after plugin/preset reactivation; no watcher or last-known-good cache is introduced in this version.

Skills remain owned by the scoped DSH `ctx.skills` registry. Legion will not parse skill files, duplicate the registry, copy a parent skill catalog, or disguise skill bodies as Prompt Fragments. True profile-local Skill contributions require a unified DSH child-setup seam that applies to one-shot children, continuable activation, and cold resume.
