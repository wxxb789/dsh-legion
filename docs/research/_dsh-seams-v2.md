# DeepSeek Harness — Plugin Seam Audit v2

Source of truth: read-only audit of `Q:\repos\deepseek-harness` @ **0.1.1-rc.2** (227 lockstep-versioned workspace packages under `packages/<family>/<pkg>`). Nothing in that checkout was modified. Orientation came from `docs/research/_dsh-package-catalog.md`; every signature below was re-read from the harness `src/`.

Note on paths: the package **directory** name is *not* the npm name. `@deepseek-ai/dsh-experimental-agent-team` lives at `packages/experimental/agent-team`; `ctx.agents` lives at `packages/core/agent`; `ctx.tokenMeter` lives at `packages/llm/token-meter`. Citations below use the harness-relative directory path.

**Companion deep-dive files** (same directory), produced by this audit:
- `_seam-client.md` — 799 lines: full slot-registry API, all 39 enumerated slot ids, client manifest and loader contract (§5 condenses it).
- `_seam-http-cmd-storage.md` — 1024 lines: full `webServer`, `commands`, and `storage.domain` surfaces (§§4, 6, 7 condense it).

**Sections are ordered as requested: 10 first, then 1, 2, 5, 6, and the remainder.**

| § | Seam | Service key | Package |
|---|---|---|---|
| 10 | Agent Teams (experimental) | `ctx.agentTeams` | `dsh-experimental-agent-team` *(private)* |
| 1 | Agent registry | `ctx.agents` | `dsh-agent` |
| 2 | Token metering | `ctx.tokenMeter` | `dsh-token-meter` |
| 3 | User questions | `ctx.userQuestions` | `dsh-user-questions` |
| 4 | Domain KV | `ctx.storage.domain` / `ctx.storageDomain` | `dsh-storage-domain` |
| 5 | Web slots | `ctx.slots` | `dsh-client-ui-slots` + `dsh-client-runtime` |
| 6 | HTTP routes | `ctx.webServer` | `dsh-host-webserver` |
| 7 | Slash commands | `ctx.commands` | `dsh-commands` |
| 8 | Approval | `ctx.approval` | `dsh-user-approval` |
| 9 | Session query | `ctx.sessionQuery` | `dsh-session-query` (+ `-sqlite`) |

---

## 10. The two private experimental packages

### 10.1 `@deepseek-ai/dsh-experimental-agent-team` — `packages/experimental/agent-team`

`package.json` description (`packages/experimental/agent-team/package.json:3`):

> "Implicit-root Agent Teams roster, durable peer mailbox, and shared task DAG"

`"private": true` (`:5`), `"version": "0.1.1-rc.2"` (`:4`), `"license": "MIT"` (`:31`). It **is** built: `lib/index.js` (1728 LOC) and `lib/types/*.d.ts` are committed, and `files` publishes `lib/index.js`, `lib/invariant.js`, `lib/types/**/*.d.ts`. It also exports a `./invariant` companion (`:19-22`), following the harness-wide convention.

**File listing with LOC (`src/` + `tests/`):**

| File | LOC |
|---|---|
| `src/roster.ts` | 460 |
| `src/mailbox.ts` | 319 |
| `src/task-board.ts` | 283 |
| `src/fold.ts` | 269 |
| `src/index.ts` | 233 |
| `src/types.ts` | 193 |
| `src/activity.ts` | 81 |
| `src/lifecycle.ts` | 77 |
| `src/journal.ts` | 64 |
| `src/task-graph.ts` | 63 |
| `src/validation.ts` | 31 |
| `src/invariant.ts` | 29 |
| `src/session-message.ts` | 27 |
| `src/error.ts` | 20 |
| **src total** | **2149** |
| `tests/team.spec.ts` | 1562 |
| `tests/persistence.spec.ts` | 452 |
| `tests/fold.spec.ts` | 302 |
| `tests/invariant.spec.ts` | 65 |
| **tests total** | **2381** |

**Test-to-source ratio is 1.11:1.** That alone rules out "stale spike".

**Vocabulary** (`src/types.ts`): `TeamId` (branded, *equals the root `SessionId`* — `types.ts:8-17`), `TeamTaskId`, `TeamMessageId`, `TeamMemberPhase = 'provisioning' | 'active' | 'failed'` (`:44`), `TeamMemberSnapshot`, `TeamMemberView` (whose `status` is `'running' | 'idle' | 'inactive' | 'provisioning' | 'failed'`, `:62`), `TeamTaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted'` (`:71`), `TeamTaskSnapshot`/`TeamTaskView`, `TeamMessageSnapshot`, `TeamMessageSource`, `TeamTaskAction` (`:176-184`: `'claim' | 'release' | 'edit' | 'set_dependencies' | 'complete' | 'reopen' | 'reassign' | 'delete'`). Role vocabulary is `'lead' | 'teammate'` (`:61`); delivery is `'quiet' | 'wakeup'` (`:105`); member context is `'fresh' | 'fork'` (`:52`).

It declares **four durable session events** by module augmentation (`src/types.ts:203-218`), all stored **only in the Lead Session log**:

```ts
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'team/member': { version: 1; teamId: TeamId; member: TeamMemberSnapshot }
    'team/task': { version: 1; teamId: TeamId; task: TeamTaskSnapshot }
    'team/message/queued': { version: 1; teamId: TeamId; message: TeamMessageSnapshot }
    'team/message/delivered': {
      version: 1
      teamId: TeamId
      messageId: TeamMessageId
      targetId: SessionId
    }
  }
}
```

…and one `MessageSourceMap` entry `'team-message'` (`src/types.ts:118-122`) for target-side de-duplication.

**Service key: `ctx.agentTeams`** (`src/index.ts:35-39`):

```ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    agentTeams: TeamService
  }
}
```

**Full public API** (`src/index.ts:56-259`), verbatim:

```ts
export class TeamService extends Service {
  static inject = ['agents', 'sessions', 'sessionPersistence', 'subagents']   // :57

  membership(agent: Agent): TeamMembership                                     // :122
  listMembers(agent: Agent): TeamMemberView[]                                  // :131
  async spawnTeammate(caller: Agent, request: SpawnTeammateRequest): Promise<SpawnTeammateResult>  // :141
  async sendMessage(caller: Agent, request: SendTeamMessageRequest): Promise<SendTeamMessageResult> // :151
  async createTask(caller: Agent, request: CreateTeamTaskRequest): Promise<TeamTaskView>            // :161
  getTask(caller: Agent, id: TeamTaskId): TeamTaskView                         // :171
  listTasks(caller: Agent): TeamTaskView[]                                     // :180
  async updateTask(caller: Agent, request: UpdateTeamTaskRequest): Promise<TeamTaskView>            // :190
  async waitForChange(caller: Agent, timeoutMs: number, signal: AbortSignal): Promise<TeamWaitResult> // :201
  interrupt(caller: Agent, targetName: string): { previousStatus: 'running' | 'idle' | 'inactive' }  // :212
  tryMembership(agent: Agent): TeamMembership | undefined                      // :221
}
```

Every method takes **the exact live `Agent` as its authority credential** — the same pattern `ctx.goals` uses. Config (`src/index.ts:59-65`) is five positive-safe-integer limits: `maxMembers` (8), `maxTasks` (256), `maxPendingMessagesPerMember` (64), `maxMessageBytes` (65 536), `disposalTimeoutMs` (5 000); a non-positive value throws `TeamError('…must be a positive safe integer', 'TEAM_INVALID_CONFIG')` (`:48-53`).

**Error codes seen in source/README:** `TEAM_INVALID_CONFIG`, `TEAM_PROVISIONING_CONFLICT`, `TEAM_TASK_STALE_REVISION`, `TEAM_TASK_LIMIT`, `TEAM_WAIT_ABORTED`.

### 10.2 `@deepseek-ai/dsh-experimental-tool-agent-team` — `packages/experimental/tool-agent-team`

`package.json:3`:

> "Scoped model-facing Agent Teams tools over ctx.agentTeams"

`"private": true` (`:5`). Files: `src/index.ts` (388 LOC), `src/invariant.ts` (13), `tests/tool-team.spec.ts` (404). Built `lib/index.js` is 552 LOC.

**Exactly ten tool names**, all registered through `scoped.tools.register(defineTool({…}))` into the *member's own Agent scope*:

| Tool | src line |
|---|---|
| `spawn_teammate` | `src/index.ts:174` |
| `send_message` | `:201-203` (via `messageTool('send_message', 'quiet')`) |
| `followup_task` | `:201-203` (via `messageTool('followup_task', 'wakeup')`) |
| `list_agents` | `:226` |
| `wait_agent` | `:236` |
| `interrupt_agent` | `:271` |
| `team_task_create` | `:286` |
| `team_task_list` | `:310` |
| `team_task_get` | `:342` |
| `team_task_update` | `:357` |

Plus one system-prompt section `'team:policy'` (`:165`). Config is two provider names, `freshProvider: spawn` / `forkProvider: fork`.

**Collision warning:** `list_agents`, `send_message`, and `interrupt_agent` are **the same names** the shipped `@deepseek-ai/dsh-tool-subagent-control` registers globally. The README states this explicitly (`README.md:5`): *"Scoped Team definitions shadow same-named legacy global continuable-subagent controls, so a composition that mounts both must disable the legacy definitions."*

### 10.3 Verdict: soon-to-ship Host feature, not a stale spike

Evidence for **near-ship**:
- 2 149 LOC of source against 2 381 LOC of tests, including a dedicated `persistence.spec.ts` (452) exercising crash/recovery.
- A full `./invariant` companion (`src/invariant.ts`, built `lib/invariant.js` at 354 LOC) that *replays each candidate Team event against its committed Session prefix* and rejects invalid member transitions, reused names, out-of-range task ids, discontinuous revisions, invalid dependencies, and duplicate queue/ack records **before append** (`README.md:52`). Stale spikes do not ship invariant validators.
- It owns a real durable event vocabulary in the canonical `SessionEventMap`, with the whole-value rule and `version: 1` payload gating.
- The README cites two internal governance documents: an **Agent Note** at `.agents/notes/implemented/feature/2026-08-05-agent-teams.md` — filed under **`implemented/`** — and a **subsystem catalog** at `docs/subsystems/agent-team.md` (`README.md:5`). It is also present in the generated `docs/tool-catalog.md` (`tool-agent-team/README.md:21`).
- Committed `lib/` build output and a populated `files` array: it is packaged, merely not published.
- README sections follow the exact house template every shipped package uses (Config / Model Experience / What the model sees / Token effect / KV Cache effect / Known Limitations and Deferred Work).

