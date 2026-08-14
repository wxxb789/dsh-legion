# dsh-legion 当前 HEAD 能力对照审计

> 审计基线：`Q:\repos\dsh-legion`，分支 `main`，HEAD `1897d305b9e416fa704d6d464607ab38f14400e6`。本报告以源码、测试、composition、package metadata 为事实源；`docs/design/*` 中明确标为 superseded 的文本仅作为历史声明核对，不视为当前 contract。

## 1. 结论摘要

当前实现不是一个 Legion-owned multi-agent scheduler，而是一个 **agent-preset 内、由 coordinator 显式选择 semantic profile 的单工具 subagent adapter**：

1. 部署者在 Cordis row 中静态定义 profile；每个 profile 固定 `subagentProvider`、可选 child LLM `provider/model/maxTokens`、persona、tool allow/deny、depth 与默认前后台模式（`src/config.ts:4-26`, `src/config.ts:28-39`）。
2. coordinator 调用一个 `legion` tool，传 `profile`、`description`、`prompt`、可选 `run_in_background`（`src/index.ts:20-25`, `src/index.ts:120-143`）。
3. 实现把配置直接投影成 `SubagentStartRequest`，调用 DSH 的 `start()` 或 `startContinuable()`；没有自己的 planner、scheduler、team/DAG、evaluation 或 synthesis（`src/index.ts:90-104`, `src/index.ts:183-206`）。
4. provider 的存在性会动态过滤 profile；这只是 **availability filtering**，不是按任务、质量、成本、延迟或健康度自动路由（`src/index.ts:211-229`, `src/index.ts:245-250`）。
5. foreground run 有严格 settlement 与 disposal；background 生命周期、持久化、follow-up 和通知完全委托给 DSH（`src/settlement.ts:30-64`, `src/index.ts:188-199`；ADR `docs/adr/0001-semantic-profile-router.md:36-40`）。

重点缺口：**automatic routing、fallback、aggregate budget、retry、synthesis、quorum、per-child preset、per-profile skills、child structured output、Legion-owned observability/persistence、doctor、settings UI 均未实现**。其中 README/ADR 对多数边界已明确承认；主要文档风险是 superseded 设计稿仍以现在时、推荐架构和验收标准详细描述未来系统，读者若跳过文件开头的状态标记，容易误判为已交付。

## 2. 实际公开 interface 与配置

### 2.1 Cordis 插件 surface

- package 只导出一个 agent-plane plugin：`name = 'dsh-legion'`，硬依赖 `tools`、`subagents`、`systemPrompt`（`src/index.ts:15-18`）。
- `apply()` 只做 config validation、tool 注册、provider lifecycle 监听、prompt section 注册及 disposer（`src/index.ts:232-263`）。没有提供 `ctx.legion` service、Host registry、CLI runtime 或 HTTP/API surface。
- tool name 可配置，默认 `legion`（`src/config.ts:65-70`）。工具参数只有：
  - `profile?: string`；无 `defaultProfile` 时 required，且 schema enum 只列当前可用 profile（`src/index.ts:107-125`）；
  - `description: string`（`src/index.ts:127-131`）；
  - `prompt: string`（`src/index.ts:132-136`）；
  - `run_in_background?: boolean`，仅在全局启用时出现（`src/index.ts:137-142`）。
- tool 声明 `isConcurrencySafe: () => true`，因此 DSH 可并发发起 sibling calls；Legion 自己没有 semaphore、maxParallel 或 admission control（`src/index.ts:175-176`）。

### 2.2 顶层 config

源码事实（`src/config.ts:28-39`, `src/config.ts:65-71`）：

| 字段 | 实现语义 |
|---|---|
| `toolName` | model-facing tool 名，默认 `legion`。空白会在 schema/cross-field validation 被拒绝（`src/config.ts:66`, `src/config.ts:74-77`）。 |
| `profiles` | 必填 map，且至少一个 profile（`src/config.ts:67`, `src/config.ts:79-82`）。 |
| `defaultProfile` | 可选；存在时必须匹配 profile-name regex 且引用已定义 profile（`src/config.ts:68`, `src/config.ts:103-105`）。 |
| `enableRunInBackground` | 默认 `true`；关闭后 schema 不暴露该参数，并拒绝偷偷传 `true`（`src/config.ts:69`, `src/index.ts:80-88`）。 |
| `guidance` | 可选附加 prompt 文本；trim 后追加（`src/config.ts:70`, `src/prompt.ts:39-43`）。 |

profile key 必须匹配 `^[a-z][a-z0-9-]*$`（`src/config.ts:2`, `src/config.ts:84-87`）。这允许 semantic labels，但没有 role、policy、route rule、replica 或 topology 类型。

