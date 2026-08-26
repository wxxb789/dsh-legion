# Legion v2 Plan: Visible, Useful, Measurable

- Status: Accepted
- Date: 2026-08-23
- Horizon: 6 weeks, three milestones
- Records the final dispositions of the former "Upstream DSH proposals" roadmap section

This plan is the output of a design interview. Every decision below was put to the
repository owner and answered; nothing here is inferred. Supporting evidence lives in
`docs/research/_audit-source-reality.md`, `_omo-current-state.md`, `_dsh-agent-teams.md`,
`_dsh-package-catalog.md`, and `_dsh-seams-v2.md`.

---

## 1. Where Legion actually stands

Measured, not claimed:

| Fact | Evidence |
|---|---|
| 12,992 LOC of source, 314 test cases, **zero tests that call a real model** | `docs/research/_audit-source-reality.md` |
| `src/durable-run/` is 4,904 LOC — **38% of the source** — and cannot start on any Host | `src/durable-run/capabilities.ts:122` pins `DURABLE_ACTIVATION_ADAPTER = 'unbound'`, so `durableActivationAvailable()` is constant `false` |
| Strategies are fully implemented and **invisible to the model by default** | `src/config.ts:416,429` (`enableStrategies ?? false`) |
| **Zero default Specialists ship.** A bare install registers no tool at all | `src/config.ts:190` (`profiles` is a required dict), `src/index.ts:960-961` |
| `ContextManifest` is referenced 21 times, **all 21 inside `src/durable-run/`** | the ephemeral path has never used it |
| Dev dependencies pinned DSH `0.1.0-rc.6` while the Host was at **`0.1.1-rc.2`** — closed by M1.1 | `package.json` devDependencies |
| The client bundle hand-wrote type declarations for packages that **are published** — closed by M1.2 | Published client contracts now drive `typecheck`; `src/client/dsh-client.d.ts` is gone |

The diagnosis in one sentence: **Legion paid the full price of an evidence-gated design and
collected none of the evidence.** The three capabilities the owner asked for — visible progress,
adequate pre-work research, and long-run recovery — were all built, and all built behind a gate
that has never opened.

## 2. The competitive frame

Measured 2026-08-23 via the GitHub API:

| Repository | Stars | Created | License |
|---|---|---|---|
| `deepseek-ai/deepseek-harness` | 186,112 | 2026-08-13 | MIT |
| `code-yeongyu/oh-my-openagent` | 68,262 | 2025-12-03 | SUL-1.0 (non-OSI) |
| `NanmiCoder/dsh-agent-teams` | **856** | 2026-08-12 | MIT |
| `wxxb789/dsh-legion` | **2** | 2026-08-14 | MIT |

Two plugins for the same Host, born two days apart, 428× apart in ten days. The difference is not
engineering quality — Legion has more tests, more contracts, and reproducible builds; the rival's
history is a single squashed commit with no default teams and no cost accounting. The difference is
that one of them lets you **see the team working**.

Three consequences fix the plan's shape:

1. **The near-term competitor is `dsh-agent-teams`, not OMO.** OMO lives on a different Host family
   and ships under a licence that cannot be adopted into the DSH ecosystem. The DSH plugin ecosystem
   is ten days old; this is a land grab, not a mature market.
2. **OMO publishes no benchmark numbers at all** — its single figure (Grok Code Fast 1, 6.7% → 68.3%)
   carries no harness, dataset, task count, or date. Since Legion also declines to price tokens in
   money (§6, decision 18), a "faster and cheaper than OMO" claim is unverifiable by construction and
   is therefore withdrawn from all public material.
3. **The Host is prototyping this category itself.** `@deepseek-ai/dsh-experimental-agent-team`
   (`private: true`) exposes `ctx.agentTeams` with eleven methods, a durable peer mailbox, and a shared
   task DAG, at 2,149 LOC of source against 2,381 LOC of tests, with a committed `lib/` and an invariant
   replay validator. It is held back by single-process durability and a missing Web surface, not by
   incompleteness. Legion must therefore stand **above** team execution, not beside it.

## 3. Legion's defensible claim

`dsh-agent-teams` derives member activity from the Host registry, but derives **task state from what
the model reported** via `update_task`. Its own source concedes the failure mode: the panel "always
reflects the on-disk state even when a model skipped a tool ritual" — which means a model that skips
the ritual leaves the panel confidently stale.

A Legion Strategy compiles to frozen IR **before anything starts**. The complete stage graph is
therefore known in advance, and progress is derived from child settlement rather than from a model's
self-report. Same panel, strictly stronger truth: **the model cannot skip a stage, cannot invent one,
and cannot lie about finishing one.**

