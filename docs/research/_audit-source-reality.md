# Legion Source Reality Audit

Audit date: repository `Q:/repos/dsh-legion`, package `dsh-legion@1.2.0`. Method: `git ls-files`, line counts, and direct source reading. No files other than this report were modified.

---

## 1. Source tree shape

220 tracked files. Top-level distribution:

| Dir | Files |
|---|---|
| src | 53 |
| tests | 52 |
| docs | 51 |
| scripts | 16 |
| .github | 11 |
| benchmarks | 6 |
| examples | 6 |
| contracts | 3 |
| presets | 3 |

### src/ by subsystem

| Directory | Files | LOC |
|---|---|---|
| `src/` (root modules) | 21 | 7,317 |
| `src/durable-run/` | 25 | 4,904 |
| `src/client/` | 6 | 744 |
| `src/internal/` | 1 | 27 |
| **Total src** | **53** | **12,992** |

`src/durable-run/` is 38% of source LOC across 25 modules (`admission`, `attempt-binding`, `capabilities`, `context`, `continuation`, `contract`, `controller`, `dispatch`, `environment`, `events`, `graph`, `host`, `invariant`, `lease`, `mailbox`, `metrics`, `plan-delta`, `projection`, `recovery`, `reducer`, `replay`, `result-acceptance`, `run-control`, `stair-step`, `validate`). This is the single largest subsystem, and (see §6) it is the one that cannot execute.

Other counted trees: tests 51 files / 9,546 LOC; docs 51 files / ~6,700 LOC (docs root 2,184; docs/design 1,825; docs/research 1,642; docs/notes 708; docs/adr 375 across 21 files); scripts 16 files / 2,139 LOC; benchmarks 6 files / 248 LOC.

Docs+tests (≈16,000 LOC) exceed source (12,992 LOC).

---

## 2. Public API surface

`package.json:11-23` declares four export entries: `.` → `lib/index.js`, `./client` → `lib/client.js`, `./contracts/v1.json`, `./contracts/compatibility.json`, `./contracts/journal-v1.json`, `./package.json`. Binary `dsh-legion` → `lib/bin.js` (`package.json:8-10`).

`src/index.ts:48-294` is one large re-export block. Named export groups:

- **config** (`index.ts:48-69`): `CURRENT_CONFIG_VERSION`, `Config`, `LegionProfileSchema`, `PROFILE_NAME`, `RESULT_CONTRACTS`, `exportConfigDocument`, `materializeConfig`, `validateConfig`; types `LegionConfig`, `ConfigExportTarget`, `ConfigVersion`, `DurableRunPolicySpec`, `LegionProfile`, `MaterializedConfig`, `PromptFileReference`, `ResultContract`, `RouteCandidate`, `RouteConstraints`.
- **compiler** (`index.ts:70-92`): `CatalogCompileError`, `DelegationPlanError`, `ERROR_DIAGNOSTIC_CODES`, `WARNING_DIAGNOSTIC_CODES`, `assertCatalogUsable`, `compileCatalog`, `compileDelegationPlan` + 13 types.
- **result-contract** (`index.ts:93-98`): `FINDINGS_V1_SCHEMA`, `REVIEW_V1_SCHEMA`, `materializeStructuredResult`, `outputSchemaFor`.
- **resources** (`index.ts:99-113`): `EMPTY_RESOURCE_SNAPSHOT`, `ProfileResourceError`, `assertResourceSnapshot`, `createResourceSnapshot`, `loadProfileResources`, `promptContentDigest`, `renderPromptFragments`.
- **route** (`index.ts:114-134`): `RoutePlanError`, `applyRoutePlan`, `compileRoutePlan`, `materializeModelFactsObservations`, `observeModelRoutes` + 13 types.
- **identity** (`index.ts:135-148`): 12 branded identity constructors (`CatalogDigest`, `PolicyDigest`, `ProfileName`, `ResourceDigest`, `RoutePlanDigest`, `ArtifactName`, `MemberSlotName`, `StrategyGenerationId`, `StrategyName`, `StrategyPlanDigest`, `TeamName`, `TeamRunId`).
- **explain** (`index.ts:149-165`): `EXPLAIN_VIEW_V1_SCHEMA`, `assertExplainViewV1`, `compileExplainView`, `explainCatalog`, `materializeExplainViewV1`, `renderExplainHuman`.
- **orchestration-contract** (`index.ts:166-197`): `ARTIFACT_CONTRACTS`, `ORCHESTRATION_NAME`, `STAIR_STEP_PAUSE_REASONS`, `STRATEGY_LIMIT_FIELDS`, `STRATEGY_STAGE_KINDS`, `StairStepPolicySpecSchema`, `StrategySpecSchema`, `TeamSpecSchema`, `defineStrategy`, `defineStrategyFor`, `defineTeam` + 18 types.
- **orchestration** (`index.ts:198-221`): `OrchestrationCompileError`, `assertCompiledStrategyPlan`, `assertOrchestrationCatalogUsable`, `compileOrchestrationCatalog`, `compileStrategy`, `renderOrchestrationGuidance` + 15 types.
- **default catalog** (`index.ts:222`): `DEFAULT_CATALOG_LAYER`.
- **acp-catalog** (`index.ts:223-241`): `ACP_AGENT_CATALOG`, `ACP_CATALOG_LAYER_ID`, `ACP_ENTRYPOINT_PROVENANCE`, `ACP_PROVIDER_PLUGIN`, `AcpCatalogError`, `acpCatalogLayer`, `acpMountRows`, `acpProfile`, `assertAcpProfileCompatible`, `defineAcpAgent`, `renderAcpFragment`.
- **settings** (`index.ts:242-257`): `LEGION_SETTINGS_NAMESPACE`, `LEGION_SETTINGS_SERVICE_KEY`, `SETTINGS_DIAGNOSTIC_CODES`, `detectSettingsCapabilities`, `installSettingsSection`.
- **execution** (`index.ts:258-268`): `TEAM_RUN_OUTCOMES`, `createStrategyExecutionSnapshot`, `executeStrategyPlan`.
- **durable-run wildcard** (`index.ts:270-293`): `export * from` 24 modules — the entire durable subsystem is public API surface.
- **plugin contract** (`index.ts:295-296, 866`): `name = 'dsh-legion'`, `inject = ['tools','subagents','systemPrompt']`, `apply(ctx, config)`.

---

## 3. The model-facing tool

Legion registers exactly **one** tool. Registration: `src/index.ts:984` — `ctx.tools.register(delegatingToolDefinition(nextProfiles.toolName, ...))`. The name is user configurable, defaulting to `'legion'` (`src/config.ts:189`, `toolName: z.string().min(1).default('legion')`).

DSH service usage (`src/index.ts:296`): `ctx.tools`, `ctx.subagents`, `ctx.systemPrompt`; plus `ctx.get('llm')` (`index.ts:442, 487, 729`), `ctx.logger`, `ctx.effect`, `ctx.on`, `ctx.emit('tools/change')`, `ctx.fiber.assertActive()`. A system-prompt section is installed at order 116.75 (`index.ts:298, 1062-1081`).

The parameter shape is **generation-dependent**. In the default configuration (`enableStrategies: false`), `hasStrategySurface` is false (`index.ts:549-555`) and the model sees a flat object (`index.ts:571-622`):

```jsonc
{
  "profile":            { "type": "string", "enum": [<active profile names>],
                          "required": <true only if no defaultProfile and no strategy surface> },
  "description":        { "type": "string", "required": true },
  "prompt":             { "type": "string", "required": true },
  "run_in_background":  { "type": "boolean" }   // only when enableRunInBackground
}
```

When `enableStrategies: true` and at least one active Strategy exists, the definition is post-processed into a `oneOf` (`index.ts:778-821`):

