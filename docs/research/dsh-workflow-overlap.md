# DSH Workflow Family vs. Legion Durable Strategy Runs

Scope: DSH `0.1.0-rc.7`, packages `workflow/workflow`, `workflow/workflow-worker-thread`, `workflow/tool-workflow`, `client/ui-workflow-run`; Legion `src/durable-run/`.

## Verdict

**(c) No meaningful overlap — the two solve different problems. Legion should finish its own path.**

The deciding fact, and it is not a judgement call: **the DSH workflow seam has exactly one method, `start()`, and no resume, load, list, or inspect entry point.** `packages/workflow/workflow/src/index.ts:157-168` declares `abstract class WorkflowEngine extends Service` with `abstract start(request: WorkflowStartRequest): WorkflowRun` and nothing else. A run is identified by a `randomUUID()` minted at `workflow-worker-thread/src/index.ts:148` and held only in a live JS object graph. There is no API by which any caller — plugin or host — could name an existing run after a restart, because no API accepts a `WorkflowRunId` as input. Anything a "lowering onto `ctx.workflowEngine`" plan needs would have to be added to the seam first, at which point it is Legion's design being built inside DSH, not reuse.

"Durable" in `@deepseek-ai/dsh-client-ui-workflow-run` refers **only to a durable UI record**, not resumable execution. Stated plainly because it decides everything: the package renders a Conversation Node from four log-only session events, and its `client/workflow-definition.ts:153-174` reads `tool-workflow/run-start`, `agent-start`, `agent-end`, `run-end` purely to draw a nested member disclosure. Nothing reads them back to restore execution.

## 1. Run model

A caller submits a **JavaScript source string plus a JSON meta block** — `WorkflowStartRequest { script, meta, args?, parent: Agent, signal? }` (`workflow/src/runtime-types.ts:19-34`). Note `parent: Agent`: the request is typed against a *live in-memory object*, so it is unserializable by construction and cannot be reconstructed from a log.

Execution: `WorkerThreadWorkflowEngine.start()` parses the body (`index.ts:143-146`) and constructs a `WorkerRun` that runs the script in a `node:vm` context on a fresh worker thread. The module header calls the thread "containment rather than a security boundary" (`workflow-worker-thread/src/index.ts:1-6`).

The unit of work is **one `agent()` call**, bridged to `ctx.subagents`. Children are spawned imperatively by the script; there is **no graph** — the "DAG" is whatever control flow the model wrote. `meta.phases` are explicitly non-structural: "progress vocabulary only … they impose no execution structure" (`workflow/src/types.ts:25-27`).

Concurrency is a FIFO slot semaphore inside the worker: `runtime.ts:223-228` acquires against `limits.maxConcurrentAgents`, defaulting to `min(16, max(1, cores - 2))` (`index.ts:151-153`). Bounds are `maxTotalAgents` (default 1000, a "runaway-loop backstop", `runtime.ts:256-259`) and `maxItemsPerCall` (4096).

Legion's Strategy Run is the opposite shape: a **typed, validated DAG IR** (`src/durable-run/graph.ts`, `validate.ts`) with tasks, attempts, accepted artifacts, and admission control (`admission.ts`), where the plan is data that survives the process rather than a closure that does not.

## 2. Durability — not durable

The engine writes **nothing**. A grep for `persist|storage|append|journal|projection|restore|resume|recover|checkpoint` across `packages/workflow/**` returns no persistence in `workflow/` or `workflow-worker-thread/` at all; every hit is in `tool-workflow` or is an unrelated comment.

The only writes are in the tool layer, `tool-workflow/src/index.ts:73-131`, and they are deliberately best-effort display records:

- `append()` (line 82) narrows `session.append` with the comment *"These four package-owned events are all log-only."*
- On failure it does not fail the run: `ctx.logger.warn(\`tool-workflow: disabled durable record after ${type} append failed\`)` and returns `false` (lines 89-92); callers then `active.delete(info.id)` (lines 105, 115) — **recording is switched off while execution continues**. A durable runtime cannot discard its journal and keep going.