### 2.3 Profile config

源码事实（`src/config.ts:4-26`, `src/config.ts:41-63`）：

| 字段 | 实现语义与边界 |
|---|---|
| `description` | 必填非空；只用于 tool/prompt routing guidance。 |
| `subagentProvider` | DSH subagent backend 名，默认 `spawn`；不是 LLM provider。 |
| `agentOptions.provider` | child LLM provider route，可省略并继承 parent。 |
| `agentOptions.model` | child model id，可省略并继承 parent。 |
| `agentOptions.maxTokens` | 单个 child 输出 token limit；正 safe integer。它不是 execution budget。 |
| `persona` | child persona overlay；不是独立 role/preset composition。 |
| `toolFilter.allow/deny` | child 可见工具名过滤；至少需出现一侧（`src/config.ts:94-100`）。 |
| `maxDepth` | 非负整数或 `provider-managed`；不是 max rounds、max agents 或并发限制。 |
| `defaultRunInBackground` | 调用未指定时选 continuable 或 foreground。 |

配置 schema 未声明 unknown-key policy，因此本报告不把“拒绝所有未知字段”视为已证明 contract。也没有配置 version/migration、timeout、cost、budget、retry、quorum、synthesizer、structured output schema、skills、preset、observability、persistence 或 settings namespace。

## 3. 真正实现的行为

### 3.1 Semantic profile 选择：显式而非自动

- 选择逻辑严格是 `args.profile ?? config.defaultProfile`；两者皆无就报错，名称不存在就报错（`src/index.ts:27-37`）。
- generated guidance 要求 coordinator “Choose a profile by task fit”，说明判断由主模型完成，而不是插件内部 classifier/router（`src/prompt.ts:14-20`）。
- profile 表展示静态 backend/model/default mode（`src/prompt.ts:22-29`），并提示并行启动、foreground 使用条件与 capability envelope（`src/prompt.ts:32-37`）。
- 因此 README “main DSH agent chooses a profile by task fit” 与源码一致（`README.md:5`）；项目名中的 router 是 **prompt-guided explicit dispatch**，不是自动路由器。

### 3.2 请求投影与 provider/model 能力

- `requestFor()` 原样传递 label、text prompt、parent、agentOptions、persona、toolFilter 和 numeric maxDepth（`src/index.ts:90-104`）。
- child LLM route 支持仅 provider、仅 model、两者、或完全继承；guidance 也明确渲染这四种状态（`src/prompt.ts:3-11`）。
- 任意已注册 `SubagentProvider` 名都可配置；源码不硬编码 `spawn/fork/codex/claude-code` allowlist（`src/index.ts:45-50`）。README 将这些列为例子而非封闭集合是准确的（`README.md:39-42`）。
- 对 foreground：numeric depth、persona、toolFilter 分别检查 provider capability，缺失则 fail loud（`src/index.ts:62-76`）。
- 对 background：只要求 `prepareContinuable`；depth/persona/toolFilter 交由 DSH continuation manager（`src/index.ts:51-60`）。这与 README 的 foreground/background 说明一致（`README.md:148-151`）。
- `outputSchema` capability 虽存在于测试 fake provider（`tests/plugin.spec.ts:36-43`），Legion 从不接收或传递 output schema；因此 structured child output 未实现。

### 3.3 Provider availability 与动态 surface

- 配置的 provider 不存在时，该 profile 被过滤，而非 plugin activation 失败（`src/index.ts:211-219`）。
- 若全部 profile 被过滤，tool 不注册且 prompt section 返回空字符串（`src/index.ts:221`, `src/index.ts:238-243`, `src/index.ts:257-260`）。
- 若被过滤的是 default profile，剩余 live schema 失去 default，调用时 profile 变为 required（`src/index.ts:222-229`）。测试验证 enum 只含 live profile、default 被移除后 required（`tests/plugin.spec.ts:376-405`）。
- provider added/removed event 触发重建 tool surface（`src/index.ts:245-250`）；测试验证从无工具到出现再消失（`tests/plugin.spec.ts:407-432`）。
- 对当前存在的 provider，profile 的 **默认执行模式** 会在 refresh 时 capability-check；错误会使 refresh/activation fail loud（`src/index.ts:216-218`）。但调用可覆盖前后台模式，因此非默认路径的 capability error 可能到实际调用时才出现（`src/index.ts:183-185`）。
- 该机制没有 provider/model probe、latency/error-rate health store、model discovery 或替代候选；不能称为 health-based routing/fallback。