Evidence for **not yet ship-ready**, quoted from `agent-team/README.md:72-76`:
- *"**One process and one shared checkout** — members share cwd and observe edits immediately; this package provides no worktree, remote member, merge, or filesystem lock."*
- *"**Advisory write scopes** — Bash, formatters, code generators, and direct external writers can bypass filesystem version checks."*
- *"**Flat immutable roster** — only the Lead creates direct teammates; there is no nested Team, rename, deletion, or name reuse."*
- *"**No automatic ownership release**"*
- *"**Mailbox is not cross-process exactly-once** — concurrent harness processes over one Team are unsupported."*
And from `README.md:40`: *"The guarantee is process-local retry plus target-Session de-duplication, not cross-process exactly-once delivery. This release has no shared mailbox transaction across processes and no mailbox timeline UI."* `tool-agent-team/README.md:49`: *"**No Web controls** — browser roster and task-board presentation is outside this runtime package."*

**Conclusion:** this is a **feature-complete single-process implementation held back on `private: true` pending multi-process durability and a Web surface.** It is the strongest signal in the tree of where the Host is heading on multi-agent coordination — a *Lead-rooted implicit team, a durable peer mailbox, and a revision-CAS shared task DAG*, all living in the invoking Session's own journal.

**For a third-party plugin: it is off-limits.** `private: true` means it is not on npm; a `peerDependencies`/`dependencies` entry cannot resolve outside the monorepo. Note also its vocabulary — `TeamId`, `lead`/`teammate`, task DAG with `expectedRevision` CAS, `writeScopes` — overlaps heavily with any third-party "team" concept, so an external plugin choosing those nouns should expect a collision if this ever ships.

---


## 1. `ctx.agents` — the agent registry

**Service key:** `ctx.agents` · **Package:** `@deepseek-ai/dsh-agent` · **Path:** `packages/core/agent`

```ts
// packages/core/agent/src/index.ts:36-50
declare module '@deepseek-ai/cordis' {
  interface Context {
    agents: AgentRegistry
    agent?: Agent
  }
}
```

### 1.1 Statuses — the registry itself knows only TWO

```ts
// packages/core/agent/src/runtime-types.ts:44-50
/**
 * An agent's lifecycle state, emitted on every transition as `agent/status`:
 * … it is not a third observable status.
 */
export type AgentStatus = 'idle' | 'running'
```

```ts
// packages/core/agent/src/runtime-types.ts:73-74
/** The current lifecycle state, mirrored on every `agent/status` transition. */
readonly status: AgentStatus
```

**`'ready'` is not an `AgentStatus`.** It is a third state *synthesized by the `list_agents` tool* to describe a child that exists only in persistence:

```ts
// packages/subagent/tool-subagent-control/src/list-agents.ts:59-63
function statusOf(agents: { get(id: SessionId): Agent | undefined }, id: SessionId): 'running' | 'idle' | 'ready' {
  const agent = agents.get(id)
  if (agent === undefined) return 'ready'
  return agent.status === 'running' ? 'running' : 'idle'
}
```

Its own doc comment (`list-agents.ts:53-58`): *"`running` for an active driver, `idle` for a resident Agent between turns (possibly waiting on agents it started), and `ready` when no live Agent remains. `ready` preserves resumability without presenting an inactive conversation as a terminal result to collect."*

So the correct three-valued model for a plugin is:
- **`running`** — `ctx.agents.get(id)?.status === 'running'`, a driver is executing right now.
- **`idle`** — live in the registry, between turns.
- **`ready`** — **not in `ctx.agents` at all**; discoverable only through `ctx.subagents.listChildren()` / `listDescendants()`, which read persistence and never load an Agent.

A fourth, orthogonal axis exists on the subagent listing: `activity: 'running' | 'inactive'` (`packages/subagent/subagent/src/list-children.ts:55`), which is *store snapshot* liveness, not driver liveness — *"`running` means the logical record is live in `ctx.sessions`; `inactive` means it exists only in persistence. Neither encodes a durable outcome."*

### 1.2 Enumeration — verbatim signatures

```ts
// packages/core/agent/src/index.ts:583-585
get(id: SessionId): Agent | undefined { return this.store.get(id)?.agent }

// packages/core/agent/src/index.ts:595-597
isOwnedBy(id: SessionId, owner: Agent): boolean { return this.store.get(id)?.owner === owner }

// packages/core/agent/src/index.ts:603-605
/** All live agents, in registration order. @returns a fresh array; mutating it does not affect the registry. */
list(): Agent[]

// packages/core/agent/src/index.ts:613-617
/** All live top-level agents in registration order. */
roots(): Agent[]
```

Lifecycle / factory members (mostly not for third-party use):

```ts
// packages/core/agent/src/index.ts
currentInitiator(): Agent | undefined                                   // :309
requireInitiator(): Agent                                               // :322
withInitiator<T>(agent: Agent, operation: () => T): T                   // :341
withoutInitiator<T>(operation: () => T): T                              // :356
setFactory(factory: AgentFactory): () => void                           // :372
async create(options: CreateAgentOptions): Promise<AgentHandle>         // :405
async resume(options: ResumeAgentOptions): Promise<AgentHandle>         // :424
register(agent: Agent): () => void                                      // :450
enter(agent: Agent, owner: Agent | undefined): () => void               // :474
announce(agent: Agent): void                                            // :549
```

There is **no status filter on `list()`** — you filter the returned array yourself.

### 1.3 Learning which are running RIGHT NOW: event, not polling

There **is** a subscription. It is a Cordis event, scope-filtered through `dsh-scope`:

```ts
// packages/core/agent/src/runtime-types.ts:170-178
/**
 * Agent status changed (`idle` ⇄ `running`). A waking delivery enters …
 * @param payload.agent - the agent whose status flipped.
 * @param payload.status - the status just entered (the transition's destination).
 */
'agent/status'(this: Scoped<Agent>, payload: { agent: Agent; status: AgentStatus }): void
```

Companion lifecycle events emitted by the registry with the agent's scope carrier (`scopeTarget(agent, agent)`): **`agent/created`** (`index.ts:561`), **`agent/disposed`** (`index.ts:529`), and **`agent/session-start`**. The experimental Team service is a worked consumer of exactly this trio:

```ts
// packages/experimental/agent-team/src/index.ts:107-114
ctx.on('session/event', (session, event) => { this.mailbox.observeSessionEvent(session, event) })
ctx.on('agent/session-start', ({ agent }) => { this.scheduleRecovery(agent) })
ctx.on('agent/status', ({ agent }) => {
  const membership = this.roster.tryMembership(agent)
  if (membership !== undefined) this.activity.notify(membership.id)
})
ctx.effect(() => () => this.disposeRuntime(), 'agentTeams.runtimeLifecycle()')
for (const agent of ctx.agents.list()) this.scheduleRecovery(agent)
```

Note the last line: **the correct pattern is subscribe-then-backfill** — register `agent/status` + `agent/created` listeners, then seed from `ctx.agents.list()` for agents that already existed. Polling is unnecessary for live agents. Polling *is* required for the `ready` (persisted-only) tier, since it is not in the registry and emits no event.

An `agent/status` invariant enforces no no-op transitions (`packages/core/agent/src/invariant.ts:16-20`): ``fail(`agent/status repeated ${status} (no-op transition)`)``.

### 1.4 Mapping a `ctx.subagents.startContinuable` child back to `ctx.agents`

The mapping is **direct and by construction: the child's `SessionId` IS its agent id.** `AgentRegistry.enter` enforces the identity (`packages/core/agent/src/index.ts:476-478`):

```ts
if (id !== agent.session.id) {
  throw new Error(`agent id "${id}" does not match session id "${agent.session.id}"`)
}
```

And `startContinuable` returns exactly that id:

```ts
// packages/subagent/subagent/src/continuation.ts:132-138
/** Identities returned once a continuable child accepted its initial prompt. */
export interface ContinuableStart {
  /** The durable child session id, stable across activations. */
  readonly childId: SessionId
  /** The accepted initial prompt's inbox message id. */
  readonly messageId: MessageId
}
```

```ts
// packages/subagent/subagent/src/index.ts:212-214
async startContinuable(spec: ContinuableStartSpec): Promise<ContinuableStart> {
  return this.requireContinuations().startContinuable(spec)
}
```

`ContinuableStartSpec` (`continuation.ts:112-130`) — note you may **reserve the id yourself**:

```ts
export interface ContinuableStartSpec {
  readonly provider: string
  readonly label: string
  readonly childId?: SessionId   // "Omission preserves the manager's UUID allocation; supplying one
                                 //  lets a durable parent record provisioning before child
                                 //  materialization without a second identity handshake."
  readonly request: Omit<SubagentStartRequest, 'label' | 'signal' | 'outputSchema'>
  readonly signal: AbortSignal
}
```

So: **`ctx.agents.get(childId)`** returns the live `Agent` while it is resident, and `undefined` once it is only persisted. Confirm parentage with `ctx.agents.isOwnedBy(childId, myAgent)` — but note that is *runtime creator* ownership, explicitly *"independent of durable session lineage"* (`index.ts:588-594`). For the durable tree use:

```ts
// packages/subagent/subagent/src/index.ts:355-357
listChildren(parentSessionId: SessionId, signal?: AbortSignal): Promise<SubagentListEntry[]>

// packages/subagent/subagent/src/index.ts:374-376
listDescendants(rootSessionId: SessionId, signal?: AbortSignal): Promise<SubagentDescendantListEntry[]>
```

which *"consults no Agent registrations, Activations, or providers"* (`index.ts:342-343`) and works cold. `SubagentListEntry` (`list-children.ts:44-87`) carries `kind: 'child' | 'diagnostic'`, `id`, `activity`, `hasChildren`, and a `mode: 'one-shot' | 'continuable'` discriminator with the durable creation `label`.

### 1.5 Scope / lifetime

- The registry is one `Service` instance on the root context; `store` is a `Map<SessionId, AgentEntry>` — **process-local, in-memory, never persisted**.
- `list()` / `roots()` return **fresh arrays**; mutating them is safe and inert.
- Listeners registered via `ctx.on(...)` are effect-scoped to your plugin fiber and unwind on plugin disposal / HMR.
- Dispatch is scope-filtered: an agent-scoped listener receives only that agent; a root-context listener receives all.

### 1.6 Minimal plugin snippet

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'

