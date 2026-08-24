# DSH 0.1.1-rc.2 upgrade assessment

Assessed against the DSH release commits `3ec5e8f8c4` (0.1.1-rc.1) and `aa6c361a97`
("release(dsh): 0.1.1-rc.2"), reading a local harness checkout. Legion's
`node_modules/@deepseek-ai/*` are junctions onto that checkout, so the plugin already builds
against 0.1.1-rc.2 sources.

## Verdict

**Nothing in this release reaches Legion.** Not one package Legion imports or reaches structurally
changed a line of source, the client module table is byte-identical, the projection contract that
broke the previous upgrade is untouched, and no package was added, removed, or renamed.

This is the opposite shape from rc.1, and the reason is worth stating: rc.1 was a contract release
(a retyped projection registration, a renamed wire event); rc.2 is a **feature release confined to
the image/attachment and provider-adapter planes** — DeepSeek Files API upload, request-image
normalization and quarantine, per-model input-modality projection, permission-preset presentation.
Legion touches none of those planes.

The one required edit is bookkeeping, not code: `latestTestedDshVersion` advances to `0.1.1-rc.2`.
The declared peer range already admits it without change, because `>=0.1.1-rc.1 <0.2.0` carries a
prerelease on the `0.1.1` tuple and rc.2 shares that tuple — exactly the property the rc.1 note
predicted when it added that clause.

## 1. Package inventory delta: empty

`git ls-tree -r --name-only <commit> packages` filtered to `package.json` returns **234 manifests at
both commits, with identical paths**. No package was added, removed, or renamed. Every `"name"`
field is unchanged; the manifests appear in `git diff` only because each one's `"version"` moved
from `0.1.1-rc.1` to `0.1.1-rc.2`.

- **No addition, therefore no Legion capability question to answer.** The rc.1 cycle had one
  (`@deepseek-ai/dsh-authorization`, declined); this cycle has none.
- **`contracts/compatibility.json`'s `dshPackageClosure` needs no change.** All 21 entries still
  exist under `packages/` at `aa6c361a97` under the same names, and no new package qualifies for
  entry.

## 2. Surface Legion actually imports or reaches

Legion's `@deepseek-ai/` specifiers across `src/` are `dsh-agent`, `dsh-llm`, `dsh-session`,
`dsh-session-projection`, `dsh-subagent`, `dsh-subagent-acp`, `dsh-system-prompt`, `dsh-tools`,
`dsh-settings`, `dsh-code-runtime-worker-thread`, `dsh-client-runtime`,
`dsh-client-ui-primitives`, `dsh-client-ui-settings-plugins`, plus `@deepseek-ai/cordis` and
`@deepseek-ai/schemastery`. Its structural `ctx` reaches are `sessionProjections`, `subagents`,
`tools`, `systemPrompt`, `llm`, `settingsScope`, `codeRuntime`, `slots`, `locale`, and the
cordis primitives (`get`, `inject`, `effect`, `emit`, `on`, `plugin`, `fiber`, `logger`).

`git diff --stat 3ec5e8f8c4..aa6c361a97` over each package's `src`:

| Package (source dir) | rc.1 to rc.2 | Reaches Legion? |
|---|---|---|
| `dsh-agent` (`packages/core/agent/src`) | unchanged | no |
| `dsh-agent-loop` (`packages/core/agent-loop/src`) | unchanged | no |
| `dsh-scope` (`packages/core/scope/src`) | unchanged | no |
| `dsh-session` (`packages/core/session/src`) | unchanged | no |
| `dsh-session-projection` (`packages/session/session-projection/src`) | unchanged | no |
| `dsh-session-projection-cache` (`packages/session/session-projection-cache/src`) | unchanged | no |
| `dsh-subagent` (`packages/subagent/subagent/src`) | unchanged | no |
| `dsh-subagent-acp` (`packages/subagent/subagent-acp/src`) | unchanged | no |
| `dsh-system-prompt` (`packages/core/system-prompt/src`) | unchanged | no |
| `dsh-tools` (`packages/core/tools/src`) | unchanged | no |
| `dsh-settings` (`packages/settings/settings/src`) | unchanged | no |
| `dsh-code-runtime-worker-thread` | unchanged | no |
| `dsh-token-meter` (`packages/llm/token-meter/src`) | unchanged | no |
| `dsh-host-webserver` (`packages/host/webserver/src`) | unchanged | no |
| `dsh-atomic-write` (`packages/util/atomic-write/src`) | unchanged | no |
| `dsh-client-ui-primitives` | unchanged | no |
| `dsh-client-ui-settings-plugins` (`src`) | unchanged | no |
| `dsh-llm` (`packages/llm/llm/src`) | `content.ts`, `index.ts` changed | **no** — see below |
| `dsh-client-runtime` (`packages/client/runtime/src`) | 4 files changed | **no** — see below |

