# DSH 0.1.1-rc.1 upgrade assessment

Assessed against the DSH release commits `15148dbd9a` (0.1.0-rc.6), `f1f7dc36fa` (0.1.0-rc.8), and
`3ec5e8f8c4` (0.1.1-rc.1, 172 commits later), reading a local harness checkout. Legion's
`node_modules/@deepseek-ai/*` are junctions onto that checkout, so every gate result below is
empirical against 0.1.1-rc.1 sources.

## Verdict

**Two changes reach this plugin, and neither is a type the compiler could have caught.**

1. The declared peer range **did not admit 0.1.1-rc.1 at all**. `>=0.1.0-rc.6 <0.2.0` rejects it,
   because semver admits a prerelease only against a comparator sharing its `major.minor.patch`.
2. DSH 0.1.1-rc.1 **retyped the `ctx.sessionProjections` registration contract**, which Legion
   reaches structurally. The stale shape registers cleanly and then throws inside the Host's own
   cold-read path.

`pnpm run check` passes end to end against 0.1.1-rc.1 both before and after the fix — typecheck,
three-artifact build, public-contract and journal-contract verification, unit tests across 49 files,
the protocol benchmark, the reproducible-pack check, and `npm pack`. That is the point: a green gate
was never evidence about either finding, because both live below the type system.

## The peer range rejected 0.1.1-rc.1

Verified with `semver@7.7.2`, not reasoned about:

| Range | `0.1.0-rc.6` | `0.1.0-rc.8` | `0.1.1-rc.1` | `0.1.1` | `0.2.0` |
|---|---|---|---|---|---|
| `>=0.1.0-rc.6 <0.2.0` | yes | yes | **no** | yes | no |
| `>=0.1.0-rc.6 <0.2.0 \|\| >=0.1.1-rc.1 <0.2.0` | yes | yes | **yes** | yes | no |

node-semver admits a prerelease version only when some comparator in the same set carries a
prerelease **and** the same `major.minor.patch` tuple. `>=0.1.0-rc.6` carries a prerelease on the
`0.1.0` tuple, so it admits the whole `0.1.0-rc.x` line and every stable `0.1.x`; `0.1.1-rc.1` sits
on the `0.1.1` tuple, which no comparator names. Nothing about this is specific to 0.1.1: **every
future `0.1.N-rc.x` line needs its own clause**, and the clause is exactly the assessment record —
a version enters the range when it has been tested, which is the discipline
`latestTestedDshVersion` already encodes.

The new clause admits later prereleases of the same line (`0.1.1-rc.2`, ...) automatically, because
they share the `0.1.1` tuple. `>=0.1.0-rc.6 <0.2.0-0` was rejected as an alternative: it changes
nothing for `0.1.1-rc.1` and only alters how `0.2.0` prereleases are excluded.

## The real break: a retyped projection registration contract

`ProjectionDefinition` changed shape in
`packages/session/session-projection/src/index.ts`:

| 0.1.0-rc.6 through 0.1.0-rc.8 | 0.1.1-rc.1 | Line |
|---|---|---|
| `schema` validates the **wire payload** `view` produces | `stateSchema` validates **persisted state** | `:49` |
| `view` is required | `wire?: { viewSchema, view }`; omitting it makes the unit **host-only** | `:65` |
| keyed by `keyof SessionProjectionMap` | keyed by `keyof SessionProjectionStateMap` | `:43` |
| — | new `stateOf(session, key)` read face for host-only units | `:288` |

Legion registers `legionRunProjection` on **every apply** (`src/index.ts:867`) and reaches the
registry structurally: `projectionRegistry(ctx.get?.('sessionProjections'))` duck-types on the
presence of `register` (`src/durable-run/projection.ts:387-393`). Legion takes no dependency on
`@deepseek-ai/dsh-session-projection`, so the rename is invisible to `tsc`.

What the old shape does on a 0.1.1-rc.1 Host, read off the registry source:

- `register()` erases the definition into `{ key, stateSchema, init, apply, wire, stateVersion }`
  (`:232`). Legion's object supplies neither name, so `stateSchema` becomes `undefined` and `wire`
  becomes `undefined`. Only `stateVersion` is validated, so registration **succeeds**.
- `snapshot()` and `viewCheckpoint()` skip the unit on `wire === undefined` (`:308`, `:384`) — no
  error, and no Legion value in client snapshots.
- `checkpoint()` still writes a row for the key (`:329-339`), so the persisted cache stores one.
- `restore()` then reads that row back and calls `def.stateSchema.parse(row.val)` (`:442`). On
  `undefined` that is a `TypeError`, thrown **inside the Host's loop over every registered unit**.

**What that costs, stated exactly.** It is not a crash, and an earlier draft of this note overstated
it. The sole caller, `ProjectionCacheStore.coldSnapshot`, wraps `restore()` in `try/catch`
(`packages/session/session-projection-cache/src/index.ts:184-193`) and recovers by re-reading the
whole log and refolding from `init` — its own comment at `:188-190` already names "stateSchema
rejection" as a recoverable failure. The cost is therefore silent and unbounded rather than loud:
**every** cold snapshot discards **every** unit's cached row and refolds the entire session log from
seq 0, for as long as Legion is mounted. The persisted projection cache is defeated for that
session, and the price grows with session length. A cache that never reports a miss and never
serves a hit is harder to diagnose than one that fails outright.

