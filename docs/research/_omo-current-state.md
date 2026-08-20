# OMO (oh-my-openagent) — Current State

> Compiled 2026-08-19 (UTC) from primary sources: GitHub REST API, `dev` branch raw files, GitHub Releases, npm registry API. Baseline for comparison: the two existing local notes pinned at commit `038ed0c`. Anything not directly observed in these sources is marked **unverified**.

## 0. Identity resolution

In this repository's vocabulary "OMO" = `code-yeongyu/oh-my-openagent` (formerly `oh-my-opencode`), per `docs/research/oh-my-openagent.md`. That is confirmed live: https://github.com/code-yeongyu/oh-my-openagent

Naming today is genuinely messy and worth stating precisely (README "Note on package and command names"):
- npm package / CLI: still `oh-my-opencode`, dual-published as `oh-my-openagent`.
- Short command after install: `omo-agent-toolkit`. The `omo` bin was **removed** from those packages.
- Senpi-native edition: npm `omo-ai@beta` (bare `omo-ai` fails by design). Plain `omo` on npm is an **unrelated package by a different author**.
- Codex edition installer: `lazycodex-ai` (`npx lazycodex-ai install`); Codex marketplace `sisyphuslabs`, plugin `omo@sisyphuslabs`; marketplace repo `code-yeongyu/lazycodex`.

## 1. Repo identity (GitHub API, 2026-08-19)

| Field | Value |
|---|---|
| org/repo | `code-yeongyu/oh-my-openagent` (personal account, not an org) |
| Stars | **68,065** |
| Forks | 5,557 |
| Watchers (subscribers) | 225 |
| Open issues+PRs count | 780 (open **issues** alone: 462, via search API) |
| Primary language | **TypeScript** (25.36 MB TS; then JS 2.52 MB, HTML 1.94 MB, Shell 575 KB, Python 406 KB, PowerShell 42 KB) |
| Default branch | `dev` |
| Created | 2025-12-03 |
| Last push | 2026-08-19T09:02Z |
| Repo size | ~155 GB-units (155,215 KB ≈ 151 MB) |
| License | `NOASSERTION` per API; actually **SUL-1.0** (non-OSI, restricts commercial/paid redistribution) — README badge + `LICENSE.md` |
| Contributors | ~335 (Link header last page, `per_page=1&anon=1`) |
| Docs site | https://omo.vibetip.help/docs ; also `omo.dev`, `lazycodex.ai`, `sisyphuslabs.ai` |

Source: `GET https://api.github.com/repos/code-yeongyu/oh-my-openagent`, `/languages`, `/search/issues`.

### Latest release / version
- Latest tag: **`v5.0.0-beta.11`**, published **2026-08-19T05:50Z** (prerelease). https://github.com/code-yeongyu/oh-my-openagent/releases
- v5.0.0 beta line began **2026-08-09** (`v5.0.0-beta.1`); 11 betas in 10 days.
- Last stable-line release before v5: **`v4.19.4`**, 2026-08-01. Preceding: v4.19.3 (07-28), v4.19.2 (07-26), v4.19.1 (07-22).
- Release cadence is roughly daily-to-every-few-days.

### Commit activity, last ~3 months
- Commits on `dev` since **2026-05-19**: **6,890** (GitHub commits API pagination `per_page=1` last-page marker).
- Merged PRs since 2026-05-19: **1,431** (`/search/issues?q=...is:pr+is:merged+merged:>2026-05-19`).
- `/stats/participation` weekly commit counts, most recent 12 weeks: 1084, 660, 436, 326, 373, 466, 366, 433, 431, 522, 809 — i.e. **~300–1,100 commits/week**, overwhelmingly owner-attributed (owner share in the same weeks: 988, 583, 396, 278, 335, 419, 336, 413, 339, 474, 781).

This is an extremely high-velocity, effectively single-maintainer repo. README states the maintainer builds it "in real-time with Jobdori, an AI assistant running on a heavily customized fork of OpenClaw", and elsewhere "99% of this project was built with OpenCode." So most of that commit volume is agent-generated.

### Distribution reach
- npm `oh-my-opencode` downloads, 2026-07-17 → 2026-08-15: **97,088/month** (`https://api.npmjs.org/downloads/point/last-month/oh-my-opencode`).

