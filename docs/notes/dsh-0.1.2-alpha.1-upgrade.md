# DeepSeek Harness 0.1.2-alpha.1 Upgrade Audit

## Purpose and conclusion

This note records the public and breaking API changes relevant to upgrading dsh-legion from its
currently declared DeepSeek Harness versions to DSH 0.1.2-alpha.1. It is based on release trees,
Git history, package export maps, and TypeScript source declarations rather than release prose.

The upgrade is breaking. Updating only version pins is insufficient. The mandatory work is the
client Runtime split, the Tool call-id rename, the Code-to-PTC presentation rename, the new
Subagent capability bit, the new Session Query runtime requirement, and the coordinated
prerelease dependency/compatibility update. Existing persisted continuable children also require a
cutover decision because descriptor version 2 has no reader in the target release.

Paths under `packages/` in this note are relative to the DeepSeek Harness repository. Other paths
are relative to dsh-legion.

## Exact source states

The local fork checkout has no corresponding tag objects, but the canonical upstream advertises
`dsh-v0.1.1-rc.2` and `dsh-v0.1.2-alpha.1`; `git ls-remote` resolves them to the merge
commits below. Each release/merge pair has the same tree, so comparing the release commits is exactly
equivalent to comparing the tagged merge trees.

| State | Canonical tag | Release commit | Tagged master merge | Tree |
|---|---|---|---|---|
| DSH 0.1.0-rc.7, the actual ui-layout pin | `dsh-v0.1.0-rc.7` | `bb4ca698d63714e753f5621b07400e6ebb0b5d97` | `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca` | `3bc8f89fe494a4755c188be354add4e8b1e7b188` |
| DSH 0.1.1-rc.2 | `dsh-v0.1.1-rc.2` | `aa6c361a972c8369148dea7380bb5c21c24e07ec` | `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` | `53915efe4e2126cc7779b73dfc8a3bcec5318c44` |
| DSH 0.1.2-alpha.1 | `dsh-v0.1.2-alpha.1` | `6c705be1ce6774a000d061da41d1823b03a3d42c` | `cd5ef8148158c3a752a658978873241fdf8e2bbc` | `a712eec535b48badc4fefb4df5176a7002e4280b` |

Legion file citations below use the frozen pre-upgrade tree at
`89332da75d5afbbaa45a554f837a6e9b1828ae56`, not transient working-tree edits. At that commit,
`package.json:145-175`, `contracts/compatibility.json:3-30`, and
`pnpm-lock.yaml:27-80` establish the baseline:

- Host peer packages permit `>=0.1.1-rc.1 <0.2.0`.
- DSH development packages are pinned to `0.1.1-rc.2`.
- `@deepseek-ai/dsh-client-ui-layout` alone is pinned to `0.1.0-rc.7`.

The layout source tree did not change between rc.7 and rc.2, so using rc.7 for its manifest baseline
and rc.2 for the other packages does not create a source ambiguity. During this audit the working
`package.json` already contained in-flight alpha pins while `pnpm-lock.yaml` still resolved rc.2
and the deleted Runtime package. That mixed state is not installation or release evidence; the
lockfile and the complete packed dependency graph still require regeneration and verification.

## Required and directly relevant changes

### 1. The client Runtime package and every Runtime subpath were deleted

**Old API**

`@deepseek-ai/dsh-client-runtime` exported `.`, `./invariant`, `./client`,
`./src/*`, and `./package.json`. The `./client` barrel combined Store, Slots, Session,
Workspace, Conversation, and Settings APIs. See the old tree at:

- `aa6c361...:packages/client/runtime/package.json`
- `aa6c361...:packages/client/runtime/src/client/index.ts`

**New API**

The package no longer exists. This was completed by
`be531688f312537787838ffceaf9382b6a918884` (`refactor(client): migrate consumers and remove
Runtime`). The split was prepared by, among other commits:

- `956730a5fbacbd7856660f57ee34ceebe6cceb79`: Session client ownership moved to the Session Controller.
- `1b535f611cee0479e8732cb169eba4fd8a406bee`: Store and renderer Slot infrastructure extracted.
- `d231c8777a93e3d78c657c623ce65727373fcfc4`: Session and Workspace UI adapters added.
- `c7d8e32aece2dbf6328c4bbed34bdf6d5934b56f`: Conversation, Chat, and Trajectory ownership separated.

There is no single replacement barrel. The exact Legion replacements are:

