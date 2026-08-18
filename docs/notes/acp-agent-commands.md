# ACP Agent Spawn Commands — Research Notes

Scope: for each agent, the exact command an ACP **client** spawns to speak Agent Client Protocol (JSON-RPC 2.0) over stdio.
Authoritative baseline: the official ACP agent list at `docs/get-started/agents.mdx` in `agentclientprotocol/agent-client-protocol`, the Zed ACP Registry pages under https://zed.dev/acp/agent/<id>, and each vendor's own docs/repo.

Research date: this session. Verified by fetching upstream sources directly (curl) plus Exa web search; `web_search` was unavailable (no DeepSeek API key), so agent-reach/Exa + direct HTTP were used.

---

## Summary table

| Agent | Speaks ACP? | command | args | Package / binary | Env var (API key) | Source |
|---|---|---|---|---|---|---|
| Codex CLI (OpenAI) | Yes — via adapter | `npx` | `["-y","@agentclientprotocol/codex-acp"]` | npm `@agentclientprotocol/codex-acp` (bin `codex-acp`) | `CODEX_API_KEY` (pref.) / `OPENAI_API_KEY` | https://github.com/agentclientprotocol/codex-acp |
| Claude Code / Claude Agent (Anthropic) | Yes — via Zed adapter | `npx` | `["-y","@agentclientprotocol/claude-agent-acp"]` | npm `@agentclientprotocol/claude-agent-acp` (bin `claude-agent-acp`); old `@zed-industries/claude-code-acp` is **deprecated/renamed** | `ANTHROPIC_API_KEY` (Claude Agent SDK convention; adapter README does not restate it) | https://github.com/zed-industries/claude-agent-acp |
| oh-my-pi (`omp`) | Yes — native | `omp` | `["acp"]` | npm `@oh-my-pi/pi-coding-agent` (bin `omp`) | Provider keys configured in omp itself (not documented as a single ACP env var) | https://github.com/can1357/oh-my-pi |
| Kimi CLI / Kimi Code CLI (Moonshot) | Yes — native | `kimi` | `["acp"]` | `kimi-cli` (Python/uv) → superseded by **Kimi Code CLI** install script | Login via `/login` (OAuth); no ACP-specific env var documented | https://github.com/MoonshotAI/kimi-cli, https://github.com/MoonshotAI/kimi-code |
| zcode (ZCode / GLM desktop app) | Yes — via **third-party** adapter only | `node` | `["/abs/path/zcode-acp-server/dist/index.js"]` | `zcode-acp-server` (build from source; npm 0.1.0) | none editor-side; `ZCODE_BIN` points at the CLI; GLM key read from `~/.zcode/v2/config.json` | https://github.com/william0wang/zcode-acp |
| Grok Build / Grok CLI (xAI) | Yes — native | `npx` | `["@xai-official/grok@1.0.4","agent","stdio"]` | npm `@xai-official/grok` (bin `grok`) | `XAI_API_KEY` (xAI convention; not restated on the ACP page) | https://zed.dev/acp/agent/grok-build, https://docs.x.ai/build/cli/reference |
| pi (Pi Coding Agent, badlogic/earendil-works) | Yes — via adapter (no native ACP) | `npx` | `["-y","pi-acp"]` | npm `pi-acp` (bin `pi-acp`); alt `pi-acpinator` (Rust) | none for the adapter; pi's own provider keys configured via the `pi` CLI | https://github.com/svkozak/pi-acp |
| GitHub Copilot CLI | Yes — native | `copilot` | `["--acp"]` (stdio is the default; `--stdio` may be passed explicitly) | `@github/copilot` CLI (bin `copilot`) | `GH_TOKEN` / `GITHUB_TOKEN` or `copilot` login (no ACP-specific var) | https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server |
| Hermes Agent (Nous Research) | Yes — native | `hermes` | `["acp"]` (or bare `hermes-acp`) | Python package `hermes-agent` with the `[acp]` extra | none; provider creds in `~/.hermes/.env` via `hermes model` | https://hermes-agent.nousresearch.com/docs/user-guide/features/acp |

---

## 1. Codex (OpenAI Codex CLI)