export const name = 'my-agent-watch'
export const inject = ['agents', 'subagents']

export function apply(ctx: Context) {
  const running = new Set<SessionId>()

  // 1. subscribe first
  ctx.on('agent/status', ({ agent, status }: { agent: Agent; status: AgentStatus }) => {
    if (status === 'running') running.add(agent.id)
    else running.delete(agent.id)
  })
  ctx.on('agent/disposed', ({ agent }: { agent: Agent }) => { running.delete(agent.id) })

  // 2. then backfill anything already live
  for (const agent of ctx.agents.list()) {
    if (agent.status === 'running') running.add(agent.id)
  }

  // 3. map a child you started back to its live Agent
  ctx.on('my/delegate', async (parent: Agent) => {
    const { childId } = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'my worker',
      request: { agent: parent, prompt: [{ type: 'text', text: 'do the thing' }] } as never,
      signal: AbortSignal.timeout(30_000),
    })
    const child = ctx.agents.get(childId)          // live Agent, or undefined when only persisted
    const owned = child !== undefined && ctx.agents.isOwnedBy(childId, parent)
    ctx.logger.info(`child ${childId}: ${child?.status ?? 'ready'} (owned=${owned})`)
  })
}
```

### 1.7 NanmiCoder/dsh-agent-teams cross-check

**No vendored copy exists locally.** `Q:\repos\dsh-legion` has no `vendor/` directory and no `*agent-team*` directory anywhere in the tree. Reported as API only; the sole in-tree consumer of this pattern is `packages/experimental/agent-team` (§10), quoted above.

---

## 2. `ctx.tokenMeter`

**Service key:** `ctx.tokenMeter` · **Package:** `@deepseek-ai/dsh-token-meter` · **Path:** `packages/llm/token-meter`

```ts
// packages/llm/token-meter/src/index.ts:67-71
declare module '@deepseek-ai/cordis' {
  interface Context {
    tokenMeter: TokenMeter
  }
}
```

### 2.1 Interface — exactly two public operations

```ts
// packages/llm/token-meter/src/index.ts:74-77
export class TokenMeter extends Service {
  static Config: z<TokenMeterConfig> = z.object({}) as unknown as z<TokenMeterConfig>

// packages/llm/token-meter/src/index.ts:116
  measure(session: Session, requestHeader?: EpochHeader): TokenMeasurement

// packages/llm/token-meter/src/index.ts:155-157
  /** @returns content and role-framing tokens under the fixed service heuristic. */
  estimateMessage(message: Message): number
}
```

Config is **closed**: any key at all throws (`index.ts:61-65`):

```ts
function validateConfigKeys(config: TokenMeterConfig): void {
  for (const key of Object.keys(config)) {
    throw new Error(`TokenMeterConfig: unknown key "${key}" (no settings are supported)`)
  }
}
```

`measure()` returns a **detached, deeply frozen structured clone** (`index.ts:139`: `return deepFreeze(structuredClone({...}))`) with fields `logRevision`, `baseline`, `surfaceDeltaTokens`, `totalTokens`, `surfaceTokens`, `nodes` (`index.ts:139-146`). Cost is **O(surface) per call** — *"Every call clones those positional nodes, so measurement is O(surface)"* (`index.ts:110-111`). Per-session fold state lives in `private readonly states = new WeakMap<Session, ReplayState>()` (`index.ts:79`) — **keyed by the live `Session` object**, so it is per-session, in-memory, and garbage-collected with the session.

### 2.2 Projections registered

Three, all registered as an **optional child** so a composition without the projection registry still gets the standalone read shape (`index.ts:87-91`):

```ts
ctx.inject(['sessionProjections'], (projectionCtx) => {
  projectionCtx.sessionProjections.register(tokenUsageProjectionDefinition)
  projectionCtx.sessionProjections.register(contextPressureProjectionDefinition)
  projectionCtx.sessionProjections.register(contextBreakdownProjectionDefinition)
})
```

**`tokenUsage`** — four non-negative integer buckets over the whole durable log (`packages/llm/token-meter/src/usage-projection.ts:43-48`, wire view at `:150`):

```ts
const projectionSchema = z.object({
  uncachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
}).strict()
```

Its fold (`usage-projection.ts:119-151`) replaces rather than double-counts a repeated sample for one `turn`/`step`, and `wire: { viewSchema: projectionSchema, view: state => state.totals }` publishes the totals to the client.

**`contextPressure`** (`usage-projection.ts:65-73`), wire view:

```ts
const pressureSchema: z.ZodType<ContextPressureProjection> = z.object({
  pressureTokens: z.number().int().nonnegative().optional(),
  projectedTokens: z.number().int().nonnegative().optional(),
  contextWindow: z.number().int().positive().optional(),
}).strict()
```

with *"Prompt-side pressure of one request: input plus cache traffic, no output"* — `pressureFrom = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)` (`:76-77`). Its internal state additionally tracks `surfaceTokens`, `sampledSurfaceTokens`, and a `claim { start, end, tokens }` (`:95-105`). Crucially the docs warn the numerator and denominator are **independent last-wins slots** and *"the pair is explicitly not one atomic request observation"* (`:153-162`).

**`contextBreakdown`** — third unit, from `./breakdown-projection.ts` (`index.ts:21, 90`).

### 2.3 Per-child token usage for a subagent you started — YES, indirectly

`ctx.tokenMeter.measure()` takes a **`Session`**, not an agent. So:

- **Per session:** yes, directly — `ctx.tokenMeter.measure(session)`, or read the `tokenUsage` projection for that session.
- **Per child you started:** yes, **as long as you can reach that child's `Session`**. Because `childId === child session id === child agent id` (§1.4), you get it via `ctx.agents.get(childId)?.session` while the child is live, or via `ctx.sessionProjections` / the projection cache / `ctx.sessionPersistence` when it is cold. `ctx.subagents.listChildren()` already reads projections through exactly that cold ladder.
- **There is no aggregate roll-up.** No `usageFor(agent)`, no subtree total, no parent-inclusive-of-children figure. Summing a delegation tree is the plugin's job: enumerate with `listDescendants()`, read `tokenUsage` per session, add.

### 2.4 Money: **absent**

Stated plainly: **the DeepSeek Harness has no price, cost, currency, or billing concept anywhere.** `tokenUsage` is the closest thing to a ledger and it counts **tokens only** — four integer buckets, no rate, no multiplier, no per-model price table, no currency field. A plugin that needs spend must supply its own price table and fold it over `tokenUsage`. (The dedicated whole-tree grep sweep is recorded in §9.)

### 2.5 Minimal snippet

```ts
export const name = 'my-usage-reader'
export const inject = ['tokenMeter', 'agents', 'sessionProjections']

export function apply(ctx: Context) {
  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'idle') return
    const m = ctx.tokenMeter.measure(agent.session)
    const usage = ctx.sessionProjections.stateOf(agent.session, 'tokenUsage')
    ctx.logger.info(
      `${agent.id}: total=${m.totalTokens} surface=${m.surfaceTokens} ` +
      `in=${usage.totals.uncachedInputTokens} out=${usage.totals.outputTokens} ` +
      `cacheRead=${usage.totals.cacheReadTokens} cacheWrite=${usage.totals.cacheWriteTokens}`,
    )
  })
}
```

---

## 3. `ctx.userQuestions` — asking the human mid-run

**Service key:** `ctx.userQuestions` · **Package:** `@deepseek-ai/dsh-user-questions` · **Path:** `packages/interaction/user-questions`

```ts
// packages/interaction/user-questions/src/index.ts:14-18
declare module '@deepseek-ai/cordis' {
  interface Context {
    userQuestions: UserQuestionService
  }
}
```

### 3.1 Full interface, verbatim

```ts
// packages/interaction/user-questions/src/index.ts:28-40
/** Request for a human answer. */
export interface AskUserQuestionRequest {
  /** Questions to display. */
  questions: AskUserQuestionItem[]
  /** Exact live calling agent, when the request came from an agent tool call. */
  agent?: Agent
  /** Abort signal for the owning tool/step. */
  signal?: AbortSignal
}

/** UI-side provider for user questions. */
export interface UserQuestionProvider {
  ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>
}
```

```ts
// packages/interaction/user-questions/src/index.ts:43-48
export class UserQuestionError extends HarnessError {
  constructor(message: string, code: string, options?: ErrorOptions)
}

// packages/interaction/user-questions/src/index.ts:51-140
export class UserQuestionService extends Service {
  registerProvider(provider: UserQuestionProvider): () => void                 // :64
  async ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>   // :92
}
```

Wire-safe payload types (`packages/interaction/user-questions/src/types.ts`), deliberately free of cordis imports so the browser type chain can consume them:

```ts
export interface AskUserQuestionOption { label: string; description?: string }                  // :9-14
export type AskUserQuestionIntent = { kind: 'plan-review'; approve: string }                    // :23-32
export interface AskUserQuestionItem {                                                          // :35-50
  id: string
  question: string
  detail?: string
  header?: string
  options?: AskUserQuestionOption[]
  multiSelect?: boolean
  intent?: AskUserQuestionIntent
}
export interface AskUserQuestionAnswerItem { id: string; selected: string[]; custom?: string }  // :53-60
export interface AskUserQuestionAnswer { answers: AskUserQuestionAnswerItem[] }                 // :63-66
```

### 3.2 Does it block? Yes.

`ask()` returns `Promise<AskUserQuestionAnswer>` and its final statement is `return this.provider.ask(request)` (`index.ts:139`). The module doc calls it *"a UI-backed service for pausing an agent tool call until the human answers a question"* (`index.ts:2-4`). There is **no timeout inside the service** — bounding the wait is the caller's job via `request.signal`. An already-aborted signal short-circuits *before* the provider is consulted (`index.ts:93-95`), but the service does **not** race an abort that arrives later; that containment is the provider's responsibility.

### 3.3 Headless / non-interactive host: it **THROWS**. It never returns null and never hangs.

Exact fallback behavior, quoted from source. Five throw sites, all `UserQuestionError` with a stable `code`:

```ts
// packages/interaction/user-questions/src/index.ts:136-138  <-- THE headless case
if (this.provider === undefined) {
  throw new UserQuestionError('no user-questions provider is registered', 'NO_PROVIDER')
}
```

**`NO_PROVIDER` is the headless answer.** A composition with no UI package registers no provider, so `ask()` rejects rather than hanging.

The other four:

```ts
// :93-95
if (request.signal?.aborted) {
  throw new UserQuestionError('ask_user_question was aborted before the user answered', 'ASK_ABORTED')
}
// :96-98
if (request.questions.length === 0) {
  throw new UserQuestionError('ask_user_question requires at least one question', 'EMPTY_QUESTIONS')
}
// :102-106
if (agents === undefined || agents.get(agent.id) !== agent) {
  throw new UserQuestionError(
    'human interaction requires the exact live calling agent when an agent is supplied',
    'CALLER_NOT_LIVE')
}
// :107-112
if (!agents.roots().includes(agent)) {
  throw new UserQuestionError(
    'human interaction is unavailable while the calling agent is owned by another live agent; '
    + "include the unresolved question or decision in the child agent's final result",
    'DELEGATED_CALLER')
}
```

Plus `BAD_INTENT` (`:125-128`, `:131-134`) when a declared `intent.approve` names none of the question's own options, or an intent carries no `detail`.

**`DELEGATED_CALLER` is the load-bearing one for a plugin.** A subagent cannot ask the human. The doc states why (`index.ts:79-85`): *"When a caller supplies an agent, human interaction is valid only for the exact live runtime root. Runtime ownership, not durable session lineage, decides this boundary: an owned child has no human answerer and would block forever, while a lineage-bearing session resumed as a new runtime root may ask normally."* The gate is literally `ctx.agents.roots().includes(agent)` — §1.2's `roots()`.

**Escape hatch:** omit `request.agent`. The whole liveness/root check is inside `if (agent !== undefined)` (`:100`). A plugin asking on its own behalf rather than an agent's skips it — at the cost of losing UI routing to the right conversation.

### 3.4 Scope / lifetime

`registerProvider` is effect-scoped on the calling fiber, **exactly one provider per context**; a second registration throws `DUPLICATE_PROVIDER` (`index.ts:66-68`). The returned disposer unregisters. A third-party plugin normally *calls* `ask()` and does not register a provider (that is the UI plane's seat, e.g. `@deepseek-ai/dsh-client-ui-user-questions`).

### 3.5 Minimal snippet

```ts
export const name = 'my-asker'
export const inject = ['userQuestions']

