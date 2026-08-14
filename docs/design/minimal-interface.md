# DSH/Cordis Legion: Minimal Interface Design

> **Status: superseded exploration.** The shipped v0.1 design is the single agent-plane semantic-profile tool recorded in [ADR 0001](../adr/0001-semantic-profile-router.md). The Host runtime and `ctx.legion.run()` below are retained as historical alternatives, not current recommendations or acceptance criteria.

## 1. 目标与设计结论

Legion 是一个可开源的 orchestration **module**：由一个 SOTA 主 agent 把一个目标分派给多个不同 model、role 与 preset 的 worker，并将结果收敛为一个可消费的结论。

公开面只保留 **2 个 entry points**：

1. Cordis plugin：`@dsh-legion/core`，在运行时提供 `ctx.legion`。
2. 可选 model-facing tool adapter：`@dsh-legion/tool`，只注册一个 `legion` tool。

核心 **Interface** 只有一个方法：`run(request)`。配置、计划生成、provider/preset 解析、并发调度、重试、预算、证据归并、冲突处理与 telemetry 全部藏在 **Implementation** 中。这是一条刻意选择的 **seam**：调用者描述“想完成什么”和“允许使用哪支 legion”，而不是手工驱动 spawn/list/wait/merge 状态机。

这样得到高 **depth**：调用者学习一次调用即可获得完整多 agent orchestration；高 **leverage**：相同策略复用于 tool、CLI、tests 与未来 UI；高 **locality**：路由、失败恢复和汇总规则集中在一个 module 内，而不会散落到每个主 agent prompt。

> 非目标：替代 DSH 的 `subagents` registry、agent preset registry、model route、session persistence、sandbox 或 approval stack。Legion 位于这些正式 extension seam 之上，不复制它们。

## 2. 正式扩展模式的只读核对

对 `Q:\repos\deepseek-harness` 的只读检查显示：

- Host composition 持有跨 session 的 `subagents` registry 及 provider；agent preset 只贡献 model-facing delegation tools。
- `@deepseek-ai/dsh-tool-subagent` 是单 provider 的薄 tool **adapter**；其配置支持 `provider`、`toolName`、`agentOptions`、`persona`、`toolFilter` 与 `maxDepth`。
- In-process `spawn`/`fork` provider 支持 `outputSchema`、`depthLimit`、`toolFilter`、`persona`；Codex 与 Claude Code 是 host-plane、one-shot、provider-managed recursion 的 out-of-process provider，且不支持上述 start-time capabilities。
- `ctx.agentPresets.mount()` 在 agent 创建窗口挂载 preset；`composeFrom()` 让 child 加入与 parent 完全相同的 standing composition。现有 `tool-subagent` 因而能继承 parent preset，但不能在一次调用中任意指定另一个 preset。
- Cordis provider registration 由 effect disposer 管理；重复 provider name、缺失 capability、缺失 provider、不可用 continuations 都是 fail-loud 错误。

因此 Legion 应采用正式 Cordis plugin row，消费 host-plane registries；若要实现“每个 worker 不同 preset”，需要一个很窄的 DSH compatibility **adapter**，在 child creation setup 中调用 `ctx.agentPresets.mount(childCtx, preset)`。不应把 registry 或 product provider 搬进 Legion。

## 3. 外部 Interface

### 3.1 配置类型

以下是唯一稳定配置。它描述策略，不暴露 scheduler、prompt compiler 或 provider lifecycle。

```ts
export interface LegionConfig {
  profiles: Record<string, WorkerProfile>
  policies?: Record<string, Policy>
  defaults?: {
    policy?: string
    timeoutMs?: number
    maxParallel?: number
  }
}

export interface WorkerProfile {
  provider: string
  model?: string
  preset?: string
  role: string
  persona?: string
  tools?: {
    allow?: string[]
    deny?: string[]
  }
  maxTokens?: number
  weight?: number
}

export interface Policy {
  members: string[]
  synthesis?: string
  quorum?: number
  failure?: "fail-fast" | "best-effort"
  retries?: number
  maxParallel?: number
}
```

约束属于 **Interface** 的一部分：