| Old Runtime area | Target owner | Legion consequence |
|---|---|---|
| `ClientContext` type alias | `Context` from `@deepseek-ai/cordis` | Import `Context` directly; it may be locally renamed, but Cordis does not export a symbol named `ClientContext`. |
| `SettingsScope` | `@deepseek-ai/dsh-client-ui-settings/client` | Move the type import. The target also adds the compatible `mutate(ops, expectedRevision?)` method; Legion's `getSnapshot`, `subscribe`, `set`, and `unset` calls remain. |
| `SnapshotStore`, `createSnapshotStore`, `defineStore` | `@deepseek-ai/dsh-client-store` | Move both value and type imports. Used signatures are compatible; subscriber failures are now contained instead of starving later subscribers. |
| `ctx.slots` / `SlotRegistry` declaration merge | `@deepseek-ai/dsh-client-ui-renderer/client` | Add a type-only owner import wherever `ctx.slots` must type-check after Runtime disappears. |
| Session/global standard Slot props | `@deepseek-ai/dsh-client-ui-session/client` and domain UI adapters | Add type-only owner imports needed by `PropsRuntime`/`ComposedProps`; do not turn them into runtime imports in Legion's bundle. |
| Session and Workspace client object layers | `@deepseek-ai/dsh-api-session-controller`, `@deepseek-ai/dsh-api-workspace-controller`, `@deepseek-ai/dsh-client-ui-session`, and `@deepseek-ai/dsh-client-ui-workspace` | Split owners replace the old aggregate barrel; Legion does not call these object layers directly. |
| Conversation, Chat, and Trajectory types | their owning `dsh-client-ui-conversation`, `dsh-client-ui-chat`, and `dsh-client-ui-trajectory` packages | No Legion value import; listed to make clear that there is no replacement aggregate. |

Primary declarations are `packages/client/store/src/index.ts`,
`packages/client/store/src/contract.ts`,
`packages/client/ui-settings/src/client/settings-contract.ts`,
`packages/client/ui-renderer/src/client/index.ts`,
`packages/client/ui-renderer/src/client/registry.ts`, and
`packages/client/ui-session/src/client/index.ts`. The store/Slot extraction is commit
`1b535f611cee0479e8732cb169eba4fd8a406bee`; final consumer migration and Runtime deletion is
`be531688f312537787838ffceaf9382b6a918884`.

**Legion impact: affected.** In the frozen Legion tree, old Runtime imports occur in
`src/client/index.ts`, `src/client/LegionCard.ts`, `src/client/RunReceiptOverlay.ts`, and
`src/client/settings-form.ts`. The migration also needs type-only imports from the new renderer
and Session UI owners so `ctx.slots` and standard prop merges remain visible to TypeScript.

The browser frozen module table changed at the same boundary. Old
`packages/client/web/src/platform.ts:8-17` put
`@deepseek-ai/dsh-client-runtime/client` in `PRELOADED_CLIENT_EXTERNALS`. At target commit
`6c705be1ce6774a000d061da41d1823b03a3d42c`, that list is empty and
`@deepseek-ai/dsh-client-store` is instead a `PLATFORM_MODULES` entry. Commit
`be531688f312537787838ffceaf9382b6a918884` owns both changes.

**Migration:** remove the Runtime dependency and every Runtime import; move symbols to the owners
above; keep renderer/Session owner imports type-only; and update `tsdown.client.config.ts`,
`tests/client-bundle.spec.ts`, `package.json`, and the lockfile. A robust bundle test should
execute the artifact against the target Host table rather than compare a local copied list with
itself. Leaving the old Runtime external produces a module-table miss even when TypeScript passes.

**Rollback:** reverse the dependencies, imports, and frozen-table expectation as one unit. An rc.2
Host cannot provide `@deepseek-ai/dsh-client-store`, and an alpha Host cannot provide the deleted
Runtime key; a mixed client artifact/Host pair is unsupported.

### 2. `CallId` was renamed to `ToolCallId`

**Old API:** value and type `CallId`, branded as `Branded<'CallId'>`.

**New API:** value and type `ToolCallId`, branded as `Branded<'ToolCallId'>`. There is no
compatibility alias. The change propagates to LLM content blocks and stream chunks, Session
`tool/call` events, and Tool execution inputs.

Primary evidence:

- `packages/llm/llm/src/brand.ts`
- `packages/llm/llm/src/types.ts`
- `packages/core/session/src/types.ts`
- `packages/core/tools/src/index.ts`
- introducing commit `a789637db66ea9a74048620f33a2d8f6489ecb9c`

**Migration:** rename imports, value constructors, and annotations. A value crossing an old nominal
type boundary must be rebranded with `ToolCallId(String(value))`. **Rollback:** reverse only the
nominal constructor/type spelling; the serialized call identity remains the same string and needs no
data rewrite.

**Legion impact: affected.** In frozen commit
`89332da75d5afbbaa45a554f837a6e9b1828ae56`, the six direct occurrences are:

