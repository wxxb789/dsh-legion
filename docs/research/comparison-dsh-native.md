# DSH 原生能力与 Legion 非重复边界审计

> 审计对象：`Q:\repos\deepseek-harness`，HEAD `47f943859bef60e4160492346772ded9b24f765a`。
> 方法：只读审计当前 HEAD 的一手源码与仓库文档；本文只讨论 DSH 已有能力和仍可由 Legion 占据的 seam，不评价 oh-my-openagent 的具体实现质量。

## 结论摘要

Legion **不应再造一个平行的 agent runtime / scheduler / permission layer / model catalog / session store / GUI**。DSH 当前已经原生覆盖：

- session-backed subagent 的 spawn、fork、one-shot、continuable、follow-up、direct/descendant listing、interrupt、child-to-parent report；
- JavaScript worker-thread workflow，带 `agent()`、`pipeline()`、`parallel()`、phase/log、structured output、并发与总量上限；
- durable goal、whole-list todo、logged plan mode；
- provider/model 精确路由、adapter catalog、reasoning effort、provider-owned retry；
- per-session preset、filesystem skills、AGENTS/CLAUDE-compatible workspace instructions；
- per-session sandbox policy、approval policy、审计事件与 fail-closed 交互；
- owner-scoped background jobs、读/列/杀/等待、并发限制与完成通知；
- JSONL/SQLite session persistence、fork/resume、Web conversation UI、reasoning/usage/stats、OTel telemetry；
- 统一 tool registry/policy pipeline 及 fs/shell/web/LSP/MCP/Cordis 等工具面。

Legion 值得保留的是 DSH **没有提供的编排策略层**，尤其：

1. **不能在每次 child 调用时选任意另一个 preset**（原生 in-process child 继承 parent 当前 preset；可逐 child 改的是 provider/model、persona、toolFilter，不是 preset）。
2. **没有 semantic model fallback/router**（按任务语义、能力、成本或失败类别自动切换 provider/model）；DSH 的 route 是精确 provider/model，retry 仍在同一 provider route。
3. **没有 provider/model quota ledger、预算、配额感知调度或跨 provider 限流器**；只有 QUOTA 错误归一化、token usage、单 provider retry 和局部并发 cap。
4. **没有跨 session/跨 workflow 的全局 fair scheduler、priority queue、provider occupancy 或 cost optimizer**。
5. **workflow phase 的 provider/model 字段只是展示信息**；真正逐 child 覆盖来自 `agent(..., { provider, model })`，并没有 phase 级执行策略。

因此 Legion 应定位为：**建立在 DSH 原生 seams 之上的高阶 planning/routing policy 与 declarative orchestration**，而不是复制底层生命周期、持久化、权限、任务、UI 或工具实现。

---

## 1. Subagent：DSH 已完整提供，Legion 不应重造

### 原生能力

DSH 把 subagent 做成多 provider registry；原生 provider 包括 in-process spawn、in-process fork、ACP、Codex、Claude Code、DSH SDK，工具层另有 follow-up/list/interrupt 与 child report。见 `docs/subsystems/subagent.md:5-9`、`docs/capability-seams.md:458-459`。