```jsonc
{
  "type": "object",
  "oneOf": [
    { "type": "object", "additionalProperties": false,
      "properties": { "kind": {"type":"string","const":"profile"},
                      "profile": {...}, "description": {...}, "prompt": {...},
                      "run_in_background": {...} },
      "required": ["description", "prompt"] },
    { "type": "object", "additionalProperties": false,
      "properties": { "kind": {"type":"string","const":"strategy"},
                      "strategy":  {"type":"string","enum":[<active strategy names>]},
                      "objective": {"type":"string"},
                      "execution": {"type":"json"},   // ONLY if durableExecutionExposed
                      "limits": { "type":"object", "additionalProperties": false,
                                  "properties": {
                                    "maxAgents":      {"type":"integer","minimum":1},
                                    "maxConcurrent":  {"type":"integer","minimum":1},
                                    "deadlineMs":     {"type":"integer","minimum":1},
                                    "maxOutputBytes": {"type":"integer","minimum":1} } } },
      "required": ["kind", "strategy", "objective"] }
  ]
}
```

Output schema is a three-branch `oneOf` (`index.ts:623-666`): `kind: 'continuable'` (profile, subagentId, three digests, optional routePlan), `kind: 'foreground'` (profile, runId, resultContract, three digests, output array, optional structured), and — only with a strategy surface — `kind: 'strategy'` (strategy, planDigest, outcome).

Behavior: `execute` (`index.ts:682-776`) parses/validates args with unknown-field rejection (`index.ts:332-340`), then either (a) compiles+runs a Strategy via `executeStrategyPlan` (`index.ts:696-718`), or (b) compiles a delegation plan, optionally resolves a route via `observeModelRoutes`/`compileRoutePlan`/`applyRoutePlan` (`index.ts:728-737`), validates provider capabilities (`index.ts:446-482`), and starts one child — `ctx.subagents.startContinuable` for background (`index.ts:743-748`) or `ctx.subagents.start` under `settleForeground` (`index.ts:763-775`).

The `execution` parameter is exposed only when `durableExecutionExposed` (`index.ts:556-557`) = `durable.enabled && durableActivationAvailable(...)`. Per §6 that second term is always `false`, so **the model never sees `execution` on any host**.

---

## 4. Strategies

Default catalog: `src/default-catalog.ts:4-179`, `DEFAULT_CATALOG_LAYER` id `legion-defaults-v1`. Three Teams and three Strategies.

**1. `independent-review`** (`default-catalog.ts:39-71`) — team `independent-review` (executor: `deep`, reviewer: `review`). Stages: `delegate execute` (executor; in `objective/objective-v1`; out `execution/text`) → `delegate review` (reviewer; in objective+execution; out `review/review-v1`). Completion `review/review-v1`. Limits: maxAgents 2, maxConcurrent 1, deadline 15 min, maxOutputBytes 512 KiB. memberFailure `fail`.

**2. `research-panel`** (`default-catalog.ts:72-104`) — team `research-panel` (researchers: `quick`, 2–3 participants; synthesizer: `deep`). Stages: `fanout research` (count 3, minSuccess 2, allowDegraded true; out `findings/text`) → `synthesize synthesis` (collection+optional findings input; out `synthesis/text`). Completion `synthesis/text`. Limits: maxAgents 4, maxConcurrent 3, 15 min, 1 MiB. memberFailure `allow-partial`.

**3. `plan-execute-review`** (`default-catalog.ts:105-177`) — team `plan-execute-review` (planner/executor: `deep`, reviewer: `review`). Four `delegate` stages: `plan` → `execute` → `review` (out `review-v1`) → `repair` (out `final/text`). Carries a `stair-step` `advancement` block (`default-catalog.ts:153-168`): plannerMember `planner`, verifierMember `reviewer`, advancement `checkpoint`, maxMilestones 12, maxNoProgressMilestones 2, requireVisibleArtifact true, pauseOn the five reasons `authority-expansion`, `irreversible-effect`, `high-cost-ambiguity`, `verification-failure`, `no-progress`. Limits: maxAgents 4, maxConcurrent 1, 30 min, 1 MiB. memberFailure `fail`.

Stage kinds used: `delegate`, `fanout`, `synthesize`.

### enableStrategies gate — OFF BY DEFAULT

Schema: `src/config.ts:193` `enableStrategies: z.boolean()` — no schema default. Materialization defaults it to **false** twice: `src/config.ts:416` (`parsed.enableStrategies ?? false`) and `src/config.ts:429` (`effective.enableStrategies ?? false`). Setting it `true` on `configVersion: 1` is a hard error (`config.ts:293-302`).