- `tests/plugin.spec.ts:8,178`
- `tests/continuable-real.spec.ts:11,84`
- `scripts/packed-delegation-consumer.mjs:6,274`

### 3. Tool presentation mode `code` was renamed to `ptc`

**Old API:** `ToolPresentationMode = 'native' | 'code' | 'both'`.

**New API:** `ToolPresentationMode = 'native' | 'ptc' | 'both'`.

This affects `dsh-tools` configuration, `ToolRuntime.presentAs()`, and the
`@deepseek-ai/dsh-agent-tool-presentation` plugin schema. Evidence:

- `packages/core/tools/src/index.ts`
- `packages/core/agent-tool-presentation/src/index.ts`
- commit `3ca9c7d4891760ba366123bf9f5d45ed7133c088`

**Legion impact: affected.** The renamed `ptc` spelling remains the value for trusted deployments
that opt into PTC. The current bundled preset instead selects `native`, because its read-only Review
Specialist cannot inherit the worker-thread runtime's bash-equivalent Node API authority.

The public type names `CodeDispatchStartEventData`, `CodeDispatchEventData`, and
`CodeDispatchLog` were also renamed to their `Ptc*` forms, and the Cordis event changed from
`tools/code-dispatch-log` to `tools/ptc-dispatch-log`. Legion does not consume those names.
The persisted event discriminators deliberately remain `tool/code-dispatch-start` and
`tool/code-dispatch`; stored events must not be renamed.

**Migration/rollback:** a trusted deployment that previously selected `code` changes only that
configuration value to `ptc`; the bundled read-only preset remains `native`. On rollback to rc.2,
restore `mode: code` only for deployments that had explicitly selected PTC. Never translate the persisted
`tool/code-dispatch*` discriminators in either direction.

### 4. `SubagentCapabilities.agentOptions` is now required

**Old API:** four required capability flags: `outputSchema`, `depthLimit`, `toolFilter`, and
`persona`.

**New API:** adds required `readonly agentOptions: boolean`. On the one-shot path,
`SubagentRuntime.start()` now rejects a request carrying `agentOptions` unless the provider
advertises this capability. Continuable children are composed by the continuation manager and do
not use this one-shot provider-capability gate.

Evidence:

- `packages/subagent/subagent/src/types.ts`
- `packages/subagent/subagent/src/index.ts`
- `packages/subagent/subagent/src/out-of-process.ts`
- release integration commit `f76a225a7db1560e1ed8b77d30fe4f2e7b774d65`

**Legion impact: affected.** There are 37 capability object literals in source tests and scripts.
More importantly:

- `src/compiler.ts:77-79` exposes the upstream shape.
- `src/input.ts:34-39,74-76` validates and allowlists only the old four fields.
- `src/index.ts:483-518` checks the other capabilities but not `agentOptions` before
  `requestFor()` may pass it.

Every provider and fixture must declare the new capability truthfully. The provider snapshot parser
must accept the new field while retaining an explicit compatibility rule for existing V1 fixtures;
Legion's preflight must reject a selected route or legacy `agentOptions` when the provider does
not support it. Old V1 provider-snapshot fixtures that omitted the new bit must default to
`agentOptions: false`, never silently gain authority. On rollback, remove the field from rc.2
provider literals only after all alpha-only snapshots and preflight expectations are retired.

### 5. Persisted Subagent descriptor version 2 has no target reader

**Old contract:** `SUBAGENT_DESCRIPTOR_VERSION = 2`.

**New contract:** version 3, adding persisted `agentReasoningEffort`. The parser returns no value
for every version other than the current constant; there is no version-2 compatibility branch.

Evidence: `packages/subagent/subagent/src/descriptor.ts:43-48,201-210` at the target tree and
commit `f76a225a7db1560e1ed8b77d30fe4f2e7b774d65`.

**Legion impact: conditionally affected.** Any continuable child persisted before the upgrade has a
version-2 descriptor and cannot be cold-classified or resumed after cutover. This is a data-contract
break, not a TypeScript-only rename.

**Migration:** do not rewrite the event ad hoc. Either finish and recreate those children before the
upgrade, or require an upstream, tested journal migration/compatibility reader. New children use
version 3 automatically. The incompatibility is bidirectional: rc.2 also has no version-3 reader, so
a rollback is safe only if the alpha created no continuable children, or after those children are
finished and recreated under rc.2. Back up the Session store before cutover.

### 6. Subagent listing and cold continuation now require Session Query

The public method signatures are unchanged, but their service preconditions changed.

**Old behavior:** `listChildren()` and `listDescendants()` could operate live-only without
persistence; cold reads used the persistence service directly.

**New behavior:** listing requires `ctx.sessionQuery`; cold followup also consumes Session Query
observations. Missing service produces a Subagent availability error.