### 3.4 Foreground 生命周期与错误

- `start()` 返回的 one-shot run 由 `settleForeground()` 等待并最终 dispose（`src/index.ts:202-206`, `src/settlement.ts:30-64`）。
- stop reason 处理：`completed` 成功；`aborted`、`error`、`max-tokens`、`refusal` 和未知原因均转为 Error（`src/settlement.ts:12-20`）。
- abnormal stop 若含 text partial output，会把 partial 文本附在错误中（`src/settlement.ts:36-43`）。非 text block 不进入错误摘要（`src/settlement.ts:23-28`）。
- execution 与 disposal 都失败时抛 `AggregateError`，保留两者；仅 disposal 失败也会失败（`src/settlement.ts:53-64`）。
- 成功结果包含 `kind/profile/runId/output`；output 是原 `ContentBlock[]` 强转为 JSON values，并非经 schema 校验的 domain result（`src/settlement.ts:44-49`）。model-facing render 只拼接 `{type:'text', text}` JSON block，其他 block 仍在 typed value 中但不显示为文本（`src/settlement.ts:67-75`, `src/index.ts:168-173`）。
- caller Agent 缺失时立即失败（`src/index.ts:176-181`）。未知 profile、disabled background、missing provider、unsupported capability 均为普通 `Error` 字符串，没有稳定错误 code、retryable 字段或 sanitized diagnostic envelope（`src/index.ts:27-35`, `src/index.ts:45-75`, `src/index.ts:80-84`）。

### 3.5 Background 生命周期

- background 调用只执行 `ctx.subagents.startContinuable()` 并返回 `subagentId`（`src/index.ts:188-199`）。
- Legion 不保存 child handle、状态、attempt、usage 或输出，也不实现 wait/list/follow-up/interrupt；这些由 DSH 的其他工具和 continuation manager 管理。ADR 明确“不拥有 Sessions、child persistence、follow-up”（`docs/adr/0001-semantic-profile-router.md:36-40`）。
- `exec.signal` 传入 initial start（`src/index.ts:189-194`），但后续 continuable 生命周期不由 Legion 监管。

### 3.6 Cordis 生命周期

- tool disposer 被保存，provider surface refresh 前先 dispose 旧注册（`src/index.ts:234-243`）。
- provider event listeners 通过 `ctx.on()` 归属 Fiber（`src/index.ts:245-250`）。
- explicit effect 在 teardown dispose tool 并清空局部状态（`src/index.ts:251-255`）。
- system prompt section 由当前 Fiber 注册（`src/index.ts:257-261`）。
- 这足以支持 plugin row stop/HMR 下自身 tool/prompt 可逆；它不负责正在运行的 DSH child 终止策略。README 的 “reversible Cordis lifecycle and HMR-safe registrations” 对注册 surface 成立（`README.md:45-46`），不应扩张解释为 Legion-owned execution graph 热迁移。

## 4. 重点能力矩阵

