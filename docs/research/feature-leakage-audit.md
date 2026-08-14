# dsh-legion vs oh-my-openagent：Feature Leakage 深度审计

> 比较基线：
>
> - `dsh-legion`：`1897d305b9e416fa704d6d464607ab38f14400e6`（`main`）
> - `oh-my-openagent`：`038ed0cbbefe2b40677b63867aeea0d16bc303e0`（`dev`）
> - `deepseek-harness`：`47f943859bef60e4160492346772ded9b24f765a`（`master`）
>
> 三个 commit 均与审计时 GitHub 远端分支一致。OmO 的 GitHub 引用固定到上述 commit；DSH 与 Legion 结论来自当前本地源码及其测试。

## 1. Executive verdict

**仍有明显 feature leakage。** 当前 `dsh-legion@0.1.0` 不是“oh-my-openagent for DSH”的功能对等实现，而是其中一个关键机制的可靠 MVP：

```text
semantic profile name
  -> fixed DSH subagent backend
  -> fixed/inherited child provider + model
  -> persona + tool filter + depth + background default
```

它已经完整满足最初的最小目标：SOTA 主线程可以把 heavy work 交给强模型，把 translation/explore/summary 交给轻模型，并由 DSH 承担并行、持久 child、follow-up、interrupt、Session 和权限生命周期。

但 OmO 的真正产品层还包括：

- automatic/intent-aware routing；
- live model resolution、fallback 和 capability normalization；
- specialized role contracts 与 skill assembly；
- bounded planning/execution/review protocols；
- provider/model concurrency、TTL、retry、budget 和 circuit breaker；
- effective config、doctor、route provenance；
- execution ledger、accumulated wisdom 和 independent completion audit。

Legion 目前没有这些 opinionated orchestration policies。更准确的定位是：

> **dsh-legion 现在是 DSH 上的 semantic delegation adapter，不是完整的 multi-agent operating system。**

这不是底层能力不足。DSH 已经比 OmO 的宿主层提供了更完整的 subagent/session/workflow/goal/preset/security/UI primitives。真正泄漏的是中间那层 **routing、policy、bounded orchestration、configuration diagnostics 与 provenance**。

## 2. 判定口径

本报告不把 OmO 每一项 feature 都当作 Legion 缺陷，而分为四类：

| 类别 | 含义 |
|---|---|
| **Legion 已实现** | `dsh-legion` 当前源码直接拥有的行为。 |
| **DSH 原生覆盖** | Legion 正确复用 DSH；重复实现反而是架构错误。 |
| **真实 feature leakage** | 为实现“OmO-like orchestration for DSH”仍必须补齐的产品/策略层。 |
| **不应照搬** | OmO 的 branding、host workaround、脆弱 hook 或不受限自治，不属于 Legion 正确方向。 |

## 3. 总体能力矩阵

