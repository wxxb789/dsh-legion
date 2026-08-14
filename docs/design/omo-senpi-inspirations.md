# Official Senpi Core Inspirations for dsh-legion

> Status: supporting design exploration; the canonical prioritized roadmap is [`omo-senpi-inspirations-and-pitfalls.md`](../research/omo-senpi-inspirations-and-pitfalls.md). Research baseline: `Q:\repos\senpi` at `779c065d3e784168f2bf277112e2351f9d0d1424`, `Q:\repos\deepseek-harness` native seams, and the shipped dsh-legion v0.1 implementation. Senpi labels itself an experimental, in-flight pi-mono fork, so this document borrows tested design patterns rather than treating its interfaces as a dependency or compatibility target [Senpi README](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/README.md#L9-L22).

## 1. Decision

dsh-legion should become a deep **delegation policy module** above DSH, not another coding-agent core. Official Senpi validates four patterns that fit Legion:

1. **pure policy resolution before side effects**;
2. **explicit provenance and user-override precedence**;
3. **bounded fallback with typed reasons and observability**;
4. **thin model-family tuning over a shared semantic contract**.

DSH must remain the sole owner of the agent loop, subagent lifecycle, workflow execution, Session history, goals/todos/plans, jobs, model/provider I/O, sandbox, approvals, tools, skills, and Web shell. Senpi's runtime implementations for those concerns are useful comparison material but are not Legion modules.

Recommended route:

- **v0.2 — explain the existing profile adapter:** effective-profile compiler, typed diagnostics, frozen route plan, and optional structured child results.
- **v0.3 — add bounded resilience:** explicit candidate chains and classified fallback for replay-safe delegation, plus route-aware prompt tuning.
- **v1.0 — add semantic capability policy:** resolve intent and requirements to exact DSH routes, publish native Session provenance, and optionally compile a small set of quality protocols to DSH workflow/subagent calls.

This supersedes recommendations based on the OmO Senpi adapter. In particular, Legion should not pursue idle-injection batching, a generic post-tool hook platform, Team Mode, a Senpi task manager, or Senpi session/goal machinery.

## 2. Evidence from official Senpi core

### 2.1 Extension-first architecture is the main transferable principle

Senpi minimizes core edits and implements most product behavior as ordered builtin extensions [Senpi README](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/README.md#L180-L220). Its extension Interface can subscribe to lifecycle/model/tool events and register tools, commands, flags, renderers, and policies [extension Interface](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/extensions/types.ts#L1565-L1701). The runner centralizes execution and error handling instead of asking every extension to patch the loop [extension runner](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/extensions/runner.ts#L1-L79).

**Legion interpretation:** use DSH's Cordis services/events and tool registry as the seam. Do not port Senpi's `ExtensionAPI`; DSH already provides the equivalent composition model with stronger lifecycle ownership.

### 2.2 Senpi has rich model runtime features, but Legion should borrow policy—not runtime

Senpi's `ModelRegistry` exposes availability, exact lookup, authentication status, provider registration, and completion [model registry](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/model-registry.ts#L36-L99). Retry fallback is deeper than a simple list:

- exact or family selectors and canonical chains;
- tried-candidate and cooldown suppression;
- authentication/availability checks;
- classified reasons (`transient`, `refusal`, `hard-error`, `billing`);
- pinned fallback for refusal/billing;
- optional restoration to primary after cooldown;
- explicit applied/reverted events.

The central behavior is visible in `RetryFallbackController` [controller contract](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/retry-fallback/controller.ts#L16-L55), [fallback transition](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/retry-fallback/controller.ts#L149-L175), and [candidate filtering](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/retry-fallback/controller.ts#L178-L224).

**Legion interpretation:** borrow the pure chain/decision vocabulary and tests. Do not reuse Senpi's model registry, auth lookup, provider switching, cooldown timers, request retry, or restoration runtime; DSH owns provider I/O and exact model selection.

### 2.3 User intent and provenance outrank recommendations

Senpi's recommended-model extension auto-switches only when the initial model came from an implicit provider default or first-available choice. An explicit settings model is preserved; manual set/cycle disarms further automatic intervention [recommended models](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/extensions/builtin/recommended-models/index.ts#L6-L13), [selection/disarm flow](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/extensions/builtin/recommended-models/index.ts#L109-L161).

**Legion interpretation:** deployment profile choice and explicit caller profile always win. Automatic semantic routing may refine an omitted/default profile but must never silently override an explicit profile or exact route chosen by deployment policy.

### 2.4 Shared prompt core plus thin route-specific tuning is a good module shape

Senpi's dynamic prompt is composed from pure section builders, with model-specific behavior layered through a `tuningSection`; only a small number of families use a deliberate full-core override [dynamic prompt](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/dynamic-prompt/AGENTS.md#L1-L21), [assembly contract](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/dynamic-prompt/AGENTS.md#L37-L56). Prompt presets explicitly reject persona-style naming and duplicated scaffolding [prompt preset conventions](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/extensions/builtin/prompt-preset/AGENTS.md#L61-L83).

**Legion interpretation:** keep semantic profile names (`quick`, `deep`, `review`) for task fit, but separate their shared delegation contract from optional model-family tuning. Persona and tuning are different axes.

### 2.5 Event interception is powerful and dangerous

Senpi supports mutable `tool_call`, replaceable `tool_result`, prompt replacement, model-selection transforms, and input interception [tool event semantics](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/extensions/types.ts#L1189-L1309), [event results](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/extensions/types.ts#L1409-L1444). Its builtin registration order is therefore behaviorally significant [builtin order](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/extensions/builtin/index.ts#L57-L100).

**Legion interpretation:** avoid broad event middleware. Legion needs narrow native observations for diagnostics/provenance, not a second policy chain that mutates arbitrary DSH tool calls or model requests.

## 3. Non-duplication boundary

| Concern | DSH owner/seam | Legion rule |
|---|---|---|
| Child start, continuations, follow-up, interrupt, report, lineage | `ctx.subagents` | Submit native requests and return native ids/results. Never own an Activation, child queue, resume protocol, or registry. |
| Fan-out, isolation, cancellation, child caps | `ctx.workflowEngine` / workflow tool | Compile optional policy templates to native execution. Never ship a DAG engine, worker VM, or scheduler. |
| Goals, todo, plan, autonomous rounds | `ctx.goals`, goal tools, todo, plan mode | Do not port Senpi goal/todo continuation or prompt injection. |
| Session history, persistence, fork/resume | `ctx.sessions`, `ctx.sessionPersistence`, projections | Only append small Legion decision records if needed. Never persist transcripts or lifecycle again. |
| Providers, model requests, retry transport, credentials | `ctx.llm` and DSH adapters | Resolve to an exact route; never register wrappers merely to intercept calls or read credentials. |
| Tools and policy | `ctx.tools` | Register the Legion tool and use native restrictions. Do not add a generic pre/post-tool hook bus. |
| Sandbox and approval | `ctx.sandboxPolicy`, `ctx.approval`, permission presets | Profile policy may only narrow native authority. Never cache or synthesize grants. |
| Background work | `ctx.jobs` and native subagent settlement | Do not create a task table, queue, TTL, lease, or monitor. |
| Skills/instructions/prompts | `ctx.skills`, `ctx.systemPrompt`, agent presets/instructions | Add one scoped Legion guidance section; do not scan skills or rebuild prompt assembly. |
| UI/telemetry | native Session projections, Client slots, `ctx.sessionTelemetry` | Add optional decoration and redacted records only. Do not fork the Web shell or exporter. |

DSH explicitly describes these authoritative seams in its capability catalog [DSH seams](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/capability-seams.md#L414-L465). Continuable subagents use the Agent inbox as the only FIFO and intentionally do not create an intermediate Task wrapper [DSH subagent](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/subsystems/subagent.md#L114-L144). That design makes a Legion-owned Senpi-style task manager a direct duplication.

## 4. Current Legion baseline

The shipped module already has a good narrow Interface:

```json
{
  "profile": "quick",
  "description": "summarize findings",
  "prompt": "Summarize the investigation and preserve source paths.",
  "run_in_background": true
}
```

The Implementation chooses `args.profile ?? defaultProfile`, projects one profile to `SubagentStartRequest`, and calls native `start()` or `startContinuable()` [profile selection](../../src/index.ts#L27-L37), [request projection](../../src/index.ts#L90-L104), [native dispatch](../../src/index.ts#L183-L206). Provider add/remove refreshes the live tool schema [provider lifecycle](../../src/index.ts#L211-L250). Foreground settlement is only disposal/error glue, not a runtime [settlement](../../src/settlement.ts#L30-L64). It partially overlaps DSH's canonical run-settlement helper, but Legion currently preserves structured `ContentBlock[]`; prefer an upstream structured settlement helper over either duplicating semantics indefinitely or flattening results to `JobOutcome`.

Therefore the next release should deepen this seam rather than introduce `team`, `task`, `session`, `goal`, `scheduler`, or `hook` Interfaces.

## 5. v0.2 — explainable profile resolution

### 5.1 Effective profile compiler

**Small Interface**

```ts
interface CompileResult {
  profiles: Record<string, EffectiveProfile>
  diagnostics: Diagnostic[]
  digest: string
}

compile(config: LegionConfig, snapshot: RuntimeSnapshot): CompileResult
```

This is package-internal first. Optional read-only Cordis Inspect output may project it later.

**Hidden Implementation**

- Materialize defaults once.
- Validate cross-field references and default execution mode.
- Snapshot named subagent-provider availability and static capabilities.
- Mark each profile `available`, `unavailable`, or `invalid` with stable codes.
- Preserve source for each effective field (`configured` or `default`).
- Canonically hash the effective profile table.
- Reuse this compiler for activation, tool-schema refresh, prompt guidance, and diagnostics.

**Dependency seam**

- Existing Schemastery config.
- Read-only `ctx.subagents` provider registry/capability descriptors.
- Optional `ctx.cordisInspect` for diagnostic projection only.

**Success metrics**

- Same config + same provider snapshot produces byte-identical output.
- Every current activation/runtime profile error maps to one stable diagnostic code.
- No separate validation path in tool registration, prompt rendering, and doctor tests.
- Existing v0.1 config remains compatible.

**Senpi pitfall to avoid**

- Do not copy Senpi's wide extension context or settings manager into Legion.
- Do not make registration order part of correctness.
- Do not call missing capabilities “false” when they are unknown.

### 5.2 Frozen delegation plan

**Small Interface**

```ts
interface DelegationPlan {
  profile: string
  subagentProvider: string
  selection?: { provider?: string; model?: string; maxTokens?: number }
  mode: "foreground" | "continuable"
  policyDigest: string
  reasons: string[]
}

resolve(profile: string | undefined, mode?: "foreground" | "continuable"): DelegationPlan
```

The model-facing Interface remains unchanged. The plan is an owned immutable decision object.

**Hidden Implementation**

- Respect explicit profile before default.
- Resolve mode, backend, route, persona/tool restrictions, and depth.
- Fail before start when the selected native path cannot enforce requirements.
- Attach the plan digest to results and diagnostic logs.
- Recheck native provider capability at the start edge to avoid stale-snapshot races.

**Dependency seam**

- `ctx.subagents` exact named provider and DSH capability checks.
- Existing `ctx.tools` output contract.

**Success metrics**

- 100% of starts can be explained by one frozen plan.
- Explicit profile choice is never replaced automatically.
- Provider removal between resolution and start fails loud without trying another route.

**Senpi pitfall to avoid**

- Senpi's user/manual selection disarms recommendation logic; Legion must preserve the same precedence.
- Do not silently canonicalize or fuzzy-match explicit DSH provider/model identities.

### 5.3 Versioned structured result profiles

**Small Interface**

```ts
interface LegionProfile {
  result?: "text" | "findings-v1" | "review-v1"
}
```

**Hidden Implementation**

- Map a small name to a bounded object-rooted schema.
- Pass `outputSchema` only through supporting one-shot providers.
- Normalize only owned JSON and keep a concise text rendering.
- Reject continuable or unsupported provider modes rather than asking for JSON prose.

**Dependency seam**

- DSH `SubagentCapabilities.outputSchema` and `SubagentStartRequest.outputSchema` [DSH structured output](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/subsystems/subagent.md#L35-L96).

**Success metrics**

- ≥95% schema-valid results in a fixed provider evaluation.
- 100% fail-loud behavior for unsupported execution paths.
- No arbitrary caller-supplied JSON Schema in the model-facing tool.

**Senpi pitfall to avoid**

- Prompt conventions are not machine-enforced contracts.
- Avoid a single huge result schema coupled to one agent persona.

## 6. v0.3 — bounded route resilience

### 6.1 Explicit candidate chains

**Small Interface**

```ts
interface RouteCandidate {
  subagentProvider: string
  selection?: { provider?: string; model?: string }
}

interface LegionProfile {
  route: RouteCandidate | {
    candidates: RouteCandidate[]
    maxAttempts?: number
    fallbackOn?: Array<"unavailable" | "transient" | "quota">
  }
}
```

The profile remains semantic; deployment policy owns candidate order. The caller cannot inject an arbitrary candidate.

**Hidden Implementation**

- Compile and freeze the full chain before the first start.
- Validate every candidate against native subagent capabilities.
- Track tried candidates only within this foreground delegation operation.
- Classify typed DSH/subagent failures conservatively.
- Preserve `AbortSignal`, bound attempts and elapsed time, and dispose every one-shot run.
- Default automatic fallback to read-only/review/research profiles. Mutation work requires an explicit deployment `replaySafe` declaration.
- Return all attempts and the terminal reason; never report fallback as an ordinary first-attempt success.

**Dependency seam**

- `ctx.subagents.start()` only. Provider transport retry remains inside DSH adapters.
- Public DSH normalized error classes where available.

**Success metrics**

- Candidate order and reason classification are deterministic.
- Zero retry after user/system cancellation.
- Zero automatic replay of a non-replay-safe profile.
- In paired baseline/fallback evaluations, report completion delta, token/latency delta, and missing/error pairs separately; ship only if the confidence interval excludes no benefit within the declared budget.

**Senpi pitfall to avoid**

- Do not port `SelectorCooldowns`, probe-back timers, primary restoration, auth lookup, or session-pinned fallback. Those belong to a top-level model runtime, not a one-child policy adapter.
- Do not clamp unsupported reasoning to the nearest level as Senpi's controller does [thinking selection](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/retry-fallback/controller.ts#L227-L235); DSH's fail-loud exact vocabulary should remain authoritative.
- Do not reinterpret safety refusal or rephrase prompts to bypass provider policy.

### 6.2 Route-aware prompt tuning

**Small Interface**

```ts
interface LegionProfile {
  guidance?: string
  tuning?: Record<string, string> // exact configured route key -> additive text
}
```

This is deployment-owned configuration, not a built-in model leaderboard.

**Hidden Implementation**

- Keep one shared delegation contract: standalone prompt, expected evidence, authority limits, and result contract.
- Add only route-specific differences after exact route resolution.
- Bound tuning bytes and record the selected tuning key in the plan digest.
- Treat persona, semantic profile, and model-family tuning as three separate axes.

**Dependency seam**

- Existing profile persona and `ctx.systemPrompt` guidance.
- Exact resolved child route in `DelegationPlan`.

**Success metrics**

- Shared contract appears exactly once in generated guidance.
- Route tuning is additive, bounded, and absent for unmatched routes.
- Prompt snapshot tests assert rule ids/placement rather than brittle full prose.

**Senpi pitfall to avoid**

- Do not ship Senpi's current model presets or hard-coded recommended rankings.
- Avoid full prompt rewrites except when evaluation demonstrates an additive layer cannot work.
- Do not name tuning after personas; Senpi itself reverted that shape.

### 6.3 Route diagnostics projection

**Small Interface**

```ts
interface LegionRunView {
  profile: string
  policyDigest: string
  attempts: Array<{
    candidate: RouteCandidate
    outcome: "started" | "completed" | "failed" | "cancelled" | "skipped"
    reason?: string
    childId?: string
    runId?: string
  }>
}
```

**Hidden Implementation**

- Emit one bounded owned record per completed foreground operation, or a start record for a continuable child.
- Reference native child/run ids; do not mirror child status.
- Redact prompt, persona, environment, credential, and raw provider errors.
- Initially return this record in the Legion tool result. Add SessionEvent/projection only after a real Web/inspection consumer exists.

**Dependency seam**

- Current tool result; later `ctx.sessions` and `ctx.sessionProjections`.

**Success metrics**

- Every fallback is attributable to a policy digest and exact native id.
- Zero duplicated child lifecycle state.
- Redaction property tests reject arbitrary prompt/path/credential fields.

**Senpi pitfall to avoid**

- Keep audit provenance separate from analytics telemetry.
- Do not add a fallback log file or another session event store.

## 7. v1.0 — semantic capability policy

### 7.1 Capability-aware resolver

**Small Interface**

```ts
interface ResolveRequest {
  profile?: string
  requirements?: {
    structuredOutput?: boolean
    tools?: boolean
    inputModalities?: string[]
    minContextTokens?: number
    optimize?: "quality" | "latency" | "cost"
  }
}

interface ResolveResult {
  plan: DelegationPlan
  candidates: Array<{
    route: RouteCandidate
    accepted: boolean
    reasons: string[]
    provenance: Record<string, "runtime" | "deployment" | "heuristic" | "unknown">
  }>
}

interface LegionRouter {
  resolve(request: ResolveRequest): ResolveResult
}
```

Explicit `profile` still wins. Automatic selection applies only when omitted or when the selected profile deliberately delegates route choice to policy.

**Hidden Implementation**

- Normalize capability facts as `true | false | unknown` with source and registry version.
- Hard-filter required capabilities before scoring.
- Apply deployment-owned quality/cost/latency policy.
- Produce exact DSH provider/model values and let DSH validate again.
- Freeze the registry/config snapshot for an invocation.
- Cache only by immutable policy/registry version; never cache auth or grants.

**Dependency seam**

- A stable public DSH model capability-directory read seam on `ctx.llm`, or a narrow upstream addition.
- `ctx.subagents` for backend capability descriptors.
- `ctx.settings` only if Legion policy becomes Host-shared; otherwise retain preset-owned config.

**Success metrics**

- 100% deterministic output for one config/registry version.
- Every accepted/rejected candidate has field-level provenance.
- Zero private DSH imports, Web scraping, or duplicated model catalog.
- Offline route evaluation beats static defaults without violating declared bounds.

**Senpi pitfall to avoid**

- Senpi's registry combines availability and auth knowledge [model availability](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/model-registry.ts#L76-L99). Legion must not request credentials or duplicate auth checks; consume only redacted routability metadata exposed by DSH.
- Do not turn a recommendation list into capability truth.

### 7.2 Optional bounded quality protocols

This belongs in v1.0 only if evaluations show that a single delegation cannot meet target quality. It is not a required expansion.

**Small Interface**

```ts
interface ProtocolRequest {
  protocol: "delegate" | "independent-review" | "research-panel"
  objective: string
  context?: Record<string, JsonValue>
}

interface LegionPolicy {
  run(request: ProtocolRequest): Promise<ProtocolResult>
}
```

Publish this programmatic Interface only after two real callers exist. Until then, keep it behind the existing tool.

**Hidden Implementation**

- Compile fixed, versioned templates to native DSH workflow or sequential subagent calls.
- Freeze member routes before execution.
- Pass bounded structured evidence packets, not live Sessions or transcripts.
- Enforce read-only reviewers through native tool restriction/sandbox.
- Bound members, attempts, deadline, output bytes, and optional revision to one cycle.
- Use native child/session ids as the only execution identities.

**Dependency seam**

- `ctx.workflowEngine`, `ctx.subagents`, native tool/sandbox/approval enforcement.

**Success metrics**

- In paired seeded-defect evaluations, report detection delta, token/latency delta, and missing/error pairs separately; enable by default only after a statistically credible benefit within the declared budget.
- No Legion task table, scheduler, mailbox, continuation, or persistence module appears.
- Reviewer write tools are neither visible nor executable.

**Senpi pitfall to avoid**

- Official Senpi intentionally has no Discipline Agents, Team Mode, category router, Prometheus planner, Ralph loop, or skill system [no direct counterpart](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/README.md#L110-L120). Do not reintroduce those through Legion branding.
- Protocols must be opt-in and bounded, not a universal autonomous organization.

### 7.3 Native decision provenance and optional UI

**Small Interface**

```ts
interface LegionDecisionRecord {
  version: 1
  profile: string
  policyDigest: string
  plan: DelegationPlan
  attempts: LegionRunView["attempts"]
  evidenceRefs?: string[]
}
```

**Hidden Implementation**

- Add a merge-extensible Legion SessionEvent only after stable record shape and a second consumer exist.
- Fold through native Session projections and projection cache.
- Optional Client Slot decorates existing tool/run cards with route reasons and attempts.
- Send redacted operational metrics through `ctx.sessionTelemetry` only under deployment policy.

**Dependency seam**

- `ctx.sessions`, `ctx.sessionProjections`, optional `ctx.sessionTelemetry`, and queried Client slots.

**Success metrics**

- Projection reconstructs solely from native Session records after resume.
- Removing Legion removes only its projection/decoration, not execution state.
- Redaction tests prove no prompt, credentials, arbitrary tool payload, or secret path leakage.

**Senpi pitfall to avoid**

- Do not copy Senpi's TUI widgets, event bus, custom entries, telemetry transport, or session manager.
- Do not make UI availability part of route correctness.

## 8. Explicit non-roadmap

The following official Senpi subsystems must not be ported into dsh-legion:

1. **AgentSession, agent loop, message streaming, tool execution, and extension runner.** DSH already owns the loop and tool policy pipeline.
2. **ModelRegistry, provider registration, auth storage, request transforms, service tiers, and provider completion.** DSH `ctx.llm` and adapters own them.
3. **Provider retry, cooldowns, hint waits, probe-back, server-side fallback abortion, primary restoration.** At most borrow pure classification/chain logic for a bounded child attempt.
4. **Goal and todo continuation.** Senpi's implementation maintains substantial continuation, accounting, cache-warm, UI, and persistence state [goal extension](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/extensions/builtin/goal/index.ts#L36-L130); DSH already has authoritative goal/todo/plan domains.
5. **Session manager, branch tree, compaction, restoration tracker, history search.** DSH owns Session persistence/query/fork and compaction.
6. **Permission system, filesystem policy, hooks, MCP, shell/terminal, web tools, skills/rules/nested instructions.** DSH has native seams and security enforcement.
7. **Tool mutation hooks and loop-guard steering.** Senpi's loop guard injects a steer message after observed tool calls [loop guard](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/extensions/builtin/loop-guard/index.ts#L18-L36); Legion must not create hidden turns or steer the parent.
8. **Dynamic prompt replacement and model prompt presets as shipped content.** Borrow section locality and thin tuning only.
9. **Recommended-model rankings.** They age quickly and mix product preference with capability policy.
10. **TUI/RPC/app-server UI abstractions and custom renderers.** Use DSH Client slots/projections.
11. **Senpi package/extension installer or compatibility layer.** Legion is a DSH Cordis plugin, not a cross-harness runtime.
12. **Per-child arbitrary preset emulation.** If evidence requires it, propose one narrow upstream DSH creation seam; never copy preset compositions or import private mount internals.
13. **Embedded Senpi `AgentSession`, `AgentHarness`, or a `SenpiCoreAdapter`.** Those would be relevant only to a separate product requirement to execute Senpi workers; they are not part of Legion's DSH-native policy roadmap.

## 9. Required upstream DSH seams

No upstream change is required for v0.2. v0.3 can use existing public subagent starts if DSH exposes sufficiently stable typed failure classes.

For v1.0 capability routing, Legion may need one narrow read-only DSH seam:

```ts
interface ModelCapabilityDirectory {
  snapshot(): {
    version: string
    routes: Array<{
      provider: string
      model: string
      routable: boolean
      contextTokens?: number
      modalities?: string[]
      reasoningEfforts?: string[]
      structuredOutput?: boolean
    }>
  }
}
```

The exact Interface belongs upstream and should expose redacted routability/capability facts—not credentials, adapter instances, retries, or mutable registry internals. Until it exists, Legion must not scrape `apiproxy`, import `./src/*`, or maintain its own catalog.

A per-child preset seam remains lower priority and is not required by this roadmap. DSH already supports per-child provider/model/persona/tool filter/depth; a full alternate preset introduces composition, history, cold-resume, and security questions disproportionate to current evidence.

## 10. Release gates and order

### v0.2 gate

- Effective compiler, prompt guidance, and execution use one decision path.
- Stable diagnostics cover all current invalid/unavailable profiles.
- Structured output is capability-checked and opt-in.
- No Host service, storage, scheduler, Session state, or security policy is added.

### v0.3 gate

- Candidate chains are explicit, frozen, classified, bounded, cancellation-safe, and replay-safe by default.
- No cooldown timer, probe-back, auth lookup, provider wrapper, or model restoration.
- Route tuning is deployment-owned and evaluated; no bundled leaderboard.
- Route attempt diagnostics expose native ids without mirroring lifecycle.

### v1.0 gate

- A stable public DSH capability-directory seam exists.
- Automatic resolution never overrides explicit profile/route policy.
- Optional quality protocols prove measurable benefit and compile to native execution only.
- Decision provenance replays from native Session records and remains separate from telemetry.
- A public `LegionPolicy.run()` is introduced only when at least two real callers justify the seam.

### Implementation order

1. Stable diagnostic codes and pure effective-profile compiler.
2. Frozen `DelegationPlan` reused by schema, prompt, and execution.
3. Versioned structured result contracts.
4. Read-only doctor/Inspect projection if operators need it.
5. Explicit foreground candidate chains with conservative classification.
6. Route-aware additive tuning and evaluation harness.
7. Upstream DSH capability-directory proposal.
8. Capability resolver, then native decision projection.
9. Optional quality protocols only after single-delegation evaluation establishes the gap.

The deletion test is the final guardrail: removing Legion should make semantic route policy, fallback explanation, and route tuning reappear in callers; it must not make child lifecycle, workflow, Session, goal, security, or model runtime reappear. Those remain DSH's deep modules.