- `profiles` key 与 `policies` key 在本配置中唯一。
- `members` 和 `synthesis` 引用 profile key；未知引用在 plugin activation 时失败，而不是首次调用时失败。
- `provider` 是 DSH `ctx.subagents` 中的注册名；provider 可暂时晚于 Legion 激活，但 `run()` 开始前必须存在。
- `preset` 省略时使用父 agent 当前 composition；显式值必须是 mountable preset。Legion 不复制 preset 文件，也不绕过 mount validation。
- `persona` 与 `tools` 仅在对应 provider capability 存在时直接传递；对不支持的 remote provider，compatibility adapter 必须拒绝，不能静默忽略。
- `maxParallel >= 1`，`quorum >= 1` 且不大于可参与 member 数；所有数值必须是 safe integer。
- secrets、credentials、sandbox 权限与 product CLI environment 不进入此 Interface，由 host deployment 管理。

### 3.2 运行类型

```ts
export interface LegionRequest {
  objective: string
  policy?: string
  context?: Record<string, JsonValue>
  output?: {
    schema?: JsonObjectSchema
  }
  signal?: AbortSignal
}

export interface LegionResult {
  status: "completed" | "partial"
  answer: ContentBlock[]
  members: Array<{
    profile: string
    runId?: string
    status: "completed" | "failed" | "cancelled" | "skipped"
    output?: ContentBlock[]
    error?: LegionErrorView
  }>
  usage?: {
    inputTokens?: number
    outputTokens?: number
  }
}

export interface Legion {
  run(request: LegionRequest): Promise<LegionResult>
}
```

只有 `run()` 是 programmatic entry point。`plan()`、`spawn()`、`vote()`、`retry()`、`collect()`、`synthesize()` 不公开，因为它们会把 orchestration state machine 泄漏给调用者，形成浅 **module**。

`context` 必须是 caller-owned lossless JSON；不得把 live Cordis/DSH objects 序列化后传入。`signal` 取消整个 legion，Implementation 负责传播到所有尚未 settled 的 child 并完成 disposer 清理。

### 3.3 错误视图

```ts
export interface LegionErrorView {
  code:
    | "INVALID_REQUEST"
    | "UNKNOWN_POLICY"
    | "NO_PROVIDER"
    | "UNSUPPORTED_PROFILE"
    | "PRESET_UNAVAILABLE"
    | "BUDGET_EXHAUSTED"
    | "QUORUM_UNREACHABLE"
    | "SYNTHESIS_FAILED"
    | "CANCELLED"
    | "INTERNAL"
  message: string
  retryable: boolean
  causeProfile?: string
}
```

`run()` 仅在无法形成合约内结果时 reject；`best-effort` 且达到 quorum 时返回 `partial`，并在 `members` 中保留局部失败。原始 provider stack、prompt、credential 与 subprocess environment 不跨 seam 暴露。

## 4. Cordis 插件行

### 4.1 Host composition（推荐）

Legion 提供 `ctx.legion`，且需要读取跨 session registry，因此属于 Host composition。它不应放在普通 agent preset 的 root realm；否则第二个 session 会发生 service registration collision。

```yaml
- id: legion
  name: "@dsh-legion/core"
  config:
    profiles:
      architect:
        provider: spawn
        model: deepseek-reasoner
        preset: code
        role: "Design the solution and identify invariants."
        tools:
          allow: [read, glob, grep]
        maxTokens: 12000
      implementer:
        provider: codex
        role: "Produce an implementation-oriented proposal."
        weight: 2
      critic:
        provider: claude-code
        role: "Find correctness, security, and maintainability risks."
    policies:
      default:
        members: [architect, implementer, critic]
        synthesis: architect
        quorum: 2
        failure: best-effort
        retries: 1
        maxParallel: 3
    defaults:
      policy: default
      timeoutMs: 900000
      maxParallel: 4
```

Host composition 中 product providers 必须独立注册；Legion 只引用 provider name：

```yaml
- id: subagent-codex
  name: "@deepseek-ai/dsh-subagent-codex"

- id: subagent-claude-code
  name: "@deepseek-ai/dsh-subagent-claude-code"
```

### 4.2 Agent preset 中的可选 tool adapter

```yaml
- id: tool-legion
  name: "@dsh-legion/tool"
  config:
    toolName: legion
```

`@dsh-legion/tool` 只消费 `ctx.legion`、`ctx.tools` 与 calling agent；它不提供 process-global service，所以可以安全地由 preset 按 session 贡献。若未来有 preset-private Legion instance，则 provider 与所有 consumers 必须置于同一 `cordis:group` 且为 `legion: true` 建立 isolate realm；默认不推荐，因为 orchestration policy 通常由 deployment 共享。

