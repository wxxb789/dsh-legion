# Run Receipts

A Run Receipt is an honest, bounded account of one ephemeral Cohort Run. The full view shows the frozen stage graph, participant state, elapsed evidence, token evidence, coverage, truncation, and outcome. It is observation data, not a transcript, historical archive, execution controller, or billing record.

## Install and compose the package pair

Install `dsh-legion`, not two independently selected packages. The root package carries an exact `dsh-legion-receipts` dependency at the same version, and its bundle patch mounts two Host rows:

- `legion-settings` loads `dsh-legion` with `role: settings`; it owns only the Settings namespace and card.
- `legion-receipts` loads `dsh-legion-receipts`; it owns the process-local feed and Web overlay.

The model-facing `legion` tool remains on the Agent Preset row. Neither Host row publishes it. Do not override the companion to another version or copy either Host row into an Agent Preset. Updating the root resolves its new exact companion dependency; removing the root removes that dependency and both bundle rows, but never deletes user-owned Agent Presets or configuration.

A Web installation therefore needs both built Client artifacts and both exact-version packages. A headless composition may intentionally mount only the Agent Preset row: the companion dependency can remain installed but inactive, and ordinary Specialist or Strategy delegation must not wait for its service.

See the main [installation instructions](../README.md#install) and [Settings card packaging notes](settings-card.md#packaging).

## Lifetime and recovery

Full Receipt facts exist only while the same parent Session and the same companion instance remain live. The Host companion keeps a bounded process-local read model and writes no Receipt snapshot to a Session event, projection cache, file, database, WAL, or browser storage.

Each Client stream generation receives a complete Session baseline before complete replacements. A page refresh or carrier reconnect can therefore recover the same active Receipt from the still-live Host. Session disposal, companion reload, or Host restart ends that lifetime; the next companion instance starts empty. Browser storage may retain presentation choices such as dock position or selected run, but never stages, participants, objectives, prompts, outputs, artifacts, or token facts.

The Strategy tool result is separate: it returns a fixed-shape terminal summary with outcome, stage and participation counts, elapsed evidence, known token subtotals, unavailable and truncation counts, coverage, and feed availability. It contains no child arrays and remains the only Receipt artifact for headless or missing-companion operation.

## Read the evidence honestly

Session-backed participants use official Agent, Session Query, timing projection, and token-fold facts. Their usage excludes fork-seed ancestry, includes reported post-seed compaction usage, and keeps absent optional cache buckets unavailable rather than zero. Remote participants use official Subagent lifecycle facts. When a remote child has no observable Session, its Session-only timing or token dimensions are unavailable; Host-observed lifecycle elapsed may still be reported with its distinct source, while nested remote descendants remain unobservable.

A known subtotal with partial coverage is not a total. An unavailable dimension is not zero. Run Receipts contain no price, cost, money, or currency field.

The overlay follows the current Session and can show opening, empty, active, partial, reconnecting, invalid-frame, unavailable, terminal, direct-clear, and new-Host-instance states. Reconnecting may preserve last-known facts as stale for the same Session; Session navigation clears the prior view. A valid direct Specialist invocation may clear one stale terminal Receipt immediately before child admission, but it cannot hide an active Cohort Run.

## Automated acceptance matrix

This table maps each acceptance example to existing behavior-bearing evidence. `tests/documentation.spec.ts` guards the complete AE1-AE11 set, every path below, and its named test or public-runtime marker. The guard is traceability evidence only; the referenced suites and commands prove behavior.

| Acceptance | Deterministic repository evidence | Command |
|---|---|---|
| AE1 | `tests/run-receipt-telemetry.spec.ts`; `tests/loader-smoke.spec.ts`; `tests/fixtures/loader-smoke-driver.mjs` | `pnpm run test:composition` |
| AE2 | `packages/run-receipt-feed/tests/client-overlay.spec.ts`; `tests/run-receipt-telemetry.spec.ts` | `pnpm run test:unit` |
| AE3 | `tests/run-receipt-telemetry.spec.ts` | `pnpm run test:unit` |
| AE4 | `tests/run-receipt-telemetry.spec.ts` | `pnpm run test:unit` |
| AE5 | `packages/run-receipt-feed/tests/host-feed.spec.ts`; `packages/run-receipt-feed/tests/client-overlay.spec.ts`; `tests/run-receipt-telemetry.spec.ts` | `pnpm run test:unit` |
| AE6 | `scripts/packed-delegation-consumer.mjs`; `scripts/verify-packed-delegation.mjs` | `pnpm run test:packed-delegation` |
| AE7 | `tests/config-version.spec.ts`; `tests/fixtures/packed-legacy-consumer.ts` | `pnpm run test:packed-delegation` |
| AE8 | `tests/dependency-preflight.spec.ts` | `pnpm run test:unit` |
| AE9 | `tests/dependency-preflight.spec.ts` | `pnpm run test:unit` |
| AE10 | `tests/loader-smoke.spec.ts`; `packages/run-receipt-feed/tests/security.spec.ts`; `packages/run-receipt-feed/tests/host-feed.spec.ts`; `tests/contract.spec.ts` | `pnpm run test:profile-install` |
| AE11 | `packages/run-receipt-feed/tests/client-overlay.spec.ts` | `pnpm run test:unit` |

**Cross-cutting R5 evidence:** `tests/run-receipt-telemetry.spec.ts` proves that the frozen plan and actual child settlement determine stage and outcome state while model narration and `lastAssistantMessage` cannot add stages, change status, or enter the Receipt.

The matrix deliberately composes official DSH evidence rather than replacing it: Loader Smoke and LLM Replay for the packed Host, the generated Typert/Gateway integration suite, the official Client Test Runtime for DOM and interaction behavior, separate canonical headless and compiled legacy packed consumers, and focused security, caps, dependency-preflight, vocabulary, contract, and compatibility tests.

For a local source-only acceptance pass, run:

~~~bash
pnpm run check
DSH_LEGION_OFFLINE=1 pnpm run test:profile-install
DSH_LEGION_OFFLINE=1 pnpm run test:packed-delegation
pnpm run test:composition
pnpm run verify:release -- v<package-version>
pnpm run verify:contract
pnpm run verify:journal-contract
pnpm exec vitest run tests/dependency-preflight.spec.ts
pnpm run verify:reproducible-pack
~~~

Before claiming protected compatibility, compare the implementation range explicitly:

~~~bash
git diff --exit-code <implementation-base> -- src/durable-run contracts/journal-v1.json
~~~

A local offline pass does not prove public-registry availability, CI, or a running browser deployment.

## Manual Web record

**U10 handoff status: DEFERRED (user-directed, 2026-08-31).** The existing URL had a live `dsh web` listener, but its selected Web composition declared only the base/Web bundles with no Legion dependency or patch row, and no `pnpm run dev:web` watcher was observed. The exact packed pair was therefore not mounted or interactively testable. Issue #2's authority explicitly deferred this real-browser lane after the automated exact-pair and CI evidence passed; these checks are retained as a future verification checklist rather than closure blockers. A reachable page or a source checkout is not package-pair evidence.

Record these identifiers first:

- root tarball name, version, and SHA-256;
- companion tarball name, version, and SHA-256;
- installed Host composition name and the two resolved Loader row names;
- DSH commit/version and browser URL;
- whether `pnpm run dev:web` is active in that exact DSH checkout.

Client-plugin HMR is valid only while that watcher rebuilds bundles from the same checkout. Without it, rebuild and install the packed pair, then refresh the existing GUI. Do not start a substitute server and do not treat a different URL as this lane.

| Check | Status | Evidence to record |
|---|---|---|
| Both exact package versions load; the generated Remote namespace exists; no duplicate Slot entry or page error appears | DEFERRED | Loader/module identities and console record |
| A held in-flight run is visible before the first child starts; reload preserves the run ID and Host facts | DEFERRED | Before/after run ID and screenshots or recording |
| Per-member stage, provider, state, elapsed source, token coverage, unavailable dimensions, and terminal outcome are honest | DEFERRED | Visible values for local and remote/mixed participants |
| Another overlay occupant and the conversation remain operable; bounding boxes do not overlap | DEFERRED | Bounding boxes and both control results |
| Keyboard-only select, dismiss, reopen, focus restoration, and live-region announcements work on desktop | DEFERRED | Focus order and announced text |
| Narrow and touch layouts use the full-width non-dragging dock with operable targets | DEFERRED | Viewport/pointer conditions and interaction record |
| Switching Sessions never shows the previous Session's Receipt | DEFERRED | Session IDs and visible run IDs |
| A direct Specialist invocation after a terminal Cohort does not make that Cohort Receipt appear current | DEFERRED | Invocation order and resulting state copy |
| Browser storage contains presentation preferences only, never full Receipt facts | DEFERRED | Storage key/value inspection |
| Host restart starts with no full Receipt facts while prior tool-result history remains in the conversation | DEFERRED | Before/after Host instance and conversation record |

Pushed `main` CI evidence is recorded on issue #2. The issue authority explicitly deferred both this real-browser lane and public npm name/OIDC Trusted Publisher proof; neither is a closure blocker for issue #2, and no tag or publication is implied. Complete the table before a later claim of real-browser support, and satisfy the existing `prerequisite-deferred` release contract before publishing either package.