export function apply(ctx: Context) {
  ctx.on('my/needs-input', async (agent: Agent, signal: AbortSignal) => {
    try {
      const { answers } = await ctx.userQuestions.ask({
        agent,                       // omit to bypass the root-only gate
        signal,
        questions: [{
          id: 'overwrite',
          question: 'Overwrite the existing config file?',
          header: 'Confirm',
          options: [{ label: 'Overwrite', description: 'Replaces the current file.' },
                    { label: 'Cancel' }],
        }],
      })
      return answers[0]?.selected[0] === 'Overwrite'
    } catch (error) {
      // Headless: 'NO_PROVIDER'. Subagent: 'DELEGATED_CALLER'. Both mean "cannot ask" —
      // fail closed rather than assuming consent.
      if (error instanceof UserQuestionError) return false
      throw error
    }
  })
}
```

---

## 4. `ctx.storage.domain` — the domain KV

**Two service keys, one instance.** `ctx.storage.domain` is a getter on the hub; `ctx.storageDomain` is a real Cordis service key. **Inject `'storageDomain'`** — the getter carries no independent lifecycle signal.

```ts
// packages/storage/storage-domain/src/index.ts:29-39
declare module '@deepseek-ai/dsh-storage' {
  interface StorageForms {
    domain: DomainFacility
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    storageDomain: DomainFacility
  }
}
```

Both are provided in `apply`: `domainCtx.storage.mount('domain', facility)` (`:209`) and `domainCtx.provide('storageDomain', facility)` (`:217`). The hub getter throws `StorageError('form-not-mounted', …)` when the domain plugin is absent (`packages/storage/storage/src/index.ts:83-85`).

**Package:** `@deepseek-ai/dsh-storage-domain` · **Path:** `packages/storage/storage-domain` · `export const inject = ['storage']` (`:44`).

### 4.1 Interface, verbatim

```ts
// packages/storage/storage-domain/src/index.ts:69-175
export class DomainFacility {
  async open<S extends DomainSpec>(spec: S): Promise<Domain<S>>   // :100
  get(name: string): DomainImpl | undefined                        // :165
  async closeAll(): Promise<void>                                  // :175
}
```

```ts
// packages/storage/storage-domain/src/domain.ts:96-119
/** One open domain, typed by its spec. */
export interface Domain<S extends DomainSpec> {
  /** Domain name from the spec. */
  readonly name: string
  /** Global singleton handle; a spec without `global` has no usable handle (`never`). */
  readonly global: DomainGlobalHandleOf<S>
  table<N extends keyof S['tables'] & string>(name: N): KvTable<TableKeyOf<S, N>, TableValueOf<S, N>>
  close(): Promise<void>
}
```

```ts
// packages/storage/storage-domain/src/domain.ts:42-90
export interface KvTable<K extends string, V> {
  get(key: K): V | undefined                            // :48
  entries(): IterableIterator<[K, V]>                    // :55
  keys(): IterableIterator<K>                            // :61
  /** Current record count. */
  readonly size: number                                  // :64
  put(key: K, value: V): Promise<void>                   // :72
  delete(key: K): Promise<boolean>                       // :80
  update(key: K, fn: (current: V) => V): Promise<V>      // :89
}
```

```ts
// packages/storage/storage-domain/src/domain.ts:18-35
/** Handle on a domain's global singleton. */
export interface DomainGlobal<G> {
  get(): G          // :23
  set(value: G): Promise<void>   // :34
}
```

**There is NO flat `get`/`set`/`delete`/`list` KV.** The shape is *domain → (tables | one optional global singleton)*. Also exported (`index.ts:21-27`): `defineDomain`, `domainTable`, `descriptorOf`, and types `DomainSpec`, `DomainGlobalSpec`, `DomainTableSpec`, `TableKeyOf`, `TableValueOf`, `GlobalValueOf`, `DomainChanged`.

### 4.2 Read/write semantics — the important asymmetry

From the module doc (`domain.ts:1-8`), verbatim:

> *"authoritative in-memory state, the single per-domain write chain, and change-event emission. **Reads are synchronous from memory; every write queues on the chain, awaits backend durability FIRST, then mutates memory, then emits `domain/changed`** — a rejected backend write leaves memory untouched (no divergence between reads and the medium), and events carry values that equal the in-memory state at emission, in write order."*

So `get`/`entries`/`keys`/`size` are **synchronous and never fail on IO**; `put`/`delete`/`update`/`global.set` are **async and durable-before-visible**. `update()` is a genuine **atomic read-modify-write on the domain's single write chain** (`domain.ts:82-89`): *"`fn` sees the value current at its queue slot, so concurrent updates never interleave."* That makes it a real in-process CAS-equivalent — but **only in-process**, since the chain is one `Promise` tail on one `DomainImpl` (`domain.ts:149`).

Records are *"plain immutable data: returned values are the stored objects themselves (no defensive copies) and must not be mutated in place — replace via `put`/`update`"* (`domain.ts:37-41`). `entries()`/`keys()` return a **snapshot, not a live view** (`:52-53`). `delete` returns `false` with **no write and no event** when the key was already absent (`:78-79`). `put` is a full replace, *"no partial merge"* (`:69`). `update` on a missing key rejects with `missing-key` (`:87`).

**No multi-key transactions exist.** `update` is the only RMW primitive and it covers exactly one key.

### 4.3 Schema validation runs at the READ boundary only

This is a genuine trap. Every stored record is validated against the spec's zod schema **at `open()`** (`index.ts:118-132`), failing the whole call with `invalid-record` naming the offending table and key. But `DomainGlobal.set`'s own doc says (`domain.ts:31-32`) the value *"must satisfy the spec's schema (**not re-checked here** — validation happens at the durable read boundary)"*. **Writes are trusted; reads are validated.** A cast that lies persists bad data which then fails the *next* `open()`.

A never-written global serves the spec's `initial` without materializing it — *"A null stored global means 'never written': serve `initial` without materializing it — the first `set` writes"* (`index.ts:125-132`). Consequently `defineDomain` **rejects a global schema that accepts `null`** (`spec.ts:91-96`), since `null` is the sentinel.

Note the schema-flavor split: record schemas are **zod**; plugin `Config` is **schemastery**.

Name grammar for domains and tables is `export const UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/` (`packages/storage/storage/src/backend.ts:10`) — **hyphens are forbidden** (must be file-name and SQL-identifier safe). This differs from command names, which do allow hyphens.

### 4.4 Events

```ts
// packages/storage/storage-domain/src/events.ts:33-46
/** One durable domain change; a closed union — switch on `operation`. */
export type DomainChanged = DomainChangedPut | DomainChangedDeleted