| 能力 | 状态 | 源码事实 / 缺口 |
|---|---|---|
| Semantic profiles | 已实现 | 静态 profile map + enum tool（`src/config.ts:28-38`, `src/index.ts:107-143`）。 |
| Automatic task routing | 未实现 | 仅 `args.profile ?? defaultProfile`（`src/index.ts:27-37`）；主模型按 prompt 自行选（`src/prompt.ts:16-18`）。 |
| Provider availability filtering | 已实现 | provider 缺失时隐藏 profile，事件驱动刷新（`src/index.ts:211-250`）。 |
| Provider/model health scoring | 未实现 | 无 health probe/store/score/latency/error metrics；README 已列 not supported（`README.md:48-50`）。 |
| Fallback chain | 未实现 | 每 profile 只有一个 backend 与一个 child route；无候选列表、切换或降级。ADR 明确无 fallback（`docs/adr/0001-semantic-profile-router.md:52-56`）。 |
| Budget | 局部字段但非预算系统 | `maxTokens` 只是单 child output limit（`src/config.ts:10-14`）；无 token/cost reservation、aggregate hard cap、maxAgents/maxParallel/deadline。 |
| Retry | 未实现 | foreground abnormal settlement直接失败，background仅返回 id；无 retry policy/backoff/attempt ledger（`src/settlement.ts:12-20`, `src/index.ts:188-206`）。 |
| Synthesis/aggregation | 未实现 | 每次 tool call只启动一个 child；没有收集多结果或 final synthesizer。并行 sibling 由 coordinator/DSH tool runtime完成（`src/index.ts:175-176`; README `README.md:43-44`）。 |
| Quorum/voting | 未实现 | 配置和执行均无 members/quorum/vote/degraded result。 |
| Team/DAG/workflow runtime | 未实现且明确非目标 | README `README.md:50-52`；ADR `docs/adr/0001-semantic-profile-router.md:59-67`。 |
| Role | 部分：persona/description 可模拟 | 无 role 类型、role adapter、replica/evaluator；profile description只用于 coordinator guidance，persona直接覆盖 child（`src/config.ts:4-21`）。 |
| Per-child preset | 未实现 | request 无 preset 字段（`src/index.ts:90-104`）；README/ADR 明确 child 继承 parent standing preset（`README.md:52`, `docs/adr/0001-semantic-profile-router.md:20-22`）。 |
| Skills | 仅 preset 全局工具，不是 profile 能力 | bundled preset安装 `dsh-skill-filesystem` 与 `dsh-tool-skill`（`presets/legion/agent.cordis.yml:36-40`）；profile schema没有 skills，只有 tool name filter（`src/config.ts:17-21`）。不能给不同 profile 装载不同 skills/preset。 |
| Structured output | 仅 Legion tool 自身有 output schema；child schema缺失 | tool result用 oneOf 区分 continuable/foreground（`src/index.ts:144-167`）；请求没有 `outputSchema`，foreground output不做 object-rooted validation（`src/index.ts:90-104`, `src/settlement.ts:44-49`）。 |
| Observability | 最低限度、非 Legion telemetry | 返回 foreground `runId` / background `subagentId`（`src/index.ts:195-199`, `src/settlement.ts:44-49`）；无 events、metrics、trace、route rationale、usage、audit ledger、safe logs。 |
| Persistence | Legion-owned 未实现 | 无文件/DB/service/state store；background durability与 Session由 DSH提供，ADR明确委托（`docs/adr/0001-semantic-profile-router.md:38`）。 |
| Doctor/validate CLI | 未实现 | package scripts只有 build/typecheck/test/pack/profile-install（`package.json:25-35`）；没有 `bin`、doctor 命令或 runtime discovery report。 |
| Settings namespace/UI | 未实现 | plugin inject 不含 settings，config来自 preset row（`src/index.ts:15-16`, `src/config.ts:28-39`）；README明确无 GUI settings card（`README.md:53`）。 |
| Tool security policy | 部分 | deployment固定 allow/deny并由 provider/continuation manager执行；没有未知 tool preflight、安全 allowlist、skills/preset authority模型。 |
| Concurrency | 仅允许 DSH并行调用 | tool标记 concurrency-safe（`src/index.ts:175`）；无本地 maxParallel、公平性或 budget admission。 |
| Cancellation | foreground/background initial request继承 signal | request传 `exec.signal`（`src/index.ts:189-205`）；foreground测试覆盖 abort并dispose（`tests/plugin.spec.ts:298-346`）；无多成员 fan-out cancellation。 |

## 5. README / ADR 与源码事实差异

### 5.1 README：总体准确，但需避免过度解读

**准确声明：**

- README 明确说主 agent 选择 profile，插件解析为固定策略（`README.md:5`），与 `requireProfile()` 一致（`src/index.ts:27-37`）。
- supported 列表中的 named profiles、backend、child provider/model/maxTokens、persona/tool policy/depth/background 都有直接实现（`README.md:39-43`; `src/config.ts:4-26`）。
- “concurrent sibling calls through DSH parallel tool execution” 的措辞准确：源码只标记 concurrency-safe，不声称自建 scheduler（`README.md:44`; `src/index.ts:175`）。
- “fail-loud provider and capability validation” 对 available/default path及实际调用成立（`README.md:45`; `src/index.ts:39-77`, `src/index.ts:211-218`）。
- not-yet-supported 明确列出 fallback/health router、team/DAG、per-child preset、GUI settings（`README.md:48-53`），与源码相符。

**需要限定的地方：**

- “semantic profile routing” 容易让读者联想到 automatic router；实际只是 coordinator 通过 enum 显式 dispatch 或 static default（`README.md:35`, `src/index.ts:27-37`）。建议理解为 semantic naming/dispatch，不是插件内部 routing decision。
- “independent child LLM provider/model/maxTokens” 只对能消费 `agentOptions` 的 DSH child route有意义；README 已对 Codex/Claude Code 的 native model selection 作限制（`README.md:145-153`），源码本身不 discovery/验证 LLM provider/model 是否存在，只把字符串透传（`src/index.ts:95-103`）。
- “foreground/background default capability-checked immediately” 的准确边界是 **live provider + profile 默认模式**（`README.md:137`; `src/index.ts:216-218`）；调用时显式切换到另一模式仍可能在 execute 阶段报 capability error。
- “HMR-safe registrations” 证据覆盖 tool/prompt/provider listeners 的 disposer（`src/index.ts:237-255`），但测试没有显式模拟整个 plugin Fiber reload 且有 active child 的情形。

