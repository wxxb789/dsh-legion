# DeepSeek Harness Package Catalog — Decision-Grade Reference for Plugin Authors

Source of truth: local checkout `Q:\repos\deepseek-harness` (mirror of
`https://github.com/deepseek-ai/deepseek-harness/tree/master/packages`).
Read-only audit. Every fact below was read from `package.json`, `src/`, or `README.md` in that checkout.

## 4. Version (reported first because it qualifies everything else)

- Root manifest `package.json`: `@deepseek-ai/dsh-root`, version **0.1.1-rc.2**, `private: true`.
- **All 227 workspace packages under `packages/` carry the identical version `0.1.1-rc.2`** — this is a lockstep-versioned monorepo. There is no per-package version drift to reason about.
- Package manager `pnpm@11.7.0`; engines `node: ^22.19.0 || >=24.0.0`.
- Workspace globs: `vendor/*`, `packages/*/*` (two levels deep — packages are grouped by family directory), `native/landlock-run`, `apps/*`, `website`.
- No root `CHANGELOG.md` exists in the checkout, so the only version statement available is the manifest. `0.1.1-rc.2` is a release-candidate line; treat the public API as pre-stable.
- Only two packages are `private: true` and therefore **not published**: `@deepseek-ai/dsh-experimental-agent-team` and `@deepseek-ai/dsh-experimental-tool-agent-team`. A third-party plugin must not depend on those two.

## 1. Full Package Inventory (227 packages, sorted by name)