| 能力 | OmO | DSH 原生 | dsh-legion 当前状态 | 判定 |
|---|---|---|---|---|
| Semantic category/profile names | 8 built-in categories + custom categories | 无 semantic router | 静态 profile map + enum tool | **已实现基础接口** |
| Automatic intent routing | IntentGate + orchestrator 按任务选 category/agent | 模型可自行调用工具，但无 classifier | coordinator 根据 prompt 显式选择 profile | **真实缺口** |
| Exact child provider/model | 支持 agent/category model config | 原生 `AgentOptions.provider/model` | 直接透传 | **已实现 / 复用 DSH** |
| Model availability preflight | live model/provider cache + dead-chain diagnostics | `ctx.llm` 有 catalog、`resolveModelInfo`、`resolveCallConfig` | 只检查 subagent backend；不检查 child LLM route/model | **P0 缺口** |
| Model fallback chain | user override + category default + user fallback + built-in chain + default | 只在 exact route 内 retry，不跨 route | 每 profile 只有一个 route | **P0 缺口** |
| Capability normalization | reasoning/temperature/top-p/max tokens/provider options normalization | 有 exact model metadata与 reasoning vocabulary；不自动降级 | 只支持 provider/model/maxTokens | **P0/P1 缺口** |
| Per-profile reasoning effort | 完整支持 | top-level session selection支持；`AgentOptions` 不含 effort | 不支持 | **需要 DSH seam** |
| Per-profile persona | 支持 | 原生 child persona | 支持 | **已实现** |
| Per-profile tool visibility | 支持 tools/permissions | 原生 tool filter + sandbox/approval | 支持 allow/deny tool filter | **已实现一半** |
| Per-profile skills | agent/category 可加载 skills | 原生 skill catalog/loader | preset 全局有 skill tool，但 profile 不能选 skills | **P1 缺口** |
| Per-child structured output | task/category 能形成结构化结果约束 | one-shot subagent/workflow 原生支持 schema | Legion 不传 `outputSchema` | **低成本高价值缺口** |
| Per-child different DSH preset | OmO agent 本身有独立 agent config | DSH child 固定继承 parent preset | 不支持，README 已声明 | **DSH upstream seam** |
| Spawn/fork/one-shot/continuable | 多 runtime 分散实现 | 原生完整实现 | 正确复用 | **不是缺口** |
| Follow-up/list/interrupt/report | Team/task tooling | DSH 原生完整实现 | 通过 preset 暴露 DSH controls | **不是缺口** |
| Parallel sibling calls | 支持 background agents | ToolRuntime/workflow 原生并行 | tool 标记 concurrency-safe | **不是缺口** |
| Workflow fan-out/pipeline | Atlas/Team/task workflows | 原生 worker-thread workflow | Legion preset 未提供 opinionated workflow | **substrate 已有，产品层缺口** |
| Planner → executor → reviewer | Prometheus/Atlas/Metis/Momus/Oracle | plan/goal/workflow/skills primitives | 只有 `deep/quick/review` profiles，无阶段协议 | **P1 缺口** |
| Synthesis/quorum/voting | Team/high-accuracy review | workflow 可脚本化，但无现成 policy | 无 | **P1 缺口** |
| Bounded retry/backoff | task/runtime fallback/circuit breaker | LLM exact-route retry；无 semantic retry | 无 | **P1 缺口** |
| Provider/model concurrency quota | global/provider/model FIFO limits | workflow per-run cap；无 provider/model pool | 无 | **P1 缺口** |
| Whole-execution limits | depth/TTL/residency/wall-clock/tool calls | depth、goal rounds、workflow total分别存在 | 只有 child maxDepth/maxTokens | **P1 缺口** |
| Cost/token/time budget | 部分 token/cost routing能力 | token usage可观测；goal只计 rounds | 无 aggregate budget | **P1 缺口** |
| Durable task/run ledger | Senpi task state/reconcile + boulder plan | durable child Session + goal + jobs | Legion 自身无 execution/run state | **策略 ledger 缺口；勿复制 Session** |
| Accumulated wisdom | Atlas notepad + task learnings | transcript/skills/goal存在，但不自动归纳传递 | 无 | **P1/P2 缺口** |
| Effective config layering | user/project/harness/profile layers | Cordis/profile/settings layers分散存在 | config 内联在一个 preset row | **P0 缺口** |
| Doctor / explain route | broad doctor + model diagnostics | Inspect、preset mount diagnostics、model directory存在 | 只有测试脚本，无用户 doctor/explain | **P0 缺口** |
| Route provenance | attempted chain、source、capability source，仍有穿透缺口 | exact request header、usage、events | 只返回 profile/runId/subagentId | **P0/P1 缺口** |
| Session persistence/fork/resume | 多 adapter runtime | DSH 原生完整 | 正确委托 | **不是缺口** |
| Goal/todo/plan | goal hooks/boulder/plan files | DSH 原生 durable goal/todo/plan | Legion preset 已暴露 goal/todo | **不是缺口** |
| Sandbox/approval | OpenCode permissions + hooks | DSH 原生 policy/enforcement/audit | 正确继承，不旁路 | **不是缺口** |
| Subagent UI/usage stats | Team monitor/tmux/TUI | DSH Web 原生 child tree/transcript/usage | 无 Legion-specific projection | **基础 UI 已有，decision UI 缺口** |
| LSP/AST/MCP/web/rules | OmO batteries included | DSH tools/skills/AGENTS/Cordis已覆盖 | preset复用 | **不是 Legion 缺口** |
| Telemetry/DAU | OmO默认 telemetry | DSH OTel/session telemetry | Legion无 telemetry | **正确的不实现** |

## 4. Legion 当前真正实现了什么

`dsh-legion` 的 public interface 很小：一个 agent-plane Cordis plugin、一个 model-facing tool。`src/index.ts:20-25` 的模型输入只有 `profile/description/prompt/run_in_background`；`src/config.ts:4-26` 的 profile 只有 backend、child route、persona、tool filter、depth 和 scheduling default。