Only two of the nineteen changed at all, and neither change touches what Legion consumes.

### `dsh-llm`: changed, but not on Legion's import surface

Legion imports exactly three type names from this package, all `import type`:

- `ContentBlock` — `src/execution.ts:21`, `src/index.ts:4`, `src/settlement.ts:1`
- `LlmResolvedModelInfo` and `LlmRuntime` — `src/route.ts:2`

The rc.2 change is the **prepared-call generation binding** plus **text-model image projection**
(`packages/llm/llm/src/index.ts`):

- New `PreparedAdapterCall` interface (`:178-184`) and a new `LlmAdapter.prepareCall` default
  method (`:246-252`) that binds model resolution and the eventual stream dispatch to one adapter
  generation, so a settings change between preparation and dispatch cannot combine one generation's
  capabilities with another's endpoint.
- `PreparedLlmCall` gains one **optional readonly** field, `inputModalities?: readonly
  ModelModality[]` (`:163-164`), populated from the bound model info.
- `adapterStream` now projects images out of the request when the bound model's
  `inputModalities` excludes `'image'`, via the new `contentHasImage` / `projectImagesForTextModel`
  helpers in `packages/llm/llm/src/content.ts`.
- Internal refactor only: `resolveModelInfoFor` splits into `normalizeModelInfo` /
  `resolveCallWithInfo`, and the private `PreparedDispatch` interface replaces an inline type
  (`:1019-1024`).

**Why this misses Legion.** `ContentBlock` is not redefined — `content.ts` only *adds* the two
helper functions. `LlmResolvedModelInfo` is unchanged; the new `inputModalities` field on
`PreparedLlmCall` is optional and additive, and Legion never constructs or consumes a
`PreparedLlmCall`. `LlmRuntime` gains no removed or retyped public member — `prepareCall`'s
signature is identical, and `LlmAdapter.prepareCall` has a default implementation, so no existing
adapter subclass breaks. Legion registers no adapter. This is source-compatible in both directions.

### `dsh-client-runtime`: a reversal of an rc.1 addition, on a face Legion does not call

The rc.1 note recorded that `dsh-client-runtime` "gained two optional `SessionsPort.create`
fields". rc.2 **removes both again**:

- `SessionsPort.create` narrows from `{ workspaceId, sessionId?, reuseWorkspaceBlank? }` back to
  `{ workspaceId }` (`packages/client/runtime/src/client/contract/sessions-port.ts:35-39`).
- `SessionManager.create` and `SessionRuntime.create` drop `reuseWorkspaceBlank`
  (`src/client/sessions/manager.ts:536-540`, `src/client/sessions/service.ts:485`).
- `WorkspaceRuntime.connectWorkspace` reverts from "explicitly adopt through `sessions.create`"
  to plainly returning the existing blank session's id (`src/client/workspaces/service.ts:107-110`).

This is a genuine narrowing of a public client contract — recorded here as the release's one real
breaking change — but it **does not reach Legion**. Legion's client half imports only
`ClientContext`, `SettingsScope`, and `createSnapshotStore` from
`@deepseek-ai/dsh-client-runtime/client` (`src/client/index.ts:14-15`,
`src/client/settings-form.ts:25`), and `IconChevronDownOutline14` from
`@deepseek-ai/dsh-client-ui-primitives` (`src/client/LegionCard.ts:24`). None of those is
`SessionsPort`; Legion never creates or adopts a session from the client plane.

## 3. Breaking changes, and the projection contract re-checked

- **`ctx.sessionProjections` `ProjectionDefinition` is unchanged.** `packages/session/session-projection/src`
  has **no source diff** between `3ec5e8f8c4` and `aa6c361a97`; only its `package.json` version
  moved. The `stateSchema` / optional-`wire` / `SessionProjectionStateMap` / `stateOf` shape that
  rc.1 introduced — and that Legion now satisfies in both spellings in
  `src/durable-run/projection.ts` — **survives rc.2 untouched**. `session-projection-cache` is
  likewise byte-identical, so the `restore()` / `coldSnapshot` recovery path the rc.1 note
  dissected behaves exactly as documented there. No second migration this cycle.
- **No renamed wire event on any surface Legion subscribes to.** The rc.1 rename
  (`credentials/updated` to `credentials/reference-updated`) is history; rc.2 adds none.
- **No removed service seam.** `ctx.webServer.tapIndex` is still present and
  `packages/host/webserver/src` has no source diff at all.
- **The one narrowing** is `SessionsPort.create`, above. It is a client-plane contract that Legion
  does not call.

## 4. The client plane: the module table did not move

`packages/client/web/src/platform.ts` has **no diff** between the two commits. Read at
`aa6c361a97`, specifier by specifier against `tsdown.client.config.ts:39-51`:

| Upstream list | Specifier | Legion's mirror |
|---|---|---|
| `PLATFORM_MODULES` | `react` | present |
| `PLATFORM_MODULES` | `react/jsx-runtime` | present |
| `PLATFORM_MODULES` | `react-dom` | present |
| `PLATFORM_MODULES` | `react-dom/client` | present |
| `PLATFORM_MODULES` | `@deepseek-ai/cordis` | present |
| `PLATFORM_MODULES` | `@deepseek-ai/dsh-client-ui-slots` | present |
| `PLATFORM_MODULES` | `@deepseek-ai/dsh-client-ui-primitives` | present |
| `PRELOADED_CLIENT_EXTERNALS` | `@deepseek-ai/dsh-client-runtime/client` | present |

Seven plus one, in the same order, with nothing upstream that the mirror omits and nothing in the
mirror that upstream dropped. **Legion's mirror needs no edit**, and `tests/client-bundle.spec.ts`
continues to pin it.

## 5. The three standing upstream asks: all three still absent

Each re-checked against `aa6c361a97` source, not against package descriptions.

- **Atomic run coordination / admission authority — still absent.** A repository-wide
  `git grep` over `packages/**/src` at `aa6c361a97` for `compareAndSet`, `fencingToken`,
  `leaseId`, and `admissionAuthority` returns **zero files**. `packages/util/atomic-write` has no
  source diff this cycle at all — only its version bumped — so `withFileLock` still offers a
  cross-process lock without durable monotonic fence allocation or CAS-at-append. Nothing else
  published gained a lease, fence, or compare-and-set primitive.
- **Unified LLM/child recovery seam — still absent.** `packages/core/agent/src` is byte-identical
  to rc.1. `packages/llm/llm/src` did change, but in the opposite direction from a recovery seam:
  `prepareCall` **narrows** a prepared call to one adapter generation and one dispatch, and the
  existing `INVALID_PREPARED_CALL` single-dispatch guard is retained (`index.ts:849-852`).
  Recovery remains same-route and single-request; cross-route replay is still unavailable.
- **Per-child reasoning-effort override — still absent.** `git grep -n 'reasoningEffort'` over
  `packages/subagent/subagent/src` at `aa6c361a97` returns **zero occurrences**, unchanged from
  rc.1. Effort stays an Agent-level selection.

**Therefore `hostCapabilities.durableMutation` stays `unavailable-fail-closed`.** The mandatory
Host coordination authority is still missing, and Legion must keep failing closed on durable
execution.

## 6. Run Receipt inputs: none affected

Every seam the planned Run Receipt reads is byte-identical between the two commits.

- **Agent registry statuses and events.** `packages/core/agent/src` and
  `packages/subagent/subagent/src` both have zero source diff. The status vocabulary and the
  `running`-versus-`idle` disambiguation the receipt would rely on are unchanged, including the
  documented caveat that `Agent.status` alone is insufficient in the window between `followup()`
  and the turn actually starting (`packages/subagent/subagent/src/continuation.ts:234`, `:927-933`).
- **The continuable subagent id-equals-agent-id guarantee.** Unchanged.
  `ContinuableStartSpec.childId` still sits at `continuation.ts:122`, and `AgentRegistry.enter()`
  is still the authoritative collision boundary for an id (`continuation.ts:1055`).
- **Cold child-listing seams.** `drainContinuableChildren` is still exported at
  `packages/subagent/subagent/src/index.ts:321` with the same signature, and the projection-cache
  cold path (`session-projection-cache`) has no source diff.
- **Token meter per-session measurement.** `packages/llm/token-meter/src` has no source diff; only
  its version moved. Note that the `dsh-llm` image-projection change does alter *what a text model
  is sent* when a request carries images on a text-only model, but Legion sends no image content
  and the meter's own measurement code is untouched.

Two rc.2 additions are worth noting as adjacent but not receipt-relevant:
`PreparedLlmCall.inputModalities` exposes exact model modalities at prepare time, which a future
Route Plan could record without a live probe — but ADR 0007 fixes route planning as pre-start, and
this field is only populated on a prepared call, i.e. after the routing decision. It changes nothing
today.

## Registry state: what was checked, and from where

The rc.1 note recorded that a local picture can be misleading — the feed configured on the machine
doing the assessment stopped two lines short of the release being assessed — so this cycle checked
publication explicitly rather than inferring it from a harness checkout.

- **The declared closure resolves.** `verify-dependency-preflight` run against a public-registry
  mirror reports `satisfied` across all 21 declared packages and 225 declared lines, with
  `host line drift: current (declared latest-tested 0.1.1-rc.2, highest resolvable 0.1.1-rc.2)`.
  The standing `LEGION_PRERELEASE_ONLY_RESOLUTION` advisory is still raised and still does not fail
  the gate: it is a property of a prerelease-only Host line, not of this contract.