## 2. Architecture — in OMO's own vocabulary

### Editions (three, same product)
- **Ultimate Edition** — omo for **OpenCode**. Full product: "11 agents, 54+ lifecycle hooks, 5 built-in MCPs, all slash commands, Team Mode, ulw-loop, ultrawork, hashline edits". Install `bunx oh-my-openagent install`.
- **Light Edition** — omo for **Codex CLI**. Portable subset only: `rules`, `comment-checker`, `git-bash`, `lsp`, `ultrawork`, `ulw-loop`, `start-work-continuation`, `telemetry`, plus plugin-scoped MCPs (`grep_app`, `context7`, `codegraph`, `git_bash`, `lsp`) and the `ast-grep` skill. **No agent orchestration, no `team_*` tools.**
- **Senpi Edition (standalone, beta)** — native `omo` command, pinned Senpi engine with the OMO extension built in.

### Agents / roles
Named after Greek mythology, primary vs subagent split:
- **Sisyphus** — main orchestrator (defaults `claude-opus-5` / `kimi-k3` / `glm-5`). Plans, delegates, drives to completion.
- **Hephaestus** — "The Legitimate Craftsman", autonomous deep worker (`gpt-5.6-sol`, medium effort).
- **Prometheus** — strategic planner, **interview mode** before code is touched; invoked by `/start-work`.
- Others named in README/docs: **Oracle**, **Librarian**, **Explore**, **Atlas**, **Metis**, **Momus**, **Sisyphus-Junior**.

### Delegation: categories, not models
The central abstraction. `task(category=...)` routes to a worker; `task(subagent_type=...)` picks a named specialist; the two are mutually exclusive. README lists user-facing categories:

| Category | Purpose |
|---|---|
| `visual-engineering` | Frontend, UI/UX, design |
| `deep` | Autonomous research + execution |
| `quick` | Single-file changes, typos |
| `ultrabrain` | Hard logic, architecture decisions |

`ultrabrain` currently routes to "GPT-5.6 Sol xhigh through OpenAI or Vercel when available, then GPT-5.6 Sol xhigh". **Important caveat carried over from the local audit and still true structurally:** there is no code-level semantic classifier; the orchestrator LLM picks the category string from tool descriptions, and the default chains are hardcoded curated leaderboards in `packages/model-core`.

### Core loop
Per `ROADMAP.md` "What This Is": *"The human is not the worker... The human only initiates."* The loop is keyword-triggered and continuation-driven:
1. User types **`ultrawork`** / **`ulw`** → every agent activates.
2. **IntentGate** analyzes true user intent before classifying/acting.
3. **Rules Injection** loads `AGENTS.md` / `.omo/rules/**` into context every prompt.
4. Sisyphus delegates by category to background specialists ("Fire 5+ specialists in parallel").
5. **Goal / `/goal`** re-injects a continuation prompt on every session idle until a **completion audit** passes.
6. **Todo Enforcer** yanks the agent back if it goes idle with work outstanding.
7. **Ulw Loop** provides durable multi-goal orchestration with evidence audit, backed by `.omo/ulw-loop/`.