- **spawn / fork**：continuable 初次创建时 provider 只提供 detached create spec；spawn 与 fork 的差异是是否给 child seed parent history。后续 cold resume 不再经 provider，而由 continuation manager 直接 `ctx.agents.resume()`。见 `docs/subsystems/subagent.md:243-280`。
- **one-shot**：有 `SubagentRun.result`、终止原因、structured output；明确没有 steer/resume。见 `docs/subsystems/subagent.md:308-363`。
- **continuable**：一个 durable child Session 对应最多一个 process-local Activation；manager 负责 admission、direct-parent authorization、cold resume、所有权树和 child-first disposal，Agent inbox 是唯一 FIFO。见 `docs/subsystems/subagent.md:114-138`。
- **follow-up**：running 时入同一 Activation，waiting 时唤醒，resident 不存在时 cold-resume；follow-up 只能发给 durable direct child，且不能改写已在执行的 turn。见 `docs/subsystems/subagent.md:128-142`。
- **interrupt**：异步请求取消当前 turn，保留 inbox、Activation 与 descendants；未知/one-shot/settled target 是幂等 no-op；授权不符报 `UNAUTHORIZED`。见 `docs/subsystems/subagent.md:144-157`。
- **list direct/descendants**：从 live sessions 与 persistence 合并读取，不会为 listing 加载或恢复 Agent；支持 direct children 与完整 descendant tree、稳定顺序、corrupt diagnostics。见 `docs/subsystems/subagent.md:287-304`。
- **report**：child 用自身 live Agent 授权，recipient 自动限定为 durable direct parent；支持 quiet inject 或 wakeup follow-up，且 runtime 还会在 Activation settle 时无条件投递一条独立 settled notice。见 `docs/subsystems/subagent.md:192-212`。
- **per-child controls**：one-shot request 原生支持 `agentOptions`、object-rooted output schema、depth cap、tool filter、persona；provider 不支持时 fail loud，不静默降级。见 `docs/subsystems/subagent.md:11-37`、`docs/subsystems/subagent.md:66-96`。
- **逐 child model route**：continuable descriptor 会固化 resolved provider/model 供 cold resume；不会固化整个 merge-extensible AgentOptions。见 `docs/subsystems/subagent.md:283-285`。

### Legion 不应重复

不要再实现：child registry、child id、continuation queue、resume、direct-parent ACL、descendant graph、interrupt、report channel、result capture、background subagent job wrapper，或另建一套 child persistence。这些都已经是 DSH 的权威生命周期。

### 仍然存在的 seam：per-child different preset

DSH **没有模型侧的 `preset` child option**。`SubagentStartRequest` 暴露的是 `agentOptions`、schema、depth、toolFilter、persona，而非 preset（`docs/subsystems/subagent.md:47-96`）。in-process child 的真实行为是继承 parent 当前 composition：测试明确断言 child 获得 parent preset tools、prompt sections 和 header `agentPreset`，parent 在空闲时切换 preset 后，新 child 跟随新 preset。见 `packages/subagent/subagent-in-process-driver/tests/preset-inheritance.spec.ts:69-104`、`:121-133`。

这意味着：

- DSH 有 **per-child persona/tool filtering/model route**；
- DSH 没有 **per-child arbitrary preset selection**；
- Legion 若需要“研究 child 用 research preset、审查 child 用 review preset”，应作为新增 seam/策略提案接入 `AgentPresets` + subagent create setup，而不是伪装成已有能力。

---

## 2. Workflow：DSH 已有通用 fan-out engine

DSH 原生 `ctx.workflowEngine` 是单实现 seam，`tool-workflow` 执行 JavaScript 编排脚本并通过 `ctx.subagents` fan-out。见 `docs/capability-seams.md:465-466`、`packages/workflow/tool-workflow/src/index.ts:1-10`。

原生脚本能力包括：

- `agent(prompt, opts)`，可选 structured JSON schema、label、phase、**逐调用 provider/model override**；
- `pipeline(items, ...stages)`，按 item 流水执行、阶段间无全局 barrier；
- `parallel(thunks)`，显式 barrier；
- `phase()`、`log()`、JSON `args`；
- fresh worker thread、无 fs/network/timer/Node globals；
- foreground run、JSON-serializable return；
- misuse/cap violation 为 fatal script error，普通 child/stage 失败降为 `null`。

精确定义见 `packages/workflow/tool-workflow/src/index.ts:133-150`。

资源控制也已存在：并发默认自动取 `min(16, max(1, cores - 2))`，每 run 总 child 默认 1000，单次 `parallel/pipeline` items 默认 4096，并有 sync timeout 与 cancellation grace。见 `packages/workflow/workflow-worker-thread/src/index.ts:31-48`、`:115-157`。

