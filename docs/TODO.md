# v1.2.0 release prerequisites

- [ ] Run the full `pnpm run check` gate on a clean committed tree.
- [ ] Produce one reproducible tarball from two isolated `git archive HEAD` rounds.
- [ ] Complete all eight Windows/Linux, Node 22/24, minimum/latest-tested packed compatibility slots against that exact tarball.
- [ ] Verify compatibility receipts, SBOM, checksums, and build attestation bind the exact tarball.
- [ ] Confirm npm Trusted Publishing and the recoverable GitHub draft release path.
- [ ] Create and push `v1.2.0` only after every metadata and evidence gate agrees.

## What the evidence may and may not claim

**Durable mutation stays unavailable.** Neither DSH 0.1.0-rc.6 (the declared minimum) nor 0.1.0-rc.7 (the latest tested) publishes the atomic run coordination Host service durable mutation requires. Session flush and `sessionProjections` do exist; coordination is the single missing mandatory capability. Release evidence may prove structural contracts, pure replay, deterministic capability diagnostics, and unchanged ephemeral behaviour. It must not claim production durable mutation.

**The browser settings card is verified by protocol, not by pixels.** `tests/client-bundle.spec.ts` executes the built bundle under the Host loader's own contract — factory handoff, id match, a `require` that answers only the platform module table, and the style tag the loader claims. No gate renders the card in a browser, and none of the three hand-maintained couplings it carries (bundle format, slot declaration, client package versions) can fail the build. Treat a DSH client-side change as a card-compatibility risk only a manual check can retire.

**No ACP agent has been spawned by a gate.** Every curated spawn command was read off the agent's own documentation and re-checked against the npm registry, and `tests/acp-catalog.spec.ts` pins the two findings that would otherwise regress: the renamed Claude adapter, and the Grok version the Zed registry pins but npm does not publish. No gate performs a real ACP handshake, so the commands are evidenced, not exercised.

## Carried over

- `devDependencies` still pin DSH 0.1.0-rc.6, so unit tests run against the declared minimum; 0.1.0-rc.7 is covered only by the packed `latest-tested` matrix channel, which installs DSH independently of the lockfile. Advancing the dev pin needs a lockfile regeneration against the public registry.

No receipt or tag is generated in the source tree.