- **The mirror serves the same bytes as the public registry.** The sha512 integrity the mirror
  reports for `@deepseek-ai/dsh-agent@0.1.0-rc.6`, `dsh-llm`, `dsh-tools`, and
  `dsh-system-prompt` is identical to the integrity already committed in `pnpm-lock.yaml`, which
  was resolved from the public registry, so a mirror answer is evidence about the public registry
  rather than about a separate publication.
- **0.1.1-rc.2 is published publicly.** jsDelivr's package API, which serves only what npm
  publishes, lists `0.1.1-rc.2` for `@deepseek-ai/dsh-agent` and reports its dist-tags as
  `latest: 0.1.0-rc.6`, `next: 0.1.1-rc.2`. That stale `latest` is the same condition
  `docs/solutions/integration-issues/upstream-publish-gap-reads-as-a-legion-regression.md` records,
  and it is why neither the contract nor the range ever reads a dist-tag.
- **The Host has never published a stable `0.1.0`.** The registry holds `0.1.0-rc.2` through
  `0.1.0-rc.8` and then the `0.1.1-rc.x` line, with nothing between, so the new range excluding
  `0.1.0` costs no deployment that exists.
- **The limit, stated.** The machine performing this assessment cannot reach
  `registry.npmjs.org` directly — the TLS handshake is refused — so npmjs itself was not queried.
  CI is the authority: the quality job runs the preflight against the public registry before the
  packed install, and the `latest-tested` matrix channel installs 0.1.1-rc.2 from it on four of the
  eight compatibility slots.

## What this upgrade required of Legion

**Zero source edits.** Everything this release cost is bookkeeping, and it was taken in one change,
because the repository's version policy is that the declared line moves as a unit: the peer range,
the declared minimum, the declared latest-tested version, and the assessed-version list advance
together, and none of them advances alone.

- **`contracts/compatibility.json`** — `dshPeerRange` `">=0.1.1-rc.1 <0.2.0"`,
  `minimumDshVersion` `"0.1.1-rc.1"`, `latestTestedDshVersion` `"0.1.1-rc.2"`,
  `assessedDshVersions` `["0.1.1-rc.1", "0.1.1-rc.2"]`, and `hostCapabilities.reason` reworded to
  say "through 0.1.1-rc.2". `dshPackageClosure` (all 21 entries),
  `hostCapabilities.durableMutation` (stays `unavailable-fail-closed`), the other three
  `hostCapabilities` fields, `previousMinorCompatibility`, and both schema-version fields: no
  change.
- **`package.json`** — the six `@deepseek-ai/dsh-*` peer ranges restate the policy's
  `dshPeerRange`, and the eleven DSH `devDependencies` pins move `0.1.0-rc.6` to `0.1.1-rc.2`, so
  `typecheck` and the unit gate compile against the line the contract claims rather than one two
  release lines behind it. `pnpm-lock.yaml` is regenerated accordingly.
- **The gates** — the packed matrix channels become `minimum: 0.1.1-rc.1` and
  `latest-tested: 0.1.1-rc.2`, the rolling canary carries the new range, and
  `scripts/verify-packed-delegation.mjs` takes its fallback version from the policy's declared
  minimum instead of a second literal.
- **Source files** — **none**. Specifically: `src/durable-run/projection.ts` needs no edit (the
  projection contract did not move again), `tsdown.client.config.ts` needs no edit (the platform
  module table is identical), `src/route.ts` needs no edit (`LlmResolvedModelInfo` and
  `LlmRuntime` are unchanged on every member Legion names), and `src/client/**` needs no edit
  (the narrowed `SessionsPort.create` is not a face Legion calls). Only comments moved, where they
  named the retired floor.

### Why retiring the 0.1.0-rc.6 floor costs nothing measurable

The previous floor was compiled by the unit gate and by nothing else, and it was the only reason two
compatibility shims exist: the cross-version read of `SubagentResult.diagnostic` in
`src/settlement.ts`, and the dual projection spelling in `src/durable-run/projection.ts`. Both are
**kept** — they cost one member and one validated read, and they are what stops a deployment that
ignores a peer warning from silently defeating its own projection cache — but nothing now depends on
them.

What replaces the old floor gate is the new floor itself. The evidence above is that rc.1 and rc.2
are byte-identical across every package Legion imports or reaches, so a range whose ends are those
two versions has ends that differ in nothing Legion compiles against: the unit gate at rc.2 *is* the
floor gate at rc.1. The packed `minimum` channel still installs the floor from the registry,
independently of the lockfile, on four of the eight compatibility slots.

The honest limit: this equivalence is a property of *this* pair of releases, not a standing one. The
next Host line that changes a type Legion imports will make the two ends differ again, and at that
point the floor either advances with the pins or earns a gate of its own.
