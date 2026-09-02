# v1.2.0 release prerequisites

- [ ] Run the full `pnpm run check` gate on a clean committed tree.
- [ ] Produce one reproducible tarball from two isolated `git archive HEAD` rounds.
- [ ] Complete all eight Windows/Linux, Node 22/24, minimum/latest-tested packed compatibility slots against that exact tarball.
- [ ] Verify compatibility receipts, SBOM, checksums, and build attestation bind the exact tarball.
- [ ] Confirm npm Trusted Publishing and the recoverable GitHub draft release path.
- [ ] Create and push `v1.2.0` only after every metadata and evidence gate agrees.

## What the evidence may and may not claim

**Durable mutation stays unavailable.** The declared DSH 0.1.2-alpha.2 minimum and 0.1.2-alpha.4 latest-tested generations publish neither the atomic run coordination Host service nor a required-event admission seam for out-of-repository `legion/*` events. Alpha.4's `ignorable` envelope marker cannot represent Legion's state-changing facts. Session flush and `sessionProjections` exist, but neither closes those two independent blockers. Release evidence may prove structural contracts, pure replay, deterministic capability diagnostics, and unchanged ephemeral behavior; it must not claim production durable mutation. See the [0.1.2-alpha.4 audit](notes/dsh-0.1.2-alpha.4-upgrade.md).

**The browser settings card is verified by protocol, not by pixels.** `tests/client-bundle.spec.ts` executes the built bundle under the Host loader's own contract — factory handoff, id match, a `require` that answers only the platform module table, and the style tag the loader claims. No gate renders the card in a browser, and none of the three hand-maintained couplings it carries (bundle format, slot declaration, client package versions) can fail the build. Treat a DSH client-side change as a card-compatibility risk only a manual check can retire.

**No ACP agent has been spawned by a gate.** Every curated spawn command was read off the agent's own documentation and re-checked against the npm registry, and `tests/acp-catalog.spec.ts` pins the two findings that would otherwise regress: the renamed Claude adapter, and the Grok version the Zed registry pins but npm does not publish. No gate performs a real ACP handshake, so the commands are evidenced, not exercised.

## Carried over

- `devDependencies` target DSH 0.1.2-alpha.4, while the compatibility contract tests 0.1.2-alpha.2 as the minimum and alpha.4 as latest-tested. Main CI derives and packs the latest-tested source once, then installs its manifest-indexed tarballs without resolving DSH through npm. The scheduled `peer-range` canary and tag-release minimum/latest matrices retain public-registry installs because source compatibility does not prove distribution availability. `scripts/verify-packed-delegation.mjs` resolves every channel from `contracts/compatibility.json`, so workflow version literals cannot drift.

- The compatibility receipt's `capabilityMode` is the frozen literal `rc6-replay-only-fail-closed`, named after a floor the package no longer supports. Producer and verifier agree on the string and no invariant is violated, but renaming it moves `compatibilityReceiptVersion`, so it waits for the next receipt-schema change rather than riding a version bump.

No receipt or tag is generated in the source tree.