Evidence:

- `packages/subagent/subagent/src/list-children.ts`
- `packages/subagent/subagent/src/continuation.ts`
- commit `f5f0448bee40fdc07cf9b0e5552c16d064e9a4fd`

**Legion impact: affected.** Frozen `src/run-receipt.ts` calls
`ctx.subagents.listDescendants()` and turns failure into an incomplete Run Receipt error. The
manually assembled test and packed-consumer environments need an explicit query service.

`@deepseek-ai/dsh-session-query` is the service-definition package and exports abstract
`SessionQueryEngine`; it is not by itself a concrete mountable backend. Target
`packages/subagent/subagent/package.json` declares it only as an optional peer. A real deployment
must compose a provider such as `@deepseek-ai/dsh-session-query-sqlite`
(`packages/session-query/session-query-sqlite/package.json`), while a focused unit harness may
mount a truthful test subclass. Legion must not invent or own this Host service.

**Migration/rollback:** add the concrete provider and its direct development dependencies wherever
Run Receipt descendant discovery is exercised, then test live and cold observations. If no provider
is available, fail closed or emit an explicitly incomplete live-only receipt; do not instantiate the
abstract base. On rc.2 rollback the old listing path can again run without Session Query, but remove
the provider only after every alpha consumer has been rolled back.

### 7. First-party system-prompt order bands changed

**Old public convention:** Harness identity at `-100`, deployment persona at `0`, and tool
guidance in `100-199`.

**New public convention:** `FIRST_PARTY_SECTION_ORDER` defines sparse anchors, including identity
`-1000`, PTC-only guidance `800`, tool guidance at `1000+`, and the generated SDK at `5000`.
Equal numeric orders are now resolved by code-unit name order.

Evidence: `packages/core/system-prompt/src/index.ts` and commit
`43ac97b554845929707f075cc29ef001fee3a173`.

**Legion impact: behavior affected.** Frozen `src/index.ts:328` hard-codes
`PROMPT_ORDER = 116.75`, which moves from the old tool-guidance band to between the target persona
and plan-policy anchors. The registration at `src/index.ts:1283-1302` should be placed deliberately
relative to `FIRST_PARTY_SECTION_ORDER` rather than carried forward mechanically. Exported
`SystemPrompt.section()`, `tools()`, and `assemble()` signatures remain compatible.

**Migration/rollback:** choose and test the alpha placement relative to the exported anchors. On rc.2
restore the old convention or keep a deliberately version-specific local constant; rc.2 does not
export `FIRST_PARTY_SECTION_ORDER`.

### 8. Agent Presets direct configuration gained `includeShippedRoot`

**Old exported `Config`:** `default`, `roots`, and `includeUserRoot`.

**New exported `Config`:** adds required `includeShippedRoot: boolean`. The runtime schema
default is `true`, so declarative Loader omission is accepted, but direct TypeScript producers
and old roster assumptions are no longer source-compatible. The package's shipped presets are now
prepended and win duplicate IDs.

Evidence:

- `packages/preset/agent-presets/src/preset.ts`
- `packages/preset/agent-presets/src/index.ts`
- commit `f94495e5275861b71baa16fcfe6f0b3406a5c425`

**Legion impact: affected in direct test assemblies.** Add `includeShippedRoot: false` to preserve
the prior roots-only semantics at:

- `tests/distribution.spec.ts:54-58`
- `scripts/verify-profile-install.mjs:105-109`

Both call sites already set `ctx.baseUrl`, so the target constructor's new base-URL precondition
does not affect them.

**Migration/rollback:** set `includeShippedRoot: false` in roots-only direct assemblies, or accept and
test the shipped-root-first roster deliberately. Remove the alpha-only field when compiling direct
config literals against rc.2; a declarative rollback should restore the prior roots-only roster
rather than leave the selected preset ambiguous.

### 9. The target persistence vocabulary rejects Legion-owned Session events

This is a persisted-data blocker for Legion durable runs and Run Receipts, not merely a removed
TypeScript field.

**Old behavior:** the rc.2 persistence coordinator accepted an unknown event only when its envelope
carried `ignorable: true`. Legion's required custom events did not carry that marker, so the frozen
consumer already had a persisted-replay design gap.

**New behavior:** commit `42dc2a46c2cd4d52bb2dc872c49d6c2641268736` removes
`SessionEvent.ignorable`. The target coordinator rejects every event whose type is absent from
`KNOWN_SESSION_EVENT_TYPES`. The generated catalog explicitly states that out-of-repository plugin
events are absent by construction and that an extension registration surface is deferred.

Primary evidence:

- `packages/core/session/src/known-event-types.ts:8-18`
- `packages/session/session-persistence/src/coordinator.ts:1132-1143`
- `packages/core/session/src/types.ts`
- frozen Legion declarations at commit `89332da75d5afbbaa45a554f837a6e9b1828ae56`:
  `src/durable-run/events.ts:71-92` and `src/run-receipt.ts:9-10,107`
- append paths: `src/durable-run/events.ts:115-123` and `src/run-receipt.ts`
  `publishRunReceipt()`

Legion declares eight `legion/*` durable-run event types plus `legion/run-receipt`; none appears
in the target known-event catalog. TypeScript declaration merging extends `SessionEventMap` but
does not extend that runtime set.

**Legion impact: affected and blocked for persisted custom events.** A stored Session containing
these records is refused with `SessionFormatUnsupportedError` on target read. Keep durable runs
disabled and keep Run Receipt publication live/client-only unless the runtime catalog explicitly
recognizes its event. Do not mutate the exported `ReadonlySet` as an unofficial registration API.

There is no already-compatible rollback line for Legion's required events: rc.2 also rejects them
because Legion correctly did not mark state-changing events ignorable. The alpha removes even the
marker escape hatch. Adoption therefore requires a public upstream event-vocabulary registration
seam or an upstream-owned package/catalog entry before persisted Legion events can be supported.
Back up affected stores and do not silently rewrite active logs.

The import-only replay parser's tolerance for old `ignorable` envelopes does not solve this Host
persistence refusal and should not be confused with event-type registration.

### 10. JSONL provenance encoding is forward-readable but not downgrade-safe

**Old storage contract:** `eventLines()` serialized every Session event's
`sourceEventSeqs: number[]` verbatim. The rc.2 surface validator requires every member to be a
non-negative safe integer.

**New storage contract:** commit `df76bc695b4bdff093369ab22a506cd37ca087c1` makes
`@deepseek-ai/dsh-session-persistence-jsonl` range-encode profitable consecutive runs as
`[start, end]` pairs on write and expand them before target Session validation on read. Old
all-number arrays remain accepted. `SESSION_FORMAT_VERSION` remains `0`, so the header does not
warn an older reader that backend rows may use the new representation.

Primary evidence:

- `packages/session/session-persistence-jsonl/src/format.ts`
- `packages/core/session/src/seq-ranges.ts`
- old validation at
  `aa6c361a972c8369148dea7380bb5c21c24e07ec:packages/core/session/src/surface.ts`

**Legion impact: operationally affected.** Tests and packed consumers mount the JSONL backend, and
ordinary assistant surface events may cite enough consecutive source events to trigger range
encoding. Forward migration requires no rewrite because the target reads old rows. Rollback is not
safe after an alpha writer emits a ranged row: rc.2 sees an array member where it requires a number
and rejects the log. Quiesce writes and back up the Session store before cutover. A rollback must
restore the backup or use a tested target-side export/rewrite that expands every range; no built-in
downgrade migration was found, and hand-editing active JSONL is not acceptable.

### 11. The committed peer range does not admit the target prerelease

The frozen peer range `>=0.1.1-rc.1 <0.2.0` at
`89332da75d5afbbaa45a554f837a6e9b1828ae56:package.json` does not match
`0.1.2-alpha.1` under node-semver prerelease rules: a prerelease comparator in one patch tuple
does not generally admit a prerelease from a different patch tuple.

**Legion impact: affected.** Supporting the alpha requires a comparator arm anchored at
`0.1.2-alpha.1`, plus synchronized changes to `package.json`,
`contracts/compatibility.json`, the assessed-version matrix, exact development pins, and the
lockfile. This must be a coordinated DSH-line update, not a partial package bump. Rollback must
restore all of those declarations and the rc.2 lockfile together; changing only peer ranges or only
development pins does not recreate a tested dependency graph.

## Other public breaks in consumed packages

These are consumer-facing breaks or material additions in packages Legion consumes. Current
Legion usage remains source-compatible where stated; that does not make the upstream break
unimportant to test doubles, packed consumers, or rollback.

### `@deepseek-ai/dsh-session-projection`

Commit `7fb2ca07e4c76f9ac20a494fe57445fc099bdf90` makes projection initialization header-aware:

- **Old:** `ProjectionDefinition.init(): S` and
  `restore(checkpoint, events, baseSeq)`.
- **New:** `init(header: SessionHeader): S` and a required fourth
  `restore(checkpoint, events, baseSeq, header)` argument.
- **Additive:** `snapshot(session, keys?)` and `viewCheckpoint(checkpoint, keys?)` gain optional
  key filters; `cachedSnapshot()` and `hydrate()` are new.