Workflow lifecycle 原生记录 run id、meta、phase、child session id、agent outcome、agentsStarted，并将事件映射回 parent Session。见 `packages/workflow/workflow/src/types.ts:24-36`、`:57-130`，以及 `packages/workflow/tool-workflow/src/index.ts:69-130`。

### Legion 不应重复

不要另建 JavaScript workflow VM、fan-out primitives、structured child result、并发 semaphore、total-agent cap、run cancellation 或 workflow event recording。

### seam 与限制

- `WorkflowPhase.provider/model` 明确是 **informational**，phase 本身“不施加执行结构”。见 `packages/workflow/workflow/src/types.ts:24-36`。真正路由必须在每个 `agent()` opts 中指定。
- 没有 DAG 持久化/resume、跨 workflow scheduling、priority/cost/quota-aware admission。
- 没有 preset override；workflow 的 child options 仅公开 provider/model 等，见 `packages/workflow/tool-workflow/src/index.ts:138-150`。

Legion 可在 workflow 之上提供 declarative graph、role-to-model/preset policy、预算和回退，而不是重写 engine。

---

## 3. Goal / Todo / Plan：原生状态域，不应另建

### Goal

DSH goal 是同 session 的 durable、revisioned CAS 状态：稳定 GoalId、正整数 revision、objective、phase（active/paused/blocked/complete）、max rounds；activation 是 process-local 且不持久化。见 `packages/goal/goal/src/types.ts:15-83`。

模型工具已有 `get_goal`、`create_goal`、`update_goal`，create 只接受 direct human 权限，edit/pause/resume 也需 direct top-level human；blocked 默认至少连续 3 rounds。见 `packages/goal/tool-goal/src/index.ts:22-49`、`:112-131`、`:186-239`。

### Todo

`todo_write` 是 per-agent-session 的 **whole-list replace**；状态为 pending/in_progress/completed，部署可选择是否允许多个 in-progress；快照写入 `todo/write`，projection 供 UI 使用。见 `packages/todo/tool-todo/src/index.ts:1-5`、`:28-43`、`:45-110`、`:122-148`、`:149-223`。

### Plan

Plan mode 是 session log 中 last-wins 的 collaboration state，resume/fork 可恢复；`exit_plan_mode` 把完整 Markdown plan 交给用户 review，approval 后退出。Plan mode 与 sandbox/approval **相互独立**。见 `packages/plan/plan-mode/src/index.ts:1-18`、`:63-88`、`:121-137`、`:179-183`。

### Legion 不应重复

不要再建 goal state、round counter、todo persistence、plan approval flow、对应 GUI projection。Legion 可以消费这些原生状态，把它们作为高阶编排的进度与人机 checkpoint。

---

## 4. Model selection / adapter catalog / reasoning：原生精确路由；语义路由仍缺

### 原生能力

- `ctx.llm` 是 provider-neutral seam，多 adapter 按 provider route 注册；loop/compaction 消费同一服务。见 `docs/capability-seams.md:414-416`。
- Web 的 model directory 返回 current selection、routability、provider-grouped catalog 与 failures；selection 调用 `resolveCallConfig` 校验 provider/model/reasoning，并保存 session current/default。见 `packages/host/apiproxy/src/api-proxy.ts:2272-2330`。
- Adapter catalog 是 advisory metadata，不控制 route；`resolveModelInfo` 要求 exact provider/model identity，并提供 modality、context、default max tokens、reasoning efforts。见 `packages/llm/llm/src/index.ts:610-675`。
- reasoning effort 是 adapter-owned vocabulary；不支持的 explicit effort 在 provider I/O 前报错，不 clamp、不 alias。见 `packages/llm/llm/src/index.ts:720-768`。
- pi-ai 配置支持 installed catalog、route replacement、per-model overrides、reasoning efforts/default、token budgets、transport/timeouts、provider retry policy。见 `docs/config-catalog.md:900-988`、`:990-1027`。
- Web UI 有 provider-grouped model selector 和独立 effort selector，metadata 全来自 Host 而非 client hardcode。见 `packages/client/ui-model-selection/src/client/ModelSelect.tsx:1-12`、`:67-102`。
- reasoning stream 原生显示为可展开 Think row。见 `packages/client/ui-conversation/src/client/chat/ReasoningRow.tsx:20-64`。

