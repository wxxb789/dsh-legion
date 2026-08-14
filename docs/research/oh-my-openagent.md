# oh-my-openagent 对 DSH 的可迁移能力研究

> 研究基线：`code-yeongyu/oh-my-openagent` 的只读 checkout，GitHub 默认分支 `dev`，核验时 HEAD 为 `038ed0cbbefe2b40677b63867aeea0d16bc303e0`。研究覆盖 README、docs、ROADMAP、package metadata 及完整 `packages/*` 源码；以下引用仍使用固定到该 commit 的 GitHub URL，避免后续漂移。

## 结论摘要

oh-my-openagent（OmO）最值得 DSH 借鉴的不是角色名或“ultrawork”口号，而是四个产品原则：**按任务语义而非模型名路由、规划/执行/审核分层、长任务持久化与可恢复、能力核心与 harness adapter 解耦**。DSH 已有 preset、model route、subagent、goal、skill、tool/approval、Cordis host/client 等相近原语，宜在现有架构上补齐“声明式 preset + category routing + 可解释 fallback + 分发/doctor”，不应移植其 OpenCode hook 堆叠或神话角色体系。

## 一手事实

- 产品以三种 edition 分发：OpenCode Ultimate plugin、Codex Light plugin、Senpi standalone；README 明确列出能力差异和安装落点（[README](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/README.md#installation)）。
- 编排包含 11 个内建 agent，分为 primary 与 subagent；规划由 Prometheus/Metis/Momus/Oracle，执行由 Atlas 调度 worker，并把 category 与具体 model 解耦（[orchestration guide](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/docs/guide/orchestration.md#the-architecture)、[agent inventory](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/docs/guide/orchestration.md#agent-inventory-and-modes-current)）。
- `task(category=...)` 统一落到 worker，`task(subagent_type=...)` 直接选专家，二者互斥；category 描述任务意图，而非实现模型（[delegation semantics](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/docs/guide/orchestration.md#delegation-semantics-important)、[category rationale](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/docs/guide/orchestration.md#why-categories-are-revolutionary)）。
- 配置可覆盖 agent 的 model chain、reasoning、prompt、tools、permission、skills、mode；category 也可声明 model chain、prompt、tools 与稳定性策略（[agent options](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/docs/reference/configuration.md#agent-options)、[category options](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/docs/reference/configuration.md#category-options)）。
- 模型解析有显式优先级，spawn 与 runtime retry 共用同一条 resolved chain；不可用 category 可隐藏并给出 attempted chain/missing providers（[model resolution](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/docs/reference/configuration.md#model-resolution)）。
- background task 支持全局、provider、model 三层并发限额；Team Mode 默认关闭（[background concurrency](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/docs/guide/orchestration.md#background-task-concurrency)、[Team Mode](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/docs/guide/orchestration.md#team-mode)）。
- `/start-work` 用 `.omo/boulder.json` 保存 active plan、session IDs、开始时间与 plan name，使新 session 可恢复（[session continuity](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/docs/guide/orchestration.md#start-work-behavior-and-session-continuity)）。
- ROADMAP 将代码分为 Core、MCP、Skills、Adapters、Platform、Web，目标依赖方向是 adapter 依赖纯 core/MCP/skills，且明确反对为快速变化的 harness API 预造“统一插件接口”（[layering](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/ROADMAP.md#current-priority-package-layering-refactor)、[multi-harness caution](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/ROADMAP.md#multi-harness-support-exploratory)）。
- package metadata 展示 monorepo core/adapters/workspaces、多个兼容 CLI bin、平台 optional dependencies 与发布脚本（[package.json lines 8–46](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/package.json#L8-L46)、[lines 109–142](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/package.json#L109-L142)、[lines 223–235](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/package.json#L223-L235)）。许可证是 SUL-1.0，限制商业与收费分发，**不能当作宽松开源代码直接搬运**（[LICENSE lines 18–29](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/LICENSE.md#L18-L29)）。

## 源码核验后的关键补充

### 配置并非一个平面 JSONC，而是有序求值管线

`omo-config-core` 先寻找 user/project config，逐层读取 JSONC、独立记录 parse/read/validation diagnostics，再按顺序 merge；最终 schema 校验失败时会回退到默认配置，而不是让半合法配置继续运行（[loader.ts lines 76–131](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-config-core/src/loader/loader.ts#L76-L131)、[lines 133–182](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-config-core/src/loader/loader.ts#L133-L182)）。有效视图的固定覆盖顺序是 `base → [harness] → profile → profile.[harness]`；不存在的 profile 产生 diagnostic 并使用 base（[resolution.ts lines 60–85](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-config-core/src/loader/resolution.ts#L60-L85)）。

merge 语义也值得注意：普通 object 递归 merge，scalar/array 默认整体替换，只有 `codegraph.excluded_roots` 做去重并集；同时过滤 `__proto__`、`constructor`、`prototype`，防止 prototype pollution（[merge.ts lines 1–49](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-config-core/src/loader/merge.ts#L1-L49)）。DSH 若实现 overlay，必须把每类字段的 merge 规则写进 schema，而不是依赖“直觉上的 deep merge”。

源码 schema 将 `agents`、`categories`、`models`、`task`、`teams`、`memory`、`telemetry` 与 harness-specific block 统一在 profile 中；Senpi/Codex block 是 strict typed schema，但 `[opencode]` 仍是任意 record，说明跨 harness 统一尚不完整（[config.ts lines 16–41](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-config-core/src/schema/config.ts#L16-L41)）。这进一步支持 DSH 使用 Cordis composition schema 作为边界，而不是复制开放式 adapter bag。

### 路由理念与实现之间存在张力

category 的产品接口是 semantic routing，但源码默认仍把大量具体 provider/model/variant 链硬编码在 release 中，例如 `quick`、`deep`、`visual-engineering`（[category-model-requirements.ts lines 3–93](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/model-core/src/category-model-requirements.ts#L3-L93)）；agent 也有各自硬编码 chain（[agent-model-requirements.ts lines 3–67](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/model-core/src/agent-model-requirements.ts#L3-L67)）。因此应迁移“semantic request + capability resolver”，而不是移植这些当期榜单。DSH 的 default policy 应来自可版本化、可替换的 HOST registry metadata，并允许部署方覆盖。

### Task runtime 已超出简单 background-agent queue

统一 task schema 不只包含 concurrency：还声明 `default_execution_mode`、`max_depth`、`residency_max_children`、`ttl_ms`、`state_dir`、reconcile/child resume、wait bounds，以及 team 的 member/parallel/wall-clock 上限（[task.ts lines 23–41](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-config-core/src/schema/task.ts#L23-L41)）。并发 key 的实际优先级是 model override → provider override → model string，队列为 FIFO，支持移除 queued task 并维持位置正确（[concurrency.ts lines 28–69](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/senpi-task/src/manager/concurrency.ts#L28-L69)、[lines 72–101](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/senpi-task/src/manager/concurrency.ts#L72-L101)）。DSH 应把 depth、residency、TTL、resume 和 wall-clock 与 token/cost budget 一并建模，而非只加一个并发数字。

### Telemetry 的实现比 README 口径更具体，也更应由部署统一治理

源码内置 PostHog endpoint/key，未设置 opt-out 时 client 可启用；它支持 `DO_NOT_TRACK`、全局及产品级 disable env（[env.ts lines 34–53](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/telemetry-core/src/env.ts#L34-L53)、[constants.ts](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/telemetry-core/src/constants.ts#L1-L5)）。事件层采用 event/property allowlist，拒绝 `*_text`、`*_path`、`*_prompt` 和 `$ip`，字符串截断到 64 字符，并关闭 exception autocapture、remote config 与 GeoIP（[events.ts lines 38–50](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/telemetry-core/src/events.ts#L38-L50)、[lines 102–138](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/telemetry-core/src/events.ts#L102-L138)、[lines 163–193](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/telemetry-core/src/events.ts#L163-L193)）。这些是良好的 data-minimization guardrails，但“默认可发送”不适合直接进入 DSH；应由 HOST 统一 opt-in、审计与 egress policy。

## 可迁移到 DSH 的产品能力（按优先级）

### P0：先做

1. **语义 category → model route**：让 preset/agent 只请求 `quick`、`deep`、`research`、`visual`、`review` 等能力，由 HOST model route 根据可用 provider、成本、reasoning/context/tool 能力解析；显式 model override 仍最高优先。
2. **可解释的 fallback chain**：一次解析生成不可变执行链，spawn 与 retry 共用；UI/诊断显示选择原因、缺失 provider、降级后的 reasoning/options，而不是静默切换。
3. **声明式 agent preset**：在 DSH preset composition 之上增加 schema 化的 agent profile：persona/prompt sections、tools、skills、permissions、category/model policy、并发预算。校验失败应明确报错；支持 user/project overlay，但必须保留最终 effective config 视图。
4. **长任务恢复与完成审计**：将现有 goal + todo + subagent 状态统一成可恢复的 objective ledger；恢复时显示已完成证据、待办和当前阻塞，而不是只注入“继续”。
5. **安装 doctor**：验证 preset 是否挂载、Service/Tool/Event 是否贡献、model route 是否可解析、approval/sandbox 是否一致、客户端 bundle 是否匹配；输出机器可读 JSON。

### P1：随后做

6. **Planning/Execution/Review 模式模板**：提供轻量预设，而非固定神话角色。复杂任务可选择“planner（只读/仅写计划）→ executor → independent reviewer”，普通任务不强制多 agent。
7. **分层并发预算与背压**：session/provider/model 三层限额，明确排队、取消、超时和费用预算；结合 DSH subagent registry，而非每个 preset 自建 scheduler。
8. **跨 session 学习包**：让 worker 返回结构化 `findings/decisions/verification/open risks`，由 orchestrator 选择性传给后续 worker，避免无限增长的共享 notepad。
9. **可移植能力包**：把 skills、prompt fragments、schemas 和纯逻辑发布成 host-neutral package；Cordis/DSH adapter 只做 registry wiring。版本、provenance、权限声明进入 manifest。

### P2：验证后再做

10. **Team UI**：基于 Web GUI 展示成员、任务、消息、预算和状态；不要引入 tmux 作为核心产品依赖。
11. **动态 context pruning、hash-anchored edit**：分别做受控实验与基准；DSH 已有 literal edit/read 工作流，需用真实失败率证明替换价值。
12. **edition packaging**：在稳定 manifest 后提供 core、web-enhanced、standalone 等 profile；先避免维护三套体验造成能力漂移。

## DSH 映射表

| OmO 概念 | DSH 现有原语 | 建议落点 | 优先级 |
|---|---|---|---|
| Agent + category routing | agent preset、model route、subagent | HOST model registry 增加 semantic capability policy；preset 只声明需求 | P0 |
| Model/fallback resolution | provider/model route | 单一 resolver 产出 chain、reason、capability normalization 与诊断 | P0 |
| Agent config overlays | `cordis.yml` preset composition | 用户自建 preset + schema/version；HOST 共享 Service，preset 贡献 persona/tools | P0 |
| Goal/boulder continuation | goal tools、todo、session | 持久 objective ledger + evidence audit + resume summary | P0 |
| Doctor | Inspect/self diagnostics、roster | CLI/Web 统一 health report，检查 mounted 与 contributed 的区别 | P0 |
| Planner/Atlas/worker | plan mode、主 agent、subagent | 可选 workflow profile；权限由现有 approval/sandbox 强制 | P1 |
| Background concurrency | subagent registry/jobs | HOST scheduler 做 session/provider/model quota 与 cancellation | P1 |
| Skill-embedded MCP | skill、Cordis Services/Tools | 技能 manifest 声明懒加载能力；Service 生命周期归 Fiber | P1 |
| Team Mode/tmux | subagent messaging、Web GUI | Client Slot 可视化，不复制 tmux 控制面 | P2 |
| Editions/installers | host composition、presets、npm/deployment | 签名 manifest + preset catalog +可逆安装/卸载 | P1/P2 |

## 配置模型建议

建议 DSH 不复制 OmO 的大一统 JSONC，而采用两层：

- **Host policy（管理员）**：providers、model capabilities、fallback、quota、sandbox/approval、共享 Services。
- **Preset profile（用户/项目）**：agent identity、prompt sections、skills/tools、semantic category、预算上限；不得放 provider credential 或绕过 host policy。

解析顺序建议：session 显式选择 → preset 显式 override → category policy → host fallback → host default。每一步保留 provenance；unsupported reasoning/temperature 不应无声丢弃，应在 effective config 与 doctor 中标注 normalization。project overlay 只允许收窄权限，权限放宽必须走现有 approval。

## 安装与开源分发建议

1. 发布 **schema-versioned preset/skill packages**，manifest 至少包含 DSH 兼容范围、Host/Client 入口、所需 Services/Events/Slots、权限、provenance、license、checksum。
2. 安装过程 preview diff、验证依赖、原子写入、失败回滚；卸载只删除 manifest 管理的文件。不要把“让 LLM 替用户安装”当作正确性的替代。
3. 共享逻辑与 adapter 分包，但只在已出现第二个真实 consumer 后抽象；这点与 OmO ROADMAP 的谨慎立场一致。
4. DSH 自有实现应选宽松许可证；只借鉴公开思想与接口形态，不复制 SUL-1.0 受限源码。第三方 skill/MCP 必须携带原始 license 和 notices。
5. telemetry 默认应明确告知并提供安装时 opt-in/opt-out；最好默认关闭或由部署方统一治理，而非各包独立上报。

## 明确不应照搬

- **角色神话与 11-agent 固定组织图**：增加学习成本并把 prompt 设计伪装成架构；DSH 应以 capability/profile 命名，角色只是可选 UX。
- **“永不停止”、Todo 强制唤醒、无上限审核循环**：可能烧 token、重复副作用或违背用户停止意图；必须有预算、round limit、取消、幂等与 blocker 语义。
- **OpenCode hook 注入堆叠**：OmO 自身 ROADMAP 已指出 prompt 异步接受、重复 idle/error 注入可能导致重复工作和状态损坏（[Why Not OpenCode-Native](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/ROADMAP.md#why-not-opencode-native)）。DSH 应走 HOST registry/Event 与 Fiber 生命周期。
- **tmux 作为团队控制面**：跨平台脆弱、和 Web GUI 重复；仅可作为可选 adapter。
- **硬编码当下模型排行榜和 provider chain**：快速过期且受营销/可用区影响；应由 capability metadata、部署策略和在线可用性驱动。
- **全量 Claude Code 兼容承诺**：兼容面会吞噬架构边界；只为经验证的高价值格式提供 importer。
- **默认匿名 telemetry**：即使日频与 hash ID，也应由 DSH 部署策略统一控制。
- **直接复用源码或 branding**：SUL-1.0 非 OSI 宽松许可，商业分发风险明确。

## 推荐实施顺序与验收

1. **P0-1 Resolver**：给定相同 registry/config 必须产出确定 chain；不可用模型、参数降级和 retry 均可解释、可测试。
2. **P0-2 Preset schema/effective view**：能展示每个字段来源；项目层不得扩大 host 权限。
3. **P0-3 Goal ledger**：跨 session 恢复不重复已提交副作用；complete 必须引用验证证据。
4. **P0-4 Doctor**：覆盖 composition mounted、service contribution、model resolution、client bundle 与权限冲突，并提供 JSON。
5. **P1 orchestration profile**：用真实任务 A/B 比较单 agent、planner/executor/reviewer 的成功率、token、时延；收益不显著则不默认启用。
6. **P1 package distribution**：安装/升级/回滚/卸载均可逆；license/provenance 检查进入发布门禁。

最终判断：**迁移“语义路由、状态机、诊断、分层和可逆分发”，不迁移“品牌角色、无限自治、hook 堆叠和固定模型榜单”。**