### 5.2 ADR 0001：与当前实现高度一致

ADR 的核心 decision 与源码一致：

- 单 agent-plane plugin + 单 tool（`docs/adr/0001-semantic-profile-router.md:24-27`; `src/index.ts:15-18`, `src/index.ts:106-209`）。
- profile 配置字段与工具参数一致（ADR `:28-36`; `src/config.ts:4-39`, `src/index.ts:20-25`）。
- 委托 `start/startContinuable` 且不拥有 persistence/follow-up/provider/credentials（ADR `:38-40`; `src/index.ts:188-206`）。
- negative consequences 对 fallback、product model selection、per-child preset、Web settings 的限制与源码一致（ADR `:52-57`）。
- roadmap 中 fallback、per-child preset、Host observability、client settings 都确实仍是 roadmap（ADR `:77-82`）。

细微差异：ADR 声称 DSH 已拥有 “cancellation, depth, persona, and tool-filter capability checks”（`:10-18`）；在 Legion foreground path 中也额外进行显式 capability checks（`src/index.ts:62-76`），background path则信任 continuation manager（`src/index.ts:51-60`）。这不是矛盾，而是 adapter 的 preflight 分工。

### 5.3 `docs/design/*`：已标 superseded，但正文能力远超当前实现

三份设计稿都在文件开头标明历史/已取代：

- `docs/design/minimal-interface.md:1-4`
- `docs/design/extensible-interface.md:1-4`
- `docs/design/alternatives.md:1-5`

因此不能把其 future interface 当作 README/ADR 的当前承诺。但它们正文使用“推荐”“v1”“MVP 验收标准”等现在/将来时，并展示大量不存在的 public contract，形成文档误读风险：

- `minimal-interface` 提议 Host `ctx.legion.run()`、policies、synthesis、quorum、retry、maxParallel、typed errors、budget、telemetry（`docs/design/minimal-interface.md:38-71`, `:83-143`, `:250-267`），当前 package 完全没有这些 service/types/modules。
- `extensible-interface` 提议 host runtime、roles/routes/adapters、health、fallback、budgets、observability、structured result（`docs/design/extensible-interface.md:69-182`, `:194-235`, `:269-325`），当前 `src/` 仅四个文件且无相应 registry/scheduler。
- `alternatives` 提议 MissionSpec、CLI、settings namespace、topologies、structured pipeline、doctor/validate（`docs/design/alternatives.md:214-305`, `:459-583`, `:644-653`），当前 `package.json` 无 `bin`，plugin 不 inject settings，也没有 mission runtime。

最重要的“声明 vs 事实”并非 README/ADR 虚假承诺，而是：**历史设计文档即使有醒目标记，其内部的完整 TypeScript/YAML、错误码和验收标准依然可能被搜索结果或局部引用脱离上下文传播。** 当前事实必须以 ADR 0001 + `src/*` 为准。

## 6. 错误模式与降级语义

### 6.1 配置期

- 空 `toolName`、空 description/provider、非法 profile name、非法 maxTokens/tool list 等由 Schemastery或 `validateConfig()`拒绝（`src/config.ts:41-71`, `src/config.ts:73-105`）。
- 空 profiles、空 toolFilter、defaultProfile 引用缺失也在 activation 失败（`src/config.ts:79-105`）。
- provider 当前缺失不是 activation error，而是 profile 被隐藏；全部缺失时工具消失（`src/index.ts:211-229`）。这是显式 unavailable behavior，不是 fallback。
- live provider 若不支持 profile **默认模式**所需 capability，refresh/activation 抛错（`src/index.ts:216-218`）。

### 6.2 调用前/启动期

- 无 default 且未传 profile、unknown profile、non-agent caller、disabled background、provider 在 schema生成后消失、capability 不足，均报普通 Error（`src/index.ts:27-35`, `:45-75`, `:80-84`, `:176-185`）。
- `ctx.subagents.start*` 自身 reject 会由 tool runtime 作为 error 返回；Legion没有分类、重试或备用 provider（`src/index.ts:188-206`）。

### 6.3 Settlement/cleanup

- foreground stop reason 非 completed 均失败，不把 partial 当 success（`src/settlement.ts:12-20`, `:35-43`）。
- result promise reject 仍执行 dispose；execution 与 disposal 双失败聚合（`src/settlement.ts:35-64`）。
- background 只确认 child id；后续 failure semantics由 DSH通知/控制面承担，Legion本身不投影 final status。

