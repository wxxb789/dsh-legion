# v1.2.0 release prerequisites

- [ ] Run the full `pnpm run check` gate on a clean committed tree.
- [ ] Produce one reproducible tarball from two isolated `git archive HEAD` rounds.
- [ ] Complete all eight Windows/Linux, Node 22/24, minimum/latest-tested packed compatibility slots against that exact tarball.
- [ ] Verify compatibility receipts, SBOM, checksums, and build attestation bind the exact tarball.
- [ ] Confirm npm Trusted Publishing and the recoverable GitHub draft release path.
- [ ] Create and push `v1.2.0` only after every metadata and evidence gate agrees.

## What the evidence may and may not claim

**Durable mutation stays unavailable.** No DSH release from 0.1.1-rc.1 (the declared minimum) through 0.1.1-rc.2 (the latest tested) publishes the atomic run coordination Host service durable mutation requires. Session flush and `sessionProjections` do exist; coordination is the single missing mandatory capability. The Host `Agent Teams` packages ship a durable mailbox and task DAG but are private, unpublished, and coordinate only within one process, so they do not supply it either — see `notes/agent-teams-reuse-assessment.md`. The `waitMs` option 0.1.1-rc.1 added to `withFileLock` lengthens a wait without adding a guarantee — see `notes/dsh-0.1.1-rc.1-upgrade.md`. Release evidence may prove structural contracts, pure replay, deterministic capability diagnostics, and unchanged ephemeral behaviour. It must not claim production durable mutation.

**The browser settings card is verified by protocol, not by pixels.** `tests/client-bundle.spec.ts` executes the built bundle under the Host loader's own contract — factory handoff, id match, a `require` that answers only the platform module table, and the style tag the loader claims. No gate renders the card in a browser, and none of the three hand-maintained couplings it carries (bundle format, slot declaration, client package versions) can fail the build. Treat a DSH client-side change as a card-compatibility risk only a manual check can retire.

**No ACP agent has been spawned by a gate.** Every curated spawn command was read off the agent's own documentation and re-checked against the npm registry, and `tests/acp-catalog.spec.ts` pins the two findings that would otherwise regress: the renamed Claude adapter, and the Grok version the Zed registry pins but npm does not publish. No gate performs a real ACP handshake, so the commands are evidenced, not exercised.

## Carried over

- `devDependencies` pin DSH 0.1.1-rc.2, the declared latest-tested line, so `typecheck` and the unit gate exercise the line Legion actually claims. The floor moved with them: 0.1.1-rc.1 is the declared minimum, and the packed `minimum` matrix channel installs it independently of the lockfile. That is what replaced the old floor gate — the previous floor, 0.1.0-rc.6, was two release lines behind and was compiled by nothing else. The window is deliberately one release line wide, because `docs/notes/dsh-0.1.1-rc.2-upgrade.md` shows rc.1 and rc.2 are byte-identical across every package Legion imports, so the two ends of the range differ in nothing Legion compiles against. Compatibility code written for the retired floor (`src/settlement.ts` reading `SubagentResult.diagnostic` across a version boundary, and the dual projection spelling in `src/durable-run/projection.ts`) is kept as defence rather than removed in the same change.

- The compatibility receipt's `capabilityMode` is the frozen literal `rc6-replay-only-fail-closed`, named after a floor the package no longer supports. Producer and verifier agree on the string and no invariant is violated, but renaming it moves `compatibilityReceiptVersion`, so it waits for the next receipt-schema change rather than riding a version bump.

No receipt or tag is generated in the source tree.
