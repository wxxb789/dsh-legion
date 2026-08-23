# Research: NanmiCoder/dsh-agent-teams

Repo: https://github.com/NanmiCoder/dsh-agent-teams
Method: read-only `git clone --depth 50` into a temp dir + GitHub REST API. Source paths below are repo-relative.

## 1. Identity

| Field | Value | Source |
|---|---|---|
| Description (GitHub) | "AgentTeams plugin for DeepSeek Harness" | GitHub API |
| Description (npm) | "AgentTeams for DeepSeek Harness: multi-agent team collaboration (captain, members, tasks with dependencies, messaging) driven by natural language, with a tree monitor in the web GUI" | `package.json` |
| Stars / Forks | 856 / 73 | GitHub API (as of 2026-08-23) |
| Open issues | 23 | GitHub API |
| License | MIT | `LICENSE`, GitHub API |
| Language | TypeScript | GitHub API |
| Created | 2026-08-12T13:41:50Z | GitHub API |
| Last push | 2026-08-22T19:01:20Z | GitHub API |
| Latest release | v0.1.13, published 2026-08-22T19:01:59Z; tags v0.1.4 … v0.1.13 | GitHub releases API, `git tag` |
| npm package | `@nanmicoder/dsh-agent-teams` v0.1.13 | `package.json` |
| Author | 程序员阿江 (Relakkes) <relakkes@gmail.com>, https://github.com/NanmiCoder — the MediaCrawler author | `package.json`, git log |
| Topics | agentteams, deepseekharness, dsh, dsh-agent-teams, dsh-plugin | GitHub API |
| Node engines | ^22.19.0 \|\| >=24 | `package.json` |

Git history is squashed: the only commit is `912aae5` "chore: prepare 0.1.13 release" (2026-08-23 +0800), so per-feature commit archaeology is not possible from the clone.

## 2. Problem and positioning

It is unambiguously a **DSH plugin** (host-plane plugin + browser client bundle), not a preset pack, prompt collection, or standalone tool.

- `package.json` declares `dsh.bundle.patch: ./cordis.patch.yml` and `dsh.client` with `platform: "web"`, injecting `@deepseek-ai/dsh-client-locale`, `dsh-client-runtime`, `dsh-client-ui-conversation`, `dsh-client-ui-layout`.
- All DSH packages are **optional peerDependencies** (cordis, dsh-agent, dsh-subagent, dsh-session, dsh-tools, dsh-llm, dsh-system-prompt, dsh-commands, client UI packages, schemastery, react).
- Install: `dsh plugin --profile web add @nanmicoder/dsh-agent-teams@latest`.
- `src/index.ts` header: "A host-plane plugin that registers the `agent_teams_*` tools and one usage section into the global system prompt… the plugin needs no realm."

Problem it solves: turn one DSH session into a **captain** that assembles durable sub-agents, splits a goal into dependency-aware tasks, and coordinates them via direct messages — "without requiring a separate workflow engine" (README). `docs/usage.md` states it reuses DSH capability seams and does not depend on a workflow engine.

## 3. VISIBILITY / OBSERVABILITY (the core answer)

Four distinct, layered surfaces. **The primary one is a live React overlay panel in the DSH Web GUI, fed by a plugin-registered HTTP route that reads disk state and enriches it with live subagent activity.**

### 3.1 Data path
`docs/usage.md`: 「数据链路：工具执行 → 磁盘状态（真相源）→ host 快照路由 → 浮层 1s 轮询渲染；会话日志同时写入 `agent-teams/*` 事件（审计/重放/复盘）。」
(tool execution → disk state as truth source → host snapshot route → floater polling at 1s → render; session log independently records `agent-teams/*` events for audit/replay/review.)

**Truth source is the filesystem, not the model's narration.** `src/snapshot.ts` header states this explicitly:

> "Server-side assembly mirrors the Claude Code desktop teamWatcher: read the durable team files (the truth source) and enrich with live subagent activity, so the panel always reflects the on-disk state even when a model skipped a tool \"ritual\" (e.g. not calling update_task on completion)."

State layout (`docs/usage.md`):
```
<workspace>/.agent-teams/<teamId>/
├── team.json            # members, tasks (with dependencies), task sequence
└── inbox/
    ├── captain.jsonl    # captain mailbox
    └── <member>.jsonl   # one JSONL mailbox per member
```

### 3.2 Host-side snapshot route — `src/index.ts`
Registers two web routes lazily (works when `webServer`/`httpServer` and `workspaceRegistry`/`workspace` services bind; headless profiles stay tool-only):