This is not hypothetical reach. `@deepseek-ai/dsh-session-projection` is mounted by `dsh-base`
(`packages/bundle/base/cordis.patch.yml:126`), so every profile has the registry, and
`dsh-session-projection-cache` — the component that persists rows and drives `restore()` — is
mounted by `web-app` (`packages/bundle/web-app/cordis.patch.yml:76`). A `dsh web` user on
0.1.1-rc.1 with Legion mounted is the exact configuration.

### The fix, and why it carries both spellings

The declared floor is still 0.1.0-rc.6, whose registry drives `schema` + `view`. One build must be
correct on both, so `legionRunProjection` now carries both names over **one** parser
(`src/durable-run/projection.ts`). Legion's `view` is the identity, so the state parser and the
wire parser were always the same function; the older contract simply called it by the other name.

`wire` is deliberately **absent**, which makes the unit host-only on 0.1.1-rc.1. That is the
correct classification and a small improvement over the floor's behaviour: Legion's key is not in
`SessionProjectionMap`, no Legion surface reads run state from a client snapshot, and the floor
Host was pushing whole run state into every client snapshot only because the older contract had no
way to say "host-only".

`tests/durable-projection.spec.ts` now exercises both Host contracts against the real definition
rather than pinning the local shape against itself.

Two things this fix does **not** buy, recorded so the next reader does not assume them:

- **No compile-time protection is restored.** `HostProjectionRegistry.register` is still typed
  against Legion's own `LegionProjectionDefinition`, so neither Host signature is checked. The next
  upstream rename fails exactly as silently; only that test stands between it and a shipped
  regression. Closing this properly means taking a real dependency on
  `@deepseek-ai/dsh-session-projection`, which the declared floor currently forbids — the floor
  registry types `register` against the other contract.
- **The two registries validate at different moments.** 0.1.1-rc.1 parses the stored row *before*
  folding it (`:442`); the 0.1.0-rc.6 floor seeds the fold with the raw row and parses only the
  result. On the floor, a corrupt cached row therefore reaches `applyLegionProjection` unvalidated.
  That is the floor's behaviour, unchanged by this fix and by the shape before it, but "one build
  correct on both" should not be read as erasing it.

## Package inventory delta

Exactly **one** package was added between 0.1.0-rc.8 and 0.1.1-rc.1, and none was removed or
renamed:

- `@deepseek-ai/dsh-authorization` (`packages/credentials/authorization`), public — "Authorization
  seam (`ctx.authorization`): plugin-owned flows that obtain a credential through a conversation
  with the human."

**Not a Legion capability.** Legion never owns a credential: a Profile names a provider and a model,
and the Host owns provider authentication. The one place it looks adjacent is
`RoutePlan.liveAvailability.auth`, and that is typed as the literal `'unknown'` on purpose
(`src/route.ts:101-102`) — ADR 0007 fixes route planning as pre-start and refuses live probes.
A seam whose defining behaviour is *blocking on a conversation with the human* is the strongest
possible case for that refusal, not an exception to it.

## Surface Legion actually imports

`git diff f1f7dc36fa..3ec5e8f8c4` over each peer's `src`:

| Package | rc.8 to 0.1.1-rc.1 |
|---|---|
| `dsh-agent` | unchanged (no source diff) |
| `dsh-llm` | unchanged (no source diff) |
| `dsh-session` | unchanged (no source diff) |
| `dsh-subagent` | only `src/projection.ts`; it is that package's own projection unit migrating to the new contract, and Legion imports none of it |
| `dsh-subagent-acp` | unchanged (no source diff) |
| `dsh-system-prompt` | unchanged (no source diff) |
| `dsh-tools` | unchanged (no source diff) |
| `dsh-settings` | unchanged (no source diff) |

The client packages the card touches are additive only: `dsh-client-runtime` gained two optional
`SessionsPort.create` fields, and `dsh-client-ui-primitives` gained an optional markdown
blockquote flag. Legion calls neither.

## Client module table: still exact

`packages/client/web/src/platform.ts` is byte-identical to the rc.8 table that
`tsdown.client.config.ts` mirrors — `PLATFORM_MODULES` is the same seven specifiers and
`PRELOADED_CLIENT_EXTERNALS` the same one. No drift this cycle; the mirror needed no edit.

## One upstream breaking change that misses Legion

- The wire event `credentials/updated` was renamed `credentials/reference-updated`. Legion
  subscribes to no credentials event.

`ctx.webServer.tapIndex` is **not** a second one, though a first pass through this release recorded
it as removed. It survives at `packages/host/webserver/src/index.ts:154`, still documented as the
escape hatch for markup no row expresses; 0.1.1-rc.1 *added* a structured `webserver/index-inject`
row table beside it, which runs before the raw transforms
(`packages/host/webserver/src/injections.ts:8`). Legion registers neither, so the correction changes
no decision — but a removal that never happened is exactly the kind of claim that later gets acted
on.