Evidence: `packages/session/session-projection/src/index.ts`. Legion structurally registers the
zero-argument initializers in `src/durable-run/projection.ts` and `src/run-receipt.ts`. A
function that ignores an argument remains callable and assignable, so those definitions need no
change; Legion does not call `restore()`. Its projection test doubles may optionally pass
`session.header` to model target semantics more faithfully. A direct consumer that does call
`restore` must add the exact header; rollback removes that fourth argument. Do not fabricate a
header because projection state may now legitimately depend on it.

### `@deepseek-ai/dsh-llm`

- `OFFLOADED_IMAGE_TEXT` was deleted; use `offloadedImageText(ref, access?)`.
- `requestImageHandleText(version)` became
  `requestImageHandleText(ref, version, access?)`.
- `RequestImageOffloadPolicy.placeholder` became required.
- `offloadRequestImages(messages, maxBytes)` was deleted; use
  `offloadRequestImagesWithPolicy` with explicit representation, bounds, and placeholder.
- `isTokenDelta` was removed with no LLM-level public replacement; consumers now own the
  domain-specific predicate.
- Model-discovery cancellation moved from `LlmModelDiscoveryRequest.signal` to a separate
  callback/method parameter.

Evidence: `packages/llm/llm/src/content.ts`, `message.ts`, `types.ts`, and `index.ts`;
commits `bd4e4173e71cdd90deb104788addc3d1b54f5228`,
`e47c897f5f20bf84aa565adeb3a4f177e10f8ce8`, and
`2d4393d842139f16f4ae32b8ae31476a597cdd22`.

Legion does not call the removed image, token-delta, or discovery APIs, so it needs no migration for
those breaks; a downstream consumer rolls back by restoring the old signatures rather than carrying
the new policy object into rc.2. The Legion-used `ContentBlock` text variant,
`LlmResolvedModelInfo`, and `LlmRuntime.resolveModelInfo(provider, model, signal?)` are unchanged.
Commit `b565df3442fad822fa42b617fda74f569463a779` additively introduces optional
`TokenUsage.totalTokens`; Legion's Run Receipt uses token-meter projection buckets instead, so it
does not assume that optional field exists.

### `@deepseek-ai/dsh-session`

- `TodoItem` and ownership of `SessionEventMap['todo/write']` moved to
  `@deepseek-ai/dsh-tool-todo`. Evidence: `packages/todo/tool-todo/src/types.ts`, commit
  `a2b415096d732f9c5b2eeb62005e640a2e1a5522`.
- `SessionEvent.ignorable?: true` was removed, and persisted unknown-event skipping is no longer
  available. Evidence: `packages/core/session/src/types.ts`,
  `packages/session/session-persistence/src/coordinator.ts`, commit
  `42dc2a46c2cd4d52bb2dc872c49d6c2641268736`. The direct Legion impact is covered in the
  persisted-event blocker above.
- `RequestHeaderReason` added `'series'`, and request-header data added
  `startsSeries?: true`; exhaustive consumers must handle it. Evidence:
  `packages/core/session/src/types.ts` and commit
  `61b65d3147437b18220171d7d091841100208450`.

Legion does not consume `TodoItem` or exhaustively switch on request-header reasons, and its
projections ignore unrelated Host events, so those two changes need no Legion migration. The
Legion-used `Session`, `SessionId`, `SessionStore`, `snapshotJsonValue`, and append/event
faces remain available apart from the `ToolCallId` and event-vocabulary changes already called
out. Rollback consumers of the additive `series` variant must stop emitting it before rc.2.

Legion-generated events already reject `ignorable`. The imported-export parser at
`src/durable-run/validate.ts:685-704` accepts that key only as backwards-compatible parsing of
old external event envelopes; it should not emit it into new Session logs.

### `@deepseek-ai/dsh-agent-presets`

- `resolveSessionPreset` and `PresetBearingSession` were deleted; the replacement is
  `agentPresetProjectionDefinition` and the Session projection service.
- `scanRoot(root)` and `discoverPresets(roots)` gained a required `harnessBase` argument.
- `PresetMount` gained required `tree: EntryTree`.
- Constructing `AgentPresets` without `ctx.baseUrl` now fails.

Evidence: `packages/preset/agent-presets/src/session.ts`, `discovery.ts`, `mount.ts`, and
`index.ts`; commits `b8dfa8b892373d0832d583344913c79ed82c539e`,
`f7890f591a6e2ff681a34d1879968a77f963dd3b`, and
`ea6f61f144420ea63b6af162b45f7a3b46a13f4c`. Legion does not call these removed functions and
already supplies `ctx.baseUrl`.

### Client UI packages