## 5. 调用示例

### 5.1 Programmatic call

```ts
const result = await ctx.legion.run({
  objective: "Design a migration from REST polling to event-driven updates.",
  policy: "default",
  context: {
    constraints: ["zero downtime", "backward-compatible rollout"],
    deadline: "2026-06-30"
  },
  signal
})

if (result.status === "partial") {
  ctx.logger.warn("Legion completed with degraded membership")
}
```

### 5.2 Model-facing tool call

```json
{
  "objective": "Review this repository's authentication redesign and return a final recommendation.",
  "policy": "default",
  "context": {
    "scope": ["threat model", "migration risk", "test strategy"]
  }
}
```

Tool schema 应只暴露 `objective`、`policy`、`context`；不要把 profile、provider、model 或 preset 作为逐次调用参数。配置管理员决定 capability envelope，主 agent 决定目标。这保持 Interface 小、可审计，并防止 prompt-driven privilege expansion。

### 5.3 CLI adapter（若以后确有第二个 caller）

不把 CLI 作为 v1 entry point；未来可由一个独立 adapter 调用同一个 `ctx.legion.run()`：

```ts
const result = await legion.run({ objective, policy, context })
process.stdout.write(JSON.stringify(result) + "\n")
```

这展示了 **leverage**：CLI 不重新实现调度。只有出现第二个真实 adapter 需求时才发布，遵循 “one adapter is hypothetical; two adapters make a real seam”。

## 6. 隐藏 Implementation

以下内容全部 package-private，以维持 **depth** 与 **locality**：

1. **Config compiler**：schema validation、default materialization、profile reference graph、静态 capability requirements。
2. **Request compiler**：把 objective、role、只读 context、expected evidence 与 output contract 编译为独立 child prompt；remote child 不继承当前 conversation 时自动补足上下文。
3. **Planner**：选择 policy members、synthesis profile、quorum 与 fan-out waves。v1 采用 deterministic config plan，不让另一个 model 生成不可审计的动态 DAG。
4. **Preset adapter**：
   - omitted preset：沿用 parent standing composition；
   - explicit preset：在 child creation setup 调用 `agentPresets.mount(childCtx, preset)`；
   - 对 remote product providers：preset 不可应用，fail loud 为 `UNSUPPORTED_PROFILE`。
5. **Provider adapter**：把统一 `WorkerProfile` 翻译为 DSH `SubagentStartRequest`；先检查 `outputSchema/depthLimit/toolFilter/persona` capabilities。
6. **Scheduler**：bounded concurrency、timeout、AbortSignal fan-out、retry backoff、quorum short-circuit、公平性与 deterministic member ordering。
7. **Run ledger**：记录状态转换、run id、attempt、selected output、usage；不向 caller 暴露可变对象。
8. **Evidence normalizer**：将不同 provider 输出归一为 owned data，限制尺寸，标注来源；不序列化 live Session/Agent/Cordis objects。
9. **Synthesizer**：向 synthesis worker 提供候选结论、分歧与 provenance；若 synthesizer 失败，可按 policy 选择 deterministic fallback 或整体失败。
10. **Lifecycle owner**：所有 listeners、runs、timeouts 与 adapters 由当前 Cordis Fiber/operation scope 持有；stop/HMR/cancel 都可逆且 idempotent。
11. **Telemetry**：内部 event span、profile latency、retry/quorum metrics；仅输出安全标签，不记录 secret 或完整 prompt。

推荐内部目录保持知识 **locality**：

```text
src/
  index.ts                 # Cordis plugin and ctx.legion provision
  config.ts                # Public config schema + compiler
  legion.ts                # run() facade
  internal/
    plan.ts
    schedule.ts
    compile-prompt.ts
    synthesize.ts
    ledger.ts
    errors.ts
    adapters/
      dsh-subagents.ts
      dsh-presets.ts
      clock.ts
```

内部 seams 只为真实变化建立：`dsh-subagents` adapter 对正式 registry，`dsh-presets` adapter 对 preset mounting，`clock` adapter 对 deterministic timeout tests。不要为 planner 的每个函数创建 interface。

## 7. 依赖分类