'domain/changed'(change: DomainChanged): void
```

`DomainChangedBase` carries `{ domain, table, key }` with `table`/`key` both `''` for a global write (`events.ts:10-18`); `DomainChangedPut` adds `operation: 'put'` + `value` (`:20-25`), `DomainChangedDeleted` adds `operation: 'deleted'` and `value?: never` (`:27-31`).

Guarantees: emitted **once per write, strictly after the backend acknowledged durability**, in write-chain order (`:38-44`); **never carries the old value** (`:3-5`); a no-op delete emits nothing; a throwing listener is contained and logged and cannot retroactively reject the committed write (`domain.ts:246-261`).

### 4.5 Scoping — process-GLOBAL, not per-session

**Nothing in this layer carries a session or agent key.** `DomainSpec` is `{ name, version, global?, tables }` (`spec.ts:34-44`) — no scope field. `KvUnitDescriptor` is `{ name, version, tables, hasGlobal }` (`storage/src/backend.ts:46-55`) — no scope. The facility is provided once on the plugin context (`index.ts:217`), not per agent, and keys its open-domain table by `spec.name` alone (`:141`), holding `private readonly domains = new Map<string, DomainImpl>()` plus a `reserved: Set<string>` (`:70-72`). `open()` **rejects a name already open** with `already-open` (`:101-103`), enforcing **single-open per domain name per process**.

⇒ **Session scoping must be encoded by the caller into the record key.** Open once at `apply` and share the handle.

Backend routing is decided at the *domain plugin's* config, not the hub (`index.ts:46-62`):

```ts
export interface Config {
  /** Default backend name for every domain without an explicit route. Required: there is no universally correct medium. */
  backend: string
  /** Per-domain overrides: domain name → backend name. */
  routes?: Record<string, string>
}
```

A route naming an unregistered backend fails loud at `open` with `backend-not-found`; a backend without a `kv` facet fails with `facet-unsupported` (`index.ts:108-113`).

### 4.6 Lifetime and ownership

Quoted verbatim (`index.ts:93-97`):

> *"Lifecycle: the **CALLER owns the returned handle** and closes it via `Domain.close()` (typically as its own `ctx.effect` disposer) — the facility does not tie the domain to any consumer fiber. Domains still open when the facility unmounts are closed by the plugin disposer."*

`close()` *"reject[s] new writes immediately, drain[s] already-queued writes (their events still emit), release[s] the backend unit, then free[s] the domain name for a later open. Idempotent"* (`domain.ts:110-118`). Reads stay valid while draining and throw `closed` only once fully closed (`:127-128`, `:272-276`).

### 4.7 Durability: survives sessions AND processes

**Yes to both**, for both shipped backends. The location is set by *assembly config*, not by the plugin.

**`@deepseek-ai/dsh-storage-json`** — one human-readable file per unit, *"published by atomic whole-file rewrite"* (`packages/storage/storage-json/src/index.ts:1-5`). Exact path formula `<root>/<domainName>.json`:

```ts
// packages/storage/storage-json/src/index.ts:64-65
await mkdir(this.root, { recursive: true, mode: 0o700 })
const path = join(this.root, `${descriptor.name}.json`)
```

`root` **has no default on purpose** (`:21-30`): *"a `process.cwd()` fallback would scatter unit files wherever the process happens to start; assemblies state the location explicitly."* Registers as backend `'json'` (`:107`).

**`@deepseek-ai/dsh-storage-sqlite`** — *"one database file hosts every unit"* (`src/index.ts:2`), over `node:sqlite`'s `DatabaseSync`. Config `path: string` (`:34`), with `:memory:` supported for tests; the file is created exclusively at `0o600` (`schema.ts:45`: `const handle = await open(path, 'wx', 0o600)`). A `journalMode` knob exists for filesystems where WAL shared-memory files fail (network mounts). Schema-version mismatch fails loud (`schema.ts:84-87`).

So the durability chain is: `put()` → backend `kv` unit write → **await durability** → memory → `domain/changed`. Data outlives the session, the agent, and the process. What does **not** survive is the in-memory `Map` — every restart re-`loadAll()`s and re-validates.

**Cross-process caveat (important).** Durability *across restarts* is guaranteed; **two live processes over one medium are not coordinated by this layer.** The write chain is per-process (`domain.ts:149`), reads are served from a per-process in-memory snapshot loaded once at `open()` (`index.ts:117-124`), and `domain/changed` is an in-process Cordis emit — cross-process change push is a documented *"later phase"* (`events.ts:5-6`). Concurrent multi-process writers ⇒ **last-writer-wins with stale reads**. For real cross-process exclusion you need `withFileLock` from `@deepseek-ai/dsh-atomic-write`.

**No migration hook.** `version` is stamped at first materialization; bumping it rejects existing media with `version-mismatch` (`storage/src/backend.ts:34-37`). The plugin owns its own upgrade path.

### 4.8 Error codes

`DomainError`: `already-open`, `backend-not-found`, `facet-unsupported`, `invalid-record`, `closed`, `missing-key`, plus backend `version-mismatch` / `malformed-medium`. `StorageError`: `duplicate-mount`, `form-not-mounted`, `closed`, `malformed-medium`.

### 4.9 Minimal snippet

```ts
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'

const NoteRecord = z.object({ text: z.string(), updatedAt: z.number() })
type NoteRecord = z.infer<typeof NoteRecord>

// Module-load-time validation: bad name/version/global throws HERE.
const MINE = defineDomain({
  name: 'mine',              // UNIT_NAME_RE /^[a-z][a-z0-9_]*$/ — no hyphens
  version: 1,
  global: { schema: z.object({ enabled: z.boolean() }), initial: { enabled: false } },
  tables: { notes: domainTable<string, NoteRecord>(NoteRecord) },
})

export const name = 'my-plugin'
export const inject = ['storageDomain']

export function apply(ctx: Context): void {
  ctx.effect(() => {
    const opening: Promise<Domain<typeof MINE>> = ctx.storage.domain.open(MINE)
    void opening.then(async (domain) => {
      const notes = domain.table('notes')
      const existing = notes.get('welcome')                 // synchronous, from memory
      await notes.put('welcome', { text: 'hello', updatedAt: Date.now() })
      await notes.update('welcome', cur => ({ ...cur, updatedAt: Date.now() }))  // atomic in-process
      await domain.global.set({ enabled: !domain.global.get().enabled })
      void existing
    })
    return async () => { (await opening).close() }          // CALLER owns close()
  }, 'my-plugin: mine domain')

  ctx.on('domain/changed', (change) => {
    if (change.domain !== 'mine') return
    ctx.logger.info(`${change.operation} ${change.table}/${change.key}`)
  })
}
```

Assembly-side config:

```yaml
storage: {}
storage-json:
  root: /path/to/state          # -> /path/to/state/mine.json
storage-domain:
  backend: json
  routes:
    mine: json                  # optional per-domain override
```

---

## 5. Client / Web plane — mounting a live overlay panel

Full detail is in the companion file `docs/research/_seam-client.md` (799 lines). Condensed here.

### 5.1 The slot registry `ctx.slots`

**Pure core:** `@deepseek-ai/dsh-client-ui-slots` (`packages/client/ui-slots`) — React-free, cordis-free. **Value implementation:** `@deepseek-ai/dsh-client-runtime` (`packages/client/runtime`), which mounts `ctx.slots` and reuses the core's overloads **verbatim** rather than restating them:

```ts
// packages/client/runtime/src/client/slots.ts:126
declare readonly register: SlotCore['register']
```

`register()` is **two overloads** (with and without `inject`) at `packages/client/ui-slots/src/index.ts:741-757` and `:768-785`, with `BaseOptions` at `:527-550`. It must stay a prototype method: the cordis proxy rebinds `this.ctx` to the **caller's** context, and that is what routes disposal into the calling plugin's fiber.

One `register` call simultaneously contributes a component into a declared slot, declares child slots, declares a store seat, and declares the registrant's injected business face. `ComposedProps` (`:442-450`) is a **five-share intersection**:

> `PropsRuntime & PropsRenderSlots & PropsStore & InjectFace & MatchedShare & PropsLocale`

`SlotMap` (`:24`) is declaration-merged and lives in the **entry module deliberately** — augmentation merges lexically, not through re-exports, so you augment `'@deepseek-ai/dsh-client-ui-slots'` itself.

Chain slots use a pure `ChainSelect` (`:257`) returning `M | null`; the first non-null result elects that entry and becomes `props.matched`. `SlotCore` seeds the a-priori `'root'` slot and **throws at register time** on: registration into an undeclared slot, duplicate child declaration, one shared handle under two scopes, or a chain registration without `select`.

### 5.2 Slot ids — `shell.overlay` is the only `shell.*` slot, and it is UNOWNED

**39 production slot ids exist.** Critically, there is exactly **one** `shell.*` slot in the entire repository:

```ts
// packages/client/ui-layout/src/client/index.ts:83   (type declaration)
// packages/client/ui-layout/src/client/index.ts:126  (runtime spec)
'shell.overlay'   // kind: list, scope: root
```

Every other repo-wide `shell.` hit is an unrelated conversation-input controller identifier. **No shipped package registers into `shell.overlay`** — a grep for `name: 'shell.overlay'` returns zero hits. It is a genuinely unowned, click-through, **additive** seat, which makes it exactly the right target for a third-party frame-wide overlay panel. Only two chain slots exist anywhere: `conversation.chat.turnTail` and `conversation.composer`.

**Traps:** never register into `root`, `sidebar`, `conversation`, or `details` — those are owned shell seats.

### 5.3 Declaring a client bundle in `package.json`

A UI plugin needs **`dsh.client` only**. The node half of `@deepseek-ai/dsh-client-modules` performs an incremental `dsh.client` scan and composes the `__DSH_BOOT__` entry graph.

- **`dsh.client.platform` must be the literal `'web'`.** Anything else is cached as a **permanent negative verdict** and the package is **silently dropped** (`packages/client/modules/src/index.ts:447-450`).
- A missing `exports["./client"]` then **throws loud** (`:451-454`). Note the asymmetry: wrong platform = silent drop; missing export = loud throw.
- `inject` in the manifest is **informational only**; `external` carries the real module-graph edges. Type-only imports are **not** requests.

**`dsh.bundle.patch` is a different axis entirely.** It is host-side *profile-layer composition* (`packages/boot/app-boot/src/profile.ts:388-397`) and has nothing to do with browser bundling. Do not reach for it when shipping UI.

The browser half of `dsh-client-modules` is the lazy-CJS module table the vendored cordis Loader consumes; `@deepseek-ai/dsh-client-ui-renderer` performs the sole context-level `renderSlot('root')` and `dsh-client-web` calls `ctx.uiRenderer.mount(container)` after every client entry activates. Documented limitation: **the first application frame waits for every client entry** — no Suspense, no per-entry lazy loading.

### 5.4 Which client packages a third-party plugin may depend on

**Correction to the brief:** the question named five targets; one of them does not exist.

| Requested | Status | Verdict |
|---|---|---|
| **slots** — `@deepseek-ai/dsh-client-ui-slots` | published, 0.1.1-rc.2 | ✅ **Depend on it.** This is the API you call. |
| **runtime** — `@deepseek-ai/dsh-client-runtime` | published, 0.1.1-rc.2 | ✅ **Depend on it.** Mounts `ctx.slots`; owns `defineStore`'s value implementation. |
| **ui-primitives** — `@deepseek-ai/dsh-client-ui-primitives` | published, 0.1.1-rc.2 | ✅ **Depend on it.** Pure React atoms, zero cordis. Use rather than re-implementing. |
| **schema-form** | ❌ **DOES NOT EXIST** | `packages/client/schema-form/` retains only stale `lib/` + `node_modules/` residue — **no `package.json`, no `src/`, no `tests/`**, and **zero dependents** across every manifest in the repo. The package was removed. **Do not plan against it.** |
| **ui-renderer** — `@deepseek-ai/dsh-client-ui-renderer` | published, 0.1.1-rc.2 | ⚠️ **Published but do not import.** Boot-once shell machinery — `install()` throws on a second call. Consume rendering through the `renderSlot` props face instead. |

**No package under `packages/client/` sets `private` at all** — all 40 are publicly dependable at `0.1.1-rc.2`. (`web-react` is likewise stale residue, same as `schema-form`.)

### 5.5 Minimal `shell.overlay` plugin

`package.json`:

```json
{
  "name": "my-overlay",
  "version": "0.0.1",
  "type": "module",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client/index.js"
  },
  "dsh": {
    "client": {
      "platform": "web",
      "external": ["@deepseek-ai/dsh-client-ui-slots", "@deepseek-ai/dsh-client-runtime"]
    }
  },
  "peerDependencies": {
    "@deepseek-ai/dsh-client-ui-slots": "^0.1.1-rc.2",
    "@deepseek-ai/dsh-client-runtime": "^0.1.1-rc.2",
    "@deepseek-ai/dsh-client-ui-primitives": "^0.1.1-rc.2"
  }
}
```

`src/client/index.tsx`:

```tsx
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-runtime'

