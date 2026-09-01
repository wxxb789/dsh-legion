# DeepSeek Harness 0.1.2-alpha.3 Upgrade Audit

## Purpose and conclusion

This note records the source audit and migration from the previously assessed DeepSeek Harness
0.1.2-alpha.1 generation to 0.1.2-alpha.3. The audit used the official package manifests, exports,
TypeScript sources, and Git history under
[`deepseek-ai/deepseek-harness/packages`](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages),
not release prose.

The upgrade is breaking. The load-bearing changes landed in alpha.2; alpha.3 changes no public
signature Legion consumes. Legion therefore supports `>=0.1.2-alpha.2 <0.2.0`, tests alpha.2 as its
minimum generation, and compiles against alpha.3 as its latest-tested generation.

The mandatory migrations are:

- consume JSON and immutable-value primitives from their new official owner,
  `@deepseek-ai/dsh-util-values`;
- resolve first-party prompt positions through the injected `SystemPrompt` service instead of the
  removed `FIRST_PARTY_SECTION_ORDER` export;
- preserve typed Run Receipt stream failures through the alpha.2 Typert/Gateway `RemoteError` ABI;
- align the shared framework graph with the alpha.3 vendor generation: Cordis 4.0.2,
  Schemastery 3.18.2, cordis-plugin-include 1.0.7, and cordis-plugin-loader 1.0.3;
- mount `sessionProjections` in direct test compositions whose official alpha.2+ services require it;
- update both package manifests, the private Typert compile facade, the complete DSH closure,
  lockfile, source-CI selection, and minimum/latest compatibility channels together.

## Exact source states

| State | Canonical tag | Release commit | Tagged master merge | Tree |
|---|---|---|---|---|
| DSH 0.1.2-alpha.1 | `dsh-v0.1.2-alpha.1` | `6c705be1ce6774a000d061da41d1823b03a3d42c` | `cd5ef8148158c3a752a658978873241fdf8e2bbc` | `a712eec535b48badc4fefb4df5176a7002e4280b` |
| DSH 0.1.2-alpha.2 | `dsh-v0.1.2-alpha.2` | `3f1b46a5db64daa5c3d6ccc081fb214ed7be1de5` | `0a53fb55bea101816fa226bb964ae2bed71c343b` | `64ccbfa8e0caa4711cd4a75717ef9e022657961b` |
| DSH 0.1.2-alpha.3 | `dsh-v0.1.2-alpha.3` | `14bab4422b12ab80cd79de59e086c12888fe00be` | `dd6322d604e00eec1ba5e0c8541159906a21094a` | `86be9091c78528b5ef0866ae6d58b01d4a53582e` |

The alpha.1 merge is the merge base of alpha.3, so `cd5ef814..dd6322d604` is the authoritative
release-tree comparison.

## Breaking changes and migrations

### Shared value primitives moved to `@deepseek-ai/dsh-util-values`

Alpha.2 removed cross-package value relays:

| Removed owner | Removed symbol used by Legion | Official owner |
|---|---|---|
| `@deepseek-ai/dsh-tools` | `JsonValue` | `@deepseek-ai/dsh-util-values` |
| `@deepseek-ai/dsh-session` | `JsonValue`, `snapshotJsonValue` | `@deepseek-ai/dsh-util-values` |
| `@deepseek-ai/dsh-llm` | `deepFreeze` | `@deepseek-ai/dsh-util-values` |

The new package is explicitly duplicate-install-safe and publishes `JsonValue`, `snapshotJsonValue`,
`isJsonValue`, `deepEqualJson`, `deepFreeze`, and `assertNever`. Legion now imports those primitives
from that package directly. The root package keeps one local facade only for Legion-specific
`deepCopy`, canonicalization, and SHA-256 helpers; its `deepFreeze` export is the official function.
The receipt companion also declares the package as a direct runtime dependency instead of relying on
a workspace-hoisted copy.

This official package first exists in alpha.2. Keeping alpha.1 would require a Legion-owned polyfill
and feature detection, which would duplicate the Host utility and violate the repository's
reuse-first policy. Alpha.2 is therefore the new minimum.

### Prompt order moved behind the `SystemPrompt` service

Alpha.2 removed `FIRST_PARTY_SECTION_ORDER` and made the central table private. The public seam is now
`ctx.systemPrompt.getSectionOrder(name)` and `getContextOrder(name)`.

Legion preserves its prior placement exactly: its generated coordinator guidance remains halfway
between `TOOL_SUBAGENT` and `TOOL_REPORT` (order 2850 on alpha.2/alpha.3). It does not move to
`TEAM_POLICY` (order 600), because that would be a behavior change rather than a compatibility
migration. The source keeps a type-only import from `@deepseek-ai/dsh-system-prompt` so the owning
package, not a transitive declaration relay, supplies `ctx.systemPrompt`.

### Typert/Gateway now preserves only marked Remote failures

Alpha.2 replaced the old Remote failure vocabulary with declaration-merged
`RemoteErrorDetailsMap`, `RemoteError`, and Gateway `isRemoteFailure()`. A reconnecting
`RemoteStream` wraps an unmarked terminal error thrown by its `open` callback as
`gateway/internal`.