| 分类 | 依赖 | 处置 |
|---|---|---|
| Core contract | `@deepseek-ai/cordis`, `@deepseek-ai/dsh-subagent`, DSH content/session JSON types | 必需 peer dependencies；Legion 直接跨这些正式 seams |
| Host registry | `ctx.subagents`, `ctx.agentPresets`, calling Agent/session lineage | 必需 runtime dependencies；不在 Legion 内创建或复制 |
| Model tool | `ctx.tools`, `ctx.systemPrompt`（若安装 tool guidance） | 仅 `@dsh-legion/tool` 需要 |
| Provider adapters | `spawn`, `fork`, `codex`, `claude-code`, future ACP/SDK names | 可选 deployment dependencies；按配置发现，不硬编码 import |
| Product runtime | `codex`/`claude` executable、credentials、subprocess owner | deployment-owned；Legion 不安装、不认证、不传 secrets |
| Operational | clock、logger、telemetry、optional persistence | 通过内部 adapter；v1 ledger 默认 operation-local |
| Development | Vitest、fake providers、fake preset adapter、property tests | dev-only；不进入 published Interface |

版本策略：把 DSH/Cordis 声明为明确且窄的 peer range，并通过 compatibility tests 锁定所用 seam。不要从 DSH 内部路径 import；若 DSH 尚未公开“指定 preset 创建 child”的 seam，先贡献一个最小 upstream extension，再由 `dsh-presets` adapter 隔离版本差异。

## 8. 错误模式

| 错误模式 | 何时发现 | 行为 |
|---|---|---|
| 无效 profile/policy 引用、非法 quorum/并发值 | plugin activation | fail loud，Cordis row 不激活 |
| provider 未注册或名称拼错 | `run()` preflight | `NO_PROVIDER`，不启动任何 child |
| provider 不支持 persona/toolFilter/output schema | activation 可静态判断时；否则 preflight | `UNSUPPORTED_PROFILE`，绝不静默降级 |
| preset 不存在、broken、挂载等待 service | child creation preflight/setup | `PRESET_UNAVAILABLE`；未发布的 child 资源清理 |
| remote provider 配置了 preset | activation | `UNSUPPORTED_PROFILE`；remote deployment 自己拥有 composition |
| 重复 provider/service/tool 名称 | Cordis/provider registration | 保留 DSH fail-loud；不捕获为成功 |
| child refusal/error/max-tokens/cancel | settlement | 标记 member；按 retry/quorum/failure policy 继续或失败 |
| timeout 或 caller abort | operation | 停止新启动，取消 active runs，等待 cleanup；返回/抛出 `CANCELLED` |
| budget exhausted | 启动前或波次间 | `BUDGET_EXHAUSTED`，不超额启动 |
| quorum 不可达 | 调度过程中 | 取消不再有价值的 work；`QUORUM_UNREACHABLE` |
| synthesis worker 失败 | merge phase | policy 允许时 deterministic fallback，否则 `SYNTHESIS_FAILED` |
| disposer/cleanup 同时失败 | teardown | 聚合 diagnostics；原始 execution failure 保持主因 |
| provider HMR/removal during run | start/settlement | 已发布 run 按 DSH ownership 完成；新 start 失败；不复用 stale adapter |
| malformed/oversized child output | normalization | member failure 或截断标注；不能把 partial 当 completed |
| tool 从 non-agent caller 执行 | tool entry | `INVALID_REQUEST`；programmatic Interface 仍可显式传 parent context 的内部调用 |

## 9. 测试面

Interface 就是主要 test surface；tests 不越过外部 seam 检查 private call sequence，除非针对内部 adapter contract。

### 9.1 Contract tests

- `run()` completed/partial/rejected 三类结果。
- stable member ordering、error code、retryable 与 provenance。
- cancellation、timeout、quorum、budget、maxParallel invariants。
- `context` lossless JSON 与 schema-constrained synthesis。
- tool adapter 与 programmatic entry point 产生等价 request。

### 9.2 Config tests

- defaults、unknown refs、duplicate logical names、quorum bounds、safe integers。
- capability matrix：spawn/fork 与 remote provider 的 persona/toolFilter/preset 差异。
- secrets/env 字段不在 public schema 中。

### 9.3 Adapter tests

- scripted fake `SubagentProvider`：success、refusal、max-tokens、infrastructure reject、slow cancel、dispose reject。
- fake preset adapter：mount success、unknown、broken、waiting service、rollback。
- provider add/remove/HMR 与 duplicate registration。
- explicit preset child 使用目标 preset；omitted preset 使用 parent standing generation，而不是重新读取同名 preset。