- `@deepseek-ai/dsh-client-ui-slots` removed `UseSession`,
  `SessionMaybeProvideInfo`, and `SessionProvideInfo`; `SessionAreaProps.children` changed
  from a render function to `ReactNode`; `SlotRendererHost` changed to the scope-adapter model.
  Evidence: `packages/client/ui-slots/src/index.ts` and `renderer.ts`, commit
  `1b535f611cee0479e8732cb169eba4fd8a406bee`. Legion's `InjectFace`, `PropsLocale`,
  `PropsRuntime`, `ComposedProps`, and `ctx.slots.register/inject` usage remain after importing
  the new declaration-merge owners described in the Runtime split.
- `@deepseek-ai/dsh-client-ui-primitives` made localized copy props required across
  `ConnectionBanner`, `HoverCard`, `JsonTree`, `Modal`, `RiskConfirmation`, the
  Terminal/Read/Diff/Search/Web blocks, `CodeBlock`, `JsonBlock`, and `MarkdownText`.
  Evidence: `packages/client/ui-primitives/src/`, commit
  `3c10f5d2d361504d3790a2c9057252f7d584f0ff`. Legion only imports the unchanged
  `IconChevronDownOutline14`.
- `@deepseek-ai/dsh-client-locale` widened `LocaleId` from `'zh' | 'en'` to `string` and
  introduced `BuiltInLocaleId`; invalid BCP-47-style single-language registrations now throw.
  Evidence: `packages/client/locale/src/locale-settings.ts` and `src/client/index.ts`; commits
  `bbe00b0db232895954de2f77de6efd8342de74fe` and
  `45b9f2db44cc06984fddad3b859b07863f67a23a`. Legion's en/zh dictionary registration remains
  valid.

### Other behavior and package removals

- `SubagentRuntime.settleRun` now maps `stopReason: 'aborted'` with a diagnostic to `failed`;
  only a diagnostic-free local abort maps to `killed`. Evidence:
  `packages/subagent/subagent/src/run-settlement.ts`, commit
  `5c27df5ed711cf2f491498b47c949da9f6eacd5c`. Legion uses its own settlement path.
- `resolveChildAgentOptions()` now prefers the parent's latest request-header route and reasoning
  effort over creation options. A route override without an explicit effort clears inherited
  effort. Evidence: `packages/subagent/subagent/src/child-agent.ts`, integrated by
  `f76a225…`. Legion is conditionally affected where a plan omits `agentOptions`.
- `@deepseek-ai/dsh-host-apiproxy` was deleted by
  `4f00a8b82af9145d9ee19d5201972ef92fb311da`. Transport belongs to
  `@deepseek-ai/dsh-client-connection`; domain calls belong to generated Remote namespaces and
  their owning packages. Legion does not declare or import ApiProxy.

## Audited packages without a confirmed breaking export used by Legion

- `@deepseek-ai/dsh-agent`: only additive optional `AgentOptions.reasoningEffort` and
  `PreStepDecision.startsRequestSeries`; the effective root `Agent` shape remains available.
- `@deepseek-ai/dsh-agent-loop`: only additive reasoning-effort configuration.
- `@deepseek-ai/dsh-agent-loop-testkit`: public source entry is unchanged.
- `@deepseek-ai/dsh-subagent-spawn-in-process`: public Config and apply surface are unchanged;
  its private provider now advertises `agentOptions: true`.
- `@deepseek-ai/dsh-session-persistence-jsonl`: the actual packed/root class, Config, and
  compression surface are compatible. Its source-only `eventLines` representation now
  range-encodes provenance, but Legion only mounts the root default class.
- The stable subpaths and Legion-used symbols in `dsh-client-ui-layout`,
  `dsh-client-ui-settings`, `dsh-client-ui-settings-plugins`, and
  `dsh-client-ui-slots` remain available after applying the Runtime split.

The manifests expose `./src/*` patterns, but their published `files` lists do not include
`src`. Those source wildcards must not be treated as a reliable packed-package API.

## Registry and publication evidence limitation

This audit proves source and API state from the local upstream release trees. It does **not** prove
that every 0.1.2-alpha.1 package needed by the coordinated graph is currently downloadable from the
public npm registry.

Direct access from this host to `registry.npmjs.org` is refused at the TLS layer with
`ERR_SSL_SSL/TLS_ALERT_HANDSHAKE_FAILURE`. The configured reachable registry is a corporate
Azure Artifacts upstream-proxy feed. A package or version absent from that configured feed is not
conclusive evidence that it is absent from npmjs, because the mirror may lag or may not have cached
the version. Conversely, source version declarations do not establish that a tarball was published.

Accordingly:

- Do not infer a public publish gap from a configured-feed 404.
- Do not regenerate the lockfile on this host while the configured feed cannot resolve the complete
  target graph.