Exactly what it gates:

1. **Strategy name list** — `index.ts:549-554`: `strategyNames` is `[]` unless `catalog.enableStrategies`. Empty ⇒ `hasStrategySurface === false` (`index.ts:555`).
2. **Tool description** — `index.ts:565-567`: the "execute an explicitly enabled bounded Team Strategy" sentence only appears with a surface.
3. **Parameter schema** — `index.ts:572-578, 595-615, 778-821`: `kind`, `strategy`, `objective`, `limits`, `execution` and the whole `oneOf` restructuring exist only with a surface.
4. **Output schema branch** — `index.ts:655-664`: the `kind:'strategy'` result branch is dropped.
5. **Runtime request rejection** — `index.ts:374`: any argument bearing `kind:'strategy'`, `strategy`, `objective`, `limits`, or `execution` (the `strategySignal` at `index.ts:368-372`) throws `STRATEGIES_DISABLED` when the flag is off. Even the `kind` field is stripped from the allowed-argument list (`index.ts:399-401`).
6. **System prompt** — `index.ts:1076-1078`: `renderOrchestrationGuidance` output is replaced by `''`.

So with defaults, the Strategy subsystem compiles and is exported as library API, but is completely invisible and unreachable from the model. The client UI labels this "Explicit authority gate. Off by default; enable only for benchmarked Strategies." (`src/client/locales.ts:23`).

---

## 5. Profiles

**There are no default Profiles in source code.** `src/config.ts:190` declares `profiles: z.dict(LegionProfileSchema).required()` — a required user-supplied dictionary with no built-in entries. `grep` for a default profile map in `src/` returns nothing. If a user supplies zero profiles, no tool is registered at all (`index.ts:960-961`: `Object.keys(nextProfiles.activeProfiles).length === 0 ? undefined : ...`).

The three "default" profiles are **shipped data**, in `examples/legion.config.yml` and the `presets/legion/` preset (described at `presets/legion/preset.yml` as "Multi-model coordinator with semantic deep, quick, and review profiles"):

| Profile | Purpose (verbatim `description`) |
|---|---|
| `quick` | "Translation, exploration, extraction, formatting, and summaries." |
| `deep` | "Complex architecture, difficult debugging, and end-to-end implementation." |
| `review` | "Independent correctness, security, and maintainability review." |

`quick` (default profile) routes `deepseek-v4-flash` → `deepseek-v4-pro`, maxDepth 2, background by default. `deep` routes `deepseek-v4-pro` → `deepseek-v4-flash` with 65536 min-context / 8192 min-output constraints, maxDepth 3. `review` uses the same routes plus `toolFilter.deny: [write, edit]`, `result: review-v1`, `promptFiles: [{root: bundled, path: review.md}]`, foreground by default.

The default catalog's Teams reference `deep`/`quick`/`review` by name (`default-catalog.ts:10-34`), so the shipped Strategies are only compilable against a config that happens to define those three profile names.

---

## 6. Durable runs (v1.1) — the subsystem is dead code at runtime

25 modules, 4,904 LOC, all exported (`index.ts:270-293`). Capability detection lives in `src/durable-run/capabilities.ts`.

**Host capability probe** (`capabilities.ts:83-99`) — duck-typing over `ctx.get`:

```ts
flush:           hasMethods(ctx.get?.('sessions'), ['flush'])
projection:      hasMethods(ctx.get?.('sessionProjections'), ['register'])
coordination:    hasMethods(ctx.get?.(LEGION_RUN_COORDINATION_KEY), ['acquire','renew','assert','release'])
globalAdmission: hasMethods(ctx.get?.(LEGION_GLOBAL_ADMISSION_KEY), ['reserve','reconcile','release'])
childReceipts:   hasMethods(ctx.get?.(LEGION_CHILD_RECEIPTS_KEY), ['lookup'])
```

`durableMutation` requires three of those (`capabilities.ts:64-66`):