### 9.4 Scheduler/property tests

- 任意 interleaving 下 active count 永不超过 `maxParallel`。
- operation settle 后无 active run、timer 或 listener 泄漏。
- 达到 quorum 后不会把失败成员错误提升为整体失败。
- quorum 已不可能时不会继续无价值启动。
- retry 次数、budget 与 cancellation 在随机时序下仍满足上界。

### 9.5 Integration/composition tests

- 真实 Cordis host composition 挂载 `core`，preset 挂载 `tool`。
- 至少两个 provider adapters：in-process spawn + 一个 scripted remote；可用环境中再测 Codex/Claude Code。
- 多 session 同时运行，确认 service 不冲突、结果不串线。
- preset mount validation、child lineage/session id、workspace locality。
- stop/HMR 时所有 effect 可逆。

### 9.6 Compatibility tests

针对支持的每个 DSH release，锁定：

- `SubagentProvider` capability contract 与 `SubagentRun.dispose()` ownership。
- `agentPresets.mount/composeFrom` semantics。
- Cordis effect lifecycle 与 service realm 行为。
- shipped provider names 只作为 fixtures，不作为 Legion 的隐式默认事实。

## 10. 取舍与拒绝方案

### 10.1 选择：一个 `run()`，而不是 orchestration CRUD

**收益**：最大 depth、leverage 与 locality；调用者不承担状态机。
**代价**：高级 caller 不能逐步操纵 plan。v1 有意拒绝 `createPlan/startMember/collect/vote/finalize` 六件套；确有可复用需求后再考虑第二个 entry point，例如只读 `inspect(runId)`，而不是提前扩张 Interface。

### 10.2 选择：静态 policy + SOTA synthesis

**收益**：可预测、可审计、可测试，配置变更可 code review。
**代价**：不具备完全动态 swarm。动态 planner 可作为隐藏 Implementation 增强，但输出必须编译为同一内部 plan，并受成员、预算、capability envelope 限制。

### 10.3 选择：profile 固定 provider/model/preset

**收益**：主 agent 的 tool call 极小，避免每次 prompt 选择任意 provider 或扩大权限。
**代价**：临时实验需要改配置。可通过新增 policy/profile 解决，而不是扩大每次调用 Interface。

### 10.4 选择：复用 DSH registries，不包装每个 provider package

**收益**：最大化现有 DSH leverage；provider lifecycle、session lineage、cancellation 与 product subprocess ownership 保持单一真相。
**代价**：Legion 对 DSH peer version 敏感。通过一个 `dsh-subagents` compatibility adapter 与 release matrix 保持 locality。

### 10.5 选择：显式 preset 只支持可控 child creation

**收益**：真实满足“不同 preset”，且遵循正式 mount seam。
**代价**：现有通用 `tool-subagent` 不直接暴露 per-call preset；可能需要一个很小 upstream DSH extension。拒绝通过复制 Cordis YAML、私自创建 registry 或修改 shipped preset 绕过该限制。

### 10.6 选择：best-effort 是显式 policy

**收益**：局部 provider 故障时仍可形成有 provenance 的结论。
**代价**：caller 必须处理 `partial`。拒绝把失败悄悄吞掉并一律标为 completed。

### 10.7 选择：v1 不持久化 Legion 自身 run graph

**收益**：更少 dependencies 与更小开源安装面；DSH child sessions 已提供 durable evidence。
**代价**：进程重启后不能恢复 orchestration ledger。出现真实 resume 需求后，再增加内部 persistence adapter；除非 caller 必须主动 resume，否则不新增公开 entry point。

## 11. 发布切片

1. `@dsh-legion/core`：配置 compiler、`ctx.legion.run()`、spawn/scripted provider integration、deterministic synthesis fallback。
2. `@dsh-legion/tool`：单一 `legion` tool adapter。
3. DSH compatibility adapter：先验证是否可用公开 child-creation setup 指定 preset；若不可用，提交最小 upstream seam，而非依赖 private imports。
4. 加入 Codex/Claude Code integration tests；保持 product executable 与 credentials deployment-owned。

删除测试（deletion test）：如果移除 Legion，caller 将被迫在 prompt/tool call sites 重复 provider 选择、并发、retry、quorum、preset mounting、normalization、synthesis 与 cleanup。复杂度会重新扩散到多个调用点，说明该 module 不是 pass-through，而是在用小 Interface 提供真实 depth。