- `GET /plugins/dsh-agent-teams/state` — JSON `{ teams: TeamActivitySnapshot[] }`; `?archived=1` serves archived teams. Comment in source: "Activity panel data route: the browser floater polls this for team snapshots (disk truth + live subagent activity). Mirrors the Claude Code desktop watcher's server-side snapshot pattern."
- `GET /plugins/dsh-agent-teams/assets/*` — prefix route serving the packaged whale mascot PNGs under a hardcoded 15-entry allowlist (no path traversal).

Snapshot payload (`src/snapshot.ts`, `TeamActivitySnapshot`): `workspace, teamId, name, description, captainSessionId, members[], tasks[], messageCount, captainInbox[]`.
- `TeamActivityMember`: `id, name, role, status, activity ('working'|'idle'|'unknown'), progress (%), done, total, currentTask, unread`. `activity` comes from `memberActivity(ctx, ids)` in `src/members.ts`, which reads real DSH `ctx.agents` `running / idle / ready` state — `docs/usage.md` notes this deliberately avoids "易变的子代理目录投影" (the volatile subagent-directory projection).
- `TeamActivityTask`: `id, subject, status, state ('blocked'|'open'|'running'|'completed'), assignee, dependencies[], depth`.
- `captainInbox`: last 5 unread captain messages (`from`, `content`).

### 3.3 Browser: the live activity panel — `src/client/ActivityPanel.tsx` (44 KB, the largest file in the repo)
Mounted into the frame-level `shell.overlay` slot (non-modal floater, top-right). Structure from the file outline:
- `ProgressOverview` — segmented total-progress bar with in-progress / waiting-on-dependency / delivered counts.
- `TeamSection` — captain header, collapsible member roster tree, per-member status.
- `DependencyMap` — interactive compact task DAG.
- `CollapsedBadge` — when collapsed, shrinks to a small corner badge showing team count + an activity pulse dot.

DAG geometry is a pure module, `src/client/activity-model.ts`: `taskStages()` groups by dependency depth (columns), `compactDagLayout()` emits nodes (92×30 px) and cubic-Bézier SVG edge paths, `relatedTaskIds()` does cycle-safe upstream+downstream traversal to highlight a whole handoff chain, `usesParallelTaskGrid()` switches to a fill-width grid when there are no real edges, `dependencyFocusTaskId()` resolves pin > keyboard focus > hover.

Panel behavior (`docs/usage.md`): auto-expands on team creation; docked right by default, height grows with content until a viewport safe cap; switchable to a draggable floating window with edge/corner resize; position, manual size and dock mode persist across refresh; hover or keyboard focus previews the full up/downstream chain, click pins, `Esc` clears; a selected node shows owner, unmet prerequisites and downstream unlocks; member rows show role avatar, role, live status and task tags and **click-through opens that member's sub-session**.

### 3.4 Polling controller — `src/client/activity-monitor.ts`
`startActivityPolling()` is deliberately inert with no targets. Explicit conversation-card targets poll at the live cadence (`ACTIVITY_POLL_MS`, 1 s); a bare "discovery session" probes at `ACTIVITY_PROBE_MS` (5 s per release notes) and **upgrades to 1 s the moment a team belonging to that session appears** — so ordinary sessions never become a permanent 1 s filesystem scan. Falls back to `?archived=1` when a tracked team disappears (post-delete review). Aborts in flight on stop; a host restart keeps the last snapshot.

### 3.5 Conversation-stream card — `src/client/agent-teams-card-definition.ts`
A Conversation Node folded **from first-party durable session events**, not a custom event: it matches `tool/call` with `name === 'agent_teams_create'` and the corresponding `tool/result` (`role: 'start' / 'update'`), and only renders once the result is non-error (`accepted`). Source comment: "Those are first-party session events, so the card survives restarts without writing an out-of-repo event type." Renders team name, member roster with whale avatars, click-to-jump to a member session, and an "activity panel" button that re-activates a closed floater.

### 3.6 Durable session-journal event stream — `src/events.ts` + `src/event-types.ts`
Seven event types are declared via a `SessionEventMap` module augmentation: `agent-teams/team-created`, `member-added`, `member-removed`, `task-created`, `task-updated` (carries `status, assignee, output, attempt, attemptId`), `message-sent`, `team-deleted`. `appendTeamEvent()` always appends to **the captain's** session (`captainSessionOf()` resolves via `ctx.agents.get(captainSessionId)`, falling back to the caller's session) "so the captain's conversation stream stays the single authoritative monitor surface."

Important caveat, quoted from `src/events.ts`: the emitter **checks `dshSession.KNOWN_SESSION_EVENT_TYPES` and silently skips** unknown types —
> "Until Session.append exposes the official `ignorable: true` writer surface, omit these informational records unless the running harness already recognizes them. Disk state remains the authoritative source for the activity panel."

So on a stock harness that does not know `agent-teams/*`, this journal layer is a no-op (debug-logged once) and only the disk-backed panel is live.