export const name = 'my-overlay-client'
export const inject = ['slots']

function OverlayPanel() {
  return (
    <div style={{
      position: 'absolute', right: 16, bottom: 16, zIndex: 50,
      pointerEvents: 'auto',            // shell.overlay is click-through by default
      padding: 12, borderRadius: 8,
      background: 'var(--dsw-surface)', color: 'var(--dsw-text)',
    }}>
      my live panel
    </div>
  )
}

export function apply(ctx: Context) {
  ctx.slots.register({ name: 'shell.overlay' }, OverlayPanel)   // effect-scoped; unwinds with the plugin
}
```

### 5.6 The canonical live-status pattern

**Append domain events to the session log → register a projection unit → the whole projection value is pushed to the client on a `session/projection` frame → a client slot renders it.** `@deepseek-ai/dsh-client-ui-goal` is the reference implementation of exactly that chain; `dsh-client-ui-jobs` and `dsh-client-ui-trajectory` are further templates. Follow it rather than inventing a side channel — there is no generic notification service.

### 5.7 Traps worth repeating

- A `StoreHandle` exported at module level becomes a **disguised singleton across plugin reloads**. Keep handles inside `apply`.
- **One handle, one scope** — the core throws otherwise.
- CSS injection runs at **materialization**, not at script execution, under the lazy-CJS factory model.
- Changing the **set** of plugins requires a restart; only client-plugin *content* hot-reloads (and only while `pnpm run dev:web` is watching).

---

## 6. Plugin HTTP routes

**Service key: `webServer`** — NOT `httpServer`. **Package:** `@deepseek-ai/dsh-host-webserver` · **Path:** `packages/host/webserver`

```ts
// packages/host/webserver/src/index.ts:22-25
declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: WebServer
  }
}