### 明确没有：semantic model fallback

核心 route 是 exact `provider + model`；catalog membership 只是 advisory（`packages/llm/llm/src/index.ts:610-624`），`prepareCall` 绑定当前 adapter registration 并只 dispatch 一次（`:771-813`）。原生 retry 按 **同一 provider** 的 policy 处理 request error；事件中记录 provider，恢复动作只是 `{kind:'retry'}`，不会换 route。见 `packages/llm/llm-retry/src/index.ts:93-153`、`:156-207`。

因此当前 HEAD 没有：

- 按 task semantic/role 自动挑模型；
- 失败后 provider A → provider B 或 model X → model Y；
- capability/cost/latency 综合 router；
- fallback chain 或 policy DSL。

Legion 的 model router/fallback 是合理差异化 seam，但必须最终产出 DSH 的 exact `ModelSelection`，并让 DSH adapter/selection 继续做校验和 dispatch。

### 明确没有：provider/model quota 管理

DSH 只把终端余额/额度耗尽归一为 provider-neutral `QUOTA`，并区分 transient rate limit。见 `packages/llm/llm/src/error.ts:24-29`、`:88-100`。这不是 quota manager。

当前 HEAD 未发现 provider/model 维度的：

- quota/budget 配置与剩余额度 ledger；
- RPM/TPM token bucket；
- provider occupancy/admission；
- cost accounting 与预算阻断；
- quota-aware route selection。

已有 token accounting 是可观测性：UI 汇总 durable token usage、cache hit、context occupancy 和速度，见 `packages/client/ui-conversation/src/client/chat/StatsLine.tsx:34-76`、`:104-152`、`:163-180`；不能等同 quota control。

---

## 5. Preset / Skills / AGENTS：DSH 已原生提供

### Preset

一个 session 在创建时挂一个 preset `cordis.yml`；同 preset 使用 standing mount，共享 plugin instances，但插件内部按 session keyed。preset 决定 tools、prompt sections、projection units；受信任与用户 root 均可发现。见 `packages/preset/agent-presets/src/index.ts:1-21`、`:75-105`。

默认 preset 可由 settings 热更新，仅影响下一次创建；运行中 session 留在既有 composition。见 `packages/preset/agent-presets/src/index.ts:184-193`。挂载只能在 agent factory setup 内安全完成，坏 preset 会让创建整体 rollback。见 `packages/preset/agent-presets/src/index.ts:262-279`。

### Skills

`ctx.skills` 合并 provider catalogs，`tool-skill` 只把 summary catalog 放入 prompt，调用时再加载完整 body。见 `docs/capability-seams.md:441-442`。filesystem provider 原生扫描 project/custom/user roots、解析 YAML frontmatter、支持 watcher 与 project cwd-sensitive discovery。见 `packages/skill/skill-filesystem/src/index.ts:1-8`、`:36-73`、`:129-143`、`:176-221`。

### AGENTS / CLAUDE-compatible instructions

`agent-instructions` 在首请求前把 baseline instructions 放进 durable context；read/write/edit 触碰 nested/changed/removed instruction files 后同步到 inbox，并经可选 `ctx.fs` 读取。见 `packages/context/agent-instructions/src/index.ts:1-8`、`:70-78`、`:105-183`。

instruction candidate 是配置化的，不把 AGENTS.md priority 硬编码死；测试覆盖 `CLAUDE.local.md`, `AGENTS.md`, `CLAUDE.md` 顺序。见 `packages/context/agent-instructions/tests/agent-instructions.spec.ts:524-570`。

### Legion 不应重复

不要另做 preset roster/mount、skill scanner/catalog/load、AGENTS ancestor discovery、live instruction refresh。Legion 的角色配置应编译/映射到这些 DSH 原语。

---