| Package | Version | Description |
|---|---|---|
| `@deepseek-ai/dsh-acp-demo` | 0.1.1-rc.2 | ACP automation server app: agent spine + JSONL persistence + ACP transport, with a JSON-RPC stdio bin |
| `@deepseek-ai/dsh-acp-snapshot` | 0.1.1-rc.2 | ACP test kit: shared subprocess launcher, snapshot scenario harness, expected-output normalizers, and suite factory |
| `@deepseek-ai/dsh-acp` | 0.1.1-rc.2 | Automation-only Agent Client Protocol server for driving DeepSeek Harness agents over JSON-RPC stdio |
| `@deepseek-ai/dsh-agent-default-model` | 0.1.1-rc.2 | Default model selection shared by Agent entry points |
| `@deepseek-ai/dsh-agent-instructions` | 0.1.1-rc.2 | Workspace context loader for AGENTS.md/CLAUDE.md instruction files |
| `@deepseek-ai/dsh-agent-loop-testkit` | 0.1.1-rc.2 | Shared prerequisite mounting for tests that exercise the concrete agent loop |
| `@deepseek-ai/dsh-agent-loop` | 0.1.1-rc.2 | The concrete agent loop plugin for the DeepSeek Harness |
| `@deepseek-ai/dsh-agent-presets` | 0.1.1-rc.2 | Per-session agent composition from preset cordis.yml files for the DeepSeek Harness |
| `@deepseek-ai/dsh-agent-spine-demo` | 0.1.1-rc.2 | The default executor-less/UI-less agent spine with fallback session titles, provider-routed retry, and optional persisted goals |
| `@deepseek-ai/dsh-agent-tool-presentation` | 0.1.1-rc.2 | Agent-plane presentation selector: composes one agent's tools as Code Mode, native, or both |
| `@deepseek-ai/dsh-agent` | 0.1.1-rc.2 | Agent interface, registry, initiator scope, and event vocabulary for the DeepSeek Harness |
| `@deepseek-ai/dsh-anonymous-user-id` | 0.1.1-rc.2 | Shared anonymous user identity for DeepSeek Harness telemetry and feedback correlation |
| `@deepseek-ai/dsh-api-gateway` | 0.1.1-rc.2 | Typert Remote Host dispatcher and Client API endpoint |
| `@deepseek-ai/dsh-api-remotes` | 0.1.1-rc.2 | Remote BFF assembly and Host Agent/Session lookup policy |
| `@deepseek-ai/dsh-app-boot` | 0.1.1-rc.2 | Shared boot glue for the app bins: .env loading, fail-loud Loader guards, snapshot-aware config resolution, and the Loader boot sequence |
| `@deepseek-ai/dsh-atomic-write` | 0.1.1-rc.2 | Zero-dependency atomic file replacement: exclusive-create random-suffix temp + rename carrying the caller-stated permissions (writeFileAtomic) |
| `@deepseek-ai/dsh-attachment-local` | 0.1.1-rc.2 | Private content-addressed DSH_HOME attachment storage |
| `@deepseek-ai/dsh-attachment` | 0.1.1-rc.2 | Durable immutable attachment storage seam for the DeepSeek Harness |
| `@deepseek-ai/dsh-authorization` | 0.1.1-rc.2 | Authorization seam (ctx.authorization): plugin-owned flows that obtain a credential through a conversation with the human |
| `@deepseek-ai/dsh-base` | 0.1.1-rc.2 | The shared dsh core as a profile bundle: every profile's first patch layer, inserting the base plugin rows over the empty profile root |
| `@deepseek-ai/dsh-bash-local` | 0.1.1-rc.2 | Local-subprocess implementation of the DeepSeek Harness bash executor seam |
| `@deepseek-ai/dsh-bash-sandbox` | 0.1.1-rc.2 | Sandbox-consuming implementation of the DeepSeek Harness bash executor seam (confines every command via ctx.sandbox, reports denial/enforcement result facts) |
| `@deepseek-ai/dsh-brand` | 0.1.1-rc.2 | Type-only Branded<B> nominal-typing primitive for the DeepSeek Harness |
| `@deepseek-ai/dsh-client-connection` | 0.1.1-rc.2 | Wire consumer layer: HTTP-up/WebSocket-down client, ConnectionController dual streams with reconnect, and fixture api |
| `@deepseek-ai/dsh-client-hmr` | 0.1.1-rc.2 | Dev-only hot-reload driver for script-loaded client entries: SSE rebuilt frames → invalidate/prefetch → fiber swap through the vendored Loader entry |
| `@deepseek-ai/dsh-client-locale` | 0.1.1-rc.2 | Locale plugin: Host-backed zh/en preference, browser-derived fallback, locale snapshots, and typed namespace dictionaries |
| `@deepseek-ai/dsh-client-modules` | 0.1.1-rc.2 | Client module system, dual-face: node half composes the __DSH_BOOT__ entry graph (incremental dsh.client scan, bundle route, index tap, webPlugins service); browser half is the lazy-CJS module table the vendored cordis Loader consumes as its internal seam |
| `@deepseek-ai/dsh-client-runtime` | 0.1.1-rc.2 | Client core services: SlotRegistry, SessionRuntime (scope tree + object layer) |
| `@deepseek-ai/dsh-client-test-runtime` | 0.1.1-rc.2 | jsdom slot test runtime: real Cordis Context + SlotRegistry + UI renderer with test-owned session/workspace doubles for feature specs |
| `@deepseek-ai/dsh-client-ui-agent-preset` | 0.1.1-rc.2 | Agent-preset surfaces: the default for later sessions, this session's seat, and the composition editor |
| `@deepseek-ai/dsh-client-ui-attachment` | 0.1.1-rc.2 | Dynamic attachment presentation plugin for conversation input and message-image slots |
| `@deepseek-ai/dsh-client-ui-brand-official` | 0.1.1-rc.2 | Official DeepSeek Harness brand occupants for the Web client's sidebar and conversation Hero slots |
| `@deepseek-ai/dsh-client-ui-commands` | 0.1.1-rc.2 | Client command surface: global directory cache, '/' source, three command UI kinds, popupSelect registry |
| `@deepseek-ai/dsh-client-ui-conversation` | 0.1.1-rc.2 | Conversation domain: skeleton, ordered chat flow, composer with the Host-backed busy-Enter preference, and details host |
| `@deepseek-ai/dsh-client-ui-cordis` | 0.1.1-rc.2 | Cordis dynamic-plugin definition card: the keyed cordis_define tool row with its run/stop switch |
| `@deepseek-ai/dsh-client-ui-deliverables` | 0.1.1-rc.2 | Produced-files turn tail and clickable final-response file references for Web |
| `@deepseek-ai/dsh-client-ui-directory-picker-browse` | 0.1.1-rc.2 | In-app directory browsing surface: the workspace directory-flow owner rendering the host's listing and creation primitives |
| `@deepseek-ai/dsh-client-ui-directory-picker-native` | 0.1.1-rc.2 | Native directory-picker surface: the renderless workspace directory-flow occupant driving the host's OS chooser |
| `@deepseek-ai/dsh-client-ui-goal` | 0.1.1-rc.2 | Session goal surface: GoalBar docked above the composer, read from the goal session projection |
| `@deepseek-ai/dsh-client-ui-input-trigger` | 0.1.1-rc.2 | Input trigger pipeline: '/' and '@' detection, candidate menu, pick routing to registered sources |
| `@deepseek-ai/dsh-client-ui-jobs` | 0.1.1-rc.2 | Session-header background-job list: live registry state mirrored from session/jobs frames |
| `@deepseek-ai/dsh-client-ui-layout` | 0.1.1-rc.2 | Shell plugin: three-column AppFrame with drag handles, ctx.layout viewing-state service (navigation + panels) |
| `@deepseek-ai/dsh-client-ui-message-feedback` | 0.1.1-rc.2 | Per-message feedback controls contributed to the assistant-message action strip, backed by the messageFeedback Host Remote |
| `@deepseek-ai/dsh-client-ui-model-selection` | 0.1.1-rc.2 | Model selection: the /model popupSelect over session.models / session.selectModel |
| `@deepseek-ai/dsh-client-ui-permission-presets` | 0.1.1-rc.2 | Permission surfaces: a new-session default in General settings and a current-session /permission popup over the permissions projection |
| `@deepseek-ai/dsh-client-ui-plan` | 0.1.1-rc.2 | Plan-mode composer control: the conversation.input.plan seat over the plan projection and the /plan command channel |
| `@deepseek-ai/dsh-client-ui-primitives` | 0.1.1-rc.2 | Pure React atoms for the dsh web UI: controls, icons, markdown, and JSON inspectors (zero cordis) |
| `@deepseek-ai/dsh-client-ui-reference` | 0.1.1-rc.2 | Unified Web @file and @session reference source |
| `@deepseek-ai/dsh-client-ui-renderer` | 0.1.1-rc.2 | Browser UI renderer: React slot bindings, ctx.uiRenderer, and the assembled application root |
| `@deepseek-ai/dsh-client-ui-settings-general` | 0.1.1-rc.2 | Settings ownerless-copy and product onboarding plugin: the General section, shell trigger/header chrome content, settings dictionaries, and the versioned welcome notice |
| `@deepseek-ai/dsh-client-ui-settings-models` | 0.1.1-rc.2 | Models settings and shared product-onboarding dialogs over existing settings and credential joins |
| `@deepseek-ai/dsh-client-ui-settings-plugin-inventory` | 0.1.1-rc.2 | Read-only Cordis Loader inventory tab in Web Plugins settings |
| `@deepseek-ai/dsh-client-ui-settings-plugins` | 0.1.1-rc.2 | Plugins settings section with feature-owned tabs and configurable host-plane plugin cards |
| `@deepseek-ai/dsh-client-ui-settings` | 0.1.1-rc.2 | Settings domain base plugin: the settings-namespace scope service and the canonical settings slot-type contract |
| `@deepseek-ai/dsh-client-ui-sidebar` | 0.1.1-rc.2 | Sidebar plugin: session multi-level tree, search, grouping, state dots |
| `@deepseek-ai/dsh-client-ui-skill` | 0.1.1-rc.2 | Web skill references and the dedicated skill tool row |
| `@deepseek-ai/dsh-client-ui-slots` | 0.1.1-rc.2 | Slot registry pure core: SlotMap declaration merging, single register composition API, four-share props types, store-seat types, renderer install seam |
| `@deepseek-ai/dsh-client-ui-subagent` | 0.1.1-rc.2 | Subagent conversation catalog, continuation routing UI, and '@' reference source |
| `@deepseek-ai/dsh-client-ui-theme` | 0.1.1-rc.2 | Theme plugin: Host bootstrap for the pre-plugin palette; DOM-free ThemeRuntime for light/dark/system state; --dsw-* token styles and Appearance settings row |
| `@deepseek-ai/dsh-client-ui-tool` | 0.1.1-rc.2 | Client Tool call-tree renderer and keyed per-tool presentation slot |
| `@deepseek-ai/dsh-client-ui-trajectory` | 0.1.1-rc.2 | Trajectory event ledger with an interactive timing overview: pure-consumer plugin registering into the conversation ViewMap (no service) |
| `@deepseek-ai/dsh-client-ui-user-questions` | 0.1.1-rc.2 | Web ask_user_question feature: host tool mount plus composer-takeover question UI |
| `@deepseek-ai/dsh-client-ui-workflow-run` | 0.1.1-rc.2 | Durable workflow-run Conversation Node and nested member disclosure for dsh web |
| `@deepseek-ai/dsh-client-ui-workspace` | 0.1.1-rc.2 | Workspace picker plugin: one WorkspacePicker registered into the sidebar and empty-state workspace slots |
| `@deepseek-ai/dsh-client-web` | 0.1.1-rc.2 | Web boot kernel: static module table, Cordis loader, framework-free boot page, and UI-renderer handoff |
| `@deepseek-ai/dsh-cmdline` | 0.1.1-rc.2 | Immutable command-line handoff from a dsh launcher to any app plugin that injects cmdlineArgs |
| `@deepseek-ai/dsh-code-runtime-python` | 0.1.1-rc.2 | CPython subprocess implementation of the DeepSeek Harness code-execution seam |
| `@deepseek-ai/dsh-code-runtime-worker-thread` | 0.1.1-rc.2 | Worker-thread implementation of the DeepSeek Harness code-execution seam |
| `@deepseek-ai/dsh-code-runtime` | 0.1.1-rc.2 | Abstract code-execution seam (ctx.codeRuntime) for the DeepSeek Harness |
| `@deepseek-ai/dsh-command-compact` | 0.1.1-rc.2 | Human-facing slash command for explicit session compaction |
| `@deepseek-ai/dsh-command-feedback` | 0.1.1-rc.2 | Log-only session feedback producer and human-facing slash command |
| `@deepseek-ai/dsh-command-goal` | 0.1.1-rc.2 | Human-facing slash command for persisted same-session goals |
| `@deepseek-ai/dsh-commands` | 0.1.1-rc.2 | Plugin-owned human command registry for DeepSeek Harness UIs |
| `@deepseek-ai/dsh-compaction-basic` | 0.1.1-rc.2 | Token-meter-driven compaction policy and LLM summarization backend for the DeepSeek Harness |
| `@deepseek-ai/dsh-compaction-tool-result-pruner` | 0.1.1-rc.2 | Replay-safe model-free head/middle/tail pruning for tool-result surface nodes |
| `@deepseek-ai/dsh-compaction` | 0.1.1-rc.2 | Abstract compaction service seam (ctx.compaction) for the DeepSeek Harness |
| `@deepseek-ai/dsh-cordis-client-runner` | 0.1.1-rc.2 | Browser half of dynamic dual-half plugin packages: event subscription, closure evaluation, guard facade, and loader entries |
| `@deepseek-ai/dsh-cordis-host-runner` | 0.1.1-rc.2 | Dynamic package definition registry, host-half sandbox lifecycle, and invoke handler table for model-mounted dual-half packages |
| `@deepseek-ai/dsh-credentials-local` | 0.1.1-rc.2 | File-backed credentials provider ($DSH_HOME/.env under the live process environment) for the DeepSeek Harness |
| `@deepseek-ai/dsh-credentials` | 0.1.1-rc.2 | Abstract credential seam (ctx.credentials): settings carry references to secrets, providers own the values |
| `@deepseek-ai/dsh-e2b` | 0.1.1-rc.2 | Shared E2B sandbox lifecycle for DeepSeek Harness provider adapters |
| `@deepseek-ai/dsh-experimental-agent-team` | 0.1.1-rc.2 | Implicit-root Agent Teams roster, durable peer mailbox, and shared task DAG |
| `@deepseek-ai/dsh-experimental-tool-agent-team` | 0.1.1-rc.2 | Scoped model-facing Agent Teams tools over ctx.agentTeams |
| `@deepseek-ai/dsh-file-reference-local` | 0.1.1-rc.2 | Local-filesystem ctx.fileReferences provider with bounded fuzzy indexes |
| `@deepseek-ai/dsh-file-reference` | 0.1.1-rc.2 | File-reference discovery contract and shared @file grammar |
| `@deepseek-ai/dsh-fs-e2b` | 0.1.1-rc.2 | E2B filesystem implementation for DeepSeek Harness |
| `@deepseek-ai/dsh-fs-local` | 0.1.1-rc.2 | Local-filesystem implementation of the DeepSeek Harness filesystem seam (ctx.fs) |
| `@deepseek-ai/dsh-fs-observation-policy` | 0.1.1-rc.2 | File-context policy plugin for the DeepSeek Harness — observed-state, read-before-edit, and version-guarded write/edit added over the ctx.fs provider seam through the fs/* event gate (no service API) |
| `@deepseek-ai/dsh-fs-sandbox` | 0.1.1-rc.2 | Sandbox-enforcing implementation of the DeepSeek Harness filesystem seam: fences write/edit by the per-call sandbox mode (read-only denies mutation, workspace-write contains it to the workspace + temp roots) while reads pass through |
| `@deepseek-ai/dsh-fs` | 0.1.1-rc.2 | Abstract filesystem capability seam (ctx.fs) for the DeepSeek Harness — vocabulary types, the FileSystem service (text IO + optional version-guarded atomic mutations), and the fs/* policy event vocabulary |
| `@deepseek-ai/dsh-goal-round-driver` | 0.1.1-rc.2 | Race-fenced same-session goal-round driver |
| `@deepseek-ai/dsh-goal` | 0.1.1-rc.2 | Event-sourced same-session goal state and lifecycle service for the DeepSeek Harness |
| `@deepseek-ai/dsh-headless` | 0.1.1-rc.2 | The dsh one-shot bundle: a direct core Agent/Session runner over dsh-base with no Host, HTTP, or browser layer |
| `@deepseek-ai/dsh-home-paths` | 0.1.1-rc.2 | Shared filesystem path helpers for the DeepSeek Harness |
| `@deepseek-ai/dsh-hook-protocol` | 0.1.1-rc.2 | Shared Claude Code / Codex hook wire protocol: matcher engine, stdin/exit-code/stdout codec, multi-hook merge, and hook/* session events |
| `@deepseek-ai/dsh-hooks-claude-code` | 0.1.1-rc.2 | Bridge plugin: run a Claude Code hooks.json / settings hook config on the DeepSeek Harness interception seams |
| `@deepseek-ai/dsh-hooks-codex` | 0.1.1-rc.2 | Bridge plugin: run a Codex hooks.json hook config on the DeepSeek Harness interception seams |
| `@deepseek-ai/dsh-host-apiproxy` | 0.1.1-rc.2 | API gateway: the ApiProxy contract (api/), the fetch carrier pair (fetch/), and the host-side gateway plugin providing ctx.apiProxy |
| `@deepseek-ai/dsh-host-directory-picker-auto` | 0.1.1-rc.2 | Adaptive chooser of the directory-picker seam: resolves the host situation at boot and mounts the native or browse backend for the DeepSeek Harness web GUI host |
| `@deepseek-ai/dsh-host-directory-picker-browse` | 0.1.1-rc.2 | In-app browsing backend of the directory-picker seam (listing/creation primitives over the host filesystem) |
| `@deepseek-ai/dsh-host-directory-picker-native` | 0.1.1-rc.2 | Native-OS-chooser backend of the directory-picker seam for the DeepSeek Harness web GUI host |
| `@deepseek-ai/dsh-host-directory-picker` | 0.1.1-rc.2 | Abstract workspace-directory picking seam (ctx.directoryPicker) for the DeepSeek Harness web GUI host |
| `@deepseek-ai/dsh-host-frontend-static` | 0.1.1-rc.2 | SPA dist server for the Web shell: owns the webserver fallback seat, serving explicit index entries and static assets with traversal rejection and 404 misses |
| `@deepseek-ai/dsh-host-plugin-inventory` | 0.1.1-rc.2 | Read-only Remote projection of current Cordis Loader plugin state |
| `@deepseek-ai/dsh-host-webserver` | 0.1.1-rc.2 | Web route-registration plugin: HTTP and upgrade routes, index transform taps, and static dist fallback; knows no harness concepts |
| `@deepseek-ai/dsh-invariants` | 0.1.1-rc.2 | Registry service for package-owned DeepSeek Harness runtime invariants |
| `@deepseek-ai/dsh-jobs-local` | 0.1.1-rc.2 | Process-local implementation of the DeepSeek Harness background job registry seam |
| `@deepseek-ai/dsh-jobs` | 0.1.1-rc.2 | Background job registry (ctx.jobs) for the DeepSeek Harness — shared ids, owner isolation, polling, cancellation, and completion listeners for long-running tool work |
| `@deepseek-ai/dsh-launch-environment` | 0.1.1-rc.2 | Immutable DeepSeek Harness launch environment that records which layer supplied each value |
| `@deepseek-ai/dsh-llm-deepseek` | 0.1.1-rc.2 | DeepSeek chat-completions adapter for the DeepSeek Harness LLM seam |
| `@deepseek-ai/dsh-llm-mock-server` | 0.1.1-rc.2 | Scriptable OpenAI-compatible HTTP/SSE fault server for LLM recovery tests |
| `@deepseek-ai/dsh-llm-pi-ai` | 0.1.1-rc.2 | pi-ai-backed DeepSeek adapter for the DeepSeek Harness LLM seam (design-verification twin of dsh-llm-deepseek) |
| `@deepseek-ai/dsh-llm-replay` | 0.1.1-rc.2 | Replay LLM plugin: short-circuits llm/stream with model chunks reconstructed from a recorded session JSONL (keyless snapshot tests) |
| `@deepseek-ai/dsh-llm-retry` | 0.1.1-rc.2 | Provider-routed LLM request retry policy for the DeepSeek Harness |
| `@deepseek-ai/dsh-llm` | 0.1.1-rc.2 | Provider-neutral LLM service interface for the DeepSeek Harness |
| `@deepseek-ai/dsh-loader-smoke` | 0.1.1-rc.2 | Shared subprocess and direct-agent harness for keyless real-Loader example smoke tests |
| `@deepseek-ai/dsh-lsp-stdio` | 0.1.1-rc.2 | Generic stdio language-server provider for the DeepSeek Harness LSP capability seam (ctx.lsp) — spawns configured servers, translates JSON-RPC, and serves transient-open goToDefinition/findReferences/goToImplementation/hover queries in the host filesystem namespace |
| `@deepseek-ai/dsh-lsp` | 0.1.1-rc.2 | Abstract LSP capability seam (ctx.lsp) for the DeepSeek Harness — language-server provider registry keyed by branded id and extension mapping, order-independent per-query selection, normalized definition/references/implementation/hover requests and results, and the LspError taxonomy |
| `@deepseek-ai/dsh-mcp-client` | 0.1.1-rc.2 | MCP client bridge: connects to MCP servers and registers their tools on ctx.tools |
| `@deepseek-ai/dsh-message-feedback` | 0.1.1-rc.2 | Lifecycle-bound per-message rating and note sidecar for the DeepSeek Harness |
| `@deepseek-ai/dsh-native-command` | 0.1.1-rc.2 | Zero-dependency no-shell execFile runner for host-native OS integrations: utf8 stdio capture, abort propagation, Windows hide |
| `@deepseek-ai/dsh-output-retention` | 0.1.1-rc.2 | Zero-dependency bounded-retention primitive: ItemRetainer/TextRetainer + neutral notice helpers (what did we keep, what did we omit) |
| `@deepseek-ai/dsh-permission-presets` | 0.1.1-rc.2 | User-facing permission presets (ctx.permissionPresets) for the DeepSeek Harness: one product-level Permissions select bundling the sandbox-mode and approval-policy knobs, written through to their own session events |
| `@deepseek-ai/dsh-persona` | 0.1.1-rc.2 | Composition-authored deployment persona section for the DeepSeek Harness |
| `@deepseek-ai/dsh-plan-mode` | 0.1.1-rc.2 | Logged per-agent plan mode with deployment guidance, a direct slash command, and a user-reviewed exit |
| `@deepseek-ai/dsh-pwsh-local` | 0.1.1-rc.2 | Local PowerShell implementation of the DeepSeek Harness bash executor seam |
| `@deepseek-ai/dsh-pwsh-sandbox` | 0.1.1-rc.2 | Sandbox-consuming implementation of the DeepSeek Harness PowerShell executor seam (confines every command via ctx.sandbox, reports denial/enforcement result facts) |
| `@deepseek-ai/dsh-repeat-tool-reminder` | 0.1.1-rc.2 | Repeat-tool-call guard plugin: advisory reminders when an agent loops on identical tool calls |
| `@deepseek-ai/dsh-sandbox-local` | 0.1.1-rc.2 | Local process-sandbox backends for the DeepSeek Harness sandbox seam: bwrap, the npm-distributed landlock-run launcher, macOS Seatbelt, or the Windows ACL restricted-token runner — functionally probed, fail-closed |
| `@deepseek-ai/dsh-sandbox-policy` | 0.1.1-rc.2 | Per-call sandbox policy resolver and current model context: deployment fallbacks plus each session's mode and workspace root, shared by every enforcing capability family |
| `@deepseek-ai/dsh-sandbox-windows-acl` | 0.1.1-rc.2 | Windows ACL write-restriction sandbox backend (restricted-token spawn with capability-SID write allowlist) for the DeepSeek Harness sandbox seam |
| `@deepseek-ai/dsh-sandbox` | 0.1.1-rc.2 | Abstract process-sandbox seam (ctx.sandbox) for the DeepSeek Harness: same-world confinement vocabulary and the SandboxProvider contract |
| `@deepseek-ai/dsh-schedule` | 0.1.1-rc.2 | Agent-scoped durable after, at, and fixed-rate reminders over the session event log |
| `@deepseek-ai/dsh-scope` | 0.1.1-rc.2 | Scoped-context registration primitive (scope tags, scope-filtered event dispatch) for the DeepSeek Harness |
| `@deepseek-ai/dsh-sdk-client` | 0.1.1-rc.2 | TypeScript client SDK for driving a DeepSeek Harness runtime subprocess over stdio JSON-RPC: the DeepSeekHarness high-level turns API and the lower-level HarnessClient |
| `@deepseek-ai/dsh-sdk-jsonrpc-demo` | 0.1.1-rc.2 | Bin that boots an external Cordis config for the stdio JSON-RPC SDK runtime |
| `@deepseek-ai/dsh-sdk-jsonrpc-server` | 0.1.1-rc.2 | Stdio JSON-RPC server plugin for out-of-process DeepSeek Harness SDK clients |
| `@deepseek-ai/dsh-sdk-protocol` | 0.1.1-rc.2 | Shared wire protocol for the DeepSeek Harness SDK runtime: the newline-delimited JSON-RPC stdio transport and the named request, result, and notification types spoken between the runtime server and SDK clients |
| `@deepseek-ai/dsh-session-checkpoint-policy` | 0.1.1-rc.2 | Semantic session durability checkpoints before model requests and tool side effects |
| `@deepseek-ai/dsh-session-log-export` | 0.1.1-rc.2 | Web Session-log export command and shared download dialog |
| `@deepseek-ai/dsh-session-persistence-jsonl` | 0.1.1-rc.2 | JSONL durable session persistence backend for the DeepSeek Harness |
| `@deepseek-ai/dsh-session-persistence-sqlite` | 0.1.1-rc.2 | SQLite durable session persistence with physical chunk-row packing |
| `@deepseek-ai/dsh-session-persistence` | 0.1.1-rc.2 | Abstract durable session persistence seam (ctx.sessionPersistence) for the DeepSeek Harness |
| `@deepseek-ai/dsh-session-projection-cache` | 0.1.1-rc.2 | Persisted projection cache (ctx.sessionProjectionCache): durable per-session projection checkpoints over the domain data form, throttled write-behind, and the cold-read ladder (cache row + persistence tail replay) |
| `@deepseek-ai/dsh-session-projection` | 0.1.1-rc.2 | Session-projection seam: the merge-extensible projection type table, the provider contract, and the ctx.sessionProjections registry serving whole current values of log-derived per-session state |
| `@deepseek-ai/dsh-session-query-sqlite` | 0.1.1-rc.2 | Concrete ctx.sessionQuery backend with SQLite FTS5 search |
| `@deepseek-ai/dsh-session-query` | 0.1.1-rc.2 | Combined session query service contract with concrete reads, traces, and filters |
| `@deepseek-ai/dsh-session-reference` | 0.1.1-rc.2 | Cross-session snapshot references and durable untrusted model context (ctx.sessionReferenceResolver) |
| `@deepseek-ai/dsh-session-stats` | 0.1.1-rc.2 | Whole-log conversation counts and wall times projection (sessionStats) for the DeepSeek Harness |
| `@deepseek-ai/dsh-session-telemetry-otel` | 0.1.1-rc.2 | OpenTelemetry backend for the DeepSeek Harness telemetry seam: hands captured session records to the OTel JS SDK's log pipeline |
| `@deepseek-ai/dsh-session-telemetry` | 0.1.1-rc.2 | SessionTelemetryBackend seam for the DeepSeek Harness: session-event capture, projection, redaction, and handoff to a reporting backend |
| `@deepseek-ai/dsh-session-title-all-prompts-llm` | 0.1.1-rc.2 | All-user-messages LLM provider plugin for DeepSeek Harness session titles |
| `@deepseek-ai/dsh-session-title-first-prompt-llm` | 0.1.1-rc.2 | First-message LLM provider plugin for DeepSeek Harness session titles |
| `@deepseek-ai/dsh-session-title-llm` | 0.1.1-rc.2 | Shared LLM generation policy for DeepSeek Harness session-title providers |
| `@deepseek-ai/dsh-session-title` | 0.1.1-rc.2 | Log-backed session title service and provider registry for the DeepSeek Harness |
| `@deepseek-ai/dsh-session` | 0.1.1-rc.2 | Event-sourced session store for the DeepSeek Harness |
| `@deepseek-ai/dsh-settings-file` | 0.1.1-rc.2 | File-backed settings provider (settings.yaml) for the DeepSeek Harness |
| `@deepseek-ai/dsh-settings` | 0.1.1-rc.2 | Abstract user-settings seam (ctx.settings) for the DeepSeek Harness |
| `@deepseek-ai/dsh-shell-env` | 0.1.1-rc.2 | Tool-independent managed DSH_* shell environment registry |
| `@deepseek-ai/dsh-shell` | 0.1.1-rc.2 | Abstract bash executor seam (ctx.shell) for the DeepSeek Harness |
| `@deepseek-ai/dsh-skill-badge` | 0.1.1-rc.2 | Bundled dsh badge skill provider for DeepSeek Harness |
| `@deepseek-ai/dsh-skill-filesystem` | 0.1.1-rc.2 | Local filesystem skill provider for the DeepSeek Harness |
| `@deepseek-ai/dsh-skill` | 0.1.1-rc.2 | Agent skill provider registry for the DeepSeek Harness |
| `@deepseek-ai/dsh-spill-local` | 0.1.1-rc.2 | Local-filesystem implementation of the DeepSeek Harness spill storage seam (private session-scoped files) |
| `@deepseek-ai/dsh-spill-policy` | 0.1.1-rc.2 | Tool-result spill policy for the DeepSeek Harness — replaces oversized plain-text tool results with a retained preview plus a spill-file path (no service API) |
| `@deepseek-ai/dsh-spill` | 0.1.1-rc.2 | Abstract spill storage seam (ctx.spillStore) for the DeepSeek Harness — save oversized tool text and return a retrieval locator |
| `@deepseek-ai/dsh-storage-domain` | 0.1.1-rc.2 | Domain data form (ctx.storage.domain): schema-validated, event-emitting KV domains over storage backends for the DeepSeek Harness |
| `@deepseek-ai/dsh-storage-json` | 0.1.1-rc.2 | JSON file KV storage backend for the DeepSeek Harness storage hub |
| `@deepseek-ai/dsh-storage-sqlite` | 0.1.1-rc.2 | SQLite storage backend (kv facet) for the DeepSeek Harness storage hub |
| `@deepseek-ai/dsh-storage` | 0.1.1-rc.2 | Storage hub (ctx.storage): named backend registry plus mounted data-form facilities for the DeepSeek Harness |
| `@deepseek-ai/dsh-subagent-acp` | 0.1.1-rc.2 | Out-of-process ACP subagent backend: drives a child agent in a spawned subprocess over the Agent Client Protocol |
| `@deepseek-ai/dsh-subagent-claude-code` | 0.1.1-rc.2 | One-shot Claude Code subagent provider over the official Agent SDK |
| `@deepseek-ai/dsh-subagent-codex` | 0.1.1-rc.2 | One-shot Codex subagent provider over the official app-server protocol |
| `@deepseek-ai/dsh-subagent-dsh-sdk` | 0.1.1-rc.2 | Out-of-process SDK subagent backend: drives a child DeepSeek Harness runtime subprocess over stdio JSON-RPC through the TypeScript SDK client |
| `@deepseek-ai/dsh-subagent-fork-in-process` | 0.1.1-rc.2 | In-process fork subagent backend: runs a child agent seeded with a prefix of the parent's log |
| `@deepseek-ai/dsh-subagent-in-process-driver` | 0.1.1-rc.2 | Shared in-process subagent run driver: drives a child agent on ctx.agents (used by the spawn and fork backends) |
| `@deepseek-ai/dsh-subagent-spawn-in-process` | 0.1.1-rc.2 | In-process spawn subagent backend: runs a fresh child agent on ctx.agents |
| `@deepseek-ai/dsh-subagent` | 0.1.1-rc.2 | Abstract subagent seam (ctx.subagents): named-provider registry for delegating to child agents |
| `@deepseek-ai/dsh-subprocess-e2b` | 0.1.1-rc.2 | E2B subprocess implementation for DeepSeek Harness |
| `@deepseek-ai/dsh-subprocess-local` | 0.1.1-rc.2 | Local-subprocess implementation of the DeepSeek Harness subprocess seam |
| `@deepseek-ai/dsh-subprocess` | 0.1.1-rc.2 | Subprocess seam (ctx.subprocess) for the DeepSeek Harness — managed process groups, bounded spill-backed output, and escalated kills behind one abstract service |
| `@deepseek-ai/dsh-system-prompt` | 0.1.1-rc.2 | System prompt assembly registry for the DeepSeek Harness |
| `@deepseek-ai/dsh-terminal-bash` | 0.1.1-rc.2 | Persistent shell PTY backend over the DeepSeek Harness subprocess terminal primitive |
| `@deepseek-ai/dsh-terminal` | 0.1.1-rc.2 | Persistent PTY session seam for the DeepSeek Harness — owner-scoped ids, backend registry, interactive sends, reads, signals, and awaited cleanup |
| `@deepseek-ai/dsh-time-context` | 0.1.1-rc.2 | Opt-in durable per-step context with the current time and elapsed time |
| `@deepseek-ai/dsh-timeout` | 0.1.1-rc.2 | Zero-dependency timeout/deadline primitive: clampTimeout, deadline, timeoutOf, TimeoutReason (timing + classification only, no termination) |
| `@deepseek-ai/dsh-tmux-context` | 0.1.1-rc.2 | Opt-in durable per-step context with this agent's tmux pane and window location |
| `@deepseek-ai/dsh-token-meter` | 0.1.1-rc.2 | Replay-aware token measurement service (ctx.tokenMeter) for the DeepSeek Harness |
| `@deepseek-ai/dsh-tool-ask-user` | 0.1.1-rc.2 | Model-facing ask_user_question tool over the ctx.userQuestions seam |
| `@deepseek-ai/dsh-tool-bash-persistent` | 0.1.1-rc.2 | Model-facing owner-scoped persistent Bash tool backed by the Harness PTY service |
| `@deepseek-ai/dsh-tool-bash` | 0.1.1-rc.2 | Model-facing bash tool with optional generic background-job and sandbox-escalation support |
| `@deepseek-ai/dsh-tool-call-timeout-policy` | 0.1.1-rc.2 | Tool-call timeout policy: a tools/execute wrapper that arms a per-tool deadline on exec.signal and returns TOOL_TIMEOUT when it wins |
| `@deepseek-ai/dsh-tool-cordis` | 0.1.1-rc.2 | Self-referential cordis toolset: inspect the live runtime, mount and dispose model-written plugins |
| `@deepseek-ai/dsh-tool-fs-search` | 0.1.1-rc.2 | Model-facing filesystem discovery tools (glob, grep) backed by the packaged ripgrep binary (@vscode/ripgrep) |
| `@deepseek-ai/dsh-tool-fs` | 0.1.1-rc.2 | Model-facing filesystem tools (read, write, edit) over the DeepSeek Harness filesystem seam (ctx.fs) |
| `@deepseek-ai/dsh-tool-goal` | 0.1.1-rc.2 | Model-facing same-session goal tools with execution-time authority checks |
| `@deepseek-ai/dsh-tool-jobs` | 0.1.1-rc.2 | Model-facing background job control tools (job_output, job_list, job_kill) over the ctx.jobs registry |
| `@deepseek-ai/dsh-tool-lsp` | 0.1.1-rc.2 | Model-facing lsp tool over the DeepSeek Harness LSP capability seam (ctx.lsp) — one read-only tool with goToDefinition/findReferences/goToImplementation/hover operations, one-based UTF-16 cursor coordinates, bounded location rendering, and hover normalization |
| `@deepseek-ai/dsh-tool-pwsh-persistent` | 0.1.1-rc.2 | Model-facing owner-scoped persistent PowerShell tool backed by the Harness PTY service |
| `@deepseek-ai/dsh-tool-pwsh` | 0.1.1-rc.2 | Model-facing pwsh tool over the bash executor seam |
| `@deepseek-ai/dsh-tool-ralph` | 0.1.1-rc.2 | Model-facing fresh-agent Ralph loop over the workflow and subagent seams |
| `@deepseek-ai/dsh-tool-session-query` | 0.1.1-rc.2 | Workspace-authorized model-facing session history search, trace, and event read tools |
| `@deepseek-ai/dsh-tool-skill` | 0.1.1-rc.2 | Model-facing skill loading tool for the DeepSeek Harness |
| `@deepseek-ai/dsh-tool-str-replace-editor` | 0.1.1-rc.2 | Model-facing view, create, literal replace, and line insert tool over the Harness filesystem service |
| `@deepseek-ai/dsh-tool-subagent-control` | 0.1.1-rc.2 | Globally named send_message, interrupt_agent, and list_agents tools over ctx.subagents continuations |
| `@deepseek-ai/dsh-tool-subagent-report` | 0.1.1-rc.2 | Child-scoped report tool over ctx.subagents continuations |
| `@deepseek-ai/dsh-tool-subagent` | 0.1.1-rc.2 | Model-facing subagent delegation tool over the ctx.subagents seam |
| `@deepseek-ai/dsh-tool-terminal` | 0.1.1-rc.2 | Six model-facing persistent PTY tools with owner isolation and generic background-job integration |
| `@deepseek-ai/dsh-tool-todo` | 0.1.1-rc.2 | Model-facing todo_write tool over the DeepSeek Harness event-sourced session log |
| `@deepseek-ai/dsh-tool-web` | 0.1.1-rc.2 | Model-facing web tools (web_search, web_fetch) over the DeepSeek Harness web capability seam (ctx.web) |
| `@deepseek-ai/dsh-tool-workflow` | 0.1.1-rc.2 | Model-facing workflow tool: run a JavaScript orchestration script over ctx.workflowEngine |
| `@deepseek-ai/dsh-tools` | 0.1.1-rc.2 | Tool registry and execution pipeline for the DeepSeek Harness |
| `@deepseek-ai/dsh-typert-generator` | 0.1.1-rc.2 | TypeScript project analyzer and model-driven Typert artifact generator |
| `@deepseek-ai/dsh-typert-loader` | 0.1.1-rc.2 | Loader integration for generated Typert package contributions |
| `@deepseek-ai/dsh-typert-protocol` | 0.1.1-rc.2 | Compiler-independent Remote metadata and Typert provider protocols |
| `@deepseek-ai/dsh-typert-registry` | 0.1.1-rc.2 | Runtime registry for generated package reflection and Zod schemas |
| `@deepseek-ai/dsh-user-approval` | 0.1.1-rc.2 | User-approval seam (ctx.approval) for the DeepSeek Harness: one-shot permission decisions dispatched to composed answerers over the approval/request waterfall, fail-closed by default |
| `@deepseek-ai/dsh-user-questions` | 0.1.1-rc.2 | Abstract user-questions seam (ctx.userQuestions) for asking the human during agent runs |
| `@deepseek-ai/dsh-web-app` | 0.1.1-rc.2 | The dsh browser-surface bundle: the web patch layer over dsh-base plus the runtime glue plugin (frontend dist serving, web-surface prompt, bash runtime variables, URL line) |
| `@deepseek-ai/dsh-web-fetch-http` | 0.1.1-rc.2 | Anonymous public HTTP(S) fetch provider for the DeepSeek Harness web capability seam (ctx.web) |
| `@deepseek-ai/dsh-web-search-deepseek` | 0.1.1-rc.2 | DeepSeek-backed search provider (native web_search via the Anthropic-compatible API) for the DeepSeek Harness web capability seam (ctx.web) |
| `@deepseek-ai/dsh-web-search-exa` | 0.1.1-rc.2 | Exa-backed search provider for the DeepSeek Harness web capability seam (ctx.web) |
| `@deepseek-ai/dsh-web-search-perplexity` | 0.1.1-rc.2 | Perplexity-backed search provider for the DeepSeek Harness web capability seam (ctx.web) |
| `@deepseek-ai/dsh-web` | 0.1.1-rc.2 | Abstract web access capability seam (ctx.web) for the DeepSeek Harness — search/fetch provider registry, registration-order-independent selection, request/result vocabulary, and the WebError taxonomy |
| `@deepseek-ai/dsh-workflow-worker-thread` | 0.1.1-rc.2 | worker-thread workflow engine: executes model-written orchestration scripts off the host event loop, bridging agent() calls back to ctx.subagents |
| `@deepseek-ai/dsh-workflow` | 0.1.1-rc.2 | Workflow capability seam: ctx.workflowEngine service, run vocabulary, and workflow/* events |
| `@deepseek-ai/dsh-workspace` | 0.1.1-rc.2 | Workspace entity registry (ctx.workspaceRegistry): durable workspace records with validated session attachment over the domain data form for the DeepSeek Harness |


## 2. Capability Groups Relevant to a Plugin Author

### 2.1 Observability / UI — rendering live status in the Web GUI or TUI

The Web client is a **separate plugin plane** from the host. A plugin that wants to render must ship a *client bundle* consumed by the browser-side Cordis loader, not merely a host service.

- **`@deepseek-ai/dsh-client-ui-slots`** — the pure slot core. This is the API a UI-contributing plugin actually calls. Single composition entry point:
  `register({ name, children?, store?, inject?, ...kind }, Component)`.
  One call contributes a component into a declared slot *and* simultaneously declares child slots, a store seat, and the registrant's business face. Key exported types: `SlotMap` (declaration-merged — you add your slot key by module augmentation), `ComposedProps` (intersection of four prop shares: `PropsRuntime<K>`, `PropsRenderSlots<S>`, `PropsStore<H>`, and the injected business face `I`), `defineStore` spec / `StoreHandle<T, A>`, `ChainSelect` + `ChainRenderOpts` for chain-kind slots where entries self-nominate via a pure selector rather than the dispatch site picking a key. `SlotCore` seeds the a-priori `'root'` slot and throws at register time on undeclared-slot registration, duplicate child declaration, one shared handle under two scopes, or a chain registration without `select`. React-free and cordis-free (React types only).
- **`@deepseek-ai/dsh-client-runtime`** — `SlotRegistry` and `SessionRuntime` (scope tree + object layer); this is where the *value* implementation of `defineStore` lives.
- **`@deepseek-ai/dsh-client-ui-renderer`** — provides `ctx.uiRenderer`, installs the slot renderer, and performs the sole context-level `renderSlot('root')` call. `dsh-client-web` calls `ctx.uiRenderer.mount(container)` after every client entry activates. Note the documented limitation: **the first application frame waits for every client entry**; there is no Suspense integration or per-entry lazy loading.
- **`@deepseek-ai/dsh-client-modules`** — the dual-face client module system. The node half composes the `__DSH_BOOT__` entry graph (incremental `dsh.client` scan, bundle route, index tap, `webPlugins` service); the browser half is the lazy-CJS module table the vendored cordis Loader consumes. **This is the mechanism by which a third-party client bundle gets loaded at all.**
- **`@deepseek-ai/dsh-client-hmr`** — dev-only hot reload for script-loaded client entries (SSE rebuilt frames → invalidate/prefetch → fiber swap).
- **`@deepseek-ai/dsh-client-ui-primitives`** — pure React atoms (controls, icons, markdown, JSON inspectors), zero cordis. Use these rather than re-implementing.
- Worked examples of a plugin owning a live status surface, all readable as templates:
  `dsh-client-ui-goal` (GoalBar docked above the composer, **read from the goal session projection**), `dsh-client-ui-jobs` (session-header background-job list, **live registry state mirrored from `session/jobs` frames**), `dsh-client-ui-workflow-run` (durable workflow-run Conversation Node with nested member disclosure), `dsh-client-ui-trajectory` (event ledger with interactive timing overview — explicitly a *pure-consumer plugin registering into the conversation ViewMap, no service*), `dsh-client-ui-tool` (call-tree renderer plus a keyed per-tool presentation slot — the seam for rendering **your own tool's** result), `dsh-client-ui-subagent`, `dsh-client-ui-plan`, `dsh-client-ui-cordis`.
- **The canonical live-status pattern in DSH is: append domain events to the session log → register a projection unit → the projection's whole value is pushed to the client on a `session/projection` frame → a client slot renders it.** `dsh-client-ui-goal` is the reference implementation of exactly that chain. A plugin should follow it rather than invent a side channel.
- **Progress / notifications**: there is no generic "notification" service. The available mechanisms are (a) the projection→slot chain above, (b) `ctx.jobs` snapshots plus `onJobsChanged`/`onJobDone` for background work, (c) `ctx.userQuestions` / `ctx.approval` for blocking human interaction, and (d) `dsh-message-feedback` for per-message sidecar data.
- **TUI**: no TUI package ships in `packages/`. The CLI help text references a `tui` profile only as *an example of a profile the user might install* (`apps/cli/src/args.ts:68`, `apps/cli/README.md:24` — "example, assuming the tui profile is installed"). **There is no in-box terminal UI plane to render into.** Plan for Web only.

### 2.2 Session journal / projections / persistence

This is the richest and most load-bearing area for a plugin that needs durable state.

- **`@deepseek-ai/dsh-session`** — `ctx.sessions`, the event-sourced append-only log that is the source of truth; the LLM message history is *derived* from it via a maintained **surface** layer. API: `create(id?, {seed?, meta?})`, `flush(session)` (awaited parallel durability checkpoint), `fork(source, boundary?, childSessionId?)`, `get(id)`, `list()`, plus the advanced ordered-teardown triple `prepare`/`enter`/`announce`. Persistence is deliberately *not* implemented here — plugins subscribe to `session/event`, flush on `session/flush`, and may mirror `session/created`/`session/disposed`.
- **`@deepseek-ai/dsh-session-projection`** — `ctx.sessionProjections`. **This is the primary seam for a plugin to derive and publish state.** API:
  - `register(definition): () => void` — definition is `{ key, stateSchema, init(), apply(state, event), wire?, stateVersion }`. `wire` supplies `viewSchema` + `view`; omitting `wire` makes the unit host-only.
  - `onChanged(listener): () => void` — one call per client-visible unit whose state reference changed, per committed event, carrying the schema-validated view and the causing seq.
  - `stateOf(session, key)` — live read-only reference, must not be mutated.
  - `snapshot(session): ProjectionSnapshot` — `{ asOfSeq, values }`, one consistent synchronous cut.
  - Merge-extensible tables `SessionProjectionMap` (client views) and `SessionProjectionStateMap` (host fold state).
  - **Hard contract rules**: `init`/`apply`/`wire.view` MUST be synchronous; `apply` MUST return the *same reference* for events it does not care about (the drive gates the change feed on `Object.is`); and the **whole-value event rule** — a state-carrying log event MUST carry the complete post-change state, never a bare delta.
- **`@deepseek-ai/dsh-session-projection-cache`** — `ctx.sessionProjectionCache`, durable per-session projection checkpoints, throttled write-behind, and the cold-read ladder (cache row + persistence tail replay).
- **`@deepseek-ai/dsh-session-persistence`** (seam) with backends **`-jsonl`** and **`-sqlite`** (SQLite adds physical chunk-row packing).
- **`@deepseek-ai/dsh-session-query`** / **`-sqlite`** (FTS5 search) / **`dsh-tool-session-query`** — reads, traces, filters over history.
- **`@deepseek-ai/dsh-session-checkpoint-policy`** — semantic durability checkpoints before model requests and tool side effects.
- **`@deepseek-ai/dsh-session-stats`**, **`dsh-session-title`** (+ three provider variants), **`dsh-session-log-export`**, **`dsh-session-reference`** (cross-session snapshot references, `ctx.sessionReferenceResolver`).
- **Non-session data**: **`@deepseek-ai/dsh-storage`** (`ctx.storage`, named backend registry + mounted data forms; `register()` returns a disposer, duplicate names and unknown lookups fail loud) with **`dsh-storage-domain`** (`ctx.storage.domain`, schema-validated event-emitting KV domains), **`-json`**, **`-sqlite`**. Note `ctx.storage.domain` throws `form-not-mounted` if read before the domain plugin mounts.
- **`@deepseek-ai/dsh-workspace`** — `ctx.workspaceRegistry`, durable workspace records with validated session attachment.

### 2.3 Atomic coordination / locking / leases / fencing

**`@deepseek-ai/dsh-atomic-write`** — read from source, `packages/util/atomic-write/src/index.ts` (154 lines, zero dependencies). Two exports.

**`writeFileAtomic(filename, content, options: { mode: number; dirMode?: number })`** — lines 49–64.
What the source actually does: `mkdir(dirname, {recursive})` → write to `\`${filename}.${randomBytes(6).toString('hex')}.tmp\`` with `{ mode, flag: 'wx' }` → `rename(temp, filename)`; on any throw, `rm(temp, {force:true})` and rethrow.
**Guarantees (exactly):**
- Readers observe either the complete old or the complete new content — the commit is a single `rename`.
- `flag: 'wx'` (exclusive create) means the open refuses to follow a symlink planted at the temp path.
- The fresh inode carries `options.mode` through the rename, so replacing a wider-permission file narrows it **without a chmod race**. `mode` is *required* by the interface so the permission decision is visible at every call site.
- The rename replaces a symlinked *target itself* rather than writing through to its referent.
- The same-directory sibling keeps the rename on one filesystem.
**Explicit non-guarantees:** *"Crash durability (fsync) is out of scope."* (line 44). There is an in-source `TODO(settings-atomic-durability)` at lines 54–55 noting that a replacement should fsync the file and parent directory and preserve owner-only permissions on Windows. **A caller needing crash durability must add its own barrier.** It is also not a compare-and-set: it unconditionally clobbers.

**`withFileLock(filename, operation, options?: { waitMs?: number }): Promise<T>`** — lines 128–154.
What the source actually does: lock path is `\`${filename}.lock\``; loop attempting `writeFile(lockPath, \`${process.pid}\n\`, { mode: 0o600, flag: 'wx' })`; on failure classify via `isLockContention` — `EEXIST` is contention directly, `EPERM` is contention **only when a fresh `lstat` confirms the lock path exists** (this covers Windows exclusive-create behavior without masking a genuine permission failure); back off `20ms` doubling to a `200ms` cap; on deadline throw `Error('atomic-write: timed out waiting for the writer lock at <path>')`. Default wait `DEFAULT_LOCK_WAIT_MS = 2000`. Release is `rm(lockPath, {force:true})` in a `finally`, so it releases on both success and throw.
**Guarantees (exactly):**
- **This IS genuine cross-process mutual exclusion** for writers of one file, because `wx` create is atomic at the OS level. Paired with the rename commit, **readers stay lock-free and only writers contend** — so a read-modify-write cycle can never resurrect a state another writer just replaced.
- `waitMs` exists specifically because the correct wait is a property of the holder's operation (the doc cites a credential mutation that performs a network round trip while holding the lock).
**Explicit non-guarantees, and these are the dangerous ones:**
- **No lease, no expiry, no fencing token.** The contender **never removes an existing lock**, because file age cannot prove its owner stopped. The source is explicit: *"orphan recovery is an operator action."* A crashed holder therefore leaves a lock file that **permanently blocks every future writer** until a human deletes it. There is no self-healing.
- The parent directory must already exist (unlike `writeFileAtomic`, this call does not `mkdir`).
- The PID written into the lock is informational only; nothing reads it back.
- `./invariant` companion is deliberately a **no-op** — `const install: InvariantInstaller = () => {}` with the comment *"No runtime invariant: this pure filesystem primitive owns no event stream or mutable runtime data; its replacement contract is enforced by unit tests."*

**Other coordination in the tree:**
- **`@deepseek-ai/dsh-fs`** (`ctx.fs`) offers *optional version-guarded atomic mutations*. Per this repository's own prior verified finding (recorded in `AGENTS.md`), `replaceIfVersion` is serialized by a **per-process lock map** and is therefore **not** a cross-process compare-and-set, whereas `createIfAbsent` **is**. Do not assume `replaceIfVersion` fences across processes.
- **`@deepseek-ai/dsh-goal`** provides a real logical CAS at the domain layer: `GoalRef { id, revision }` compare-and-set; stale refs are rejected.
- **`@deepseek-ai/dsh-settings`** provides optimistic concurrency: every write takes an optional `expectedRevision`, and a mismatch rejects with `SettingsConflictError` (`code: 'SETTINGS_CONFLICT'`) rather than clobbering.
- **`@deepseek-ai/dsh-goal-round-driver`** is described as *race-fenced*.
- **Verdict:** DSH gives you cross-process *mutual exclusion* (`withFileLock`) and per-domain *revision CAS* (goal, settings, fs`createIfAbsent`). It gives you **no lease service, no fencing tokens, and no orphan-lock recovery**. Anything needing crash-tolerant distributed coordination must supply that layer itself.

### 2.4 Admission / budget / rate limiting / token or cost accounting

- **`@deepseek-ai/dsh-token-meter`** — `ctx.tokenMeter`, the real accounting service. Two operations: `measure(session, requestHeader?)` (returns request pressure and the current priced surface at one consumed-log revision; one detached deeply-immutable snapshot; `totalTokens` is request+response pressure, `surfaceTokens` equals the sum of `nodes[].tokens`; O(surface) per call) and `estimateMessage(message)`. The estimator is intentionally unconfigurable — a fixed 4-chars-per-token heuristic plus structural overhead; **any config key is rejected**. Model capacity is *not* here: use `ctx.llm.resolveModelInfo().context`. Provider usage is preferred over the heuristic only when the canonical request envelope matches and the total is no lower than that call's heuristic anchor. It registers three projection units, notably **`tokenUsage`** (`uncachedInputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens` over the whole durable log) and **`contextPressure`** (`pressureTokens`, `projectedTokens`, `contextWindow`). **`tokenUsage` is the closest thing DSH has to a cost ledger — but it is tokens only; there is no price table and no currency anywhere in the tree.**
- **Admission** exists, but only as narrow per-subsystem hooks, not as a service:
  - `ctx.jobs.start(spec)` validates *"any provider-owned admission policy"* before calling `run()` once, and `attachController(name)` means a composition that loads no controller **cannot start background work** on the strength of another composition's controls.
  - `ctx.compaction.compactNow()` *"synchronously reserves idle turn admission before yielding."*
  - `dsh-goal` enforces a **round cap**: `defaultMaxGoalRounds` (default 256, must be a positive safe integer); resume is refused unless the configured round cap has remaining capacity. This is DSH's only shipped *budget* concept.
- **Rate limiting**: no rate-limiter package exists. The nearest neighbours are `@deepseek-ai/dsh-llm-retry` (provider-routed request retry policy), `@deepseek-ai/dsh-timeout` (zero-dependency `clampTimeout`, `deadline`, `timeoutOf`, `TimeoutReason` — **timing and classification only, no termination**), `@deepseek-ai/dsh-tool-call-timeout-policy` (a `tools/execute` wrapper arming a per-tool deadline on `exec.signal`, returning `TOOL_TIMEOUT`), and `@deepseek-ai/dsh-timeout-policy`.
- **Output budgeting** is a separate, well-served concern: `@deepseek-ai/dsh-output-retention` (`ItemRetainer`/`TextRetainer` + neutral "what we kept / what we omitted" notices), `@deepseek-ai/dsh-spill` (`ctx.spillStore`) + `-local` + `-policy`.
- **Gap:** there is **no cost/currency accounting and no rate limiter**. A plugin needing either builds it, ideally folding over `tokenUsage`.

### 2.5 Subagent orchestration — `ctx.subagents`, workflow engine, goal lifecycle

**`@deepseek-ai/dsh-subagent`** — `ctx.subagents` (`SubagentRuntime`). Exact members a plugin may call:
- `registerProvider(provider)` — register one trusted same-process implementation by name; effect-scoped; duplicate names fail loud. Removing it prevents new starts but **does not revoke runs already returned to callers**.
- `getProvider(name)`, `list()` (insertion order).
- `start(name, request)` — validate, resolve a detached `one-shot` descriptor, await the provider until a real one-shot child is published; returns a holder-owned `SubagentRun`. Rejection means the provider already cleaned every unpublished startup resource. **Continuable children never enter through this operation.**
- `startContinuable(spec)` — establish one durable continuable child and deliver its initial prompt; resolves `{ childId, messageId }` when the child's inbox accepts, *without* waiting for the turn to start or the message to reach the Session log. Any earlier failure rejects with no ids and rolls the child back entirely. Requires `ctx.agents`, session persistence, and a provider with the `prepareContinuable` capability.
- `followup(parent, childId, content, { source, signal })` — one later message from the exact live direct parent as the child's next FIFO turn; a resident child's inbox accepts directly, an absent one cold-resumes from its persisted Session.
- `interrupt(targetSessionId, authority)` — authority is `{ kind: 'user', parentSessionId }` or `{ kind: 'ancestor', agent }`. Admission synchronous, effect asynchronous: issues `Agent.cancel(cause, { keepInbox: true })`. Unclaimed pending inbox work, the Activation, and published descendants are preserved; work already claimed into the interrupted turn is **not** requeued. Absent target is an accepted no-op; wrong/stale/self/non-ancestor rejects `UNAUTHORIZED`.
- `reportFrom(child, content, { delivery, signal })` — one selected message from the live child to its live direct parent; quiet delivery injects next-step context without waking, next-step delivery steers and wakes.
Backends: `-spawn-in-process`, `-fork-in-process` (child seeded with a prefix of the parent's log), `-in-process-driver` (shared run driver), `-acp` (out-of-process over Agent Client Protocol), `-dsh-sdk` (child DSH runtime subprocess over stdio JSON-RPC), `-claude-code`, `-codex`. Model-facing consumers: `dsh-tool-subagent`, `dsh-tool-subagent-control` (`send_message`, `interrupt_agent`, `list_agents`), `dsh-tool-subagent-report`.

**`@deepseek-ai/dsh-workflow`** — `ctx.workflowEngine` service, run vocabulary, and `workflow/*` events. Engine: **`@deepseek-ai/dsh-workflow-worker-thread`** executes model-written orchestration scripts off the host event loop, **bridging `agent()` calls back to `ctx.subagents`**. Consumers: `dsh-tool-workflow`, `dsh-tool-ralph` (fresh-agent Ralph loop over the workflow and subagent seams).

**`@deepseek-ai/dsh-goal`** — `ctx.goals`, event-sourced same-session goal state. Accepts **only the exact live `Agent` instance** registered under its id. `get()` returns a detached `GoalView`; mutations use a `GoalRef { id, revision }` CAS fence and reject stale refs. Verbs: create, edit, pause, resume, complete, block, clear, plus `disarm()` (lifecycle-only exception — removes process-local continuation authority without writing a revision or emitting a mutation). At most one goal is current. Every mutation appends a durable `goal/change` event **carrying the complete post-mutation snapshot**; clear uses a revisioned tombstone. **Activation is never persisted** — a fresh cache and every `agent/session-start` edge disarm it even when replay finds an active durable phase; this is exactly why a resumed session must be explicitly re-armed. Companions: `dsh-goal-round-driver`, `dsh-tool-goal`, `dsh-command-goal`, `dsh-client-ui-goal`.

**Agent Teams** (`dsh-experimental-agent-team`: implicit-root roster, durable peer mailbox, shared task DAG) is the one obvious multi-agent primitive — but it is **`private: true` and unpublished**. Do not build on it.

### 2.6 Context / memory / prompt assembly / skills / compaction

- **`@deepseek-ai/dsh-system-prompt`** — `ctx.systemPrompt`, the assembly registry. `section(section)` contributes an ordered section into **the calling context's scope layer** (so `agent.ctx` contributes to that agent alone, shadowing a same-named global section); a `complete: true` section becomes the exact complete prompt after the assembly waterfall, and more than one effective complete section rejects assembly. `context(context)` contributes ordered dynamic context. `suppressRuntimeContext()` composes independently and restores when no suppressor remains. `tools(provider)` contributes tool schemas. Config: `includeHarnessIdentity`, `includeRuntimeContext`, `persona`, and `toolOrder` (a list of tool names with exactly one `'<unlisted-tools>'` rest entry; misconfiguration fails loud at load).
- **`@deepseek-ai/dsh-agent-instructions`** — the `AGENTS.md`/`CLAUDE.md` workspace context loader.
- Per-step durable context providers: **`dsh-time-context`**, **`dsh-tmux-context`** (both opt-in).
- **`@deepseek-ai/dsh-skill`** — `ctx.skills`, host+per-scope layered over `dsh-scope`. `registerProvider(create)` (synchronous factory receiving `{ signal, invalidate }`; duplicate names in one layer throw; `runtime` is a reserved name), `snapshot({cwd?, signal?, scope?})` → `{ skills, complete }`, `list(...)`, `get(name, ...)`, `register(skill)` (runtime embedded skill, same-name is first-wins with a warning). Event `skills/change` is an **unfiltered invalidation notification carrying no catalog or diff** — each consumer refetches. Providers: `dsh-skill-filesystem`, `dsh-skill-badge`. Consumers: `dsh-tool-skill`, `dsh-client-ui-skill`. **Legion's rule that skills stay owned by the scoped DSH registry maps directly onto this layering.**
- **`@deepseek-ai/dsh-compaction`** — `ctx.compaction`, three abstract operations: `compactIfNeeded(agent, trigger, signal)` for `'pressure' | 'context-overflow'`, `compactNow(agent, signal)` (reserves idle turn admission, records a standalone `compaction/* { turn: null }` attempt, awaits its durability checkpoint; `ManualCompactionError` for expected failures), and `compactRegion(start, end, agent, signal?)` (inclusive **surface-position** span, not a numeric seq interval — throws if a compaction is in progress or the bounds are not surface nodes). Provider: `dsh-compaction-basic` (token-meter pressure + budget retention + `llm.stream()` summarization). Also `dsh-compaction-tool-result-pruner` (replay-safe, model-free head/middle/tail pruning) and `dsh-command-compact`.
- **`@deepseek-ai/dsh-session-reference`** — cross-session snapshot references and durable untrusted model context.
- **Gap:** there is **no long-term/cross-session "memory" service**. Memory in DSH means the session log plus `ctx.storage.domain` plus `AGENTS.md` instruction loading. A vector store or recall service does not exist.

### 2.7 Evaluation, benchmarking, telemetry harnesses

- **Telemetry (real):** **`@deepseek-ai/dsh-session-telemetry`** declares the `SessionTelemetrySink` contract — three members: `emit(record)` **MUST enqueue without blocking** (it runs synchronously during `session/event`), optional `flush()` (fire-and-forget hint after a turn ends), and `shutdown()` (drains and resolves when the SDK stops; disposal awaits it). Registered under the `sessionTelemetry` context key; **one implementation per context, duplicate load throws.** The coordinator supports `live` or `on-demand` capture via `captureSession(session, throughSeq?)`. It also carries a required `sharing: SessionTelemetrySharingStatus` member — `full` | `feedback-only` | `disabled` — that every backend must disclose to human-facing acknowledgement surfaces. **This package stops at `emit()`: batching, retry, queueing, and loss policy belong to the backend SDK and are explicitly not wrapped.** Backend: **`dsh-session-telemetry-otel`** (hands records to the OpenTelemetry JS SDK log pipeline).
- **Runtime assertion harness:** **`@deepseek-ai/dsh-invariants`** — `ctx.invariants.register(packageName, installer)`. Config `{ enabled?, package_allowlist?, package_blocklist? }` (defaults `true`/`[]`/`[]`); entries are unanchored case-sensitive `RegExp` sources, blocklist overrides allowlist, invalid/duplicate/blank entries **fail service startup**. Enabled contributions run in a dedicated child Cordis fiber; the installer declares services via `installer.inject` and receives `fail(message)`, which throws an `InvariantError` (stable `code: 'INVARIANT'`, carries `packageName`). **Every workspace package publishes a `./invariant` companion registering its exact npm package name** — a strong convention a third-party plugin should follow.
- **Test harnesses (published, reusable):** `dsh-agent-loop-testkit`, `dsh-client-test-runtime` (jsdom slot test runtime with a real Cordis Context + SlotRegistry + UI renderer), `dsh-llm-mock-server` (scriptable OpenAI-compatible HTTP/SSE **fault** server), `dsh-llm-replay` (short-circuits `llm/stream` from a recorded session JSONL — **keyless snapshot tests**), `dsh-acp-snapshot`, `dsh-loader-smoke`.
- **Feedback:** `dsh-message-feedback` (lifecycle-bound per-message rating/note sidecar), `dsh-command-feedback`, `dsh-client-ui-message-feedback`, `dsh-anonymous-user-id`.
- **Gap:** there is **no benchmark or eval-suite runner package**. A root `BENCHMARK.md` exists but no `packages/` entry implements evaluation scoring. `dsh-llm-replay` + `dsh-llm-mock-server` are the raw materials you would build one from.

### 2.8 Settings / configuration services

**`@deepseek-ai/dsh-settings`** — `ctx.settings`. One provider holds a raw document of per-namespace sections; a plugin registers a namespace schema and reads a value layered as **schema defaults → the registrant's composition `base` (its cordis.yml entry-config subset) → the user document section**. Crucially: *"Without a mounted provider nothing changes for consumers"* — they keep resolving entry config alone, so **every composition works with or without settings**. API:
- `register(ns, schema, { base?, applies? })` → owner `SettingsScope` with `get`/`watch`/`update`. Effect-scoped on the calling fiber. A stored section the schema rejects **fails the registration itself**; duplicate namespace fails loud.
- `describe(options?)` → one descriptor per namespace (`schema.toJSON()` envelope, resolved value, detached `base`/`user` layers, `applies`); presence in `user` is what marks a field user-overridden. **`describe({ redactSecrets: true })` strips `role('secret')` fields and adds a `secrets` slot list (`{ path, set }`); every wire surface MUST pass it.** The pure `redactSecrets(schema, value)` walker is exported.
- `get(ns)`, `update(ns, patch)` (deep-merges into the **user section only**, never `base`; rejects Date/Map/BigInt/non-finite/circular with a `$`-rooted path *before* persisting; a read-only provider rejects every write; writes to one namespace are serialized in call order), `replace(ns, section)` (wholesale reset), `mutate(ns, ops)` (ordered `{op:'set'|'unset', path}` — **the removal path for any caller holding an incomplete/redacted view**, since replacing wholesale from a redacted descriptor would delete every secret the wire never returned).
- `documentPath` / `prepareDocument()` for native-editor handoff; browser protocols expose only a boolean capability.
- Optimistic concurrency: every write takes `expectedRevision`; mismatch → `SettingsConflictError`.
Provider: **`dsh-settings-file`** (`settings.yaml`). Related: `dsh-credentials` (`ctx.credentials` — *settings carry references to secrets, providers own the values*) + `-local`, `dsh-authorization` (`ctx.authorization`), `dsh-permission-presets` (`ctx.permissionPresets`), `dsh-shell-env`, `dsh-launch-environment`, `dsh-cmdline`. Client surfaces: `dsh-client-ui-settings` (+ `-general`, `-models`, `-plugins`, `-plugin-inventory`), `dsh-client-schema-form`.

## 3. The Word "Profile" in DSH

### 3.1 What it means — one meaning only

In DSH, **a profile is a deployment/launcher composition unit: a directory under `$DSH_HOME/profiles/<name>` that composes which plugins the process boots.** It is *not* an agent persona, not a model preset, not a user identity, and not a permission profile.

From `packages/boot/app-boot/src/profile.ts:5-13` (module doc):

> A profile is a directory under `$DSH_HOME/profiles/<name>` holding a `package.json` (out-of-tree plugin dependencies plus the profile manifest `dsh.profile` with its ordered `bundles` list) and a `cordis.patch.yml` (the user's own patch layer, applied after every bundle layer).

Representative usages, with `file:line`:

1. `packages/boot/app-boot/src/profile.ts:2-3` — *"Profile discovery, initialization, and patch-layer composition for the `dsh --profile` launcher family."*
2. `packages/boot/app-boot/src/profile.ts:36` — `export const PROFILES_DIR = 'profiles'` — *"Directory under the Harness home holding every profile."* And `:39` `export const PROFILE_PATCH_FILENAME = 'cordis.patch.yml'` — *"The user patch layer inside a profile directory (hot-reloaded on long-lived surfaces)."*
3. `packages/boot/app-boot/src/profile.ts:114-117` — the shipped templates auto-initialized on first use:
   ```ts
   export const PROFILE_TEMPLATES: Record<string, readonly string[]> = {
     web: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
     headless: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'],
   }
   ```
4. `apps/cli/src/args.ts:131` — `.option('--profile <name>', 'the profile under $DSH_HOME/profiles to boot')`; and `:130` `.argument('[args...]', "arguments for the booted profile's app (see: dsh --profile <name> --help)")`.
5. `apps/cli/README.md:11-14` — `dsh --profile <name>` "Boot the named profile under `$DSH_HOME/profiles/<name>`"; `dsh web` "Alias of `--profile web`"; `dsh plugin --profile <name> <pnpm args>` "Manage a profile's plugins by forwarding to pnpm in the profile directory."
6. `apps/cli/src/args.ts:173` — `.requiredOption('--profile <name>', 'the profile whose plugins to manage (initialized on first use)')`.

Reinforcing evidence: the description of **`@deepseek-ai/dsh-base`** is *"The shared dsh core as a **profile bundle**: every profile's first patch layer, inserting the base plugin rows over the empty profile root"*, and **`dsh-web-app`** is *"The dsh browser-surface bundle: the web patch layer over dsh-base."* Profile name validation (`profile.ts:104-111`) rejects `''`, any name containing `/` or `\`, `.`, `..`, and `node_modules`. Module resolution is two-anchor: a bundle name resolves first from the dsh installation, then from the profile directory, with a maintained flat fallback at `$DSH_HOME/profiles/node_modules`.

**So when a DSH user says "profile", they mean: which bundle stack and plugin set this `dsh` process boots with — an installation-level composition selected by `dsh --profile <name>`, materialized as a real directory with its own `package.json`, its own pnpm-managed `node_modules`, and its own `cordis.patch.yml` overlay.** The closest mental model is a Neovim/Chrome profile or a Nix profile: an isolated, independently-provisioned installation flavor.

Note the term is heavily overloaded *outside* DSH's own concept in files like `packages/llm/llm-pi-ai/*` (72 hits in `adapter.ts`), but those refer to **provider/model catalog profiles** internal to that one adapter, plus ordinary `pwsh -NoProfile` shell flags in `sandbox-local`. Neither is a user-facing DSH concept.

### 3.2 Naming collision verdict for a third-party plugin

**A third-party plugin that reuses "Profile" for a different concept would actively confuse users.** "Profile" in DSH is a first-class, user-typed, CLI-visible noun (`dsh --profile web`, `dsh plugin --profile tui add <pkg>`) that denotes a *process-level plugin composition rooted in a real directory*. A plugin-level "Profile" meaning, say, a routing policy or a delegation persona would collide head-on: a user reading "profile" in that plugin's docs will reasonably expect `$DSH_HOME/profiles/<name>` semantics, plugin-install commands, and boot-time selection. **Recommend a different noun.**

### 3.3 What DSH calls its agent persona/preset concept

Two distinct, deliberately separated names:

- **"Agent preset"** — the *composition* of one agent. Package **`@deepseek-ai/dsh-agent-presets`**, service `ctx.agentPresets`. *"A **preset** is a directory holding one `agent.cordis.yml`; the roster mounts it ONCE per process under a standing scope, and each session that names it joins by having its agent scope key parented to the mount's."* Preset ids must match `[a-z0-9][a-z0-9-]*`. API: `defaultId`, `list()`, `resolve(id?)`, `mount(agentCtx, id?)`, `composeFrom(agentCtx, parentCtx)`, `composedPreset(agentCtx)`, `recompose(agentCtx, id)`, `standingKeyFor(id?)`, `roots`, `authorable`, `read(id)`, `copy(from, id, name?)`. Discovery is **unmemoized** (re-reads roots every call) and owns preset *health*: a broken directory is listed with a `broken` reason rather than skipped, because a skipped directory would still occupy its id on disk. Client surface: `dsh-client-ui-agent-preset`.
- **"Persona"** — the *identity prose* of one agent. Package **`@deepseek-ai/dsh-persona`**, *"The agent persona as a composable row. It can either shadow the deployment persona or own the complete system prompt."* It is **scope-only**: mounting it outside an agent scope collides with the prompt registry's own `deployment:persona` registration and **fails loud** — it is designed to be mounted *inside a preset composition*. Config: `text` (required, a template resolved strictly against registered prompt variables at render), `complete` (default `false`; when true the registry restores this persona as the sole system-prompt section after assembly), `includeRuntimeContext` (default `true`). It renders as the `deployment:persona` section at order 0, immediately after the harness identity opener. The global default lives in `dsh-system-prompt`'s `persona` config key, and a process has exactly one.

**The clean three-way distinction to preserve:** *profile* = which plugins the **process** boots; *agent preset* = which plugins compose one **agent**; *persona* = what that agent's **identity prose** says.

## Summary Verdict: Covered vs. Not Covered

**Well covered — reuse, do not rebuild:** session journal and event sourcing; projections (incl. persisted projection cache and cold-read ladder); session persistence (JSONL/SQLite) and FTS5 query; non-session KV storage with schema-validated domains; workspace registry; subagent delegation including durable continuable children, followup, interrupt with authority checks, and report; workflow engine bridging to subagents; goal lifecycle with revision CAS and round caps; prompt assembly with scope shadowing; skills with scope layering; compaction; token measurement and usage projections; settings with layering, redaction, and revision conflicts; credentials and authorization; background jobs with owner isolation; sandbox, approval, and user questions; telemetry sink contract with OTel backend; the runtime invariant registry; output retention and spill; the full Web slot/renderer/bundle plane.

**Partially covered — a seam exists but you supply the policy:** admission (only per-subsystem hooks in jobs/compaction/goal, no general service); atomic coordination (real cross-process `withFileLock`, but no lease, no expiry, no fencing token, and orphan recovery is explicitly an operator action); crash durability (`writeFileAtomic` explicitly excludes fsync); progress/notification (must ride the projection→slot chain).

**Not covered — build it or do without:** cost/currency accounting (tokens only, no price table); rate limiting; long-term cross-session memory or recall; benchmark/eval scoring harness; any TUI plane; a general-purpose lock/lease service. Agent Teams exists but is `private: true` and unpublished — off-limits.
