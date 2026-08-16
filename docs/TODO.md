# v1.1.0 release prerequisites

- [ ] Run the full `pnpm run check` gate on a clean committed tree.
- [ ] Produce one reproducible tarball from two isolated `git archive HEAD` rounds.
- [ ] Complete all eight Windows/Linux, Node 22/24, minimum/latest-tested packed compatibility slots against that exact tarball.
- [ ] Verify compatibility receipts, SBOM, checksums, and build attestation bind the exact tarball.
- [ ] Confirm npm Trusted Publishing and the recoverable GitHub draft release path.
- [ ] Create and push `v1.1.0` only after every metadata and evidence gate agrees.

DSH 0.1.0-rc.6 lacks published atomic coordination and projection Host services. Release evidence may prove structural contracts, pure replay, deterministic capability diagnostics, and unchanged ephemeral behavior; it must not claim production durable mutation. No receipt or tag is generated in the source tree.