### 6.4 未实现的 resilience

无 error code、retryable 分类、retry/backoff、fallback、best-effort/degraded、quorum short-circuit、budget exhausted、deadline、synthesis fallback、provider health/circuit breaker、run ledger或 resume。历史设计稿列出的相应错误码不是当前 API（例如 `docs/design/minimal-interface.md:121-143`; `docs/design/extensible-interface.md:539-580`）。

## 7. Preset、role 与 skills

### 7.1 当前 preset 能力

- 仓库分发一个 ready-to-copy user preset metadata（`presets/legion/preset.yml:1-3`）和完整 composition（`presets/legion/agent.cordis.yml:1-132`）。
- preset 内含 persona、instructions、shell/fs/search/jobs、skill filesystem/tool、goal、compaction、subagent control、Legion、ask-user、todo、web（`presets/legion/agent.cordis.yml:4-69`, `:120-132`）。
- default profiles 为 `deep/quick/review`，都用 `spawn`，但绑定不同 model/persona/depth，review deny `write/edit`（`presets/legion/agent.cordis.yml:71-118`）。
- example fragment提供同一 Legion row供用户追加到自有 preset（`examples/legion.agent.cordis.fragment.yml:1-49`）。README明确不修改 shipped standard（`README.md:85-90`）。

### 7.2 不能做什么

- profile 不能指定 DSH preset；child沿用parent standing composition。源码 request字段没有 preset（`src/index.ts:90-104`），README明确限制（`README.md:52`）。
- `persona` 可表达 role prompt，但不存在 role identity、role-specific output schema、replicas、evaluator、quorum或provenance。
- preset安装的 skill工具对整个 parent/child standing composition可见；profile只能按工具名 allow/deny，不能声明或加载不同 skill集合（`src/config.ts:17-21`, `presets/legion/agent.cordis.yml:36-40`）。
- Legion 不在 activation 时把 toolFilter 名称与 live tool catalog 预核对；对于声明支持 `toolFilter` contract 的 DSH provider/continuation runtime，未知工具名会在下游 fail loud。外部 provider 是否支持该能力由 `SubagentCapabilities` 决定，不能泛化为所有 backend 都接受同一过滤语义（`packages/subagent/subagent/src/types.ts:132-140`；Legion 透传见 `tests/plugin.spec.ts:172-184`）。

## 8. Observability、persistence、doctor/settings UI

### 8.1 Observability

仅有：

- foreground result 的 `runId`、profile、raw output（`src/settlement.ts:5-10`, `:44-49`）；
- background start 的 `subagentId`（`src/index.ts:195-199`）；
- DSH tool result文本显示 start或child text（`src/index.ts:168-173`）。

缺失：Legion execution id、selected-route rationale、config digest、resolved provider/model/preset provenance、attempt/usage/token/cost、latency、member状态、event spans、metrics、logger/redaction、audit/export API。README没有宣称这些存在；ADR把 shared observability放在future host runtime roadmap（`docs/adr/0001-semantic-profile-router.md:81`）。

### 8.2 Persistence

源码没有 persistence依赖、state service、文件或DB访问。continuable child durability属于 DSH，不是 Legion run graph；foreground无任何持久化。README的 “continuable background children with normal DSH settlement notifications and follow-up support” 必须按这一委托关系理解（`README.md:43`; ADR `docs/adr/0001-semantic-profile-router.md:38`）。

### 8.3 Doctor/settings UI

- package无 `bin` 字段，scripts无 doctor/settings（`package.json:6-14`, `:25-35`）。
- plugin inject不含 `settings`，Config仅来自Cordis row（`src/index.ts:15-16`, `src/config.ts:28-39`）。
- bundle patch为空，不会安装Host service、settings namespace或Web row（`cordis.patch.yml:1-5`）。
- README明确 GUI settings card未支持，配置留在user-owned preset（`README.md:53`, `:83-90`, `:125-153`）。
- `scripts/verify-profile-install.mjs` 是CI/install smoke，不是用户-facing doctor：它pack tarball、在临时profile安装、mount preset并输出成功（`scripts/verify-profile-install.mjs:33-86`）。

## 9. 测试覆盖与缺口

### 9.1 当前测试面

在审计 commit `1897d305b9e416fa704d6d464607ab38f14400e6` 上共有 5 个 spec 文件、21 tests（本次本地运行全部通过）；数量只是该 commit 的审计快照，不是稳定产品 contract：