```ts
durableMutation: flush.kind === 'available'
  && projection.kind === 'available'
  && coordination.kind === 'available',
```

**But the decisive condition is a hardcoded constant** (`capabilities.ts:122`):

```ts
const DURABLE_ACTIVATION_ADAPTER: 'unbound' | 'bound' = 'unbound'
```

```ts
export function durableActivationAvailable(capabilities) {
  return DURABLE_ACTIVATION_ADAPTER === 'bound' && capabilities.durableMutation
}   // capabilities.ts:129-133
```

The comment at `capabilities.ts:115-121` states it plainly: "The package ships ports and pure logic only, so no build binds one yet. Until that changes, journal mode cannot be activated on any Host and must never be advertised to a model."

**What happens today on DSH 0.1.0-rc.6/rc.7:**

- `durableActivationAvailable(...)` returns `false` unconditionally — `DURABLE_ACTIVATION_ADAPTER` is a module constant compared against `'bound'`, and no code assigns it. TypeScript narrows the literal type; nothing can flip it at runtime.
- Therefore `durableExecutionExposed` (`index.ts:556-557`) is always `false`: the `execution` parameter is never in the model-visible schema, regardless of `enableDurableRuns` or host services.
- If a caller somehow passes `execution.durability === 'journal'` (only possible when `enableDurableRuns: true` widens the allowed-arg list at `index.ts:377` — the arg parser accepts it even though the schema hides it), the path is `index.ts:705-711`: `assertDurableMutationAvailable(...)` first (throws the missing-capability diagnostics if the Host lacks them), then **unconditionally throws** `LEGION_DURABLE_EXECUTION_ADAPTER_UNAVAILABLE: this build binds no durable Strategy activation adapter, so journal mode cannot start`. There is no branch that starts a durable run.
- `registerLegionRunProjection` is still called on every apply (`index.ts:867`), and `enableDurableRuns: true` on a host missing `sessions.flush`/`sessionProjections`/coordination logs a warning (`index.ts:898-908`).
- The `LEGION_RUN_COORDINATION_KEY`/`LEGION_GLOBAL_ADMISSION_KEY`/`LEGION_CHILD_RECEIPTS_KEY` services are Legion-defined keys that stock DSH does not mount; nothing in this repository mounts them either.

**Live vs fail-closed:**

| Part | Status |
|---|---|
| Event/reducer/projection/replay/graph/mailbox pure logic | Live as pure functions, exercised only by unit tests |
| Capability detection | Live |
| Session projection registration | Live (`index.ts:867`) |
| Journal Strategy Run execution | **Dead** — hard `throw` at `index.ts:707-710` |
| Model exposure of `execution` | **Never** — `capabilities.ts:122` |
| Host coordination/admission/receipt services | Not implemented anywhere in repo |

Net: v1.1 durable runs are 4,904 LOC of unreachable-in-production library code. The ephemeral path (`executeStrategyPlan`, `index.ts:712`) is the only executor that runs.

---

## 7. Tests

**51 `*.spec.ts` files** in `tests/` (plus `tests/types.ts`, `tests/durable-fixture.ts`, `tests/helpers/crash-cut.ts`), 9,546 LOC total. **314 test cases** (`it(`/`test(` at line start).

Largest: `plugin.spec.ts` 33, `acp-catalog.spec.ts` 21, `execution.spec.ts` 17, `compiler.spec.ts` 16, `client-bundle.spec.ts` 15, `orchestration.spec.ts` 14, `settings.spec.ts` 11, `quality-scorer.spec.ts` 11. Durable-specific specs (`durable-*.spec.ts`, 16 files) contribute ~66 cases.

**Proportion touching a real model: zero.** `grep` across `tests/` for `apiKey`, `OPENAI`, `ANTHROPIC`, `DEEPSEEK_API`, `fetch(` returns **no matches**. The only `process.env` hits are in `tests/temp-root.spec.ts:10-29`, manipulating `TEMP`/`TMP`/`TMPDIR`/`DSH_LEGION_TEMP_ROOT`.