- Establish publication and dependency-closure evidence in CI or on a host that can reach the public
  registry explicitly.
- Run `verify-dependency-preflight` against that registry before the packed install; an unreachable
  registry is incomplete evidence, not an unpublished-package verdict.

This preserves the same measurement boundary recorded in the earlier DSH upgrade notes.

For constrained local development, repository `.npmrc` selects the Tencent npm mirror. GitHub
Actions explicitly sets `DSH_REGISTRY` to public npm, and preflight/packed scripts resolve that
environment override before the project setting. Package publication independently stays directed
to public npm through `publishConfig.registry`.

## Local release-artifact verification

The DSH 0.1.2-alpha.1 release tree contains its packed npm artifacts under `dist/npm`. The SHA-512
integrities of all 22 DSH packages Legion names directly in `devDependencies` match their exact
`pnpm-lock.yaml` package records. The project-pinned pnpm 11.21.0 also accepts the frozen lockfile
when the machine-local proxy's unavailable release-age metadata is excluded from that local-only
policy check. This verifies the dependency graph and lockfile against official release artifacts; it
does not substitute for the unrestricted public-registry CI matrix.

## Source-backed compatibility CI

Main CI derives the exact DSH tag from `contracts/compatibility.json`, checks out that source, uses
its declared pnpm version and build policy, and packs the DSH family once. Quality jobs scan the
tarball manifests and install the recursively required DSH package closure through temporary
`file:` dependencies; neither package names nor source paths are copied into Legion configuration. The installer restores
`package.json`, `pnpm-workspace.yaml`, and `pnpm-lock.yaml` before validation. Public npm remains the
source for ordinary third-party dependencies.

The scheduled compatibility canary and release workflow deliberately keep the public-registry
install path. A green source job proves API/source compatibility; only those separate jobs can prove
that the published distribution is complete.

## Ordered migration checklist

1. **Choose the data cutover and enforce the go/no-go.** Inventory persisted continuable children
   and Sessions containing `legion/*` events. Finish/recreate descriptor v2 children before
   switching. If Legion custom-event logs must remain readable, do not adopt the alpha until
   upstream supplies and tests both the descriptor migration and a public event-vocabulary seam.
2. **Confirm public publication from an unrestricted environment.** Verify all exact
   0.1.2-alpha.1 packages and their transitive peers through the public-registry preflight. Do not
   treat the configured corporate feed as authoritative for absence.
3. **Align the dependency graph.** Replace `dsh-client-runtime` with `dsh-client-store`, add
   Session Query where required, align every DSH development pin to one tested release tree, and add
   any new client owner peers required by the split graph.
4. **Migrate client imports and the browser table.** Move Context, SettingsScope, and Store symbols
   to their new owners; replace the old external/module-table key and test stub with
   `@deepseek-ai/dsh-client-store`.
5. **Rename Tool call identities.** Replace every `CallId` import, constructor, and nominal type
   with `ToolCallId` across tests and packed-consumer scripts.
6. **Rename the presentation value.** Change the bundled preset and assertions from `code` to
   `ptc`; leave persisted `tool/code-dispatch*` event names unchanged.
7. **Adopt the new Subagent capability.** Add `agentOptions` to provider implementations,
   fixtures, runtime snapshots, parser allowlists, and compiler/runtime preflight. Preserve a clear
   compatibility policy for old V1 snapshot fixtures.
8. **Mount Session Query before exercising Run Receipts.** Update direct test and packed harnesses,
   then verify both live and cold descendant listing paths.
9. **Re-anchor Legion prompt guidance.** Select a deliberate order relative to
   `FIRST_PARTY_SECTION_ORDER`; do not carry forward `116.75` mechanically.
10. **Make Agent Presets behavior explicit.** Add `includeShippedRoot: false` to roots-only test
    assemblies, or deliberately adopt the shipped-root-first roster.
11. **Update compatibility declarations as one unit.** Add an explicit 0.1.2-alpha.1 prerelease
    range arm and synchronize `package.json`, `contracts/compatibility.json`, assessed versions,
    exact dev pins, and release metadata.
12. **Regenerate and verify only with a resolving registry.** Produce the lockfile from the complete
    target graph, run typecheck/build/unit tests, the full `pnpm run check` gate, dependency
    preflight, packed browser-bundle tests, packed profile install, and minimum/target compatibility
    matrix slots.

## Final assessment

DSH 0.1.2-alpha.1 is a coordinated breaking migration for dsh-legion, not a bookkeeping release.
The source changes are migratable, but safe adoption requires both code updates and explicit proof
for persisted Subagent state, a supported runtime owner for Legion Session events, the new Host
service graph, SemVer prerelease compatibility, and public-registry package availability.