Note: the older **Ralph Loop** is **no longer wired into session hooks**; the Goal subsystem replaced its continuation path (`docs/reference/known-issues.md` #5839).

### Package layering (the "Multi-Harness Agent OS Refactor")
`ROADMAP.md` defines six layers: **Core** (pure TS, no harness deps) → **MCP** (stdio servers) → **Skills** (SKILL.md, no code) → **Adapters** (OpenCode/Codex/Senpi/Pi) → **Platform** (generated launchers) → **Web** (marketing site). Dependency rule: adapters depend on Core/MCP/Skills; Platform and Web are leaves.

**19 Core packages** extracted so far: `utils`, `model-core`, `prompts-core`, `rules-engine`, `agents-md-core`, `comment-checker-core`, `hashline-core`, `boulder-state`, `telemetry-core`, `lsp-core`, `mcp-stdio-core`, `tmux-core`, `claude-code-compat-core`, `skills-loader-core`, `mcp-client-core`, `openclaw-core`, `team-core`, `delegate-core`, `omo-config-core`.

Live `packages/` listing adds since the local notes: **`memory-core`**, `ast-grep-mcp`, `git-bash-mcp`, `lsp-daemon`, `lsp-tools-mcp`, `omo-codex`, `omo-native`, `omo-senpi`, `pi-goal`, `pi-webfetch`, `senpi-task`, `shared-skills`, `web`, plus 11 platform launcher packages (`oh-my-opencode-{darwin,linux,windows}-*`).

Documented layering exceptions: same-layer `omo-senpi -> senpi-task`, and transitional `omo-opencode -> omo-codex`.

### Configuration
`omo-config-core` provides the `omo.json` schema, a walked multi-layer loader, and a comment-preserving atomic writer. Landed **senpi-first on purpose**. ROADMAP states plainly: *"The OpenCode edition still reads its own `oh-my-openagent.json` chain, and the two files have zero interaction today."* Adopting `omo.json` in OpenCode is "the next phase". Effective override order remains `base → [harness] → profile → profile.[harness]`.

### Memory (new since the local notes)
`memory-core` package plus v5.0.0-beta.11 release notes describe: **memory pressure** surfaced to the agent; automatic **dream runs** (memory consolidation) when pressure crosses a threshold; **enforced token budgets** with committed per-file estimates; a **memory-file access ledger** driving **dream tier rebalancing** by evidence; and **memory reflection / people-ask children** spawned as subprocesses.

### Team Mode (v4.0, opt-in, Ultimate only)
Lead agent + up to 8 members (README: "up to 8 parallel members"; default config example uses `max_parallel_members: 4`), real-time tmux visualization, dedicated `team_*` tools (`team_create`, `team_send_message`, `team_task_create`, `team_status`, ...). Two skills ride on it: **`hyperplan`** (5 hostile critics) and **`security-research`** (3 vulnerability hunters + 2 PoC engineers). Off by default.

### mass-ulw / DAG (new)
v5.0.0-beta.11 mentions a **dag boundary** enforcing planning discipline for **mass-ulw** runs: advisory planning warnings at start, dag agent-node dispatch through spawn policy, extension reload blocked while a DAG run is in flight. No public design doc located — architecture details **unverified**.

## 3. Headline capabilities (README "Highlights")

Concretely, as advertised:
1. **`ultrawork` / `ulw`** — one keyword activates all agents; "doesn't stop until done" (Both editions).
2. **Discipline Agents** — Sisyphus orchestrating Hephaestus/Oracle/Librarian/Explore in parallel (Ultimate).
3. **Team Mode** — lead + ≤8 parallel members, tmux grid, `team_*` tools (Ultimate).
4. **IntentGate** — intent analysis before classification/action (Ultimate; Light only recognizes the keyword).
5. **Hash-Anchored Edit Tool ("Hashline")** — every read line tagged `LINE#ID` with a content hash (`11#VK| function hello() {`); a stale hash rejects the edit before corruption. Inspired by `can1357/oh-my-pi` and Can Bölük's "The Harness Problem" (https://blog.can.ac/2026/02/12/the-harness-problem/).
6. **LSP integration** — `lsp_rename`, `lsp_goto_definition`, `lsp_find_references`, `lsp_diagnostics` (Both).
7. **AST-Grep** — pattern-aware search/rewrite across **25 languages** (Ultimate).
8. **Background Agents** — 5+ specialists in parallel, context stays lean (Ultimate).
9. **Built-in MCPs** — Exa (web search), Context7 (official docs), Grep.app (GitHub code search); always on (Ultimate).
10. **Goal / `/goal`** — persistent per-session objective, continuation re-injected on every idle until completion audit passes (Ultimate).
11. **Todo Enforcer** — idle agent is forcibly resumed (Ultimate).
12. **Comment Checker** — blocks "AI slop" comments (Both).
13. **Rules Injection** — `AGENTS.md` / `.omo/rules/**` auto-loaded every prompt (Both).
14. **Ulw Loop** — durable multi-goal orchestration with evidence audit, `.omo/ulw-loop/` (Both).
15. **Tmux Integration** — full interactive terminal, REPLs/debuggers/TUIs (Ultimate).
16. **Claude Code Compatible** — hooks, commands, skills, MCPs, plugins work unchanged (Ultimate).
17. **Skill-Embedded MCPs** — skills carry their own MCP servers, spun up on demand, scoped, then torn down (Ultimate).
18. **Prometheus Planner** — interview-mode planning before execution (Ultimate).
19. **`/init-deep`** — auto-generates hierarchical `AGENTS.md` files throughout a project (Ultimate).
20. **Built-in skills** — `playwright`, `git-master`, `frontend`, `ast-grep`, `coding-agent-sessions`; user skills under `.opencode/skills/*/SKILL.md`.

Modes named in the install guide: `ultrawork`, `search`, `analyze`, `team`, `hyperplan`.

## 4. Benchmarks — **OMO publishes essentially none**

This is the clearest negative finding. Searching the README for benchmark terms yields **exactly one quantitative claim**, and it is not a standard benchmark:

> "Grok Code Fast 1: **6.7% → 68.3%** success rate, just from changing the edit tool."

That is an internal edit-tool success-rate claim for Hashline. **No harness, no dataset, no task count, no date, and no methodology are published alongside it.** Treat it as a marketing number, not a reproducible benchmark.

There is **no GAIA, SWE-bench, SWE-bench Verified, terminal-bench, τ-bench, WebArena, or browser-task table** anywhere in the README or the ROADMAP. The single "terminal-bench" string in the README is a **hyperlink target** on the IntentGate row (https://factory.ai/news/terminal-bench) — i.e. an attribution to Factory.ai's terminal-bench writeup as the idea's origin, **not** an OMO score.

The rest of the evidence OMO offers is **testimonial**: quotes from X/Twitter users, a YouTube review, and claims like "Kimi K3 + GPT-5.6 Sol already beats vanilla Claude Code" — with no measurement behind it.

**Statement: as of 2026-08-19, oh-my-openagent publishes no standard agent-benchmark scores.** (A docs-site-only benchmark page was not found on the `dev` branch; if one exists on https://omo.vibetip.help/docs it is **unverified** here.)

## 5. Shipped in the last ~3 months

Quantitatively: 6,890 commits and 1,431 merged PRs on `dev` since 2026-05-19, and the entire v4.19.x → v5.0.0-beta.11 range.

Qualitatively, from release notes and ROADMAP status:
- **v5.0.0 major line (2026-08-09 →)** — the breaking change is the rename/repackaging: `oh-my-opencode` → `oh-my-openagent`, and the `omo` bin removed from the plugin packages in favor of the senpi-native `omo-ai`.
- **Memory subsystem** (`memory-core`) — memory pressure signal, automatic dream runs on threshold crossing, enforced dream token budgets with per-file estimates, memory-file access ledger, evidence-driven dream tier rebalancing, reflection retries through provider outages.
- **mass-ulw DAG gate** — advisory planning warnings, spawn-policy dispatch for dag agent-nodes, blocked extension reload during in-flight DAG runs.
- **Codex Light edition / LazyCodex** — `npx lazycodex-ai install`, `~/.codex/plugins/cache/sisyphuslabs/omo/`, Codex marketplace integration, optional autonomous-permissions mode.
- **Senpi standalone edition (beta)** — `omo-ai@beta`, bundled Senpi `2026.8.18-3`: TUI clipboard image paste, Cursor context-window corrections (Claude/GPT-5.5/5.6 at 1M, Grok at 500K), resumable goals, full retry budgets, compaction no longer discarding typed messages, headless OAuth continuity, Linux glibc binary preference.
- **`omo-config-core` / `omo.json`** — harness-neutral schema, multi-layer loader, comment-preserving atomic writer; in production for the Senpi `task` component only.
- **Pi adapters** — `pi-goal` and `pi-webfetch` standalone adapters landed.
- **Package layering refactor** — 19 Core packages extracted; `lsp-tools-mcp`/`lsp-daemon` de-tangled onto `lsp-core` + `mcp-stdio-core`.
- **Windows fixes** — memory-ledger path-separator normalization (Windows reads were going uncounted), reflection health report dormant-streak mis-reporting.
- Roadmap-forward: adopting `omo.json` in the OpenCode edition + a migration path from `oh-my-openagent.json` is explicitly "the next phase". Pi Engine DI abstraction **deferred**.

## 6. Ecosystem

**Harness integrations (first-party):** OpenCode (largest adapter), OpenAI Codex CLI, Senpi, Pi (goal + webfetch adapters). ROADMAP lists Claude Code, Amp, Droid as **exploratory and not confirmed**.

**MCP integrations shipped:** Exa (web search), Context7 (docs), Grep.app (GitHub code search), `codegraph`, `git_bash`, `lsp` (`lsp-tools-mcp` + `lsp-daemon`), `ast-grep-mcp`.

**Extension model — yes, several layers:**
- **Skills**: `.opencode/skills/*/SKILL.md` or `~/.config/opencode/skills/*/SKILL.md`; scope priority project > opencode > user > builtin; skills can embed their own MCP servers and carry scoped permissions.
- **Claude Code compatibility**: hooks, commands, skills, MCPs, and plugins claimed to work unchanged (Ultimate only).
- **Rules**: `AGENTS.md` and `.omo/rules/**`.
- **Config**: `.opencode/oh-my-openagent.jsonc` (project) / `~/.config/opencode/...` (user); `omo.json` for Senpi.
- OMO is itself distributed **as a plugin** into two hosts, so its own primary mode of existence is as an extension.

**Who uses it:** hard evidence is adoption metrics, not named enterprises — 68k stars, 5.5k forks, ~335 contributors, ~97k npm downloads/month, a Discord community (server id 1452487457085063218). README cites individual practitioner testimonials (Arthur Guiot, Jacob Ferrari, James Hargis, Henning Kilset, mysticaltech) and a YouTube review. **No named organizational adopters are published — unverified.**

**Commercial surround:** Sisyphus Labs (https://sisyphuslabs.ai) with a "Dori" AI assistant waitlist; `lazycodex.ai`; `omo.dev`. The **SUL-1.0** license restricts commercial and paid redistribution, which materially limits ecosystem forking.

**Notable external relationship:** README claims Anthropic blocked OpenCode "because of us", citing https://x.com/thdxr/status/2010149530486911014.

## 7. Weaknesses, criticisms, limitations

### By the numbers
462 open issues (780 open issues+PRs). Label taxonomy is per-package (`memory-core`, `team-core`, `lsp-daemon`, `hashline-core`, `senpi-task`, ...) plus a heavy triage system (`triage:needs-investigation`, `triage:feature-request`, `blocked-upstream`, `wontfix`).

### Open-issue clusters (top by comment count)
- **Background/subagent task lifecycle**: #4095 `background_output` still returns "Task not found" after PR #4015 (macOS + Windows); #6487 a single `task()` invocation spawns **duplicate parallel subagent sessions** in the same worktree; #1734 background task output distillation + non-destructive recovery.
- **Team Mode reliability**: #5317 `team_send_message` member replies lost in OpenCode 4.10.0 (regression from 4.9.2); #6922 completed resident members vanishing from the team widget (fixed in beta.11).
- **Platform/Windows**: #3408 Windows Terminal garbled text and unresponsive after LLM response (Windows 11), labeled `blocked-upstream`; Windows path-separator bug in the memory ledger (fixed beta.11).
- **Model routing brittleness**: #3198 MiniMax 2.7 agents stop unexpectedly during plan execution; #839 proposal to centralize hardcoded model references into configurable constants (**directly confirms the hardcoded-leaderboard criticism in the local audit**); #1637 native OpenRouter provider support still open; #3649 DeepSeek V4 support request.
- **Robustness**: #6391 long user prompt crashes with `InvalidObjectiveError` above 2,000 characters; #6237 codegraph "not installed and cannot be enabled".
- **Prompt-injection/loop hazards**: #2632 (confirmed) Prometheus review loop reinjects agent/tool output into the main session and **consumes Copilot premium requests as user prompts** — a real cost leak.
- **Feature demand**: #1397 automated learning capture (64 comments, the most-discussed issue), #854 unified spec-driven `/omo-spec` workflow, #673 CLI disable command, #190 a light `ultrawork`, #1153 Zellij support (tmux dependency is a portability complaint), #1346 proactive handoff/session rotation to avoid auto-compaction quality loss.

### Maintainer-stated limitations (`docs/reference/known-issues.md`)
- **#5911** worktree can report "already merged" while dirty/untracked task-state files still exist only in the worktree — risks users believing work is integrated when it is not.
- **#5850** the `ulw` planner can fall into OpenCode's **native** plan mode, writing to `.opencode/plans/` instead of `.omo/plans/`, and a nested unresolved `plan_exit` prompt leaves the synchronous parent hanging.
- **#5806** `ulw` mode **does not persist across follow-up messages** — the keyword detector is edge-triggered per message; users must repeat `ulw` every turn.
- **#5746 / #5809** tmux subagent panes only attach after manual focus ("Focus this pane to attach"); under cmux they may never attach at all.
- **#5838** LazyCodex frontend runs can skip the visual QA gate because Codex enforces it by prose, not a hard completion gate.

### Structural / architectural criticisms
- **Multi-harness is aspirational, not achieved.** ROADMAP: "The current codebase is still strongly coupled to OpenCode in its largest adapter." Editions are **not** feature-equivalent — Light has no orchestration and no `team_*` tools at all.
- **Two disconnected config systems.** `omo.json` and `oh-my-openagent.json` have "zero interaction today" (ROADMAP).
- **Explicit anti-abstraction stance.** ROADMAP is "skeptical" of a unified hook layer and prefers duplication: *"Premature 'adapter pattern' abstraction across unstable interfaces causes more pain than duplication."* Defensible, but it means cross-harness guarantees stay per-adapter.
- **Self-acknowledged host fragility.** ROADMAP "Why Not OpenCode-Native": OpenCode's plugin API "makes it trivial to break the main agent loop"; asynchronous prompt acceptance can cause duplicate work, infinite loops, and state corruption.
- **Hardcoded model leaderboards.** `ultrabrain → GPT-5.6 Sol xhigh`, Sisyphus → `claude-opus-5`/`kimi-k3`/`glm-5`. Semantic-routing rhetoric, curated-ranking implementation. Issue #839 is the community pushing back.
- **Bus factor ≈ 1.** Owner-attributed commits are 60–95% of weekly volume in every recent week. Combined with ~1,400 merged PRs/quarter and agent-authored code ("99% of this project was built with OpenCode"; "I don't really know TypeScript"), review depth is a legitimate concern.
- **Licensing.** SUL-1.0 is not OSI-approved and restricts commercial/paid distribution — code cannot be freely reused, only ideas.
- **Telemetry on by default.** `omo_daily_active` / `omo_codex_daily_active` to PostHog, once per UTC day per machine, SHA256-hashed install id. Opt-out requires `"telemetry": false`, `OMO_DISABLE_POSTHOG=1`, or `OMO_SEND_ANONYMOUS_TELEMETRY=0` (plus `OMO_CODEX_*` variants).
- **Onboarding complexity is admitted.** README: *"Strongly recommended: let an LLM agent install this for you... humans fat-finger these."* Requiring an AI to install your AI tool is a usability tell, and the LazyCodex push exists precisely because "the setup felt like too much".
- **Version churn.** 11 prereleases in 10 days on a 5.0.0 major, with prerelease flags inconsistently set (beta.1–beta.7 mixed `prerelease: true/false`).

## 8. Delta vs the existing local notes

The local notes were pinned at `038ed0c` and remain **directionally accurate** on config layering, category routing, Senpi task lifecycle, telemetry, and the OpenCode-coupling critique. What has changed:
- Scale is far larger than the notes imply: 68k stars, ~335 contributors, ~97k npm downloads/month.
- Version has moved to the **v5.0.0-beta** line with a completed rename to `oh-my-openagent`.
- **`memory-core`** (memory pressure, dream consolidation, access ledger) is entirely new.
- **mass-ulw DAG** orchestration is new.
- **Ralph Loop was removed**; Goal replaced it.
- **Codex Light / LazyCodex** matured into its own installer package and brand.
- **Pi adapters** (`pi-goal`, `pi-webfetch`) landed.
- Category names shifted: the notes' `quick`/`deep`/`visual-engineering` persist; `ultrabrain` is the current README headline category.
- The notes' criticism of hardcoded model chains is now **independently corroborated by open issue #839**.

## 9. Explicitly unverified
- Any benchmark table on https://omo.vibetip.help/docs (docs site not fetched; nothing on `dev`).
- Named organizational/enterprise adopters.
- The internal design of the mass-ulw DAG (no public design doc found).
- Whether the "6.7% → 68.3%" Hashline figure is reproducible; no methodology published.
- Real-world equivalence of the three editions beyond what README/ROADMAP state.