There is **no restoring code to quote**, because none exists. Execution state lives in `WorkerRun` and the worker's vm heap; a process restart loses the run with no record that it was mid-flight. Contrast Legion `src/durable-run/replay.ts:22-31`, which rebuilds state from a checkpoint gated on `stateVersion === LEGION_RUN_PROJECTION_STATE_VERSION`.

## 3. Events and projection

Two disjoint event families, **neither projected**:

- **Runtime events** (`workflow/src/index.ts:36-90`): `workflow/start`, `workflow/phase`, `workflow/log`, `workflow/agent-start`, `workflow/agent-end`, `workflow/end`. Every one is annotated `@mode emit` — fire-and-forget Cordis events, not session events. The seam doc says "observe-only lifecycle events never expose run control" (`index.ts:2-3`), and `emitWorkflowEvent` (line 175) swallows every listener failure.
- **Session events** (`tool-workflow`): the four `tool-workflow/*` record types (`index.ts:53-58`).

**No `sessionProjections.register()` call exists anywhere in `packages/workflow/**` or `packages/client/ui-workflow-run/**`.** The registry exists (`packages/session/session-projection/src/index.ts:220`); the workflow family simply does not use it. `tool-workflow/src/invariant.ts:138` does a linear `session.events.filter(isWorkflowRecordEvent)` scan — an integrity check, not a projection.

Legion registers `legionRunProjection` with a versioned schema at `src/durable-run/projection.ts:342-349`, over eight typed events (`run-state`, `plan-state`, `task-state`, `attempt-state`, `mail-state`, `milestone`, `decision`, `continuation-state`; see `projection.ts:68-109`). DSH has four untyped-by-projection display records. The ratio understates it: Legion's carry `record` payloads that *are* the state; DSH's carry a label and an outcome enum.

## 4. Exclusion — nothing, and single-process by construction

DSH has no lock, no fence, no epoch, no owner token. It does not need one, because it **assumes single-process, single-holder ownership** in the type system. Naming the code:

- `WorkflowStartRequest.parent: Agent` (`runtime-types.ts:31`) — a live host object.
- `WorkflowRun` is documented "Holder-owned live workflow … consumers must call idempotent `dispose()`" (`runtime-types.ts:36-49`). Ownership is a JS reference; a second process cannot obtain one.
- `index.ts:170-171` captures `runCtx`/`subagents` at start specifically so an in-process HMR unload cannot break the run — the concern is *module reload*, not a competing process.
- `tool-workflow/src/index.ts:291`, `const recordsRun = exec.parent === undefined`, records only top-level runs — a nesting filter, not exclusion.

There is consequently no stale-result rejection: results arrive over a worker `MessagePort` correlated by RPC id, a channel that cannot outlive the process. Legion's `RunCoordinationAdapter` (`src/durable-run/lease.ts:147`) with `materializeRunLease`/`LeaseAcquireResult` and `result-acceptance.ts` address a problem DSH never has.

## 5. Extension seams

Registrable: **the engine itself.** `WorkflowEngine` is an abstract Cordis `Service` on `ctx.workflowEngine` (`workflow/src/index.ts:31-34, 157-160`), so a plugin may replace the whole engine — `workflow-worker-thread` is one implementation. A plugin may also listen to `workflow/*` events and register subagent providers (routed by name, `workflow-worker-thread/src/index.ts:85`).

Closed: **everything else.** There is no workflow-definition registry (a workflow is a string the model writes at call time, never a registered artifact), no run-driver seam, no persistence backend seam. To contribute durability a plugin must reimplement the entire engine — and even then the seam gives it no vocabulary to expose resume, since `start()` is the only method.

## 6. Overlap table

