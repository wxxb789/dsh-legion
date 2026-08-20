# v1.2.0 release prerequisites

- [ ] Run the full `pnpm run check` gate on a clean committed tree.
- [ ] Produce one reproducible tarball from two isolated `git archive HEAD` rounds.
- [ ] Complete all eight Windows/Linux, Node 22/24, minimum/latest-tested packed compatibility slots against that exact tarball.
- [ ] Verify compatibility receipts, SBOM, checksums, and build attestation bind the exact tarball.
- [ ] Confirm npm Trusted Publishing and the recoverable GitHub draft release path.
- [ ] Create and push `v1.2.0` only after every metadata and evidence gate agrees.

## What the evidence may and may not claim

**Durable mutation stays unavailable.** No DSH 0.1.0-rc.6 (the declared minimum), 0.1.0-rc.7, or 0.1.0-rc.8 (the latest tested) release publishes the atomic run coordination Host service durable mutation requires. Session flush and `sessionProjections` do exist; coordination is the single missing mandatory capability. The 0.1.0-rc.8 Agent Teams packages ship a durable mailbox and task DAG but are private, unpublished, and coordinate only within one process, so they do not supply it either — see `notes/agent-teams-reuse-assessment.md`. Release evidence may prove structural contracts, pure replay, deterministic capability diagnostics, and unchanged ephemeral behaviour. It must not claim production durable mutation.

**The browser settings card is verified by protocol, not by pixels.** `tests/client-bundle.spec.ts` executes the built bundle under the Host loader's own contract — factory handoff, id match, a `require` that answers only the platform module table, and the style tag the loader claims. No gate renders the card in a browser, and none of the three hand-maintained couplings it carries (bundle format, slot declaration, client package versions) can fail the build. Treat a DSH client-side change as a card-compatibility risk only a manual check can retire.

**No ACP agent has been spawned by a gate.** Every curated spawn command was read off the agent's own documentation and re-checked against the npm registry, and `tests/acp-catalog.spec.ts` pins the two findings that would otherwise regress: the renamed Claude adapter, and the Grok version the Zed registry pins but npm does not publish. No gate performs a real ACP handshake, so the commands are evidenced, not exercised.

## Carried over

- `devDependencies` still pin DSH 0.1.0-rc.6, so unit tests and `typecheck` run against the declared minimum. This is deliberate, not staleness: it is the only gate that catches an accidental dependency on a newer DSH API, and it did so — `SubagentResult.diagnostic` (new in 0.1.0-rc.8) has to be read across a version boundary in `src/settlement.ts` precisely because the floor build would otherwise fail to compile. 0.1.0-rc.8 is covered by the packed `latest-tested` matrix channel, which installs DSH independently of the lockfile. Advancing the dev pin needs a lockfile regeneration against the public registry, and would trade the floor-compatibility gate away; do not advance it without replacing that gate.

No receipt or tag is generated in the source tree.