This is the only claim in this document that requires no benchmark to defend.

## 4. Vocabulary decisions already applied

Recorded in [ADR 0022](adr/0022-legion-nouns-do-not-reuse-host-vocabulary.md) and applied to
`CONTEXT.md`:

| Was | Is | Because the Host already owns |
|---|---|---|
| `Profile` | **`Specialist`** | `profile` = launcher composition unit (`dsh --profile web`); the Host also owns `agent preset` and `persona` |
| `Team` | **`Cohort`** | `ctx.agentTeams`, `TeamId`, `lead`/`teammate`, `TeamMemberView` |
| `Team Run` | **`Cohort Run`** | same |

Two terms were added: **Run Receipt** (accounted in tokens and time, never in money) and
**Endorsement** (what a deployment may run vs what Legion will recommend).

Migration is non-breaking: `profiles`/`specialists` and `teams`/`cohorts` are both accepted for one
minor version, the old name emits a deprecation diagnostic, and the migration is a pure function that
never overwrites a user preset.

---

## 5. Milestone M1 — Visible (weeks 1–2)

**Goal:** run one delegation and watch it happen.

| # | Task | Detail |
|---|---|---|
| M1.1 ✅ | Track the latest Host | **Done.** devDependencies `0.1.0-rc.6` → `0.1.1-rc.2` with the lockfile regenerated, and the declared window moved with them to minimum `0.1.1-rc.1` / latest-tested `0.1.1-rc.2` / peer range `>=0.1.1-rc.1 <0.2.0`. Policy from here: always follow the latest DSH. See `docs/notes/dsh-0.1.1-rc.2-upgrade.md`. |
| M1.2 ✅ | Depend on published client contracts | **Done.** Removed `src/client/dsh-client.d.ts`; the card now compiles against the published slot, runtime, locale, settings, React, and UI-primitives contracts. `dsh-client-ui-schema-form` and `dsh-client-web-react` remain absent because neither has a package manifest or source. `dsh-client-ui-renderer` remains unimported because it is boot-once shell machinery whose `install()` throws on a second call. |
| M1.3 | Apply the renames | Config contract v3, dual-name window, deprecation diagnostics, pure migration, branded identity and compiled-IR updates, public contract documents. |
| M1.4 | Wire `ctx.agents` | Subscribe-then-backfill: register `agent/status`, `agent/created`, `agent/disposed`, then backfill with `ctx.agents.list()`. Map a child by `ctx.agents.get(childId)` — `enter()` enforces `childId === agent.session.id`. Use `listChildren`/`listDescendants` for the cold tree. |
| M1.5 | Run Receipt v0 | Three ingredients, three different truth sources: **stages** from the compiled Strategy IR (known before start), **participation** from `ctx.agents`, **tokens** from `ctx.tokenMeter.measure(childSession)`. Published as a session projection. |
| M1.6 | Overlay panel v0 | Register into `shell.overlay` — the only `shell.*` slot, and unclaimed inside the harness. Progress bar, member tree, and the stage DAG rendered from compiled IR. |
| M1.7 | Kill the upstream death list | Delete the "Upstream DSH proposals" section from `docs/roadmap.md` and redistribute it per §8. |
| M1.8 | Stop the preset lying | `presets/legion/preset.yml` blames the deployment for durable unavailability. The real cause is an in-package constant no deployment can change. Correct the text. |

**Acceptance:** a delegation runs and the DSH Web GUI shows, live, how many members exist, which are
running, how long each has run, and how many tokens each consumed — with no model cooperation required.

### M1 landmines

1. `AgentStatus` is **`'idle' | 'running'` only**. `'ready'` is synthesized by the `list_agents` tool for a
   child with no live Agent; it is not a registry status. Only that persisted-only tier needs polling.
2. `dsh.client.platform` must be the literal string `'web'`. Any other value is cached as a permanent
   negative verdict and the package is **silently dropped**. A missing `exports["./client"]` throws loud.
   `dsh.bundle.patch` is an unrelated host-side axis.
3. The HTTP service key is **`webServer`**, not `httpServer`, and the **`/plugins` prefix is already claimed**
   by `client/modules`. Use a distinct namespace. `webServer.register` returns a bare disposer and **must**
   be wrapped in `ctx.effect`. Prefer Typert Remote for typed calls; keep raw routes for SSE and webhooks.
4. `ctx.commands.register` **already routes through effect** — wrapping it again is a bug, the exact
   opposite of `webServer`.
5. `tokenMeter.measure` returns `deepFreeze(structuredClone(...))` and is O(surface) per call. Do not call
   it per child inside a one-second render loop; sample on settlement and on status change.