// :73
export class WebServer extends Service {
// :88-90
  constructor(ctx: Context, private config: Config) {
    super(ctx, 'webServer')
  }
```

Package doc (`:2-6`): *"a node:http server plus the `webServer` service (HTTP and upgrade route registries, the structured index injection table with raw transform taps behind it, and the single fallback seat for everything no route claims)"*. It serves no files itself.

### 6.1 Route vocabulary, verbatim

```ts
// packages/host/webserver/src/index.ts:38-64
/** Route match kind: 'exact' matches the pathname verbatim; 'prefix' p matches p and p/<anything>. */
export type WebRouteKind = 'exact' | 'prefix'

/** One named route registration. */
export interface WebRoute {
  kind: WebRouteKind
  /** Absolute pathname, no trailing slash. */
  path: string
  /** Owns the full response lifecycle (may hold the response open, e.g. SSE). */
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** One exact-path HTTP upgrade registration. */
export interface WebUpgradeRoute {
  /** Absolute pathname, no trailing slash. */
  path: string
  /** Owns protocol negotiation and the upgraded socket after dispatch. */
  handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>
}

/** Gateway config: the listen address. */
export interface Config {
  host: '127.0.0.1' | '0.0.0.0'
  port: number
}
```

### 6.2 Full public interface

| Member | Citation |
|---|---|
| `get port(): number` | `packages/host/webserver/src/index.ts:93` |
| `get host(): Config['host']` | `:98` |
| `register(route: WebRoute): () => void` | `:108` |
| `registerUpgrade(route: WebUpgradeRoute): () => void` | `:123` |
| `registerFallback(handler: WebRoute['handler']): () => void` | `:139` |
| `tapIndex(transform: (html: string) => string): () => void` | `:154` |
| `applyIndexTaps(html: string): string` | `:274` |
| `collectIndexInjections(): IndexInjection[]` | `:286` |
| `renderIndex(html: string): string` | `:298` |
| `static Config: z<Config>` | `:74` |

```ts
// packages/host/webserver/src/index.ts:108-115
register(route: WebRoute): () => void {
  const table = route.kind === 'exact' ? this.exact : this.prefixes
  if (table.has(route.path)) {
    throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`)
  }
  table.set(route.path, route)
  return () => { table.delete(route.path) }
}
```

`registerUpgrade` (`:123-129`) and `registerFallback` (`:139-145`) throw on duplicate / already-taken seat the same way. The fallback seat is already owned by `packages/host/frontend-static/src/index.ts:109` — a third party must **not** take it.

Structured index injection is preferred over raw taps: `collectIndexInjections()` performs one `ctx.emit('webserver/index-inject', table)` per render (`:286-290`, event declared at `:34`), and `IndexInjection` is a 5-variant union `{kind:'global'|'script'|'script-src'|'style'|'html'}` (`packages/host/webserver/src/injections.ts:14-29`). `tapIndex` is the raw escape hatch and runs **after** structured row rendering (`renderIndex`, `:298-300`).

### 6.3 Matching semantics

- Exact table first, then prefix table with **longest-prefix-wins** (`private match(pathname)`, `:257-266`).
- Prefix `p` matches `p` and `p/<anything>` only (`:262`) — `/plugins` does **not** match `/pluginsfoo`.
- **No method routing.** The registry keys on pathname only; handlers must gate on `req.method` themselves.
- Unmatched with no fallback ⇒ 404 (`:174-177`). A rejecting handler is contained: logged, then 400, or `res.destroy()` if headers were already sent (`:186-194`).
- Registration order is irrelevant to dispatch (`:68-70`).

### 6.4 ⚠️ `/plugins` is already claimed

```ts
// packages/client/modules/src/index.ts:340
() => ctx.webServer.register({ kind: 'prefix', path: '/plugins', handler: this.serveBundle }),
```

Because duplicate `(kind, path)` throws, a plugin **cannot** register prefix `/plugins`. It *can* register **exact** `/plugins/mine/state`, since exact and prefix live in separate tables (`:79-80`) and exact is consulted first (`:258`) — but that shadows the client-bundle server for that pathname. **Use a distinct namespace** such as `/x-mine/state` unless shadowing is deliberate. Other route owners: `packages/client/connection/src/index.ts:173` (`/api`) and `:181` (upgrade), `packages/client/hmr/src/index.ts:166` (SSE).

### 6.5 Minimal snippet — GET /plugins/mine/state → JSON

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

export const name = 'my-plugin'
export const inject = ['webServer']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/plugins/mine/state',
    handler: (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {   // no method routing in the registry
        res.writeHead(405); res.end(); return
      }
      const body = JSON.stringify({ ok: true, port: ctx.webServer.port })
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(req.method === 'HEAD' ? undefined : body)
    },
  }), 'my-plugin: /plugins/mine/state')
}
```

`register` returns a **bare disposer**, so the `ctx.effect(...)` wrapper is required — the established idiom at `packages/client/connection/src/index.ts:173` and `packages/client/modules/src/index.ts:339-342`.

### 6.6 Typert Remote is the preferred alternative for typed calls

`@deepseek-ai/dsh-host-apiproxy` explicitly *"registers no routes — physical carriers wrap `ctx.apiProxy` themselves"* (`packages/host/apiproxy/src/index.ts:7-8`), providing `apiProxy: ApiProxy` (`:33-38`). The gateway does *"Live Typert Remote dispatch over Cordis Services and registered providers"* (`packages/api/gateway/src/index.ts:2-3`).

```ts
// packages/typert/protocol/src/index.ts
export abstract class TypertRemoteService<out T = never> extends Service<T> {   // :147
  protected constructor(ctx: Context, serviceKey: string, options: TypertGatewayBindingOptions = {}) {  // :157

export function Remote<This extends object, Args extends unknown[], Result>(  // :168-177
  _method: (this: This, ...args: Args) => Result,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
): void
export function Remote(exportName: string): RemoteMethodDecorator

export function bindTypertRemote<Service extends object>(                     // :135-139
  service: Service, serviceKey: string, options: TypertGatewayBindingOptions = {},
): TypertGatewayBinding<Service>

export function RemoteScope(key: Extract<keyof TypertContextMap, string>, exportName?: string): RemoteMethodDecorator  // :204-207
```

`CommandRuntime` is the worked in-tree example: `export class CommandRuntime extends TypertRemoteService` (`packages/interaction/commands/src/index.ts:250`) with `@Remote` on `list` (`:284`) and `execute` (`:328`).

**Decision rule.** Typed method calls consumed by a DSH *client plugin* over the existing `/api` carrier ⇒ `TypertRemoteService` + `@Remote`. Raw HTTP semantics that are not a method call — SSE, webhooks, blob downloads, non-DSH clients — ⇒ `ctx.webServer.register` (even in-tree, HMR chose a raw route).

---

## 7. Commands — contributing a slash command

**Service key:** `ctx.commands` · **Package:** `@deepseek-ai/dsh-commands` · **Path:** `packages/interaction/commands`

```ts
// packages/interaction/commands/src/index.ts:104-108
declare module '@deepseek-ai/cordis' {
  interface Context {
    commands: CommandRuntime
  }
}

// :250  — note it is itself a Typert Remote service
export class CommandRuntime extends TypertRemoteService {
// :261-263
  constructor(ctx: Context) { super(ctx, 'commands') }
```

### 7.1 The `ctx.inject(['commands'])` pattern

The **declarative** form is the module-level `inject` array, and that is what shipped commands use:

```ts
// packages/goal/command-goal/src/index.ts:12-13
export const name = 'command-goal'
export const inject = ['commands', 'goals']
```

`ctx.inject([...], cb)` is the **callback** form, for dynamically computed service keys (e.g. `packages/storage/storage-domain/src/index.ts:206`).

### 7.2 Registration signature — do NOT wrap in `ctx.effect`

```ts
// packages/interaction/commands/src/index.ts:270-277
register(definition: CommandDefinition): () => void {
  const registered = normalizeDefinition(definition)
  return this.layers.effect(
    this.ctx,
    layer => layer.commands.insert(registered.definition.name, registered),
    { label: 'commands.register()' },
  )
}
```

It returns *"the exact effect disposer that unregisters this definition"* (`:269`). Because it **already routes through `this.layers.effect(this.ctx, …)`**, it is already an effect bound to the calling context — unlike `webServer.register`, wrapping it in `ctx.effect` is wrong.

### 7.3 Interfaces, verbatim

```ts
// packages/interaction/commands/src/index.ts:53-69
/** Plugin-owned command registration. */
export interface CommandDefinition {
  /** Lowercase command name without the leading slash. */
  readonly name: string
  /** Human-readable summary used in discovery UI. */
  readonly description: string
  /** Optional free-form input hint advertised to capable clients. */
  readonly input?: CommandInputDescriptor
  /**
   * Whether `command/run` records `rawInput`. Defaults to true. A command
   * whose domain event owns the payload sets this false to avoid duplicating
   * that payload in the session log.
   */
  readonly recordInput?: boolean
  /** Execute against the receiving agent without sending the command to the model. */
  readonly handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>
}
```

```ts
// packages/interaction/commands/src/index.ts:33-51
/** Invocation passed to one registered command handler. */
export interface CommandInvocation {
  /** Pairing id already written to this invocation's `command/run` event. */
  readonly commandId: CommandId
  /** Exact agent whose UI received the command. */
  readonly agent: Agent
  /** Exact text following the registered command name, including separator whitespace. */
  readonly rawInput: string
  /** Durably admitted image blocks accompanying this invocation, in submission order. */
  readonly attachments: readonly ImageBlock[]
  /** Cancellation signal owned by the dispatching UI request. */
  readonly signal: AbortSignal
}
```

```ts
// packages/interaction/commands/src/types.ts:26-34
/** Expected command outcome rendered directly by the dispatching UI. */
export type CommandResult =
  | {
    readonly kind: 'success'
    readonly text?: string
    /** Earlier authoritative domain event that owns a richer presentation. */
    readonly sourceEventSeq?: number
  }
  | { readonly kind: 'error'; readonly text: string }

// :12-24
export interface CommandInputDescriptor {
  /** Placeholder shown before the user supplies free-form input. */
  readonly hint: string
  readonly images?: boolean
}

// :49-57
export interface CommandDescriptor {
  readonly name: string
  readonly description: string
  readonly input?: CommandInputDescriptor
}
```

Rest of the runtime surface:

```ts
// packages/interaction/commands/src/index.ts
@Remote list(agent: Agent): readonly CommandDescriptor[]                       // :284-285
find(agent: Agent, name: string): CommandDefinition | undefined                // :298
@Remote async execute(                                                          // :328-334
  agent: Agent, line: string,
  images: readonly EncodedImageAttachment[], signal: AbortSignal,
): Promise<CommandExecution | undefined>
export function parseCommand(line: string): ParsedCommand | undefined          // :116
```

### 7.4 Validation, lifecycle, scoping

- **Name grammar** `const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/u` (`:28`) — hyphens **allowed** here (contrast storage unit names, §4.3).
- **Registration-time throws** (`normalizeDefinition`, `:170-214`): bad name, non-string/empty description, non-function handler, non-string/empty `input.hint`, non-boolean `input.images`. Duplicate global name throws with a scope hint (`:94`).
- **Result validation** (`normalizeResult`, `:217`) throws `TypeError` on a non-`CommandResult`, non-string `success.text`, non-safe-integer/negative `sourceEventSeq`, empty `error.text`, or unknown `kind`. Results are frozen (`:230`, `:240`).
- **Durable lifecycle**: `command/run` is appended **before** the handler runs, `command/done` after settlement; a thrown or aborted handler settles as `kind: 'error'` (`:302-313`). Both are log-only and non-surface (`types.ts:96`, `:103-108`).
- **`'commands/change'(): void`** (`types.ts:80`) is an unfiltered registry notification; observer failures are contained and cannot veto.
- **Scoping**: *"Plain-context definitions are global; definitions registered through a command-injected child of an agent context shadow globals for that agent."* (`:246-249`).
- **Abort**: `withAbort` (`:146`) stops awaiting an uncooperative handler; non-`Error` rejections are wrapped.
- **Images**: admission is enforced in the registry before the handler runs — images sent to a command without `input.images`, an absent attachment store, or an exceeded limit each settle as an error.

### 7.5 Worked example — `/goal`, quoted verbatim

```ts
// packages/goal/command-goal/src/index.ts:188-196
/** Register the Codex-shaped `/goal` command for every composed command adapter. */
export function apply(ctx: Context): void {
  ctx.commands.register({
    name: 'goal',
    description: 'set or view the goal for a long-running task',
    input: { hint: '[<objective>|clear|edit <objective>|pause|resume]', images: true },
    handler: invocation => executeGoalCommand(ctx, invocation),
  })
}
```

Note the shape: no `ctx.effect` wrapper; the handler delegates to a plain `(ctx, invocation)` function; domain errors are converted to `{ kind: 'error', text }` rather than thrown (`:177-185`).

### 7.6 Minimal registration example

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'

export const name = 'command-mine'
export const inject = ['commands']

export function apply(ctx: Context): void {
  ctx.commands.register({          // already effect-scoped — do NOT wrap
    name: 'mine',
    description: 'show my plugin state',
    input: { hint: '[status|reset]' },
    handler: (invocation: CommandInvocation): CommandResult => {
      const arg = invocation.rawInput.trim().toLowerCase()
      if (arg !== '' && arg !== 'status') {
        return { kind: 'error', text: 'Usage: /mine [status]' }
      }
      return { kind: 'success', text: `agent: ${invocation.agent.session.id}` }
    },
  })
}
```

---

## 8. `ctx.approval` — requesting user approval before a side effect

**Service key:** `ctx.approval` · **Package:** `@deepseek-ai/dsh-user-approval` · **Path:** `packages/interaction/user-approval`

```ts
// packages/interaction/user-approval/src/index.ts:17-32
declare module '@deepseek-ai/cordis' {
  interface Context {
    approval: ApprovalService
  }

  interface Events {
    /**
     * Ask composed answerers for one decision. Return an outcome to claim the
     * request or call `next()`; failure yields the fail-closed default.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
     * @mode waterfall
     */
    'approval/request'(this: Scoped<ApprovalService>, req: ApprovalRequest, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome>
  }
}
```

### 8.1 Interface, verbatim

```ts
// packages/interaction/user-approval/src/index.ts:152-174
export interface ApprovalRequest {
  /** The agent on whose behalf the question is asked. */
  readonly agent: Agent
  /** The tool the question is about (presentation and audit). */
  readonly toolName: string
  /** The exact tool call being decided, when the asker has one. */
  readonly callId?: CallId
  /** The asker's human-readable explanation of WHY it is asking. */
  readonly reason?: string
  /** Aborting withdraws the question: the request settles 'cancelled' immediately. */
  readonly signal?: AbortSignal
}
```

```ts
// packages/interaction/user-approval/src/index.ts:94-97
export type ApprovalPolicy = 'ask' | 'never'
export const APPROVAL_POLICIES: readonly ApprovalPolicy[] = ['ask', 'never']

// packages/interaction/user-approval/src/index.ts:82
const OUTCOMES: readonly ApprovalOutcome[] = ['allowed-once', 'rejected', 'cancelled', 'unavailable']
```

```ts
// packages/interaction/user-approval/src/index.ts:192-344
export class ApprovalService extends Service {
  static Config: z<Config> = z.object({ policy: z.union(['ask', 'never'] as const).default('ask') })  // :193-195
  setPolicy(agent: Agent, policy: ApprovalPolicy): void                       // :226
  async request(req: ApprovalRequest): Promise<ApprovalOutcome>               // :257
  overrideOf(session: Session): ApprovalPolicy | undefined                    // :294
}

// module-level pure helpers
export function effectiveApprovalPolicy(events: readonly SessionEvent[]): ApprovalPolicy | undefined  // :112
export function setApprovalPolicy(session: Session, policy: ApprovalPolicy): void                     // :142
export { ApprovalRequestId }                                                                          // :78
export type { ApprovalOutcome }                                                                       // :79
```

### 8.2 Semantics that matter

**`'allowed-once'` is the only grant** (`index.ts:254`). There is no "always allow", no remembered grant, no scope broader than the one request. The package description says it plainly: *"one-shot permission decisions … fail-closed by default"*.

**Fail-closed is structural.** `decide()` (`index.ts:304-344`): an aborted signal → `'cancelled'`; a missing or throwing answerer → `'unavailable'`; a rogue non-vocabulary return → normalized to `'unavailable'` (`:325`); a throwing answerer *"must fail the QUESTION closed, not the caller's tool call open — the seam contains its callbacks"* (`:327-328`).

**Policy `'never'` short-circuits before dispatch** (`index.ts:307-312`), and the comment explains why it cannot be a listener: *"a listener registered with `prepend: true` after this service mounts would sit ahead of any gate LISTENER, so a listener-shaped gate cannot keep the documented promise that 'never' rejects deterministically regardless of registration order — only the service's own request path can."*

**`request()` requires an open turn and throws otherwise** (`index.ts:259-265`):

```ts
if (!hasOpenTurn(session.events)) {
  throw new Error(
    'approval.request() outside an open turn: the approval/asked + approval/decided audit pair '
    + 'must be turn-enclosed (a bare event between turns is crash-tail garbage on reload). '
    + 'Ask from inside the turn that needs the decision.',
  )
}
```

This is the single biggest gotcha for a plugin: **you cannot ask for approval from idle/background work.** Ask from inside the turn that needs the decision.

**Every ask is audited as a durable pair** on the requesting agent's session log — `approval/asked` then `approval/decided`, sharing one `ApprovalRequestId` (`index.ts:266-275`), both declared log-only and *"NOT a surface event"* (`:34-58`). A third event, `approval/policy` (`:67-72`), records policy switches; the last one is the session's override.

### 8.3 Scope / lifetime

One service instance; there is **no `registerProvider`**. Answerers compose by **listening to the `approval/request` waterfall**, scope-filtered by `dsh-scope` so an agent-scoped listener sees only that agent. The service injects a system-prompt context section `'approval:policy'` at order 115 (`index.ts:204-216`) so the model is told the current stance — and does so *after* retained history so *"switching policy does not rewrite the stable system-prompt cache prefix"* (`:202-203`).

### 8.4 Minimal snippet — a plugin gating a config write

```ts
export const name = 'my-config-writer'
export const inject = ['approval', 'fs']

export function apply(ctx: Context) {
  ctx.on('my/write-config', async (agent: Agent, path: string, body: string, signal: AbortSignal) => {
    const outcome = await ctx.approval.request({
      agent,                                  // must be a live agent inside an OPEN TURN
      toolName: 'my_write_config',
      reason: `Writing deployment config to ${path}`,
      signal,
    })
    if (outcome !== 'allowed-once') {         // 'rejected' | 'cancelled' | 'unavailable'
      return { ok: false, outcome }           // fail closed — do NOT retry another way
    }
    await ctx.fs.write(path, body)
    return { ok: true }
  })
}
```

To *answer* approvals instead (a UI plugin):

```ts
ctx.on('approval/request', async (req, next) => {
  if (req.toolName !== 'my_write_config') return next()   // decline to claim
  return 'allowed-once'
})
```

---

## 9. session-query — historical session search, and can a plugin read it OFFLINE?

**Service key:** `ctx.sessionQuery` · **Contract:** `@deepseek-ai/dsh-session-query` (`packages/session-query/session-query`) · **Backend:** `@deepseek-ai/dsh-session-query-sqlite` (FTS5) · **Model-facing tools:** `@deepseek-ai/dsh-tool-session-query`

```ts
// packages/session-query/session-query/src/index.ts:68-72
declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionQuery: SessionQueryEngine
  }
}
```

### 9.1 Full interface, verbatim

```ts
// packages/session-query/session-query/src/index.ts:74-82
/**
 * Unified live-preferred session query service.
 *
 * Exact reads, filters, and traces are backend-independent concrete behavior.
 * A backend implements full-text observation, reconciliation, ranking, cursor
 * generations, and query execution on the same `ctx.sessionQuery` service.
 */
export abstract class SessionQueryEngine extends Service {
  static inject = ['sessions']
```

Two **abstract** members the backend supplies:

```ts
// :113-127
abstract searchSessions(
  request: SessionSearchRequest,
  exec?: SessionSearchExecContext,
): Promise<SessionSearchPage<SessionSearchHit>>

abstract searchEvents(
  request: SessionEventSearchRequest,
  exec?: SessionSearchExecContext,
): Promise<SessionEventSearchPage>
```

Eleven **concrete, backend-independent** members:

```ts
// packages/session-query/session-query/src/index.ts
listSessions(signal?: AbortSignal): Promise<SessionRecord[]>                                          // :134
async readSession(sessionId: SessionId): Promise<SessionLogSnapshot>                                  // :144
async filterSessions(filters: readonly SessionResultFilter[], signal?: AbortSignal): Promise<SessionRecord[]>  // :159
async readTitle(sessionId: SessionId, signal?: AbortSignal): Promise<SessionTitleSnapshot | undefined> // :173
async readTitleSnapshot(sessionId: SessionId, signal?: AbortSignal): Promise<SessionTitleObservation>  // :186
async readTitleSnapshots(...)                                                                          // :204
async listEvents(sessionId: SessionId): Promise<SessionEventRecord[]>                                  // :222
async filterEvents(...)                                                                                // :233
async readSurface(sessionId: SessionId): Promise<SessionSurfaceSnapshot>                               // :263
async traceSession(sessionId: SessionId, signal?: AbortSignal): Promise<SessionLineageTrace>           // :279
async traceEvent(request: SessionEventTraceRequest, signal?: AbortSignal): Promise<SessionEventTraceObservation>  // :292
async readEvent(request: SessionEventReadRequest, signal?: AbortSignal): Promise<SessionEventWindow>   // :307
```

Config (`config.ts`) validates `readWindowMax` (non-negative integer) and `persistedInspectConcurrency` (positive safe integer), both throwing `SessionQueryError('…', 'SESSION_QUERY_INVALID_CONFIG')` (`index.ts:89-104`). Useful pure exports for offline work: `extractSessionEventText`, `buildSessionEventRecords`, `buildSessionEventSearchDocuments`, `compileSessionTextFilter`, `filterSessionEventDocuments`, `filterSessionResults`, `materializeSession*ResultFilters`, `assertSessionHeadersCompatible` (`index.ts:57-66`).

`readSession` replay-**validates**: it calls `Session.create(sessionId, loaded.events, loaded.header)` (`:146`) and throws on header incompatibility or replay failure, then returns cloned data *without making the session live*.

### 9.2 Offline use: **NO standalone reader exists**

`SessionQueryEngine` is an `abstract class … extends Service` whose constructor is `constructor(ctx: Context, config: Config = {})` calling `super(ctx, 'sessionQuery')` (`:87-88`), and it declares `static inject = ['sessions']` (`:82`). Its whole corpus layer is `new SessionCorpus(ctx, persistedInspectConcurrency)` (`:104`).

⇒ **There is no constructor path that does not take a live Cordis `Context` with `ctx.sessions` mounted.** A plugin cannot `new` a reader against a bare directory. What "offline" *is* available:

- **Outside a live *conversation*, yes.** The corpus is **live-preferred but persistence-backed**: `listSessions`, `readSession`, `listEvents`, `filterSessions`, `traceSession` all read persisted sessions that have no live Agent. So a plugin running in the same process can query *historical* sessions freely — it simply must be a plugin in a booted composition, not a standalone script.
- **Outside a live *process*, no.** To read a `$DSH_HOME` corpus from an external tool you must boot a minimal composition (e.g. the `headless` profile) that mounts `sessions` + `sessionPersistence` + a `sessionQuery` backend, then call the service. There is no exported `openSessionStore(path)` equivalent.

### 9.3 Per-task durations: YES — but from `sessionStats`, not session-query

`session-query` itself exposes no duration or token aggregate. Those live in a **separate projection**, `@deepseek-ai/dsh-session-stats` (`packages/session/session-stats`, `export const inject = ['sessionProjections']`, `src/index.ts:20`):

```ts
// packages/session/session-stats/src/types.ts:22-39
export interface SessionStatsProjection {
  /** Distinct turns carrying at least one closed step (`step/end`); rejected or empty turns are uncounted. */
  turns: number
  /** Closed steps (`step/end` events) — completed, failed, and cancelled steps alike. */
  steps: number
  /** Summed model wall time (`step/start` → `assistant/message`) over steps that assembled a message. */
  llmMs: number
  /** Summed tool wall time over `tool/call` → `tool/result` pairs matched by callId. */
  toolMs: number
  /** Summed first-token latency (`step/start` → first non-empty delta chunk) over `ttftSteps`. */
  ttftMs: number
  /** Steps carrying a recorded first token. */
  ttftSteps: number
  /** Summed decode wall time (first token → `assistant/message`) over steps that also report output tokens. */
  decodeMs: number
  /** Summed provider output tokens over the same decode-timed steps. */
  decodeTokens: number
}
```

It registers as projection key `sessionStats` (`types.ts:41-46`). Note *"Counts and wall times all fold from the complete durable log; every field is 0 until its first contributing event lands"* (`:16-18`).

**So the recipe for "per-task token totals and durations over history" is a three-way join, all keyed on `SessionId`:**

1. `ctx.sessionQuery.listSessions()` / `filterSessions()` / `traceSession()` → which sessions, and their lineage.
2. Projection **`tokenUsage`** (§2.2) → `uncachedInputTokens` / `outputTokens` / `cacheReadTokens` / `cacheWriteTokens`.
3. Projection **`sessionStats`** → `turns` / `steps` / `llmMs` / `toolMs` / `ttftMs` / `decodeMs` / `decodeTokens`.

For **cold** sessions, read those projections through `ctx.sessionProjectionCache` (durable per-session checkpoints) with the persistence-tail-replay cold-read ladder — the same mechanism `ctx.subagents.listChildren()` uses. Both projections are registered as *optional children*, so a composition that omits `sessionProjections` gets neither.

### 9.4 MONEY CHECK — definitively absent

A whole-tree grep over `packages/**/*.ts` (excluding `node_modules/` and built `lib/`) for `\busd\b`, `\bcents?\b`, `\bdollar`, `costPerToken`, `price_per`, `pricePer`, `billing`, `\bcurrency\b`, `\bmonetar` returns **58 raw hits and ZERO genuine money concepts.** Every hit is one of four false positives:

1. **`currency` is DSH jargon for a props contract** — by far the most common. E.g. *"Owner currency of the details panel's Tool output renderer"* (`packages/client/ui-conversation/src/client/contract/slots.ts:433`), *"the chain currency"*, *"the InputZone currency source"*. It means "the shared unit of exchange between a slot owner and its registrants", never money. ~45 of the 58 hits.
2. **`concurrency` substring-matching `currency`** — e.g. `imageCompressionConcurrency` (`packages/attachment/attachment-local/src/index.ts:46-182`).
3. **`dollar` = the `$` character** in the markdown math tokenizer — `codes.dollarSign`, `sameLineDollarMathFlow` (`packages/client/ui-primitives/src/markdown/mathCompatibility.ts:149-341`) and a PowerShell `$null` test string.
4. **`billing` in prose or a quoted upstream error** — the OpenAI 429 text *"You exceeded your current quota, please check your plan and billing details"* (`packages/llm/llm/tests/service.spec.ts:126`, `packages/llm/llm-pi-ai/tests/convert.spec.ts:795`), and a comment about API-key tenancy (`packages/llm/llm-pi-ai/src/index.ts:174`).

Similarly, `price` / `pricing` appear **only as a metaphor for token estimation** — the token meter "prices" a node in tokens. See `packages/compaction/compaction-tool-result-pruner/src/index.ts:45-46`: *"The token meter prices each shadowed node for its logged shadow-price event, so pruning genuinely requires the pricing capability."* No rate, no unit, no multiplier.

The decisive citation is the token meter disowning the concept outright:

```ts
// packages/llm/token-meter/src/projection.ts:20-29
/**
 * Approximate context occupancy for a status display.
 *
 * The fields, when present, are deliberately NOT one atomic request
 * observation: each is a last-wins record of a different moment. Switching
 * models can therefore pair a fresh capacity with the previous route's
 * pressure until the next request reports usage. This is an intentional trade
 * — the value is a user-facing reference, not a billing or gating input. See
 * the token-meter README for the full rationale.
 */
```

**Verdict, stated plainly: there is no price table, no currency type, no cost field, no rate, and no billing concept anywhere in the DeepSeek Harness.** Accounting stops at four integer token buckets. A plugin that needs money must own the price table itself and fold it over `tokenUsage`.

---