| Capability (Legion claim) | DSH workflow family | Evidence |
|---|---|---|
| Bounded DAG activation | **No** — imperative script, no graph; phases explicitly non-structural | `types.ts:25-27`; `graph.ts` vs. none |
| Typed journal events | **Partial (display only)** — 4 log-only records, discardable on write failure | `tool-workflow/src/index.ts:53-58, 89-92` |
| Projection-derived state | **No** — no `sessionProjections.register()` in the family | absent; cf. `projection.ts:342-349` |
| Replay | **No** — no code reads events back into state | no restore path exists |
| Crash recovery | **No** — state is vm heap + `WorkerRun` | `workflow-worker-thread/src/index.ts:172` |
| Mailbox / steering | **No** — `args` is fixed at start; events are emit-only | `runtime-types.ts:24`; `index.ts:2-3` |
| PlanDelta | **No** — no plan object to amend | `plan-delta.ts` vs. none |
| Continuations | **No** — `start()` returns a promise that must be awaited in-process | `runtime-types.ts:40-49` |
| Stair-step | **No** — no stage-boundary context contract | `stair-step.ts` vs. none |
| At-least-once + fenced acceptance | **No** — exactly-once-in-process, no fence | `result-acceptance.ts` vs. none |
| Run control: cancel | **Yes** — `run.cancel()`, in-process holder only | `runtime-types.ts:46` |
| Run control: inspect / resume / steer | **No** — seam has only `start()` | `workflow/src/index.ts:168` |
| Concurrency bounding | **Yes** — FIFO semaphore + total/item caps | `runtime.ts:223-259` |
| Child fan-out onto subagents | **Yes** | `workflow-worker-thread/src/index.ts:85` |

Two of fourteen rows are genuine overlap, and both are ephemeral-execution mechanics Legion's v1.0 path already has.

## 7. Defending (c), and what (a) would lose

DSH's workflow engine is a **model-authored ephemeral fan-out sandbox**: a script the LLM writes at call time, run once in a vm, whose value is returned to the same tool call that started it. Legion's Strategy Run is a **declaratively compiled, operator-authored durable controller**: a validated DAG whose facts outlive the process. They share a substrate (`ctx.subagents`) and nothing above it.

Under (a) — lowering onto `ctx.workflowEngine` and deleting `src/durable-run` — Legion would lose every durable property it exists to provide: crash recovery, replay, projection-derived state, fenced acceptance, steering, PlanDelta, continuations, and stair-step. It would additionally violate Legion's own architecture rules, since compiling a Strategy to a JavaScript source string is precisely the "arbitrary callbacks" and strategy-name branching `AGENTS.md` forbids, and it would move typed, validated IR into an unvalidatable code string.

(b) is tempting but does not survive contact with the source: the pieces that *look* redundant — concurrency bounding, child fan-out — are not in `src/durable-run` anyway; they are `admission.ts` policy over Host-owned subagents. There is no Legion file whose deletion is justified by an upstream equivalent.

**This does not vindicate the current blocker.** Legion's durable run cannot execute because it awaits a `legionRunCoordination` Host service nothing provides, and this analysis confirms DSH will not provide it — the workflow family assumes single-process ownership and has no lock or fence to borrow. Per `AGENTS.md` ("Never invent a Host service Legion could obtain … Mount it as a separate package"), the coordination service belongs in a **companion package**, not in the Legion plugin. The one upstream primitive worth checking first is `@deepseek-ai/dsh-atomic-write`'s cross-process `withFileLock`, which supplies mutual exclusion but documents itself as atomic and **not durable** — so a fence epoch surviving crash still needs its own barrier.

## 8. Experiment

Not applicable: the verdict is (c). The one-day experiment worth running instead **falsifies (c)** if it can:

Write a throwaway plugin that calls `ctx.workflowEngine.start()` with a script that logs a marker, then hard-kills the process mid-run (`SIGKILL`, after the first `agent()` settles). On restart, attempt to observe or resume that run through any public DSH API. Success requires naming the run — so the experiment's real question is whether *any* method accepts a `WorkflowRunId`. Grep the seam: if `start()` remains the only method, (c) is proven in minutes and the rest of the day goes to scoping the coordination companion package. If a resume path is found, (c) is dead and the analysis must be redone.