- **Official name / vendor:** Codex CLI — OpenAI. ACP adapter maintained by Zed Industries under the `agentclientprotocol` org.
- **ACP support:** **Via adapter.** `codex-acp` is a stdio ACP agent server that starts the Codex App Server and translates ACP ⇄ Codex. Codex CLI itself exposes the App Server JSON-RPC, not ACP.
- **Spawn command:** `command: "npx", args: ["-y", "@agentclientprotocol/codex-acp"]`
  - Global-install alternative: `command: "codex-acp", args: []`
- **Package / install:** `npx -y @agentclientprotocol/codex-acp` or `npm install -g @agentclientprotocol/codex-acp` (current npm version 1.1.14; bundles a compatible `@openai/codex`).
- **Env vars:** `CODEX_API_KEY` (takes precedence) or `OPENAI_API_KEY`. Also `CODEX_PATH`, `CODEX_CONFIG`, `MODEL_PROVIDER`, `INITIAL_AGENT_MODE`, `NO_BROWSER`, `APP_SERVER_LOGS`. ChatGPT OAuth login is also an advertised auth method.
- **Source:** https://github.com/agentclientprotocol/codex-acp (README); listed on https://agentclientprotocol.com/get-started/agents

## 2. Claude Code (Anthropic)

- **Official name / vendor:** Claude Agent SDK / Claude Code — Anthropic. Adapter by Zed Industries.
- **ACP support:** **Via adapter.** The adapter implements an ACP agent on top of the official Claude Agent SDK.
- **Spawn command:** `command: "npx", args: ["-y", "@agentclientprotocol/claude-agent-acp"]`
  - Global-install alternative: `command: "claude-agent-acp", args: []`
- **Important correction to the task premise:** `@zed-industries/claude-code-acp` (last version 0.16.2) is **deprecated** — npm metadata says: *"This package has been renamed to @agentclientprotocol/claude-agent-acp. Please migrate to continue receiving updates."* The old `npx @zed-industries/claude-code-acp` still resolves but is stale. Current version of the new package: 0.66.0.
- **Package / install:** `npm install -g @agentclientprotocol/claude-agent-acp` (bin `claude-agent-acp` → `dist/index.js`).
- **Env var:** `ANTHROPIC_API_KEY` is the Claude Agent SDK's standard variable; the adapter README does not itself document an env var (it defers to the SDK / existing Claude Code login). Treat the specific variable as *inferred from the SDK*, not stated by the adapter.
- **Source:** https://github.com/zed-industries/claude-agent-acp (redirects to the renamed repo), https://www.npmjs.com/package/@agentclientprotocol/claude-agent-acp

## 3. oh-my-pi

- **Official name / vendor:** oh-my-pi (`omp`) — community project by `can1357`; a fork of Pi by Mario Zechner (badlogic). MIT.
- **ACP support:** **Native.** README section "ACP — speak to editors": *"`omp acp` … The Agent Client Protocol over JSON-RPC."* Source file `packages/coding-agent/src/modes/acp/acp-agent.ts` imports `@agentclientprotocol/sdk`. It is also visible as a dimension (`oh-my-pi`) in Zed's ACP usage telemetry on https://zed.dev/acp.
- **Spawn command:** `command: "omp", args: ["acp"]`
- **Package / install:** npm `@oh-my-pi/pi-coding-agent` (bin `omp`, version 17.2.12) — `npm install -g @oh-my-pi/pi-coding-agent`.
- **Env var:** not documented as a single ACP-level key; omp uses its own provider configuration. **UNVERIFIED** for a specific env var name.
- **Source:** https://github.com/can1357/oh-my-pi
- Note: oh-my-pi is **not** on the official `agents.mdx` list; the native `omp acp` command is documented in its own README, which is authoritative for the command itself.

## 4. Kimi Code / Kimi CLI (Moonshot AI)

- **Official name / vendor:** Kimi CLI, now evolving into **Kimi Code CLI** — Moonshot AI. Both listed/served under the same `kimi` binary.
- **ACP support:** **Native, out of the box** ("Kimi CLI supports Agent Client Protocol out of the box"). Zed registry page: "Moonshot AI's CLI coding agent with native ACP support."
- **Spawn command:** `command: "kimi", args: ["acp"]` — identical for both Kimi CLI and Kimi Code CLI. Verbatim Zed config from the Kimi README:
  ```json
  { "agent_servers": { "Kimi CLI": { "type": "custom", "command": "kimi", "args": ["acp"], "env": {} } } }
  ```
