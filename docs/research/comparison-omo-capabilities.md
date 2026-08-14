# oh-my-openagent 能力深度只读审计：面向 dsh-legion 的比较

> **审计基线**：`code-yeongyu/oh-my-openagent` 的只读 checkout；当前 HEAD `038ed0cbbefe2b40677b63867aeea0d16bc303e0`。本文所有 GitHub 链接固定到该 commit。本次未修改被审计仓库。
>
> **判定口径**：产品文档只证明“承诺/设计意图”；源码入口、持久化结构、状态转换与测试才证明“已实现”。“真实实现”也不等于三个 edition 行为完全一致：ROADMAP 明确称最大 OpenCode adapter 仍强耦合，且 `omo.json` 目前是 **senpi-first**，OpenCode 仍读取自己的 legacy config chain，两套配置“zero interaction today”（本地 `ROADMAP.md:65-79`；[固定链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/ROADMAP.md#L65-L79)）。

## 1. 总结判断

OmO 与 dsh-legion 愿景真正同构的部分，是一个有状态的 orchestration kernel：**semantic category → agent/role → resolved model chain → bounded child execution → durable state/resume → independent verification → explainable effective configuration**。最值得借鉴的是语义路由、确定且可解释的 fallback、能力 metadata/provenance、后台任务生命周期、goal completion audit、以及 planner/executor/reviewer 的职责隔离。

但 OmO 仍有明显张力：

1. category 是语义接口，默认策略却仍是硬编码的 provider/model 排名；应该借接口与解析机制，不应复制当前榜单。
2. 文档描绘统一的产品，真实 runtime 分散在 OpenCode hooks、Senpi task manager、Codex components；跨 harness 核心尚在重构中。
3. Team Mode 很完整，但 mailbox、tmux、worktree 和 12 个工具是较重的协作产品面，不是 category/task/goal 内核的前提。
4. prompt injection 既是其力量来源，也是其已知脆弱点；ROADMAP 明说异步 prompt 接受会造成 duplicate work、infinite loops、state corruption（`ROADMAP.md:81-91`；[固定链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/ROADMAP.md#L81-L91)）。

## 2. 能力矩阵：文档承诺 vs 真实实现

| 能力 | 产品文档口径 | 真实实现证据 | 审计结论 / dsh-legion 启示 |
|---|---|---|---|
| Semantic category routing | category 描述 intent 而非 model；八个 user-facing category，统一交给 Sisyphus-Junior（`docs/guide/orchestration.md:319-350`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/docs/guide/orchestration.md#L319-L350)） | 这里**没有代码 semantic classifier**：orchestrator LLM 依据 tool description 自行选择 category，runtime 只校验 category 字符串并映射 worker/model（`packages/omo-opencode/src/tools/delegate-task/tools.ts:61-79`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-opencode/src/tools/delegate-task/tools.ts#L61-L79)，`category-resolver.ts:65-89,271-280`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-opencode/src/tools/delegate-task/category-resolver.ts#L65-L89)）；authoritative chains 在 `packages/model-core/src/category-model-requirements.ts:3-155`（[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/model-core/src/category-model-requirements.ts#L3-L155)） | **核心接口已实现，自动分类未实现**。语义选择目前是 prompt/LLM 行为；默认 chain 是版本化 policy，不是永恒 capability truth。 |
| Agents / roles | 11 built-in agents；primary 与 subagent 分离（`docs/guide/orchestration.md:82-108`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/docs/guide/orchestration.md#L82-L108)） | agent fallback requirements 独立定义（`packages/model-core/src/agent-model-requirements.ts:3-181`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/model-core/src/agent-model-requirements.ts#L3-L181)）；Senpi agent resolver 对 agent chain 做 availability resolution（`packages/senpi-task/src/agents/resolve-agent.ts:89-172`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/senpi-task/src/agents/resolve-agent.ts#L89-L172)） | **角色能力核心，神话命名非核心**。dsh-legion 应保留 role contract（planner/executor/reviewer/researcher），避免把 Sisyphus 等品牌名固化为架构。 |
| Model resolution / fallback | 文档声明 UI → user override → category default → user fallback → provider chain → system default，并两次声称 spawn 与 runtime retry 使用同一 resolved chain（`docs/reference/configuration.md:392-404`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/docs/reference/configuration.md#L392-L404)） | spawn pipeline 的优先级和 `attempted` 在 `packages/model-core/src/model-resolution-pipeline.ts:94-273`（[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/model-core/src/model-resolution-pipeline.ts#L94-L273)）；但 OpenCode reactive runtime fallback 只读取显式 `fallback_models`，没有显式配置时停止，不会自动复用 built-in agent/category requirements（`packages/omo-opencode/src/hooks/runtime-fallback/fallback-models.ts:39-98`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-opencode/src/hooks/runtime-fallback/fallback-models.ts#L39-L98)，`event-handler.ts:241-247`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-opencode/src/hooks/runtime-fallback/event-handler.ts#L241-L247)）；delegate-core 另有不同匹配语义（`packages/delegate-core/src/model-selection.ts:230-263`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/delegate-core/src/model-selection.ts#L230-L263)） | **核心存在，但不是全系统统一 resolver**；“spawn/retry 同链”对 OpenCode reactive fallback 不成立。dsh-legion 应冻结并全链路复用同一 resolution record。 |
| Capability normalization | 文档称 runtime metadata 优先，其次 bundled models.dev/local cache，再次 heuristic + alias；doctor 可显示 diagnostics（`docs/reference/configuration.md:429-463`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/docs/reference/configuration.md#L429-L463)） | capability resolver 处理 provider prefix、variant、alias，按 runtime / override / snapshot / heuristic 合并，并逐字段记录 source（`packages/model-core/src/model-capabilities/get-model-capabilities.ts:133-252`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/model-core/src/model-capabilities/get-model-capabilities.ts#L133-L252)）；它确实接入 OpenCode `chat.params`（`packages/omo-opencode/src/plugin/chat-params.ts:113-189`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-opencode/src/plugin/chat-params.ts#L113-L189)），但未找到生产调用把 refreshable local snapshot 传给 resolver，故“刷新本地 cache 会影响 runtime”缺少实现证据 | **编排核心且部分接入生产**。runtime/bundled/heuristic 已有 provenance；refreshable local cache 不能仅凭文档视为已接线。 |
| Background tasks / concurrency | README 称 5+ specialist 并行；orchestration 文档只概述 default/provider/model 三层限制（`docs/guide/orchestration.md:383-389`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/docs/guide/orchestration.md#L383-L389)） | **OpenCode 与 Senpi 是两套语义不可混用的 task runtime**。Senpi schema 包含 execution mode、depth、residency、absolute record TTL、state dir、reconcile/resume（`packages/omo-config-core/src/schema/task.ts:7-41`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-config-core/src/schema/task.ts#L7-L41)），其 FIFO concurrency 按 model override → provider override → model key（`packages/senpi-task/src/manager/concurrency.ts:13-101`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/senpi-task/src/manager/concurrency.ts#L13-L101)）。OpenCode 的 `defaultConcurrency` 也按 model/provider key 而非全局总量，queue/counts 主要进程内；其 `taskTtlMs` 表示 queue age/inactivity，不等于 Senpi absolute TTL | **核心但 adapter 分叉明显**。dsh-legion 必须先定义统一 task lifecycle 语义，再让 adapter 映射；不能把同名 concurrency/TTL 当作等价。 |
| TTL / depth / resume | 产品主文档较少暴露这些细节 | Senpi reconcile 支持 scoped durable resume、ownership/admission、tombstone、reattach disabled、respawn/reattach、lost/deferred（`packages/senpi-task/src/lifecycle/reconcile-reclamation.ts:46-141`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/senpi-task/src/lifecycle/reconcile-reclamation.ts#L46-L141)）；OpenCode queue/counts 则主要进程内。两者默认 depth 也不同：OpenCode 为 3、Senpi schema 为 1（`packages/omo-config-core/src/schema/task.ts:28-33`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-config-core/src/schema/task.ts#L28-L33)） | **durable lifecycle 是核心，但主要成熟于 Senpi path**。报告与 dsh-legion 设计都应明确 adapter-specific guarantee。 |
| Team Mode | opt-in，lead + members，12 tools，mailbox/shared task list；默认 8 members、4 in flight、120 min（`docs/guide/team-mode.md:83-108`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/docs/guide/team-mode.md#L83-L108)） | OpenCode 与 Senpi 的 Team 工具面、配置和生命周期不同；该 12-tool 文档主要描述 OpenCode adapter。共享 schema 只固化部分 max members/parallel/wall-clock（`packages/omo-config-core/src/schema/task.ts:13-17,36-40`）；OpenCode 文档还承认 no nested teams、fire-and-forget messaging、member delegation budget 0（`docs/guide/team-mode.md:122-127`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/docs/guide/team-mode.md#L122-L127)） | **高级 orchestration product，不是统一内核保证**。文档和 API 必须标注 adapter；先实现 task graph + messaging primitives，再决定完整 team UX。 |
| Planner / executor / reviewer | Prometheus 访谈规划，Metis gap analysis，Momus + Oracle 双审，Atlas 执行（`docs/guide/orchestration.md:120-203,213-239`；[链接 1](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/docs/guide/orchestration.md#L120-L203)、[链接 2](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/docs/guide/orchestration.md#L213-L239)） | Prometheus 的 system prompt/permission 仍允许 edit/bash（`packages/omo-opencode/src/agents/prometheus/system-prompt.ts:3-8`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-opencode/src/agents/prometheus/system-prompt.ts#L3-L8)）；`.omo/*.md` 限制依赖可禁用且依赖 agent 识别的 hook（`packages/omo-opencode/src/hooks/prometheus-md-only/hook.ts:18-60`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-opencode/src/hooks/prometheus-md-only/hook.ts#L18-L60)）。Metis→双 reviewer→无限返工主要是 prompt contract，未见独立 runtime state machine 强制 | **职责分离是核心，但“read-only/双审完成”不是机器级保证**。dsh-legion 应以 permission enforcement 和 typed bounded workflow 实现，而非只靠 prompt/hook。 |
| Config layering / profile / effective view | user/project walk、base → `[harness]` → profile → profile.`[harness]`；不存在 profile 有 diagnostic（`docs/reference/configuration.md:50-81`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/docs/reference/configuration.md#L50-L81)） | loader 对每层做 parse/validation diagnostics，按序 merge；最终失败回默认（`packages/omo-config-core/src/loader/loader.ts:76-182`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-config-core/src/loader/loader.ts#L76-L182)）；effective order 在 `resolution.ts:60-85`（[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-config-core/src/loader/resolution.ts#L60-L85)） | **控制平面核心**。但目前 result 记录 layer/source，不是逐字段 provenance；dsh-legion 应输出 field-level effective view。 |
| Doctor / install | 三 edition installer；doctor 支持 default/status/verbose/JSON（`README.md:112-178`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/README.md#L112-L178)，`packages/omo-opencode/src/cli/cli-program.ts:239-261`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-opencode/src/cli/cli-program.ts#L239-L261)） | doctor checks system/config/TUI/tools/models/telemetry/team（`packages/omo-opencode/src/cli/doctor/checks/index.ts:20-84`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-opencode/src/cli/doctor/checks/index.ts#L20-L84)），但 known issues 记录 `System OK` 而 agents 缺失的场景（`docs/reference/known-issues.md:127-138,230-237`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/docs/reference/known-issues.md#L127-L138)）；`--platform=both` 时 Codex 失败而 OpenCode 成功仍可整体退出 0（`packages/omo-opencode/src/cli/cli-installer.ts:150-164,208`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-opencode/src/cli/cli-installer.ts#L150-L164)） | **外围但关键的可运维性**。doctor pass/installer exit 0 都不能证明全部 runtime capability 已挂载；必须按 edition/component 报告部分成功。 |
| Skills / tools / prompt injection | 文档称 skill 可按 relevance 自动激活，且 instructions prepend 到 child prompt；优先级 project > opencode > user > builtin（`docs/guide/orchestration.md:352-381`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/docs/guide/orchestration.md#L352-L381)，`docs/reference/features.md:447-450`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/docs/reference/features.md#L447-L450)） | 实现只是把 skill 名称/description 放进 tool description 让模型自行调用，并无 deterministic intent matcher（`packages/omo-opencode/src/tools/skill/tools.ts:122-199`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-opencode/src/tools/skill/tools.ts#L122-L199)）；`allowed-tools` 被解析携带但加载/调用路径未执行 allowlist，restricted skill 还存在先询问、后校验的时序问题；审计另发现 skill symlink 可能越过发现 scope，scope priority 的实现与部分文档不一致。用户可控 description 直接嵌入 XML-like description，存在 discovery-stage prompt injection 面（`packages/omo-opencode/src/tools/skill/description-formatter.ts:10-42,95-100`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-opencode/src/tools/skill/description-formatter.ts#L10-L42)）。Rules injection 虽有字符预算与去重（`packages/rules-engine/src/engine/constants.ts:74-109`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/rules-engine/src/engine/constants.ts#L74-L109)） | **skills/tools registry 是核心输入，但自动激活、scope confinement 与 allowed-tools enforcement 未形成硬边界**。dsh-legion 必须 canonicalize/约束 skill 路径、转义不可信 metadata，并由 runtime 强制 tool policy。 |
| Observability / provenance | 文档承诺 doctor、status、attempted chain；Team status/monitor 提供运行视图 | resolution 有 `provenance`/`attempted`，capability 每字段有 source，Senpi status 显示 resolved model/fallback。但没有跨 config→route→task→artifact 的统一 trace。Memory provenance 可桥接注入与 Git trailers，但缺上下文时不 fail-closed；本地 task event log 只保留 assistant text/tool marker/error/fallback 切片并按敏感 key 名 redact，不能完整 replay。Telemetry 也不等于 trace：Privacy Policy 低估 Senpi event 范围，GeoIP 文档与实现 `disableGeoip: true` 冲突，daily-active 在发送前写 dedup 导致失败后当日不重试，event runtime 只做 key/primitive allowlist 而非完整 enum/type 校验 | **核心横切能力，现状碎片化且 analytics 契约有漂移**。dsh-legion 应统一 execution provenance，并将 telemetry 与审计 trace 严格分离。 |
| Goal / continuation | README 称每次 idle 重注入 continuation，直到 completion audit 完成（`README.md:224-240`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/README.md#L224-L240)） | OpenCode goal 主干存在：idle 读取 active goal，in-flight 去重后异步注入（`packages/omo-opencode/src/hooks/goal/index.ts:36-103`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-opencode/src/hooks/goal/index.ts#L36-L103)），prompt 要求 evidence audit（`packages/omo-opencode/src/hooks/goal/prompt.ts:3-30`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-opencode/src/hooks/goal/prompt.ts#L3-L30)）。但 `auto_start`、`default_max_iterations` 与 production usage accounting 未完整接线；completion audit 仍只是 prompt 约束 | **长任务核心，但预算/计量/完成判定并非硬状态机保证**。dsh-legion 应以持久调度状态、硬 round budget 和可核验证据实现。 |

## 3. 重点深入结论

### 3.1 Semantic category 应成为稳定请求接口，model chain 只能是可替换 policy

OmO 的最佳抽象不是 `quick/deep` 这几个具体名字，而是将 caller 的意图与 provider/model 解耦。实际 resolver 已能：

- 接受 explicit model、category default、user fallback、built-in chain、system default；
- 对 live model registry 做 fuzzy/alias/provider transform；
- 在 unavailable 时返回 attempted chain 和 missing providers；
- 将 resolved model、variant、source 传给执行层。

但 built-in category 和 agent chain 明确硬编码在源码中。这意味着它仍是“semantic API + curated leaderboard policy”，而非完全由能力约束推导。dsh-legion 应采用两段式协议：

1. preset/agent 请求 `category + required_capabilities + quality/cost/latency bounds`；
2. host resolver 基于实时 registry 与 deployment policy 生成 immutable chain，并记录所有候选的接受/拒绝原因。

不要把 OmO 当前 model 排序照抄为架构；它会随 provider、区域、订阅和模型版本快速过期。

### 3.2 Capability normalization 是路由正确性的基础，不只是兼容补丁

`getModelCapabilities` 的价值在于对每一个属性分别决定来源：runtime metadata、provider/model override、runtime/bundled snapshot、heuristic、none。它还处理同 provider 前缀、reasoning suffix、canonical alias。这个逐字段 diagnostics 比一个粗糙的“model family”标签可靠得多。

应迁移的原则：

- unknown 与 false 必须区分；
- runtime truth 优先，但要记录采样时间/version；
- heuristic 结果必须带低置信度 provenance；
- normalization 后仍需在调用前降级/拒绝不支持的 temperature、top_p、reasoning、modalities、tool call；
- retry 必须使用 spawn 时冻结的 chain，避免 registry 变化导致同一 task 不可复现。

### 3.3 Background runtime 的真正边界是 durable lifecycle

OmO/Senpi task 不只是“开一个后台 agent”。schema 和 lifecycle 已覆盖：并发队列、execution mode、递归深度、resident child cap、TTL、state directory、reconcile reattach、child resume、wait bounds。其 adversarial/chaos tests 还说明作者把 ownership race、orphan reclaim、wait settlement、cancelled pending 不得启动当成核心 invariant。

这对 dsh-legion 的直接含义是：scheduler 应位于 HOST/shared registry，而非各 preset 自建。最小 TaskRecord 至少要有：

- stable task/run id、parent session/task、depth；
- requested role/category 与 frozen model resolution；
- queued/running/terminal + resident/detached/disposed 两个正交状态轴；
- created/updated/lease/TTL、owner process/session；
- cancellation cause、resume/reconcile disposition；
- output/evidence/provenance 引用。

### 3.4 Planner / executor / reviewer：协议是核心，角色 persona 是产品包装

OmO 的三层图解决了三个真实问题：planner 避免边做边漂移，executor 管理 delegation 与累积 learning，independent reviewer 抵抗 self-approval。值得借鉴的是 artifact handoff 和权限边界：planner 只产计划，executor 依计划执行，reviewer 引用真实文件/测试证据。

不应照搬：

- 神话角色名与固定 11-agent 组织图；
- 每个任务都强制完整流程；
- “任一 reviewer reject 就无限重跑”的无上限循环；
- 将“只能写 `.omo/*.md`”仅靠 adapter hook 实现。

建议 dsh-legion 提供声明式 workflow profile：`plan_only → execute(plan_digest) → review(artifact_set)`，每阶段有 permission envelope、round/time/token/cost budget 和 termination reason。

### 3.5 Config effective view 还缺逐字段 provenance

`omo-config-core` 已有良好基础：layer parse/validation diagnostics、确定覆盖顺序、missing profile fallback、最终 schema validation。merge 也并非所有 array 一律 replace：`codegraph.excluded_roots` 特判为 union + dedupe（`packages/omo-config-core/src/loader/merge.ts:26-28,41-45`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-config-core/src/loader/merge.ts#L26-L45)）。问题是 `layers` 与 `sources` 只能告诉用户“哪些文件参与”，不能直接回答“最终 `task.max_depth` 来自哪个文件/哪个 profile”；CLI 只有 config migration，doctor 也不提供完整 effective-config dump（`packages/omo-opencode/src/cli/cli-program.ts:265-275`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-opencode/src/cli/cli-program.ts#L265-L275)）。

dsh-legion 应将 effective view 作为一等产品对象：每个 leaf 输出 `value/source/layer/path/normalization/warnings`；权限字段采用单调收窄规则，项目层不得扩大 host policy。Doctor 应直接消费这份 effective view，避免诊断逻辑重新实现解析。

### 3.6 Goal / continuation 需要状态机化，避免 hook 重入

OmO 新 goal prompt 的 completion audit 很强：它要求将 objective 拆为 checklist，并以 artifact/test/command state 覆盖每项；这比“todos 全绿即可 complete”可靠。但 runtime 仍由 `session.idle` 触发异步 internal prompt。源码有 per-session in-flight set，只防当前进程内并发重复；ROADMAP 已承认 host prompt API 的 durable acceptance 不可靠。

dsh-legion 应采用显式 continuation state：`armed → running → awaiting_evidence → complete/paused/blocked`，使用 revision/CAS、round limit、budget、idempotency key 和 durable wake event。Prompt 只携带状态快照，不应承担状态转移本身。

## 4. 产品文档与实现的主要差距

1. **“统一产品” vs edition 分叉**：README 用 Ultimate/Light/Senpi 描绘一个品牌，但 ROADMAP 明确 OpenCode config 与新 `omo.json` 尚无交互，adapter 能力不可默认等价。
2. **“semantic routing” vs LLM 自选 category**：category 是真实语义接口，但并无代码 classifier；orchestrator prompt 让 LLM 选字符串，runtime 再确定性解析。默认模型仍是硬编码 chain。
3. **“same resolved chain” vs 三条解析路径**：spawn pipeline、delegate-core、OpenCode reactive runtime fallback 的边缘语义不同；后者只读显式 `fallback_models`，文档的同链承诺不成立。
4. **文档默认值漂移**：`docs/guide/overview.md:104` 称 `unspecified-low` 默认 GPT-5.6 Luna（[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/docs/guide/overview.md#L104)），权威实现首选却是 GPT-5.6 Terra `high`（`packages/model-core/src/category-model-requirements.ts:95-101`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/model-core/src/category-model-requirements.ts#L95-L101)）。
5. **“read-only planner / mandatory dual review” vs prompt/hook contract**：Prometheus 的硬权限并非 read-only；review 流程未见独立状态机强制。
6. **“doesn't stop until done” vs 安全终止不足**：goal audit 很严谨，但 high-accuracy review 明示无 retry 上限；长任务必须由预算和取消语义约束。
7. **“resume/no context lost” 是营销化表达**：boulder 恢复的是 plan path、session ids、checkbox progress 等持久状态（`docs/guide/orchestration.md:442-492`；[链接](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/docs/guide/orchestration.md#L442-L492)），不等于完整模型上下文无损恢复。Senpi task 的 reconcile/reattach 更接近真正 runtime resume。
8. **Doctor 很广，但不是统一 provenance graph**：它能检查系统、配置、工具、模型、telemetry、team 与 Codex components，却没有把一次决策从配置来源追到最终 artifact。

### 验证限制

尝试执行聚焦测试时，workspace 在 preload 阶段因缺失 `@oh-my-opencode/utils` 等 workspace module 失败，结果为 **0 pass / 8 errors**。因此本文将测试文件仅作为静态实现意图/回归资产，未把它们表述为本次动态验证通过；该环境失败也不能据此判定业务逻辑失败。

## 5. 对 dsh-legion 的建议落点

### P0：编排内核

1. **Semantic resolver**：category/role + capability constraints → frozen model chain；所有候选有 reason/provenance。
2. **Durable task scheduler**：并发、queue、cancel、TTL、depth、residency、lease、reconcile、resume、cost/time/token budget。
3. **Goal/continuation state machine**：revisioned objective、evidence checklist、bounded autonomous rounds、blocked/paused/complete。
4. **Effective configuration graph**：host policy、preset/profile、project/session overlays，逐字段 provenance，权限只可收窄。
5. **Planning/execution/review protocol**：artifact-based handoff、权限隔离、独立 review 和有限重试。
6. **Unified execution provenance**：将 config、route、prompt/skill/tool sources、task lineage、fallback、artifact evidence 串成同一 trace。

### P1：核心之上的能力面

1. 声明式 agents/roles catalog 与可替换 persona；
2. team graph、mailbox、shared tasks（先无 tmux）；
3. skills/tool manifests、lazy capability loading、prompt budget/security labels；
4. doctor 消费 effective view 与 runtime registry，输出 human + JSON；
5. Web 可视化 task/team/goal/provenance。

### P2：外围产品与分发

1. 多 edition installers、自动迁移、uninstall/cleanup；
2. tmux pane 与 worktree UX；
3. telemetry/DAU analytics；
4. branding、神话角色、`ultrawork` keyword marketing；
5. compatibility importers 与 provider-specific onboarding。

## 6. 最终分类：哪些是编排核心，哪些只是外围产品功能

### 编排核心

- Semantic category routing 与 role contract；
- model resolution、fallback chain、capability normalization；
- agent/task lineage、background concurrency、TTL、depth、cancel、resume/reconcile；
- goal、continuation、completion evidence audit；
- planner/executor/independent reviewer 的协议与权限边界；
- config layering、profile、effective view 与逐字段 provenance；
- skills/tools 作为声明式 capability 输入及其来源/预算/权限；
- observability/provenance（决策可解释、运行可恢复、结果可审计）。

### 高级编排产品（非最小核心，但可建立在核心之上）

- Team Mode 的 lead/member、mailbox、shared tasks、shutdown protocol；
- multi-agent monitor/status UI；
- worktree-per-member；
- role/persona catalog 和预制 workflow profiles。

### 外围产品功能

- install/uninstall、edition packaging、provider onboarding；
- doctor 的 CLI 格式与漂亮 dashboard（诊断能力必要，但展示/安装属于外围）；
- tmux visualization；
- telemetry/DAU；
- branding、角色神话、`ultrawork` 关键词；
- Claude/OpenCode/Codex 兼容层与迁移脚本。

**最终判断**：dsh-legion 应迁移 OmO 的“语义请求、确定解析、持久状态、受限并行、证据审核、配置与决策 provenance”，而不是迁移其“固定角色名、当前模型榜单、无限自治口号、OpenCode prompt-hook 堆叠、tmux 与多 edition 包装”。前者构成 orchestration kernel；后者主要是 adapter、UX、增长与分发层。