## 6. Sandbox / Approval：原生 policy + enforcement + audit

Sandbox policy 的单一 owner 管 deployment default、per-session mode 与 workspace root；fs、one-shot shell、terminal enforcing backends读取同一 policy。三种 mode 是 `read-only | workspace-write | danger-full-access`，默认 fail-safe read-only。见 `packages/sandbox/sandbox-policy/src/index.ts:1-16`、`:60-75`、`:91-110`。

每次 capability call 按优先级解析：approved explicit override > session last `sandbox/mode` > deployment default；session cwd 是 workspace boundary。见 `packages/sandbox/sandbox-policy/src/index.ts:126-150`。

Approval seam 原生提供：

- scoped `approval/request` waterfall；
- 无 answerer 时 fail closed；
- per-session `ask | never` policy；
- `approval/asked` 与 `approval/decided` durable audit；
- cancellation；
- policy runtime context；
- grant 只针对 requested action。

见 `packages/interaction/user-approval/src/index.ts:1-4`、`:22-31`、`:34-71`、`:81-102`、`:136-173`、`:176-215`。

### Legion 不应重复

不要创建旁路 permission system、自己缓存 grants、绕过 DSH sandbox 或另记审批审计。Legion 的高阶 action 必须落到 DSH tool calls，让原生 policy 决定是否执行/询问/拒绝。

---

## 7. Jobs / concurrency：原生 registry 与局部并发控制

`ctx.jobs` 是 owner-session fenced 的 background registry；producer 注册、controller 读取；first settlement wins；start 会拒绝没有 attached controller 的 owner；API 有 list/get/read/kill/wait、completion/change listeners。见 `packages/jobs/jobs/src/index.ts:1-6`、`:35-61`、`:73-143`、`:145-176`。

模型侧已有 `job_output`、`job_list`、`job_kill`；完成通知可以 wakeup 或 quiet，且有 per-owner consecutive wake budget，避免自激循环。见 `packages/jobs/tool-jobs/src/index.ts:1-7`、`:24-53`、`:205-229`。

Workflow 自身已有 FIFO concurrency semaphore 与 per-run limits；配置见 `packages/workflow/workflow-worker-thread/src/index.ts:31-48`、`:150-157`。

### 明确没有的 scheduler seam

Jobs 是 process-local registry，workflow cap 是 per-run。当前 HEAD 没有跨所有 jobs/subagents/workflows 的：

- global priority/fair queue；
- provider/model concurrency pool；
- tenant quota；
- admission by cost/latency/token budget；
- durable distributed scheduler。

Legion 可以提供这一层，但应把实际运行注册为 DSH jobs/subagents/workflows，复用原生 owner ACL、cancel、notification 与 UI。

---

## 8. Session persistence / UI / telemetry：已有完整产品面

### Persistence 与 fork/resume

核心 `ctx.sessions` 持有 append-only events；`ctx.sessionPersistence` 有 JSONL 与 SQLite 后端。见 `docs/capability-seams.md:418-423`。Projection 与 projection cache 支持 per-session watermark、cold-read cache + persistence tail replay。见 `docs/capability-seams.md:439-440`。

Web fork 会选择 completed-turn boundary、保留 trailing out-of-band events、继承 cwd/parent/seed/preset，并创建新 Agent；fork child 继承 source composition，因为 seed 中已有旧 tool history。见 `packages/host/apiproxy/src/api-proxy.ts:2363-2421`、`:2422-2458`。

### UI

仓库已有 conversation shell、queue、approval panel、permission selector、todo panel、goal bar、plan control、job list、model selector、reasoning disclosure、stats、attachments、feedback 等 client packages。能力聚合可从 `docs/capability-seams.md:418-469` 看出 Host seams，具体 model/reasoning/stats UI 见前述 `ModelSelect.tsx`、`ReasoningRow.tsx`、`StatsLine.tsx` 引用。

### Telemetry