- **Package / install:**
  - Kimi CLI (legacy, Python/uv): see https://moonshotai.github.io/kimi-cli/en/guides/getting-started.html
  - Kimi Code CLI (current): `curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash` (POSIX) or `irm https://code.kimi.com/kimi-code/install.ps1 | iex` (Windows). Single-binary, no Node required. npm install path also exists.
- **Env var:** none for ACP — you must run `kimi` in a terminal and `/login` first; the ACP session reuses that login. (`KIMI_SHELL_PATH` on Windows selects Git Bash, unrelated to auth.)
- **Source:** https://github.com/MoonshotAI/kimi-cli, https://github.com/MoonshotAI/kimi-code, https://zed.dev/acp/agent/kimi-cli

## 5. zcode

- **Official name / vendor:** **ZCode** — the GLM/Z.ai desktop coding app (the `zcode` CLI ships bundled inside it). The ACP layer is **third-party**: `zcode-acp-server` by `william0wang`.
- **ACP support:** **Via a third-party adapter only.** ZCode itself exposes `zcode app-server --stdio` (its own protocol), not ACP; the bridge spawns that and translates to ACP. There is **no vendor-official ACP support found**, and zcode is **not** on the official `agents.mdx` list.
- **Spawn command (adapter, from source build):**
  ```json
  { "agent_servers": { "ZCode": { "type": "custom", "command": "node",
      "args": ["/absolute/path/to/zcode-acp-server/dist/index.js"],
      "env": { "ZCODE_BIN": "/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs" } } } }
  ```
  Also exposes a `zcode-acp-server` bin, and claims ACP Registry compatibility.
- **Package / install:** `git clone` → `pnpm install && pnpm build`; npm package `zcode-acp-server` exists at 0.1.0. Requires Node ≥ 22 and the `zcode` CLI on PATH (or `ZCODE_BIN`).
- **Env vars:** `ZCODE_BIN`, `ZCODE_NODE`, `ZCODE_MODEL`, `ZCODE_BASE_URL`. **No API key env var** — the GLM API key is read from `~/.zcode/v2/config.json`.
- **Source:** https://github.com/william0wang/zcode-acp

## 6. Grok Build / Grok CLI (xAI)

- **Official name / vendor:** **Grok Build** (the `grok` CLI) — xAI. Official npm scope `@xai-official`.
- **ACP support:** **Native.** xAI's CLI reference lists `grok agent stdio` — *"Run as an ACP agent over stdin/stdout"*. Grok Build has a Zed ACP Registry page.
- **Spawn command (as published by the Zed ACP Registry):**
  `command: "npx", args: ["@xai-official/grok@1.0.4", "agent", "stdio"]`
  - If `grok` is installed: `command: "grok", args: ["agent", "stdio"]` (a user-reported working Zed config uses `command: "~/.grok/bin/grok", args: ["agent","stdio"]`).
  - Caveat: npm currently publishes up to **1.0.1**; the registry page pins `@1.0.4`. Version pin may be ahead of / different from the public npm dist-tags at time of reading — pin what your registry entry says, or drop the pin.
- **Package / install:** npm `@xai-official/grok` (bin `grok`), or xAI's own installer into `~/.grok/bin/grok`.
- **Env var:** `XAI_API_KEY` is xAI's standard variable, but the ACP page does not state it — treat as **inferred**, not directly evidenced by the ACP docs.
- **Source:** https://zed.dev/acp/agent/grok-build, https://docs.x.ai/build/cli/reference

## 7. pi (Pi Coding Agent)

- **Official name / vendor:** **Pi** coding agent — Mario Zechner / earendil-works (`@earendil-works/pi-coding-agent`). Zed calls it "Pi Coding Agent".
- **ACP support:** **Via adapter.** The official ACP list entry reads: *"Pi … (via pi-acp adapter)"*. `pi` itself exposes `pi --mode rpc`, and the adapter bridges that to ACP JSON-RPC over stdio.
- **Spawn command:** `command: "npx", args: ["-y", "pi-acp"]`
  - Global install: `command: "pi-acp", args: []`
  - From source: `command: "node", args: ["/path/to/pi-acp/dist/index.js"]`
  - Rust alternative (third-party): `command: "npx", args: ["pi-acpinator"]` — https://github.com/ahmadaccino/pi-acpinator