调用路径是直接映射：

```text
args.profile ?? defaultProfile
  -> configured LegionProfile
  -> SubagentStartRequest
  -> ctx.subagents.start() or startContinuable()
```

源码没有：

- classifier；
- candidate scoring；
- model catalog lookup；
- fallback candidates；
- retry attempts；
- planner/scheduler；
- member collection；
- synthesis/evaluation；
- mission state；
- route ledger；
- settings/doctor/UI service。

Provider lifecycle filtering（`src/index.ts:211-250`）只回答“这个 **subagent backend** 是否注册”，不能回答：

- `agentOptions.provider` 是否存在；
- model id 是否可解析；
- model 是否支持所需 modality/reasoning/context；
- 凭据是否有效；
- provider 是否 rate-limited / quota-exhausted；
- 另一个 route 是否更便宜、更快或更可靠。

因此当前最大的命名风险是把 prompt-guided dispatch 叫成 automatic router。README 已写明“main DSH agent chooses a profile”，但项目后续文档和宣传应持续使用：

> semantic profile dispatch / semantic delegation

直到真正的 resolver 落地后，才使用 automatic/health-aware routing。

## 5. DSH 已经覆盖、Legion 不应重造的部分

### 5.1 Subagent lifecycle

DSH 已有 named provider registry、spawn/fork、one-shot、continuable、durable child Session、follow-up、cold resume、interrupt、direct/descendant listing、report 与 settled notice。Legion 只需生成请求和策略，不应创建第二套 child registry、queue、id、persistence 或 ACL。

### 5.2 Workflow engine

DSH workflow 已有 `agent()`、`parallel()`、`pipeline()`、phase/log、structured output、per-child provider/model、并发/总量 cap、cancellation 和 run event。Legion 若增加 declarative topology，应 **编译到 DSH workflow**，而不是再造 VM/DAG executor。

### 5.3 Goal / Todo / Plan

DSH 已有 revisioned durable goal、round budget、todo projection 和 logged plan mode。OmO 的“坚持做到完成”可以改造成 Legion policy/skill，使用 DSH goal 状态；不应复制 boulder 文件状态机或 idle prompt injection。

### 5.4 Model registry

DSH `ctx.llm` 已拥有 exact provider/model catalog、model metadata、reasoning efforts、context/output limits和 route validation。Legion 应在其上做 semantic policy，最终仍输出 exact DSH route；不应维护另一个 adapter registry。

### 5.5 Preset / skills / instructions / security

DSH 已有 preset roster/mount、filesystem skills、AGENTS/CLAUDE instruction loader、sandbox、approval 和 audit。Legion profile 应引用/编译这些原语，不应复制 scanner、permission grants 或 workspace instruction resolution。

### 5.6 Persistence、UI、telemetry、tool bus

DSH 已有 Session/persistence/projection、subagent conversation UI、usage/reasoning stats、OTel telemetry 和统一 `ctx.tools` pipeline。Legion 只需新增 route/execution decision events/projections，而不是第二个数据库、UI shell或 telemetry exporter。

## 6. 真正的 feature leakages（按优先级）

## P0 — 没有这些，就不能称为 OmO-like routing layer

### P0.1 Semantic model resolver + frozen fallback chain

当前 profile 是单 route：

```yaml
agentOptions:
  provider: deepseek-official
  model: deepseek-v4-pro
```

应扩展为部署方可配置的 ordered candidates，但不要复制 OmO 的硬编码排行榜：

```yaml
profiles:
  deep:
    description: Complex architecture and implementation.
    requires:
      tools: true
      contextTokens: 128000
      quality: high
    routes:
      - provider: primary-gateway
        model: sota-a
        reasoningEffort: high
      - provider: backup-gateway
        model: sota-b
        reasoningEffort: medium
```

Resolver 应输出 immutable decision：

```text
requested profile
+ candidate list
+ live model facts
+ deployment policy
-> selected exact route
+ rejected candidates/reasons
+ frozen retry chain
+ config/model metadata versions
```

Spawn 与 retry 必须使用同一 frozen chain，防止运行中 registry 变化导致不可复现。

### P0.2 LLM route/model preflight 与 capability-aware tuning

Legion 现在只 preflight `subagentProvider`，没有 inject/consult `ctx.llm`。这是最直接的 correctness leakage：`spawn` 可用不代表 child LLM route/model可用。