The Run Receipt client previously threw local error classes while decoding the opening stream and
later classified them with `instanceof`. Under alpha.2+ the wrapper hid those identities, causing a
valid `unavailable` frame or a malformed opening frame to render as a generic stream error and, after
a reconnect, retain stale Receipt facts.

The companion now declares two package-owned Remote codes, throws official `RemoteError` instances,
and classifies them with Gateway `isRemoteFailure()`. The Client bundle inlines the protocol runtime
because it is not a frozen browser platform-module key. Tests cover malformed frames and a
reconnect followed by an unavailable baseline clearing prior facts.

### Direct test compositions require the projection registry

Several alpha.2+ official services made `sessionProjections` a hard lifecycle dependency. The normal
DSH base/Web bundle already mounts `@deepseek-ai/dsh-session-projection`; Legion must not publish a
second Host registry. Direct test compositions now mount the official registry before Agent Presets,
Token Meter, or the Agent Loop paths that require it.

## Alpha.3 changes assessed as non-breaking for Legion

- Alpha.3 removes `@deepseek-ai/dsh-session-persistence-sqlite`. Legion uses the distinct
  `@deepseek-ai/dsh-session-persistence-jsonl` and `@deepseek-ai/dsh-session-query-sqlite` packages;
  both remain published.
- Session projection change notifications now use raw-view identity more efficiently. Legion's
  projection is Host-only and does not consume the Client change feed.
- Continuable Subagent browser prompts gained image admission and typed refusal. Legion's Host
  delegation requests remain compatible.
- Client syntax highlighting and connection recovery changed internally; the Client Store, Slots,
  Settings, Gateway stream, and UI primitive symbols Legion consumes remain available.
- Agent, one-shot Subagent, Tool, LLM model-resolution, SettingsScope, Session Query, and Token Meter
  signatures used by Legion remain compatible after the migrations above.

## Official package reuse decisions

The alpha.3 package tree was searched completely before adding code.

- **Reused:** `dsh-util-values`, the `SystemPrompt` order getters, Typert `RemoteError`, Gateway
  `isRemoteFailure`, `dsh-session-projection`, Session Query, the Subagent lifecycle, Client Store,
  SettingsScope, Slots, and official UI primitives.
- **Not replaced:** Legion's bounded Strategy compiler/controller and Run Receipt model are
  domain-specific. `@deepseek-ai/dsh-experimental-agent-team` is private and is not a public
  dependency.
- **Still absent:** no public alpha.3 package provides Legion's required atomic Run Coordination or
  Host-global Admission contract. `ctx.fs`, `@deepseek-ai/dsh-atomic-write`, process-local storage,
  Jobs, and experimental Agent Teams do not supply lease/fence compare-and-set authority.
- **Still fail-closed:** alpha.3 again permits persisted unknown events only when their envelope was
  explicitly marked `ignorable`. The generated event catalog excludes out-of-repository event names,
  and Legion's state-changing `legion/*` facts cannot truthfully be ignorable. There is still no
  public required-event registration/admission seam.

Consequently, ephemeral Specialists and Strategies remain supported, while journal mutation remains
unavailable. Full ephemeral Run Receipt facts continue through the process-local companion without a
custom Session event or a second persistence system.

## Dependency closure

The alpha.3 closure was derived from both workspace manifests and every DSH dependency, peer
dependency, and optional dependency in the official package manifests. Optional peer type faces are
included because the packed consumer compiles declarations with `skipLibCheck: false`. The result
contains 74 DSH packages. Compared with the alpha.1 policy, alpha.2 introduces, among other required transitives,
`dsh-deque`, `dsh-util-time`, and `dsh-util-values`. The compatibility contract records the complete
closure so the alpha.2 minimum lane cannot silently resolve an alpha.3 transitive through an upstream
caret range.

## Cutover and rollback

1. Finish or recreate pre-alpha.1 descriptor-v2 continuable children as documented in the alpha.1
   audit; alpha.3 still writes descriptor version 3.
2. Back up Session persistence before upgrading. The alpha.1 JSONL downgrade limitations still
   apply.
3. Upgrade the complete DSH composition and Legion package pair together. Do not mix alpha.1 Typert,
   Session, Tool, or Client packages with alpha.2/alpha.3 artifacts.
4. On rollback, restore the previous package graph and lockfile together. A partial rollback leaves
   removed ESM exports and the Typert metadata ABI mismatched.

The code migration itself is reversible by restoring the previous commit. There is no data rewrite in
this increment.

## Verification contract

The upgrade is complete only when all of the following hold:

- frozen installation resolves the committed lockfile;
- root and companion typechecks/builds use alpha.3 packages;
- generated Typert Host/Remote artifacts are rebuilt by the alpha.3 generator;
- unit, Client Runtime, loader-composition, contract, journal, benchmark, reproducible-pack, and dry
  pack gates pass;
- the packed compatibility matrix passes alpha.2 minimum and alpha.3 latest-tested on Windows/Linux
  and Node 22/24;
- dependency preflight and the captured consumer lockfiles prove one coherent DSH generation per
  matrix slot.