- **Package / install:** `npm install -g pi-acp`; prerequisite `npm install -g @earendil-works/pi-coding-agent` (pi ≥ 0.80.4, Node 22+).
- **Env var:** no API key var for the adapter — pi is configured separately for model providers/keys. Adapter-only knob: `PI_ACP_ENABLE_EMBEDDED_CONTEXT=true`.
- **Source:** https://github.com/svkozak/pi-acp, https://agentclientprotocol.com/get-started/agents

## 8. GitHub CLI / GitHub Copilot CLI

- **Official name / vendor:** **GitHub Copilot CLI** (`copilot`) — GitHub. Note this is *not* `gh`, the GitHub CLI; `gh` does not speak ACP.
- **ACP support:** **Native, public preview** (announced 2026-01-28).
- **Spawn command:** `command: "copilot", args: ["--acp"]`
  - stdio is the default transport; `copilot --acp --stdio` is the explicit form. TCP alternative: `copilot --acp --port 8080` (not stdio, so not what an ACP client spawning a subprocess uses).
- **Package / install:** `npm install -g @github/copilot` (bin `copilot`).
- **Env var:** authentication is via `copilot` login / `GH_TOKEN` or `GITHUB_TOKEN`; **no ACP-specific env var is documented**. Treat the exact token variable as inferred from Copilot CLI's general auth docs.
- **Source:** https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server, https://github.blog/changelog/2026-01-28-acp-support-in-copilot-cli-is-now-in-public-preview/

## 9. Hermes

- **Official name / vendor:** **Hermes Agent** — Nous Research.
- **ACP support:** **Native** (via an optional `[acp]` install extra that pulls in the `agent-client-protocol` dependency).
- **Spawn command:** `command: "hermes", args: ["acp"]`
  - Equivalent launchers: `hermes-acp` (bare, `args: []`) and `python -m acp_adapter`.
  - Verbatim Zed config from the docs:
    ```json
    { "agent_servers": { "hermes-agent": { "type": "custom", "command": "hermes", "args": ["acp"] } } }
    ```
- **Package / install:** install Hermes normally, then `cd ~/.hermes/hermes-agent && uv pip install -e '.[acp]'`. Recent installs write both `hermes` and `hermes-acp` into `~/.local/bin`; `hermes update` backfills `hermes-acp`.
- **Env var:** no ACP-specific API key var. Credentials come from Hermes' normal resolver — `hermes model` or editing `~/.hermes/.env`. Hermes also advertises a terminal auth method (`hermes acp --setup`). Unrelated `BUZZ_*` vars configure the optional buzz-acp relay bridge.
- **Source:** https://hermes-agent.nousresearch.com/docs/user-guide/features/acp, https://hermes-agent.nousresearch.com/docs/reference/cli-commands

---

## Confidence and caveats

- **Fully evidenced commands** (vendor/adapter docs state the exact command): Codex, Claude, oh-my-pi, Kimi, zcode, Grok Build, pi, Copilot CLI, Hermes. All nine resolved.
- **Partially unverified — env vars only:** the API-key variable for **Claude** (`ANTHROPIC_API_KEY`), **Grok** (`XAI_API_KEY`), **Copilot** (`GH_TOKEN`/`GITHUB_TOKEN`), and **oh-my-pi** (unknown) is *not* stated in the respective ACP documentation. Those four are inferences from each vendor's general conventions; do not rely on them without checking the vendor's auth docs.
- **Version drift:** `@xai-official/grok@1.0.4` is what the Zed registry page prints, but public npm shows 1.0.1 as the newest published version. Verify before pinning.
- **Deprecation:** `@zed-industries/claude-code-acp` is deprecated in favour of `@agentclientprotocol/claude-agent-acp`. Update any hardcoded `npx @zed-industries/claude-code-acp`.
- **Not vendor-official:** the ACP layer for **zcode** and for **pi** is community-maintained, not vendor-shipped.
- **Name collisions to avoid:** "Pi" (earendil-works) vs "oh-my-pi" (`omp`, a fork) are different agents with different commands. "GitHub CLI" (`gh`) does not speak ACP; only "GitHub Copilot CLI" (`copilot`) does.
