# DSH 0.1.0-rc.8 upgrade assessment

Assessed against the DSH release commits `15148dbd9a` (0.1.0-rc.6), `bb4ca698d6` (0.1.0-rc.7),
and `f1f7dc36fa` (0.1.0-rc.8), reading a local harness checkout. Legion's `node_modules/@deepseek-ai/*`
are junctions onto that checkout, so the gate results below are empirical against rc.8 sources.

## Verdict

**No breaking change reaches this plugin and no source fix is required.** The declared peer range
`>=0.1.0-rc.6 <0.2.0` already admits 0.1.0-rc.8. `pnpm run check` passes end to end against rc.8:
typecheck, three-artifact build, public-contract and journal-contract verification, 347 unit tests
across 49 files, the protocol benchmark, the reproducible-pack check, and `npm pack`.

One follow-up is genuinely load-bearing: the hand-maintained client module-table mirror in
`tsdown.client.config.ts` has drifted from the Host, and that class of drift fails at bundle load
time rather than at build time.

## Surface Legion actually imports

| Package | Imported symbols | rc.6 to rc.8 |
|---|---|---|
| `@deepseek-ai/cordis` | `Context` | unchanged |
| `dsh-agent` | `Agent` | unchanged (no source diff) |
| `dsh-llm` | `ContentBlock`, `LlmResolvedModelInfo`, `LlmRuntime` | unchanged types; retry default changed |
| `dsh-session` | `JsonValue`, `Session`, `SessionEvent`, `SessionEventMap`, `snapshotJsonValue`, `SessionId` | additive only |
| `dsh-subagent` | `SubagentCapabilities`, `SubagentProvider`, `SubagentResult`, `SubagentRun`, `SubagentStartRequest` | additive only |
| `dsh-system-prompt` | side-effect import | unchanged (no source diff) |
| `dsh-tools` | `JsonValue`, `ObjectJsonSchema`, `ToolDefinition`, `defineTool`, `validateJsonSchemaValue` | unchanged |

No `export` line was added, removed, or retyped in any of the six peer packages' `src/index.ts`.

## The three real breaking changes, and why each misses Legion

1. **`SubagentReportDelivery` `'wakeup'` -> `'next-step'`** (`subagent/src/continuation.ts:101`,
   mirrored in `tool-subagent-report/src/index.ts:37`). Legion contains zero occurrences of
   `wakeup`, `next-step`, `SubagentReportDelivery`, or `deliverReport`. It never configures report
   delivery.

2. **Report wakeup switched from `parent.followup()` to `parent.steer()`**
   (`subagent/src/continuation.ts`). Invisible to the compiler because both methods still exist, and
   it changes turn boundaries: a child report no longer opens a new parent turn but lands at the
   nearest step boundary of the turn in flight. Legion asserts nothing about report turn boundaries
   and calls neither method.

3. **`assistant/message` gained `interrupted?: true`** (`session/src/types.ts:277`), and an
   interrupted turn now appends its delivered prefix as a real `assistant/message`. Legion's
   projection cannot see this: `applyLegionProjection` returns the state unchanged unless
   `isLegionEvent(event)` holds (`src/durable-run/projection.ts:61`), and the eight Legion event
   families are all `legion/*` (`src/durable-run/events.ts:73-92`). Legion folds no Host event.

## `ctx.teams` -> `ctx.agentTeams` is not a collision

rc.8 renamed the Agent Teams service key and added `packages/experimental/agent-team` plus
`packages/experimental/tool-agent-team`. Neither affects Legion:

- The entire `packages/experimental/` tree did not exist in rc.6, so the rename cannot break a
  pinned consumer.
- Legion registers no `teams` service. Its `'teams'` occurrences are a **catalog namespace**
  (`CatalogNamespace = 'profiles' | 'teams' | 'strategies'`, `src/catalog-layer.ts:5`) and config
  keys, which are declarative data, not cordis service keys. Legion's only injections are
  `['tools', 'subagents', 'systemPrompt']` (`src/index.ts:296`) plus an optional `settings` scope.
- Both Agent Teams packages are `"private": true` and excluded from release, so Legion cannot depend
  on them even where the domains overlap.

## The one follow-up that matters: stale client module-table mirror

`tsdown.client.config.ts:28-40` documents itself as a hand-maintained mirror of the Host's module
table, with no compile-time link upstream: *"a change to the module table or the wrapper strings
breaks the card at load time, not at build time."* rc.8 changed that table.

Authoritative rc.8 table (`packages/client/web/src/platform.ts`):

- `PLATFORM_MODULES`: `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`,
  `@deepseek-ai/cordis`, `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-ui-primitives`
- `PRELOADED_CLIENT_EXTERNALS` (new): `@deepseek-ai/dsh-client-runtime/client`

Three entries Legion still lists were removed from the table in rc.8:

| Stale entry | What happened upstream |
|---|---|
| `@deepseek-ai/dsh-client-web-react` | renamed to `dsh-client-ui-renderer` and delisted from the table |
| `@deepseek-ai/dsh-client-ui-attachment` | became a client plugin, no longer a table row |
| `@deepseek-ai/dsh-client-schema-form` | package deleted; schema handling moved into `dsh-client-ui-settings` |