6. There is **no aggregate token roll-up**. Summing a delegation tree is Legion's job.

## 6. Milestone M2 — Useful out of the box (weeks 3–4)

**Goal:** a bare install plus one slash command lets someone finish real work.

| # | Task | Detail |
|---|---|---|
| M2.1 | Ship the full default Specialist catalog | 15 core entries: `quick`, `deep`, `reason`, `research`, `plan`, `execute`, `review`, `repair`, `explore`, `test`, `docs`, `security`, `data`, `ui`, `legion-setup`; plus the existing 9 ACP entries. Read-only tool policy is mandatory for `research`, `plan`, `review`, `explore`, `security`, `data`. Specialists are the product, not hardcoded privilege: every entry uses the same public contract a user has. |
| M2.2 | Route resolution ladder | (1) explicit user routes → (2) routes written by `/legion-setup` → (3) the shipped preset's named routes, carrying `asOf` as ordinary replaceable data → (4) capability solve against adapters the Host actually registered → (5) inherit the parent model and mark the Run Receipt "unrouted". A stale preset **degrades to (4); it never hard-fails and never silently substitutes.** |
| M2.3 | `/legion-setup` | A slash command (root turn) backed by an internal Specialist. It reads which LLM adapters the Host registered, interviews the user about cost and strength, and proposes routes. It emits a config **diff** gated by `ctx.approval`; it never writes silently. |
| M2.4 | Simple GUI status page | A plain latest-status surface alongside the overlay. Deliberately small. |
| M2.5 | Coordinator-side grill protocol | See the constraint below. A bounded, single-batch clarification round in the root turn, before the Strategy starts. |
| M2.6 | Default Strategy | `research → plan → execute → review`, where `plan` **cannot compile** unless it consumes the `research` artifact. Bounded repair remains one delegate. |
| M2.7 | Free the Context Manifest | Lift ADR 0018's ordered, digest-addressed, cache-stable context assembly out of `src/durable-run/` into the ephemeral execution path. This is the direct fix for "not enough research and planning before working": today a child starts blind with a prompt and a persona. |
| M2.8 | Default-on with honest labels | `enableStrategies` defaults true. Every catalog entry carries an Endorsement of `unproven`, `observed`, or `measured`. The routing table stays terse and lives in the stable prompt prefix so its cost lands in `cacheReadTokens` rather than `uncachedInputTokens` — and is therefore measurable rather than guessed. |

**Acceptance:** bare install → `/legion-setup` → a non-programmer completes a real task, and the Run
Receipt shows which Specialists ran under which routes.

### The constraint that reshaped M2.5

`ctx.userQuestions.ask()` gates on `ctx.agents.roots().includes(agent)`. **Every Strategy stage lowers
to a subagent, and a subagent is not a root agent**, so a stage that tries to interview the user
receives `DELEGATED_CALLER` instead of an answer. In a headless host it throws `NO_PROVIDER` — it never
hangs and never returns null.

A bypass exists (omitting `request.agent`), and Legion will **not** use it: granting a built-in Strategy
a hidden privilege is precisely what authority monotonicity forbids.

Therefore grilling is a **coordinator-side protocol, not a Strategy stage**. It runs in the root turn,
asks one bounded batch of questions (never an open-ended loop — unbounded round-trips are the direct
cause of the slowness Legion is trying to beat), degrades in headless hosts to emitting an
open-questions artifact, and records the degradation in the Run Receipt.

The same mechanism serves `/legion-setup`. It is implemented once.

## 7. Milestone M3 — Measurable (weeks 5–6)

**Goal:** produce the first honest table of numbers.

| # | Task | Detail |
|---|---|---|
| M3.1 | Persist receipts | `ctx.storageDomain`, unit name `legion_receipts` (**hyphens are rejected**: `/^[a-z][a-z0-9_]*$/`). Scoping is process-global, so encode the SessionId into the key. Schema validates at the **read** boundary, not on write. `update` is atomic RMW **in-process only**; two live processes are uncoordinated and last-writer-wins. |
| M3.2 | Historical baseline extractor | Per-task totals need a three-way join on SessionId: `sessionQuery` for the corpus, the `tokenUsage` projection for the four token buckets, and the separate `sessionStats` projection for `turns`/`steps`/`llmMs`/`toolMs`/`ttftMs`/`decodeMs`. **`SessionQueryEngine` is an abstract Service requiring a live Context** — the extractor runs inside a booted composition, not as a standalone script. |
| M3.3 | Endorsement promotion | `unproven` → `observed` automatically once N receipts exist. `measured` requires a paired campaign that is **not** in this plan and therefore stays unreachable. The vocabulary states our ceiling instead of hiding it. |
| M3.4 | `dsh-legion-coordination` | A separate package adding lease, expiry, fencing token, and an fsync barrier over `@deepseek-ai/dsh-atomic-write`. `withFileLock` is genuine cross-process writer exclusion, but has no lease, no expiry, and no fence, and its own source states that orphan recovery is an operator action — a crashed holder blocks every future writer permanently. `writeFileAtomic` excludes crash durability by design. Shipped with Legion through a DSH profile bundle so installation stays one command. Deletable in full if the Host ever publishes the capability. |
| M3.5 | Public wording pass | Apply §9 across README, README.zh-cn, CHANGELOG, and release notes. |