**Is there any end-to-end test that runs a real LLM? No.** The closest candidate is `tests/continuable-real.spec.ts` — the name suggests otherwise, but it defines `class TextAdapter extends LlmAdapter` whose `stream()` yields a hardcoded `'real continuable result'` string (`continuable-real.spec.ts:24-40`). "Real" refers to a real DSH runtime, not a real model.

A minority of tests do mount a **real DSH runtime in-process** — `continuable-real.spec.ts` composes `Context` from `@deepseek-ai/cordis` with `AgentLoop`, `mountAgentLoopTestDependencies`, `JsonlSessionPersistence`, `SubagentRuntime`, and `dsh-subagent-spawn-in-process` (`continuable-real.spec.ts:1-22`), always driven by a scripted adapter. The rest — compiler, route, config, identity, orchestration, result-contract, explain, and all 16 durable specs — are pure-unit tests over pure functions. Several specs (`package.spec.ts`, `release.spec.ts`, `distribution.spec.ts`, `compatibility-receipts.spec.ts`, `client-bundle.spec.ts`, `preset.spec.ts`) are packaging/metadata assertions, not behavior tests.

---

## 8. Benchmarks

`benchmarks/` holds 6 files, 248 LOC — all fixtures and prose, **no benchmark runner**. The runners are `scripts/benchmark-protocol.mjs`, `scripts/evaluate-quality-campaign.mjs`, `scripts/evaluate-exposure-evidence.mjs` (`package.json:77-79`).

**`benchmarks/README.md` + `protocol-thresholds.json` — the protocol benchmark.** Per `benchmarks/README.md:3-9`, it is "a deterministic regression gate for Legion's orchestration semantics, not a claim about general model quality." **A scripted provider supplies fixed responses** for three comparisons: direct vs execute+review; one research result vs three-member panel+synthesis; direct execution vs plan+execute+review+repair. The score "measures expected defect and source markers encoded by those fixtures" and explicitly "does not estimate credentials, provider health, real token price, or performance on unseen tasks."

Restated bluntly: the protocol benchmark measures whether Legion's own compiler and ephemeral executor propagate strings that the fixture authors planted. It is a structural regression test wearing the word "benchmark". It contains no model, no sampling, no quality signal. It is nevertheless part of the `check` gate (`package.json:80`).

**`benchmarks/quality/`** — 4 files: `README.md`, `research-v1.json`, `review-v1.json`, `thresholds-v1.json`. These are **case packs (inputs + oracles), not results**. `research-v1.json` contains cases like `research-aggregate-01` with `fixture` source strings and an `oracle` of `requiredFactIds`/`forbiddenClaimIds`/`requiredSourceRefs`. `benchmarks/quality/README.md:3` states "The scorer never invokes a model or judges free text."

**Are there any real-model quality results checked in? No.** `benchmarks/quality/README.md:5` is explicit: these are "**open development packs** for runner/scorer integration. Their oracles are public and therefore cannot make a Strategy eligible for model exposure. Exposure requires two independently adjudicated campaigns over two distinct held-out packs supplied explicitly to the scorer." The required campaign shape — 12 cases × 3 repeats × direct/treatment with signed content-addressed receipts — has never been run and committed.

This closes the loop with §4: `enableStrategies` is off "until benchmarked" (`client/locales.ts:23`), and the benchmark that would justify enabling it has produced no results. The gate is not a temporary caution; it is permanent until an evidence campaign that does not exist is run.

---

## 9. Provable gaps between docs and code

1. **Durable runs are documented as a shipped v1.1 feature; nothing can run.** `package.json:33` ships `docs/durable-runs.md`, and `package.json:21` publishes `./contracts/journal-v1.json`, `package.json:69` a `verify:journal-contract` script, `package.json:70-71` `test:durable`/`test:recovery` scripts. Yet `src/durable-run/capabilities.ts:122` hardcodes `DURABLE_ACTIVATION_ADAPTER = 'unbound'` and `src/index.ts:707-710` throws unconditionally on `durability: 'journal'`. 4,904 LOC across 25 modules with a published contract and a dedicated test script gate a feature that has no start path on any host. The code comment at `capabilities.ts:115-121` concedes this; the shipped user documentation set does not carry that constant.