Upstream also deleted the exported `CLIENT_EXTERNALS` constant and the hardcoded
`RUNTIME_STORE_EXEMPTION`, replacing both with a per-package computation:
`PLATFORM_MODULES` + `PRELOADED_CLIENT_EXTERNALS` + a package's own `dsh.client.external` declaration.

**Current impact is nil, and this is not a latent break.** Legion's card imports only
`@deepseek-ai/dsh-client-runtime/client` and `@deepseek-ai/dsh-client-ui-primitives`; the first is
parser-preloaded before the shell starts and the second is a static table row, so both are answered
without any declaration. The three stale names never enter the module graph, so `noExternal` never
consults them. What is wrong is that a list whose whole purpose is exactness no longer matches the
Host, and `tests/client-bundle.spec.ts` pins the local constants against themselves, so it cannot
detect upstream drift. Fixing it is cheap; leaving it means the next reader trusts a wrong mirror.

If Legion ever needs a non-baseline row (for example `dsh-client-ui-renderer`), rc.8 requires
declaring it in `package.json` under `dsh.client.external`; the Host reads that field
(`packages/client/modules/src/index.ts:136`) and uses it to order the boot graph.

## Behavioral change Legion inherits

**LLM retry default rose from 2 to 5** (`packages/llm/llm/src/retry-policy.ts:14`). Legion sets no
retry policy, so every delegated child inherits the new default. Worst-case latency and token cost
per failing delegation roughly doubles. Nothing to fix, but delegation timing assumptions and
benchmark wall-clock expectations should be read with this in mind.

## Additions worth adopting later

- **`SubagentResult.diagnostic?: string`** (`subagent/src/types.ts:239-242`, provider-authored,
  4096-byte cap, scrubbed of tool inputs and credentials). Legion currently synthesizes generic text
  in `stopReasonError()` (`src/settlement.ts:21-28`), e.g. `Legion child run ended abnormally (...)`.
  Surfacing `diagnostic` alongside it would turn an opaque failure into an actionable one. Present it
  separately from `output`, as the contract requires.
- **`ContinuableStartSpec.childId?: SessionId`** (`subagent/src/continuation.ts`). Lets a caller
  reserve a child identity before the child materializes, with a new `DUPLICATE_CHILD` error. This is
  the seam the ADR 0015-0020 durable Strategy controller would otherwise need its own correlation
  table for. Worth an ADR-level look, not a drive-by change.
- **`SubagentRuntime.drainContinuableChildren(parent, childIds)`** (`subagent/src/index.ts:311-324`).
  Selective release of resident continuable children, where rc.6 offered only whole-subtree
  `drainDescendants`.

## Still missing upstream

rc.8 ships **no atomic run-coordination Host service**. A scan of every package description for
coordination, atomicity, fencing, leasing, admission, or locking returns only `dsh-fs`,
`dsh-atomic-write`, `dsh-goal-round-driver`, and sandbox/LSP packages — none of which is the
Host-owned atomic run coordination with monotonic fences that durable mutation requires. The Agent
Teams package implements its own durable mailbox and task DAG but is private and unpublished, so it
is not a capability Legion can obtain. `durableMutation` therefore stays `unavailable-fail-closed`,
and the compatibility reason should now name rc.8 rather than stopping at rc.7.

The other standing asks are unchanged: no child reasoning-effort override at the
`AgentOptions`/request seam, and no unified DSH recovery seam.

## Verification limitation: the 0.1.0-rc.x line does not resolve from the configured feed

Local gate results are authoritative for **source** compatibility only. Registry availability is a
separate question, and it comes back negative here.

Against the configured Azure DevOps feed with a freshly refreshed AAD token — authentication
confirmed working, since `npm view @deepseek-ai/dsh-subagent versions` succeeds — the published
version list is exactly `["0.0.1-rc.1", "0.0.1-rc.2"]`. Every `0.1.0-rc.6`, `-rc.7`, and `-rc.8`
request returns E404, for `dsh-subagent`, `dsh-agent`, and `dsh-client-runtime` alike. The public
npm registry is denied by company policy and cannot arbitrate. This matches the pre-existing
observation in `dsh-client-card-feasibility.md`, which recorded the published line as `0.0.1-rc.1`
against a `0.1.0-rc.7` checkout.

Consequences:

- **Do not bump the exact `devDependencies` pins from `0.1.0-rc.6` to `0.1.0-rc.8` yet.** The pins
  currently resolve only because `node_modules/@deepseek-ai/*` are junctions onto a local harness
  checkout; a real `pnpm install --frozen-lockfile` of rc.8 cannot be satisfied from this feed, and
  regenerating `pnpm-lock.yaml` here would produce a lockfile no consumer could install.
- `contracts/compatibility.json` records `latestTestedDshVersion`, which this assessment did test —
  against rc.8 **sources**. Release-time receipts additionally require
  `resolvedDshVersion === latestTestedDshVersion` (`scripts/verify-compatibility-receipts.mjs:76-77`),
  so the release job must run somewhere that can actually resolve `0.1.0-rc.8` before the
  `latest-tested` channel can be produced. That is a CI-environment precondition, not a local one.