**Acceptance:** a table reading "same-kind task, Legion vs direct delegation: tokens (by bucket),
llmMs, toolMs, turns", with its observational nature stated on the same page.

### The methodological ceiling, stated up front

The owner's session history contains almost no Legion runs, so history supplies the **baseline arm
only**: what a task costs today without Legion. New runs supply the experimental arm. Task difficulty
is not controlled, so this is **observational evidence, not a randomised comparison**. It yields
direction, not proof, and every artifact reporting it must say so. Publishing an uncontrolled ratio as
if it were an experiment is exactly the failure Legion criticises OMO for.

---

## 8. Roadmap cleanup: the upstream proposals are dead

The Host does not accept external pull requests. Every "waiting for DSH" item is therefore permanent.
Delete the section and redistribute:

| Former proposal | Disposition |
|---|---|
| Unified recovery seam | **Permanent limitation.** Cross-route recovery stays disabled; the README states that Legion starts only the selected child. |
| Host-owned budget admission | **Companion backlog.** Aggregate admission belongs in a successor to the M3.4 coordination package, not in Legion. |
| Generation-bound LLM resolve/reserve/start lease | **Partly satisfied upstream, with a permanent limit.** DSH binds one prepared adapter generation to one dispatch; Legion's pre-start Route observations remain best-effort and never claim atomic adapter topology. |
| Child reasoning-effort override | **Permanent limitation.** A Specialist cannot set a child's reasoning effort. |
| Per-child named preset composition | **Permanent limitation.** In-process children inherit the parent's named preset. |
| Unified child-setup contributions | **Permanent limitation.** Legion cannot add Specialist-local DSH Skill registrations to one-shot, continuable, and cold-resume paths. |
| Published `clientBundle` preset | **Permanent limitation.** DSH does not publish the build preset, so Legion mirrors the loader artifact format under a protocol test. |
| Published `settings.plugin.item` slot declaration | **Already satisfied upstream.** The public `@deepseek-ai/dsh-client-ui-settings-plugins` package declares the slot. |
| Client packages on the Host's line | **Already satisfied upstream.** The assessed 0.1.1-rc.2 client contracts are public and drive Legion's client typecheck. |
| Redacted provider health | **Permanent limitation.** Legion does not inspect live provider health and reports it as unknown; no health capability is planned. |

## 9. What Legion may and may not say

**May say**, because a Run Receipt supports it:
- how many Specialists ran, which routes were selected, and why the others were rejected;
- token counts by bucket and latency split into LLM and tool time;
- that the stage graph is compiled before start and therefore cannot be skipped or fabricated;
- observational direction across the owner's own sessions, labelled as such.

**May not say**, until something changes:
- any comparison of speed or cost against OMO — neither side publishes comparable figures, and Legion
  will not run OMO to obtain them;
- any monetary amount. The Host counts tokens and has no price table anywhere; `token-meter`'s own
  source states the value is "not a billing or gating input". Legion deliberately does not add one;
- that a Strategy is better than direct delegation, until an Endorsement reaches `observed`, and then
  only as direction;
- that durable Strategy runs work in production.

## 10. Explicitly deferred

- **The fate of `src/durable-run/`.** Not one of its 4,904 lines is touched in these six weeks except
  to extract the Context Manifest (M2.7). Delete, freeze, or unblock is decided after M3.
- **`measured` Endorsement.** Requires a paired held-out campaign that is not funded here.
- **OMO as a target.** Revisited after the DSH plugin ecosystem position is held.
- **Adopting `ctx.agentTeams`.** It is `private: true` and unusable today. The `Cohort` vocabulary
  exists so that adopting it later is a backend change, not a rename.

## 11. Non-goals, unchanged

No second Agent, Session, subagent, workflow, or goal runtime. No task store, mailbox directory, WAL,
database, lock service, generic scheduler, process-global registry, daemon, or autonomous resumption
loop. No credential storage, provider auth, model adapter registry, sandbox, approval, or telemetry
exporter. No hook injection, fixed mythology roles, model leaderboard baked into code, or unbounded
autonomy.