2. **`presets/legion/preset.yml` blames the deployment for a limitation the source imposes.** It says durable mutation "stays disabled until deployment supplies DSH projection and atomic coordination Host services." That is false as a complete cause. Even a deployment supplying all three services gets `durableMutation === true` (`capabilities.ts:64-66`) and still `durableActivationAvailable() === false` (`capabilities.ts:129-133`), because the missing piece is an in-package adapter binding, not a Host service. No deployment action can enable it.

3. **The package description advertises capabilities that ship disabled or absent.** `package.json:4` sells "declarative Teams and Strategies." Strategies default to `false` (`src/config.ts:416, 429`) and are hard-rejected at `src/index.ts:374`, so the out-of-box tool exposes zero Strategy surface. The 26 keywords at `package.json:84-110` include `multi-agent-system`, `agent-orchestration`, `claude-code`, `codex` — the orchestration surface is off by default and the two named agents appear only as ACP catalog data.

4. **"Semantic agent Profiles" are advertised as a package feature but implemented as required user input.** `package.json:4` names "semantic agent Profiles"; `src/config.ts:190` makes `profiles` a `.required()` dict with no defaults, and `src/index.ts:960-961` registers no tool at all when it is empty. The `quick`/`deep`/`review` triad exists only in `examples/legion.config.yml` and `presets/legion/`. A user installing the package with a bare config gets nothing.

5. **The shipped default catalog depends on profile names the code refuses to guarantee.** `AGENTS.md` mandates "do not hardcode default names." `src/default-catalog.ts:10-33` hardcodes `profile: 'deep'`, `'quick'`, and `'review'` in every Team member slot. All three default Strategies fail to compile against any config that does not define those exact three names — a hidden coupling between "curated defaults expressed only through the same public catalog data contract" (`default-catalog.ts:3`) and one specific example file.

6. **"Benchmark" names a fixture-replay test.** `package.json:77` exposes `benchmark:protocol` and `package.json:80` puts it in the release gate, implying measured performance evidence. `benchmarks/README.md:3` confirms "A scripted provider supplies fixed responses"; `README.md:9` confirms it "does not estimate ... performance on unseen tasks." The word "benchmark" in the script name and gate carries a quality connotation the artifact does not support.

7. **`tests/continuable-real.spec.ts` is named for realism it does not have.** The file name implies a real end-to-end run; `continuable-real.spec.ts:24-40` defines a `TextAdapter` that streams the literal string `'real continuable result'`. Across all 314 test cases in 51 files there is no network call and no API key reference — verified by `grep` for `apiKey|OPENAI|ANTHROPIC|DEEPSEEK_API|fetch(` over `tests/`, whose only hits are `process.env` temp-directory manipulation in `tests/temp-root.spec.ts:10-29`.

8. **Documentation and tests outweigh implementation.** 51 doc files (~6,700 LOC) and 51 spec files (9,546 LOC) against 12,992 LOC of source, of which 4,904 (38%) cannot execute. The ratio of specification to working, reachable code is roughly 2:1.

9. **`enableDurableRuns` widens argument acceptance for a path that always throws.** `src/index.ts:377` adds `'execution'` to the allowed-argument list when `enableDurableRuns` is true, while `src/index.ts:556-557` guarantees the field is never in the published schema. The result is a config flag whose sole observable effect is changing which error message a hand-crafted request receives — `REQUEST_INVALID: unknown field(s): execution` versus `LEGION_DURABLE_EXECUTION_ADAPTER_UNAVAILABLE`.

---

## Summary

Legion is a real, carefully-typed, well-tested **compiler and policy layer** for DSH subagent delegation, wrapped around exactly one registered tool. Its working, model-reachable surface is: one tool with `profile`/`description`/`prompt`/`run_in_background`, route resolution against `ctx.get('llm')`, capability-checked single-child start, and structured result contracts.

Everything above that line is gated off or inert. Strategies are complete and unit-tested but disabled by default and awaiting a quality campaign that has never been run. Durable runs are the largest subsystem in the repository and cannot start on any host because of a hardcoded module constant. Profiles — the package's headline feature — have no in-code defaults at all.