- `tests/plugin.spec.ts`：配置约束、tool schema/prompt、foreground request mapping、continuable start、capability ownership、abnormal settlement、result/disposal/cancellation、provider lifecycle、background disable、cross-field config、missing Agent（`tests/plugin.spec.ts:139-472`）。
- `tests/loader.spec.ts`：真实 Cordis Loader composition 能加载 agent-plane row，并在provider注册后出现tool（`tests/loader.spec.ts:24-87`）。
- `tests/preset.spec.ts`：preset YAML可解析、包含Legion row、没有在preset内注册Host subagent service（`tests/preset.spec.ts:9-28`）。
- `tests/distribution.spec.ts`：从profile-local `node_modules`解析 package并mount user preset（`tests/distribution.spec.ts:24-62`）。
- `tests/package.spec.ts`：bundle patch可解析且为空、manifest所列runtime/preset/example文件存在（`tests/package.spec.ts:18-44`）。

### 9.2 已证明与未证明

**较好覆盖：** foreground holder-owned disposal、dual failure、cancellation signal、default provider capability preflight、provider add/remove surface、Cordis loader/package resolution。

**测试与 gate 风险：**

- **高：CI gate 可能在测试前失败。** 仓库没有 `pnpm-lock.yaml`，但 CI 直接运行 `pnpm install`（`.github/workflows/ci.yml:18-26`），同时 manifest 固定 `packageManager: pnpm@11.21.0`（`package.json:60`）。审计中的 clean frozen install 实测报 `ERR_PNPM_NO_LOCKFILE`；当前仓库也没有通过 lockfile 保证依赖可复现。
- **高：独立 test 与 ignored build artifact 耦合。** `lib/` 被 `.gitignore` 排除（`.gitignore:1-3`），但 package entry、exports 与 tarball 都依赖 `lib`（`package.json:6-16`）。`pnpm run check` 因顺序为 typecheck → build → test 而生成 `lib` 后再测（`package.json:28-34`），掩盖了 clean artifact 状态直接运行 `pnpm test` 时 package/distribution tests 的失败：审计实测 clean 状态 19/21，build 后 21/21；依赖点见 `tests/package.spec.ts:37-43`、`tests/distribution.spec.ts:24-34,60-61`。README 已要求 local checkout 先 build（`README.md:57-66`），Git dependency 则依赖 `prepare`（`README.md:68-81`, `package.json:33`），但这是安装前置条件而非独立 `test` script 的自洽 contract。
- packed-install smoke 只证明 tarball 可安装、preset 可 mount（`scripts/verify-profile-install.mjs:43-82`）；它没有注册 provider 后验证 tool/prompt，也没有实际执行 delegation。CI 仅在 Node 24 运行该 smoke（`.github/workflows/ci.yml:27-28`）。

**未覆盖或不存在：**

- automatic router/fallback/budget/retry/synthesis/quorum（因为没有实现）；
- per-child preset、skills隔离、structured child output；
- settings/doctor/UI、observability/persistence；
- real spawn/fork/product provider E2E、真实LLM provider/model discovery；
- continuable cold resume/follow-up/interrupt/final settlement；测试仅 mock `startContinuable()`（`tests/plugin.spec.ts:186-208`, `:210-247`）；
- explicit full Fiber HMR/reload with active runs；
- missing/unknown profile、provider removal race、non-continuable backend、persona/toolFilter capability rejection及若干cross-field/stop-reason分支没有直接测试；相关源码分支见 `src/index.ts:27-37,45-75`、`src/config.ts:74-105`、`src/settlement.ts:12-20`；
- coverage threshold。Vitest配置声明v8 include，但没有 reporter/threshold，`pnpm test`也未启用coverage（`vitest.config.ts:3-10`, `package.json:28-32`）；
- Windows CI。GitHub Actions只跑Ubuntu Node 22/24（`.github/workflows/ci.yml:11-28`）。

### 9.3 本次验证

- `pnpm run check`：typecheck、build、Vitest均完成；5 files / 21 tests passed。整体命令最初在最终 `npm pack --dry-run --ignore-scripts` 阶段达到120秒工具超时，因此随后单独执行 pack验证。
- `pnpm run verify:pack`：通过；dry-run tarball为 `dsh-legion-0.1.0.tgz`，13 files，包含 `lib`、empty patch、examples、presets、README/CHANGELOG/SECURITY/LICENSE。该命令只验证清单，不等于安装或运行验证。
- 子代理尝试 packed profile install 时遇到 registry TLS timeout，未完成；这是外部网络阻断，不能据此判定代码失败，也意味着本次没有获得 packed-install 成功的独立复验。