至少需要：

- exact provider route existence；
- model resolution；
- reasoning effort validation；
- modality/tool/context/output capability；
- maxTokens clamp/reject policy；
- missing credential / quota / rate-limit分类；
- unknown 与 unsupported 的区分。

DSH 已有多数 exact metadata；Legion 应消费而非复制。Per-child `reasoningEffort` 目前不在 DSH `AgentOptions`，需要上游扩展或受控 child request hook。

### P0.3 Effective config + doctor + explain

当前配置只存在于某个 preset row。用户无法回答：

- 这个 session 实际使用哪一代 preset/config？
- 为什么 `deep` profile 消失？
- 哪个 model route最终被选中？
- 哪个候选因 provider、model、reasoning、credential 或 quota 被拒？
- profile 的 tool/skill/preset authority 最终是什么？

需要一个 read-only effective view，至少输出：

```text
value / source file / layer / field path / normalized value / warning
```

Doctor 应消费同一个 compiled view，提供 human + JSON 输出，而不是重新实现一遍解析。

### P0.4 Profile capability contract

OmO category 不只是 model alias；agent/category 还能指定 prompt、skills、tools、permissions、structured task expectations。

Legion profile 当前只有 persona 与 toolFilter，至少缺：

- `skills`；
- child `outputSchema`；
- prompt fragment/file source与预算；
- required capabilities/modalities；
- explicit result/evidence contract；
- optional role type（research/execution/review）。

这是比完整 team runtime 更低成本、更直接的下一步。

## P1 — 让多个 profile 真正形成一个系统

### P1.1 Bounded planning/execution/review protocol

不要复制 Sisyphus/Prometheus/Atlas 名字；应提供可选协议模板：

```text
plan artifact
  -> execute against plan digest
  -> independent review against artifact/test evidence
  -> bounded repair rounds
  -> completed / partial / blocked
```

用 DSH plan/goal/workflow/subagent 实现，Legion 只拥有：

- stage contract；
- artifact handoff；
- role/profile selection；
- completion/evidence rule；
- retry/round/time/token/cost limit。

### P1.2 Provider/model admission、quota 与 execution budget

DSH 有 per-run workflow cap 与 token usage，但没有全局 provider/model pool。Legion 若要跨模型稳定运行，需要一个很薄的 Host policy module：

- default/provider/model concurrency；
- FIFO/fair admission；
- task deadline / TTL；
- max agents / attempts / tool calls；
- aggregate token/cost/time budget；
- rate-limit cooldown / circuit breaker；
- cancellation and release accounting。

实际 child 仍由 DSH `ctx.subagents` 运行；该 module 只拥有 admission/ledger，不拥有 child lifecycle。

### P1.3 Retry、fallback、partial success、quorum、synthesis

当前任一 foreground failure 直接失败，background failure只由 DSH notice到达。Multi-agent任务需要稳定结果模型：

- member success/failure/cancelled/skipped；
- retryable vs terminal；
- fallback index；
- best-effort/degraded；
- quorum reached/unreachable；
- synthesis/evaluator failure；
- provenance-preserving final result。

对于一两个 child，继续让 coordinator调用单一 `legion` tool；复杂 policy 应编译到 workflow，不要扩大普通调用 interface。

### P1.4 Execution provenance 与 accumulated wisdom

应记录最小 route/execution event：

```text
decisionId
parent session/task
requested profile/role
resolved backend/provider/model
candidate accept/reject reasons
config/model metadata versions
child/run id
attempt/latency/usage/stop reason
artifacts/evidence/open risks
```

“Accumulated wisdom”不要实现成无限增长的共享 Markdown。Worker 应返回结构化 `findings/decisions/verification/openRisks`，由 orchestrator选择性传递给后续 stage，并把来源保留到最终结果。

### P1.5 Per-child preset seam

当前 DSH child 继承 parent standing preset。若确实需要 research/review/implementation child 使用完全不同的 plugin composition，应先扩展 DSH：

- named preset 在 unpublished child setup 安全 mount；
- descriptor记录实际 preset；
- cold resume使用同一 generation/identity；
- authority与tool-history compatibility明确；
- product/out-of-process provider明确拒绝或声明能力。

在上游 seam 完成前，Legion 应继续声明不支持，而不是复制 in-process driver。

## P2 — 产品化增强，而非最小内核