`sessionTelemetry` 捕获 session ledger events 和 ops records，并提供 `session-telemetry/record` waterfall 做部署侧 redaction；canonical session log 不被改写，listener failure 对该记录 fail closed。见 `packages/session/session-telemetry/src/index.ts:1-12`、`:22-44`、`:57-87`。

backend contract 要求 non-blocking enqueue、可选 flush、shutdown drain；sharing policy 明确为 full/feedback-only/disabled。见 `packages/session/session-telemetry/src/index.ts:89-130`、`:133-175`。OTel 是已有实现，见 `docs/capability-seams.md:425-426`。

### Legion 不应重复

不要另建 session DB、transcript schema、fork lineage、conversation UI、usage dashboard、telemetry export pipeline。若 Legion 需要自己的决策记录，应作为新的 SessionEvent/projection/telemetry policy contribution，而不是第二份事实源。

---

## 9. Tooling：原生 registry/policy pipeline 足够宽

`ctx.tools` 已统一负责 capability registration、Code Mode transport，并经过 pre-policy、monotonic guards、around dispatch、post-policy 和 final-result observation。见 `docs/capability-seams.md:433-435`。

已有 seams/tools 包括 fs、shell/PowerShell、terminal、web search/fetch、LSP、MCP、session query、skills、subagents、jobs、workflow、goal/todo/plan、Cordis dynamic plugins、ask-user 等；总表见 `docs/capability-seams.md:430-469`。

### Legion 不应重复

不要实现一个绕开 `ctx.tools` 的 tool bus 或平行 schema/execution/audit system。Legion 可提供新的 policy plugin、meta-tool 或 declarative compiler，但最终动作应注册/调用 DSH tools，继承统一权限、session、presentation、spill 和 telemetry。

---

## 10. Legion 推荐边界

### 应直接复用 DSH

| 需求 | DSH 原生入口 |
|---|---|
| child 创建/续聊/中断/列举/report | `ctx.subagents` + model tools |
| 大规模 fan-out | `ctx.workflowEngine` / `workflow` |
| 长任务状态 | goal + todo + plan |
| 模型与 effort 选择 | `ctx.llm`, model catalog, `ModelSelection` |
| session 角色配置 | agent preset |
| 可复用操作手册 | skills |
| workspace 规则 | agent-instructions |
| 权限与隔离 | sandboxPolicy + approval |
| background lifecycle | jobs |
| durable history与 GUI | sessions/persistence/projections/Web UI |
| telemetry | sessionTelemetry/OTel |
| 工具执行 | `ctx.tools` |

### Legion 可以拥有

1. **Role/intent classifier**：把任务语义映射为已有 workflow/subagent/tool 调用。
2. **Semantic routing & fallback**：维护显式策略，输出 exact provider/model；失败时按受控规则改 route，而非修改 adapter。
3. **Quota/cost/concurrency policy**：provider/model 级预算、限流、占用和优先级；实际执行仍走 DSH。
4. **Declarative orchestration compiler**：把 role graph/DAG 编译为 DSH workflow JavaScript。
5. **Per-child preset seam（若确有需求）**：作为 DSH upstream extension 设计，处理安全 mount、descriptor persistence、cold resume 与 inherited tool history；在该 seam 落地前，不要声称原生支持。
6. **Cross-run durable policy state**：若需要，建立独立、最小的 policy domain，并通过 SessionEvent/projection 或 storage domain 接入，而不是复制 Session。

## 最终判断

oh-my-openagent 中凡是属于 **agent execution substrate** 的能力，DSH 基本已原生提供，Legion 重复实现只会制造双重事实源和不一致生命周期。Legion 的合理定位应缩到 DSH 明确未提供的 **semantic planning/routing、quota-aware scheduling、declarative role graph，以及可能的 per-child different preset**。其中后三项必须清楚区分：

- DSH 已支持 per-child **provider/model/persona/tool filter**；
- DSH 不支持 per-child **arbitrary preset**；
- DSH 能识别 QUOTA 与统计 tokens，但没有 **quota manager**；
- DSH 有 provider retry，但没有 **semantic/cross-provider fallback**。
