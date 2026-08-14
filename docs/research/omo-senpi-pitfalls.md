# OMO / Senpi pitfalls and Legion invariants

> Evidence baseline (immutable):
>
> - Oh My OpenAgent: [`038ed0cbbefe2b40677b63867aeea0d16bc303e0`](https://github.com/code-yeongyu/oh-my-openagent/commit/038ed0cbbefe2b40677b63867aeea0d16bc303e0)
> - Senpi: [`779c065d3e784168f2bf277112e2351f9d0d1424`](https://github.com/code-yeongyu/senpi/commit/779c065d3e784168f2bf277112e2351f9d0d1424)
>
> Source code at those commits and first-party issue reports are treated as evidence. Issues may describe later releases; they are linked as incident reports, not silently projected back onto the pinned commits. “Legion invariant” means a prevention rule for dsh-legion, not a claim that Legion should import the corresponding runtime.

## 1. Split ownership

**Trigger.** One behavior is driven by more than one layer: provider fallback plus host fallback; native/client/skill tool exposure; adapter continuation plus core Goal; task manager state plus child-session state.

**Root cause.** OMO’s Senpi adapter consumes core model-selection events while adding product directives and notices, and its task runtime separately owns child lifecycle. Senpi likewise has provider-native and extension-owned paths. A feature can therefore acquire two policy owners even when code is cleanly packaged. The adapter/core boundary is visible in OMO’s component composition and fallback-architect registration ([`compose.ts#L53-L120`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-senpi/src/extension/compose.ts#L53-L120), [`fallback-architect/index.ts#L64-L99`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-senpi/src/components/fallback-architect/index.ts#L64-L99)). Duplicate task dispatch has produced parallel sessions mutating the same worktree ([OMO #6487](https://github.com/code-yeongyu/oh-my-openagent/issues/6487)).

**Impact.** Duplicate work and billing, contradictory UI/state, late results overwriting the active owner, or concurrent file mutation.

**Legion invariant.** Every side effect and durable fact has exactly one owner. Legion may select policy and record provenance, but DSH remains the only owner of child/session lifecycle, settlement, security, compaction, and provider retry. Cross-layer consumers receive typed facts, never a second mutation path. Admission uses an idempotency key and an atomic `not-started -> reserved -> dispatched` transition.

## 2. Prompt / hook duplication

**Trigger.** A compatibility hook, continuation component, child resource discovery, or provider replay injects a directive already present in system prompt/history; extension-origin messages are reclassified as user input.

**Root cause.** Prompt state is spread across a dynamic prompt assembler, adapter hooks, hidden continuation messages, child-discovered resources, and provider continuity. Senpi deliberately centralizes its core prompt in one ordered assembler ([`dynamic-prompt/build.ts#L61-L121`](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/dynamic-prompt/build.ts#L61-L121)), while OMO’s Senpi child uses a minimal loader specifically to prevent parent/project extension and prompt recursion ([`minimal-resource-loader.ts#L11-L48`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/senpi-task/src/senpi/minimal-resource-loader.ts#L11-L48)). Real incidents include compounded injected directive blocks ([Senpi #516](https://github.com/code-yeongyu/senpi/issues/516)) and project rules disappearing or arriving only once on some provider lanes ([Senpi #541](https://github.com/code-yeongyu/senpi/issues/541)).

**Impact.** Context bloat, conflicting instructions, self-reinforcing continuation, cache misses, and repeated side effects.

**Legion invariant.** One pure prompt compiler owns ordered section IDs. A logical directive has a stable ID, scope, generation, and replacement policy; it is never appended blindly. Child capability/prompt inheritance is explicit and deny-by-default. Every injected message carries provenance, and trigger detectors exclude non-user origins.

## 3. Fallback, cost, and cache

**Trigger.** A timeout, quota/refusal/billing error, or smaller fallback model causes retry or route switching at large context.

**Root cause.** Rendered error strings substitute for typed failure causes; retry and fallback have independent budgets; request reconstruction drops `cache_control` or moves breakpoints; provider fallback and host fallback both run; model switch skips context re-admission. Senpi’s controller distinguishes transient/refusal/hard-error/billing and tracks attempted selectors ([`retry-fallback/controller.ts#L16-L175`](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/retry-fallback/controller.ts#L16-L175)), yet a stream-start retry incident measured 5.7× cost when cache metadata vanished or shifted ([Senpi #723](https://github.com/code-yeongyu/senpi/issues/723)); intermittent cache misses resent roughly 178K tokens 18 times ([Senpi #589](https://github.com/code-yeongyu/senpi/issues/589)).

**Impact.** Retry storms, surprise spend, repeated full-history billing, route thrash, or immediate overflow on a smaller fallback model.

**Legion invariant.** Freeze one candidate chain per operation. Use typed causes and one global attempt/deadline/token/cost budget across retry and fallback. Automatic replay requires `replaySafe=true`; cancellation admits no new attempt. A same-route retry preserves a canonical request/cache digest and stable cache boundaries. Every model switch re-runs capability and context admission. Explicit caller/deployment choice outranks recommendation and fallback.

## 4. Goal loops

**Trigger.** A provider returns account exhaustion as an ordinary assistant `stop`, a continuation monitor sees no terminal success, or paused/stopped work is still considered continuable.

**Root cause.** “Turn ended” is confused with “objective can make progress”; continuation guards are ephemeral or reset by ordinary user input; no hard round/cost cap exists. Senpi classified account exhaustion as a clean stop and repeatedly auto-continued ([Senpi #748](https://github.com/code-yeongyu/senpi/issues/748)); an earlier report documents unbounded token consumption and self-reinforcing Goal output ([Senpi #447](https://github.com/code-yeongyu/senpi/issues/447)). OMO’s Senpi continuation also treated paused work as continuable and could re-arm after explicit stop ([OMO #6752](https://github.com/code-yeongyu/oh-my-openagent/issues/6752)).

**Impact.** Infinite requests, ignored stop intent, repeated side effects, continuity payload growth, and inability to distinguish blocked from active work.

**Legion invariant.** Goal continuation requires all of: active status, explicit armed state, fresh evidence of progress, remaining round/time/token/cost budget, and a non-terminal typed provider outcome. `paused`, `blocked`, `complete`, user stop, and cancellation are durable gates. Resume is explicit; ordinary messages do not re-arm. One objective revision can arm at most one next continuation.

## 5. Stream stall

**Trigger.** The provider stream becomes silent after a tool result or before first byte while the UI still reports “working.”

**Root cause.** Only stream-start timeout is guarded, or liveness is inferred from an unresolved promise; there is no mid-stream idle watchdog and no guaranteed terminal event. A Senpi turn stayed silent for more than 31 minutes after a successful tool result ([Senpi #683](https://github.com/code-yeongyu/senpi/issues/683)).

**Impact.** A turn and its lease remain resident forever; users cannot tell slow work from dead work; goals and parent tasks never settle.

**Legion invariant.** Every attempt has distinct first-byte, inter-event idle, and total deadlines. Tool execution time is separately bracketed so it does not look like provider silence. Timeout aborts the exact generation, emits one typed terminal outcome, releases all leases, and only then enters bounded replay-safe fallback. `started` and `terminal` events must pair; terminal is first-wins.

## 6. Compaction

**Trigger.** A large conversation crosses admission thresholds, speculative summary races with new activity, or summary requests themselves overflow/time out.

**Root cause.** Multiple compaction owners, stale summary publication, one-history-item-at-a-time overflow retries, per-attempt rather than aggregate budgets, or broken tool-call/result pairing. Senpi has explicit policy and stale-publication fences ([`compaction/policy.ts#L97-L130`](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/extensions/builtin/compaction/policy.ts#L97-L130), [`compaction/index.ts#L309-L376`](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/extensions/builtin/compaction/index.ts#L309-L376)), but an unbounded overflow-retry incident burned about 13.5M tokens without landing a summary ([Senpi #650](https://github.com/code-yeongyu/senpi/issues/650)); another incident produced orphaned tool use ([OMO #6605](https://github.com/code-yeongyu/oh-my-openagent/issues/6605)).

**Impact.** Hours of billed summarization, wedged admission, stale/phantom context, or provider-rejected transcripts.

**Legion invariant.** DSH compaction is the sole owner. Any speculative artifact is published only after validating session, branch/anchor, complete model identity, and generation. Aggregate attempts, wall clock, input/output tokens, and cost are hard-bounded with a circuit breaker. Start/end telemetry pairs for every attempt. Post-compaction validation preserves tool call/result pairs and immutable objective/evidence anchors.

## 7. Catalog LKG (last-known-good)

**Trigger.** The first dynamic model-catalog fetch fails, is aborted, or returns empty.

**Root cause.** `{}` is treated as a valid cache rather than “never fetched”; fetch failure has no durable diagnostic or retry state. Senpi’s Ollama catalog could remain empty forever, making valid selectors look invalid ([Senpi #839](https://github.com/code-yeongyu/senpi/issues/839)).

**Impact.** Models disappear, fallback validation lies, a healthy provider appears unsupported, and recovery requires manual cache surgery.

**Legion invariant.** Catalog state is one of `never_fetched | fresh | stale_lkg | fetch_failed | empty_verified`; empty is not success unless the provider explicitly verified it. Preserve and serve LKG on refresh failure with age/provenance diagnostics. Route admission snapshots a catalog generation; refresh cannot retroactively alter an in-flight chain.

## 8. Config layering

**Trigger.** User, project, harness, profile, migration, and schema-default layers overlap; a lower layer omits a key, supplies an empty tombstone, or contains executable settings.

**Root cause.** Defaults are materialized before merge, presence is lost, arrays/tombstones use inconsistent semantics, runtime and doctor parse different schemas, or source provenance is discarded. OMO’s pinned loader has an explicit layer order and diagnostics ([`loader.ts#L76-L182`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-config-core/src/loader/loader.ts#L76-L182), [`resolution.ts#L60-L85`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-config-core/src/loader/resolution.ts#L60-L85)); its merge code also rejects prototype-pollution keys ([`merge.ts#L1-L49`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-config-core/src/loader/merge.ts#L1-L49)). Later schema/runtime drift nevertheless made doctor contradict runtime ([OMO #6606](https://github.com/code-yeongyu/oh-my-openagent/issues/6606)).

**Impact.** Explicit user choices vanish, permission widens, doctor gives false reassurance, or an upgrade loads a different effective route.

**Legion invariant.** Parse each layer into a presence-preserving partial IR; merge authored keys using schema-declared semantics; materialize defaults once at the end. Preserve leaf provenance, deletion tombstones, normalization diagnostics, and a canonical effective-config digest. Runtime, prompt, tool schema, doctor, and UI consume the same compiled view. Project/profile policy may only narrow host authority.

## 9. Installer transaction

**Trigger.** Installation/migration touches settings, artifacts, launchers, caches, and legacy paths; an operation fails halfway or crosses filesystems.

**Root cause.** Mutation starts before complete preflight; `rename` is assumed atomic across devices; receipts do not enumerate owned files; cache activation and config activation are separate uncoordinated steps. OMO’s migration transaction has lease/transaction machinery ([`migration/transaction.test.ts#L43-L83`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-config-core/src/migration/transaction.test.ts#L43-L83)), while a Docker bind-mount migration still hit `EXDEV` and silently ignored later legacy edits ([OMO #6574](https://github.com/code-yeongyu/oh-my-openagent/issues/6574)).

**Impact.** Config points at missing artifacts, old and new editions both load, rollback is impossible, or the installation appears healthy but executes stale code.

**Legion invariant.** Installation is `preflight -> stage -> verify -> atomic switch -> receipt`; failure before switch changes no active state, and failure after switch rolls back from the receipt. Same-volume atomic replace is used where available; cross-device paths use verified copy/fsync/replace semantics. The receipt records scope, canonical paths, versions, hashes, prior state, and exact ownership for uninstall. Packed-artifact activation is probed before commit.

## 10. Path and security

**Trigger.** A repository contributes hook commands, extension paths, state directories, symlinks, globs, or cleanup PIDs; Windows path/drive behavior differs from POSIX.

**Root cause.** Trust is inferred from location or tool name rather than the canonical effective action; string-prefix containment is used instead of real path resolution; shell commands inherit ambient environment; cleanup targets are selected by broad process matching. OMO allowed repository `.claude/settings.json` to execute `UserPromptSubmit` shell hooks without project trust ([OMO #6604](https://github.com/code-yeongyu/oh-my-openagent/issues/6604)). Senpi has had cross-drive project-root traversal fixes ([Senpi #518](https://github.com/code-yeongyu/senpi/issues/518)) and a process-cleanup report where broad `pgrep` could terminate unrelated processes ([Senpi #823](https://github.com/code-yeongyu/senpi/issues/823)).

**Impact.** Local command execution, workspace escape, credential/environment exposure, deletion outside owned roots, or killing unrelated processes.

**Legion invariant.** DSH sandbox/approval is the sole authority. Canonicalize existing ancestors, resolve symlinks, compare path components with platform semantics, and fail closed on ambiguity. Approval binds user, canonical workspace, action digest, referenced-target digest, environment allowlist, and generation; any change re-prompts. Cleanup uses exact spawned-process identity and owned-artifact manifests—never broad name/PID scans or unvalidated persisted paths.

## 11. Stale context

**Trigger.** Reload, session replacement, model switch, compaction, fallback, or async completion occurs after the context that started it is no longer current.

**Root cause.** A closure retains an ExtensionContext or branch summary beyond its fiber/generation; only model ID (not provider/variant/branch/anchor) is compared; transcript summaries are treated as authoritative external facts. Senpi’s loader explicitly invalidates old extension contexts on replacement ([`extensions/loader.ts#L252-L301`](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/extensions/loader.ts#L252-L301)). Long-session evidence shows phantom child completion, synthetic tool results, and undelivered replies across compaction ([Senpi #561](https://github.com/code-yeongyu/senpi/issues/561)); OMO also reports the original objective being lost after updates plus compaction ([OMO #6756](https://github.com/code-yeongyu/oh-my-openagent/issues/6756)).

**Impact.** Old work mutates a new session, false evidence is accepted, objectives disappear, and user-visible state diverges from Git/files/task records.

**Legion invariant.** Every asynchronous operation carries `sessionId + operationId + attemptEpoch + ownerGeneration + branchAnchor`. After every `await`, commit revalidates the full identity and active AbortSignal. Stale completions are audit-only. Summaries are lossy hints; completion and resume re-check typed receipts and external state. The original objective/deliverable contract is immutable except through explicit redirect.

## 12. Task status, residency, lease, TTL, and exactly-once

### 12.1 Status is not residency

**Trigger.** A task is logically running but its process is detached/persisted-only, or it is terminal while a resident handle still exists.

**Root cause.** One `running` boolean is made to represent logical state, in-memory/process residency, notification delivery, and capacity ownership. OMO’s task record separates `status` and `residency_state` ([`state/types.ts#L1-L39`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/senpi-task/src/state/types.ts#L1-L39)).

**Impact.** Ghost slots, lost resumability, terminal tasks rerun, or UI that cannot explain detached work.

**Legion invariant.** Treat logical outcome, residency, connection, notification, and admission lease as orthogonal axes. Legion reads DSH-native facts and stores only a bounded projection; it does not create a second child-state machine.

### 12.2 Lease fencing and revival

**Trigger.** Two hosts/reconcilers resume the same persisted task, a lease expires during work, or an old owner completes after takeover.

**Root cause.** Lease expiry is mistaken for ownership transfer; takeover lacks expected-owner CAS and generation fencing; capacity reclamation and new admission are conflated. OMO’s resume contract requires parent-session scoping, renewable ownership, exact re-resolution, and no terminal rerun ([`senpi-task/AGENTS.md#L86-L100`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/senpi-task/AGENTS.md#L86-L100)).

**Impact.** Duplicate execution, concurrent writes, late-owner overwrite, or leaked capacity.

**Legion invariant.** Any Legion-owned admission lease is renewable and fenced by monotonic epoch plus expected-owner CAS. Expiry permits a takeover attempt, not a write. Commit/release must match lease identity. DSH alone owns actual child revival.

### 12.3 TTL is a two-phase delete

**Trigger.** Cleanup races revival, an undelivered completion, a live owner, or open Windows handles.

**Root cause.** Scan and delete are separated without lock-time revalidation; terminal status is assumed sufficient for deletion. OMO’s task TTL path revalidates and tombstones before cleaning artifacts ([`lifecycle/ttl.ts#L6-L57`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/senpi-task/src/lifecycle/ttl.ts#L6-L57)). A Windows cleanup incident could terminate the host process ([OMO #6535](https://github.com/code-yeongyu/oh-my-openagent/issues/6535)).

**Impact.** Revived work disappears, notifications are lost, cleanup crashes the runtime, or foreign artifacts are deleted.

**Legion invariant.** Legion may TTL only Legion-owned terminal derived artifacts. Under lock: revalidate terminal, no owner/lease, no pending delivery, then write a durable tombstone. Outside lock: idempotently delete receipt-listed artifacts; crash recovery finishes tombstones. Never TTL DSH sessions or children.

### 12.4 Exactly-once is an identity protocol

**Trigger.** Completion is delivered, then the process crashes before marking it delivered; retries/revival produce a second terminal signal.

**Root cause.** “Send once” is implemented in memory, or terminal output lacks a durable `(task, epoch)` identity. OMO tracks notification run/notified epochs and tests exactly-once under random interleavings ([`chaos-invariants.ts#L118-L149`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/senpi-task/src/__adversarial__/chaos-invariants.ts#L118-L149)).

**Impact.** Duplicate parent wake, lost completion, repeated continuation, or contradictory terminal payloads.

**Legion invariant.** Reuse DSH settlement delivery. Any additional Legion event uses a durable `decisionId + attemptEpoch + nativeChildId`; terminal is idempotent and first-wins. Delivery is reserve/observe/commit (or an equivalent transactional inbox), and consumers deduplicate by identity—not payload text.

## 13. Edition drift

**Trigger.** Core, OpenCode/Codex/Senpi adapters, installer, generated bundle, schema, docs, cache, and pinned engine release evolve independently.

**Root cause.** Similar policies are copied across editions, compatibility is inferred from package version rather than capability probes, mutable tags such as `latest` are cached, and development-hoisted dependencies hide packed-install failures. OMO exposes separate edition artifacts ([`plugin-artifacts.ts#L9-L15`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-senpi/src/install/plugin-artifacts.ts#L9-L15)); a stale `@latest` OpenCode cache executed 4.15.1 while 4.19.4 was expected ([OMO #6620](https://github.com/code-yeongyu/oh-my-openagent/issues/6620)). Senpi’s automated upstream sync repeatedly opens conflict issues, exemplified by [Senpi #631](https://github.com/code-yeongyu/senpi/issues/631), and its README explicitly describes an extension-first fork strategy ([`README.md#L262-L280`](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/README.md#L262-L280)).

**Impact.** Docs describe unavailable features, doctor and runtime disagree, one edition misses a safety fix, cached code ignores new config, or release artifacts cannot run outside the monorepo.

**Legion invariant.** Keep one host-neutral policy/compiler and thin adapters; avoid edition forks until a real consumer requires one. Every artifact carries exact version, source commit, schema version, capability manifest, and content hash. Runtime probes required capabilities and fails closed rather than guessing from version. CI tests source and packed artifacts on a DSH compatibility matrix and verifies tag/tarball/manifest coherence. Mutable aliases may discover updates but never identify an activated package.

## Consolidated Legion prevention contract

1. One durable owner per fact and side effect; DSH owns runtime lifecycle and security.
2. Prompt sections/directives have stable IDs, provenance, scope, and generation.
3. Operation chains are frozen; retry/fallback share typed causes and one hard budget.
4. Same-route retry preserves request/cache identity; model switches re-run admission.
5. Goal continuation is explicitly armed, progress-gated, bounded, and stop-safe.
6. Every attempt has first-byte, idle, and total deadlines with paired terminal events.
7. Compaction artifacts are fenced by full identity and aggregate budgets.
8. Catalogs distinguish never-fetched, verified-empty, fresh, stale LKG, and failed.
9. Config merge preserves authored presence, tombstones, provenance, and authority narrowing.
10. Installer activation is transactional, receipted, verified, and reversible.
11. Paths/actions are canonicalized and approved by digest; cleanup targets only owned identities.
12. Every async commit revalidates session, operation, epoch, generation, and branch anchor.
13. Status, residency, connection, delivery, and lease are orthogonal.
14. Lease transfer uses fencing/CAS; TTL uses tombstone-first two-phase deletion.
15. Terminal settlement is first-wins and deduplicated by durable identity.
16. Edition/runtime compatibility is capability-probed and artifact-hash pinned.