### 3.7 Localization
The panel registers its own `agentTeams` locale namespace and takes the translate function from the Slot's official `locale` seat; card, panel, status summaries, archive markers and a11y text switch live between en and zh-CN without reload or DOM sniffing (`src/client/locales.ts`, 8 KB).

### 3.8 Mascot artwork — `src/client/artwork.ts`
Role→image mapping by bilingual regex over `"${name} ${role}"`: data/analysis, research, QA (matched **before** engineer so "QA Engineer" doesn't fall into the engineer bucket), engineer, designer, security, docs, operator; captain always `team-lead-v2.png`. Action overlay: `working → action-working-v2.png`, `idle → action-sleeping-v2.png`, `unknown → action-thinking-v2.png`. Unmatched roles fall back to an initial letter. `assets/agent-teams/` also ships `action-reporting/celebrating/sending-v2.png`. Animations honor `prefers-reduced-motion`; unread messages give the avatar a halo ring.

### 3.9 The README screenshot (`assets/ui.png`, 3308×2374)
A Chinese-locale DSH Web GUI. Left: the chat stream with the user's `/agent-teams 分析一下最近的 commit…` message, context-injection rows (`@deepseek-ai/dsh-system-prompt`, `skill-catalog`, `agent-teams-command`), Think/Bash rows, the inline **commit-review-team card** (whale + "3 名成员" + 活动面板 button + researcher / security-reviewer / reviewer avatars), then `Tool call · agent_teams_create`, three `agent_teams_add_member` calls, and `agent_teams_create_task` calls.
Right: the **AgentTeams 活动 floater**, containing — team header `commit-review-team · 3 成员 · 0/3 完成 · 0 消息`; a 队长 (captain) card reading 「拆解·派发·汇总 / 已派发 3 项任务给 3 名成员」 with a "2 人执行中" chip; a segmented 总进度 bar with legend 进行中 2 / 等待依赖 1 / 已交付 0; a status hint line "t3 等待前置，其余已开工"; a collapsible 成员 3 tree where each row has a whale avatar, name, role, a 工作中/等待 badge, an `0/1` counter, "正在执行 t1" / "等待 t1 · researcher", and a 队长派发 task chip (t1/t2/t3, orange for blocked); and a 任务依赖 section rendering the DAG (t1 and t2 in column 1 curving into t3 in column 2) with the hint 「悬停高亮依赖链 · 点击固定」, plus a detail card for the selected t3 showing owner, 等待 t1、t2, and 无下游任务.

## 4. Architecture and vocabulary

**No declarative team/role config format exists.** Teams are created imperatively at runtime by the model through tools; the only YAML is plugin-level config. There is no teams.yaml, no role library file.

Vocabulary: **captain** (the current session), **member** (a durable continuable DSH sub-agent with a persona), **team** (one captain leads exactly one active team), **task** (with `dependencies`, `assignee`, `depth`), **attempt / attempt_id** (a monotonic capability token per execution), **mailbox / inbox** (JSONL), **archive**. There is no "run" noun; the closest is an attempt.

It **delegates entirely to DSH sub-agents** — it defines no independent agent runtime. What it does own is a small scheduler (`src/scheduler.ts`, 13 KB) driven by the `agent/status` event: when a member goes idle it atomically claims one ready task from the shared pool and wakes it.

Task state machine (`docs/usage.md`): `pending → claimed → in_progress → completed | failed | cancelled`. Dependencies are validated before claiming; a member may not hold two unfinished tasks. Reassignment invalidates the old attempt, interrupts, and waits for the old worker to quiesce, so late writes cannot overwrite new results.

Source map: `src/index.ts` (mount, prompt section, web routes), `src/tools.ts` (52 KB, the ten tools), `src/state.ts` (33 KB, durable state + locking), `src/members.ts` (20 KB, spawn/wake/activity), `src/scheduler.ts`, `src/snapshot.ts`, `src/events.ts`, `src/command.ts` (slash command + gesture boundary), `src/client/*`.

## 5. DSH seams used

`ctx.*` usage counted across `src/`: `ctx.subagents` ×12, `ctx.tools` ×10, `ctx.logger` ×10, `ctx.slots` ×7, `ctx.agents` ×6, `ctx.effect` ×5, `ctx.get` ×4, `ctx.on` ×3, `ctx.commands` ×2, `ctx.llm` ×2, `ctx.systemPrompt` ×2, `ctx.sessions` ×2, `ctx.httpServer` ×1, `ctx.inject` ×1, `ctx.locale` ×1, `ctx.conversationEvents` ×1.

- `inject = ['tools', 'llm', 'subagents', 'systemPrompt', 'agents']` (hard); `commands` is injected lazily via `ctx.inject(['commands'], …)` so a minimal composition still works.
- `ctx.tools` — ten `agent_teams_*` tools, "same registration path as `tool-workflow`".
- `ctx.subagents.startContinuable()` to create a member; `ctx.subagents.followup()` to wake one.
- `ctx.agents` — real `running/idle/ready` liveness; `agent/status` drives the scheduler.
- `ctx.systemPrompt.section({ name: 'agent-teams:usage', order: 117 })` — a 7-step captain protocol injected into the global system prompt.
- Web server: dual-key probe `webServer` then `httpServer`, and `workspaceRegistry` then `workspace`, re-attempted on every `internal/service` event — explicit compatibility with the DSH rc.1→rc.2 rename.
- Session journal: `session.append(type, data)` guarded by `KNOWN_SESSION_EVENT_TYPES`.
- Client: `ctx.slots` into `shell.overlay` (ui-layout) and the conversation chat-node keyed renderer map (ui-conversation); official `locale` seat.
- Settings: schemastery `Config` — `stateDir` (`.agent-teams`), `memberProvider` (`spawn`), `memberModel`, `memberMaxDepth` (1), `maxMembers` (8), `promptSectionOrder` (117), `slashCommand` (true).
- Commands: closed-namespace `/agent-teams` host command plus a plain-text "gesture boundary" for surfaces without command adjudication (headless CLI); invocation logged as `command/run` / `command/done`.

## 6. Default teams/roles shipped

**None.** No built-in team or role catalog exists — roles are free-form strings the captain invents per goal. The only role vocabulary anywhere is the **artwork keyword map** (`src/client/artwork.ts`), 8 visual buckets: data/analysis, researcher, QA, engineer, designer, security, docs, operator, plus the captain (team-lead). Those are cosmetic avatar selectors, not behavior presets. The system-prompt protocol only exemplifies "researcher, engineer, reviewer, …".

It does ship one **Agent Skill** package, `skills/dsh-plugin-development/SKILL.md` (`npx skills add NanmiCoder/dsh-agent-teams --skill dsh-plugin-development`), which is about writing DSH plugins, not about teams.

## 7. Cost / token accounting / run receipts

**Absent.** Grepping `src/` for cost/token/price/budget/receipt finds zero accounting code: `price`, `budget`, `receipt` = 0 hits; `cost` = 1 hit and it is a UTF-8 byte-length comment in `state.ts`; `token` hits are the `/agent-teams` command token and CSS design tokens. There is no per-member spend, no usage rollup, no run receipt.

What exists instead is **structural** accounting: task counts (`done/total`, per-member `progress` %), `messageCount`, unread-per-member, attempt numbers, and the archived team directory as a post-hoc record. `agent_teams_delete` archives rather than deletes: `<stateRoot>/archive/<teamId>/` retains members, tasks, dependency graph and mailboxes, and the panel can render archived teams via `?archived=1`. Release-notes markdown ships inside the npm tarball under `release-notes/`.

## 8. Weaknesses / explicit non-goals

From `docs/usage.md` 「已知限制」and README "Boundaries":
- Scheduling is **event-driven, not a resident poller**. With the captain offline there is no cold recovery of members; tasks and messages sit on disk until the captain returns or a status tool is called.
- **One captain leads exactly one team at a time** (explicitly aligned with Claude Code AgentTeams).
- State is file-level durable and serialized **only within one DSH process**; concurrent processes on the same team are not coordinated.
- Member persona **replaces** the deployment default persona, and members still hold the full tool set (bash/fs/web) — no capability narrowing per role.
- **The panel reports persisted state as-is.** Models sometimes finish work without performing the expected task-state update (e.g. never calling `agent_teams_update_task`); the panel will faithfully show the stale truth.
- The floater targets DSH `0.1.0-rc.8` `shell.overlay` specifically; narrow screens fall back to a safe-padding overlay with drag/resize disabled.
- The `/agent-teams` slash-menu description and hint stay **English-only** because the official `CommandDefinition` protocol has no locale namespace field; the author explicitly refuses to fake it with DOM replacement.
- Session-journal `agent-teams/*` events are **suppressed** unless the running harness already knows those types (§3.6).
- v0.1.13 known limitation: after a hard DSH restart, resident member state cannot always be confirmed.
- No cost/token accounting, no declarative team config, no default role catalog, no workflow engine, no multi-process coordination.

## Key URLs
- Repo: https://github.com/NanmiCoder/dsh-agent-teams
- README (EN): https://github.com/NanmiCoder/dsh-agent-teams/blob/main/README.md — (ZH): `README_ZH.md`
- Usage doc (Chinese, the real spec): https://github.com/NanmiCoder/dsh-agent-teams/blob/main/docs/usage.md
- Releases: https://github.com/NanmiCoder/dsh-agent-teams/releases/latest
- npm: https://www.npmjs.com/package/@nanmicoder/dsh-agent-teams
- Screenshot: `assets/ui.png`