- Team task graph、mailbox、shared task list；
- Web route/decision/team/provenance 面板；
- guided installer，根据已配置 provider生成建议 profile；
- multimodal profile 与 artifact routing；
- signed manifest、SBOM、release automation、migration/uninstall；
- benchmark/A-B harness，比较单 agent 与 multi-stage成功率、token、时延、成本。

## 7. 不应从 OmO 照搬

### 7.1 固定神话角色与 11-agent 组织图

角色职责值得借鉴，命名和固定组织图不应进入核心。Legion 应提供 role contract 与可替换 profile。

### 7.2 硬编码模型排行榜

OmO 的 category interface很好，但当前 fallback chain仍是 curated model leaderboard。Legion 应允许部署方配置候选，并基于 DSH live metadata解析，不把某一时点榜单作为代码常量。

### 7.3 无上限自治和审核循环

OmO high-accuracy review 明确没有最大重试。Legion 必须有 rounds、deadline、token/cost、cancel与blocked语义。

### 7.4 OpenCode prompt-hook 堆叠

OmO ROADMAP 自己承认 prompt异步接受可能导致 duplicate work、infinite loops和state corruption。Legion 应使用 DSH Event、Inbox、Goal、Session与Fiber生命周期。

### 7.5 tmux 作为核心控制面

DSH 已有 Web subagent conversation tree。tmux/worktree可作为 optional adapter，不应成为核心依赖。

### 7.6 默认 telemetry、全量兼容层和外围工具复制

Legion 不需要自己的 DAU telemetry、LSP/AST/MCP实现、Claude兼容层或第二套 AGENTS loader。DSH 已有对应 seams；analytics应由部署统一治理。

## 8. 推荐路线图

### v0.2 — Make routing real

1. Profile `routes[]` + required capability schema；
2. `ctx.llm` exact route/model preflight；
3. deterministic resolver + frozen fallback chain；
4. decision provenance + `explain`/doctor JSON；
5. child output schema + per-profile skills；
6. 保持当前单 tool interface。

### v0.3 — Bounded orchestration profiles

1. planner/executor/reviewer workflow templates；
2. artifact/evidence contracts；
3. bounded retry、partial success、quorum和synthesis；
4. 使用 DSH goal/workflow/subagent，不新增平行 runtime。

### v0.4 — Shared admission policy

1. Host-plane provider/model concurrency与cooldown；
2. deadline/TTL/attempt/token/cost budgets；
3. execution ledger/projection；
4. Web decision/usage panel。

### Upstream DSH proposals

1. `AgentOptions`/child route支持reasoning effort；
2. per-child named preset composition；
3. 可选的 profile-scoped skills/output contract setup；
4. model availability/credential health的安全只读视图。

## 9. Success criteria

Legion 可以合理称为“OmO-like orchestration for DSH”之前，至少应满足：

- 同一 semantic profile 有两个以上可解析候选 route；
- primary route不可用时，按冻结且可解释的 chain fallback；
- 每个候选的接受/拒绝原因可由 doctor/explain读取；
- child profile可声明skills、output/evidence contract与capability要求；
- planner/executor/reviewer是有上限、可取消、可恢复的可选协议；
- provider/model并发和whole-execution预算可强制执行；
- final result保留route、attempt、child、artifact和verification provenance；
- DSH原生 lifecycle、Session、goal、workflow、security和UI保持单一事实源。

## 10. Final answer

**是的，仍有 substantial feature leakages。**

但缺失的不是“再多几个 agent 名字”或“再造一个 Team runtime”。真正缺失的是：

1. semantic intent 到 live model route 的可解释解析；
2. fallback、capability、reasoning与成本/健康策略；
3. effective config和doctor；
4. profile-level skills/output/evidence contract；
5. bounded planning/execution/review；
6. provider/model admission和whole-execution budget；
7. route/task/artifact provenance；
8. per-child preset这个必要的DSH上游 seam。

当前 v0.1 是一个质量不错、边界清晰的 foundation，但它只完成了 **semantic dispatch**。OmO-like orchestration 的主要策略层仍待实现。

## Supporting audits

- [`comparison-omo-capabilities.md`](comparison-omo-capabilities.md)
- [`comparison-legion-capabilities.md`](comparison-legion-capabilities.md)
- [`comparison-dsh-native.md`](comparison-dsh-native.md)
- [`oh-my-openagent.md`](oh-my-openagent.md)