## 10. Build、分发与安装事实

- ESM package，entry `lib/index.js`，types `lib/index.d.ts`，exports仅根与package.json（`package.json:5-14`）。
- `files`白名单包含 `lib`、patch、examples、presets及文档许可证（`package.json:15-24`）。源码和研究/ADR文档不进入npm tarball。
- build使用tsdown，ES2024 Node target，生成dts并 externalize `@deepseek-ai/*`（`tsdown.config.ts:3-13`）。
- runtime dependency只有Schemastery；DSH/Cordis均为peer，范围为Cordis `^4.0.1` 与 DSH `>=0.1.0-rc.5 <0.2.0`（`package.json:66-76`）。dev锁在rc.6（`package.json:78-95`）。
- `prepare`会build，`prepack`会typecheck/build/test；`check`是typecheck/build/test/pack dry-run（`package.json:25-35`）。
- DSH bundle patch有意为空，仅使profile-local package可解析，不增加process-global tool/service（`cordis.patch.yml:1-5`; README `README.md:81-83`）。
- CI在Ubuntu Node 22/24执行install/check，Node24额外运行packed profile install（`.github/workflows/ci.yml:11-28`）；matrix 使用 floating major `22`，没有显式锁定并验证 engines 下界 `22.19.0`（`package.json:57-59`）。
- `test:profile-install`实际从pack tarball安装到临时profile，再通过AgentPresets mount验证（`scripts/verify-profile-install.mjs:33-86`）。
- 无release workflow、provenance/SBOM/signing、npm publish automation或多平台 E2E；GitHub install和npm tarball行为由README说明（`README.md:55-83`），但仓库CI没有实际GitHub install测试。`package.json` 声明版本与 public publish config（`package.json:3`, `:54-56`），CHANGELOG 列出 `0.1.0` release/tag链接（`CHANGELOG.md:19-33`），仓库内却没有自动发布链可验证 tag、tarball与registry发布的一致性。

## 11. 按优先级归纳的产品缺口

### P0：名称/期望管理

1. **不是 automatic router。** 当前“routing”由coordinator prompt完成，插件只做显式enum dispatch。若产品目标是自动选择，需要task features、candidate discovery、deterministic decision、explanation与测试；当前均无。
2. **不是 multi-agent orchestration runtime。** 一次调用只启动一个child；multi-model panel、pipeline、vote、synthesis都由主agent多次调用并自行整合。
3. **历史设计稿易被误读。** 虽有superseded banner，但其中完整接口、错误码和MVP验收远超当前交付。

### P1：可靠性与成本控制

4. 无 fallback/health；provider或model失败直接失败。
5. 无 retry/backoff/idempotency/attempt上限。
6. 无 aggregate token/cost/time/agent/parallel budget；`maxTokens`不是budget。
7. 无 quorum/best-effort/degraded/member ledger；不能结构化表达部分成功。
8. 无 synthesis/evaluation/structured child output；最终质量完全依赖coordinator prompt。

### P2：能力隔离与配置体验

9. 无 per-child preset；只能继承parent preset并叠加persona/toolFilter/model/depth。
10. 无 per-profile skills装配；skill仅是preset全局tool，profile最多按名字过滤。
11. 无 settings namespace/hot update/schema projection，也无GUI settings/doctor。
12. provider名称存在性可检测，但LLM provider/model是否有效直到下游start才知道；无model capability discovery。

### P3：运维与恢复

13. 无Legion-owned telemetry、audit、usage、route rationale、metrics或redaction policy。
14. 无Legion run persistence/resume；只有DSH continuable child具备外部生命周期。
15. 无doctor/read-only capability report、配置解释、provider/model/preset/skill availability诊断。
16. 无release automation和跨平台/真实provider兼容矩阵。

## 12. 最终判定

`dsh-legion@0.1.0` 当前交付与 README “MVP for semantic profile routing over DSH subagents” 基本一致，但必须把“routing”严格理解为：**部署者定义固定profiles，coordinator显式选择，插件检查当前backend availability/capability并委托给DSH**。

它已经可靠实现了一个小而清晰的 adapter seam：配置校验、live provider filtering、foreground严格settlement/disposal、continuable启动、Cordis可逆注册、user-preset/package分发。它尚未实现此前设计探索中更深的Legion runtime：automatic route/fallback/budget/retry/quorum/synthesis/roles/presets/skills/structured output/telemetry/persistence/settings/doctor/UI。README与ADR 0001没有掩盖这些主要边界；真正需要防范的是项目名及历史设计稿让使用者把“未来架构”误认为“当前源码事实”。