## Still missing upstream

All three standing asks survive 0.1.1-rc.1 unchanged, each checked in source rather than in package
descriptions:

- **Atomic run coordination / admission authority.** Still absent. No compare-and-set, lease, or
  fencing-token primitive exists in any published package. `dsh-atomic-write` gained an optional
  `waitMs` on `withFileLock`, which lengthens a wait and does not add a guarantee; it still owes
  durable monotonic fence allocation and CAS-at-append, as `agent-teams-reuse-assessment.md`
  already recorded. `durableMutation` therefore stays `unavailable-fail-closed`.
- **Unified LLM/child recovery seam.** `core/agent/src` and `llm/llm/src` are byte-identical to
  rc.8. Recovery remains same-route, single-request.
- **Per-child reasoning-effort override.** `reasoningEffort` still has zero occurrences in
  `packages/subagent/subagent/src`; effort stays an Agent-level selection.

## New seams worth an ADR-level look

`stateOf(session, key)` (`:288`) is new: a host-only unit can now be read directly, without
computing unrelated views. Together with `ContinuableStartSpec.childId` and
`drainContinuableChildren` (both carried over from rc.8), that is three of the pieces the ADR
0015-0020 durable Strategy controller would otherwise build for itself. None of them is the missing
coordination authority, so none of them unblocks durable mutation; they change what the controller
would have to write once it is unblocked.

## Dependencies: already at the newest version every range admits

| Dependency | Range | Resolved | Newest published |
|---|---|---|---|
| `@deepseek-ai/schemastery` | `^3.18.1` | 3.18.1 | 3.18.1 |
| `js-yaml` | `^4.2.0` | 4.3.1 | 5.2.3 |
| `@deepseek-ai/cordis` | `^4.0.1` | 4.0.1 | 4.0.1 |
| `@types/js-yaml` | `^4.0.9` | 4.0.9 | 4.0.9 |
| `@types/node` | `^22.20.0` | 22.20.1 | 26.2.0 |
| `tsdown` | `^0.22.2` | 0.22.14 | 0.22.14 |
| `typescript` | `^6.0.3` | 6.0.3 | 7.0.2 |
| `vitest` | `^4.1.8` | 4.1.10 | 5.0.0-rc.1 |

Nothing to bump: the lockfile already resolves the maximum of every range.

The four ranges whose major line trails the registry are **held deliberately**, and the reason is
the same for all four — they are not Legion's choices, they are DSH's. The harness root manifest at
0.1.1-rc.1 declares `typescript ^6.0.3`, `vitest ^4.1.8`, `js-yaml ^4.2.0`, `@types/node ^22.20.0`,
and `tsdown ^0.22.2`: identical to Legion's. Concretely:

- **TypeScript 7** is refused upstream, not merely unadopted: `pnpm-workspace.yaml` pins
  `peerDependencyRules.allowedVersions.typescript: '>=5 <7'`. Legion consumes `.d.ts` files emitted
  by that toolchain.
- **`@types/node` 26** would type APIs absent from Node 22, which `engines` still supports
  (`^22.19.0 || >=24.0.0`) and which the packed matrix still tests.
- **`vitest` 5** publishes `5.0.0-rc.1` under the `latest` dist-tag; an RC is not a stable upgrade.
- **js-yaml 5** is a major with no consumer benefit here — Legion parses `cordis.patch.yml` and
  preset fragments the Host reads with js-yaml 4 — and `@types/js-yaml` has no v5 line at all.

The DSH `devDependencies` pins stay at `0.1.0-rc.6` for the reason `docs/TODO.md` records: they are
the floor-compatibility gate, and they caught a real regression once already. 0.1.1-rc.1 is covered
by the packed `latest-tested` matrix channel, which installs DSH independently of the lockfile.

## Registry availability: published upstream, invisible from this machine

**0.1.1-rc.1 is published to the public npm registry.** CI run `32466388793` settles it: all four
`packed E2E (…, latest-tested, …)` jobs installed with `--registry=https://registry.npmjs.org` at
`DSH_VERSION: 0.1.1-rc.1` and passed, on both platforms and both Node versions, alongside the four
`minimum` slots at 0.1.0-rc.6 — so the widened peer range admits both ends of its own claim in a
real install, not only in a semver table.

The local picture says the opposite and is wrong, exactly as it was for 0.1.0-rc.8.
The configured Azure DevOps feed now mirrors the `0.1.0-rc.x` line up to `0.1.0-rc.6` — an
improvement over the state `dsh-0.1.0-rc.8-upgrade.md` recorded — but stops there:
`npm view @deepseek-ai/dsh-agent versions` ends at `0.1.0-rc.6`, and `0.1.1-rc.1` returns E404.
The public registry is refused at the TLS layer by company policy
(`ERR_SSL_SSL/TLS_ALERT_HANDSHAKE_FAILURE` against `registry.npmjs.org`), so no local command can
arbitrate.

**Do not regenerate `pnpm-lock.yaml` or move the DSH `devDependencies` pins from a machine on this
feed.** Locally those pins resolve only through the junctions onto the harness checkout.
