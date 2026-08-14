# Extensible Interface Design for DSH/Cordis Legion

> **Status: superseded exploration.** The shipped v0.1 design is the single agent-plane semantic-profile tool recorded in [ADR 0001](../adr/0001-semantic-profile-router.md). The registries and third-party adapter ecosystem below are possible future directions, not current recommendations or acceptance criteria.

## 1. 目标与范围

Legion 是一个可开源的 **module**，让一个 SOTA 主 agent 在 DSH/Cordis 中协调多个不同模型、角色和 preset。它不复制 DSH 的 agent loop、Session、工具注册、持久化或 subagent transport；它在这些正式扩展模式之上提供一个有策略、有预算、有可观测性的编排 **interface**。

本文统一使用以下术语：

- **module**：具有一个 interface 和隐藏 implementation 的可部署单元。
- **interface**：调用者正确使用 module 必须知道的全部事实，包括类型、约束、顺序、错误与成本语义。
- **seam**：无需修改调用处即可替换行为的位置。
- **adapter**：在某个 seam 上满足 interface 的具体实现。
- **depth**：每单位 interface 所提供的行为杠杆；Legion 应把规划、路由、并发、恢复、聚合与审计隐藏在少量操作后。
- **locality**：决策、错误处理和验证集中于 module 内，而不是散落到主 agent prompt 或每个调用者。

### 1.1 非目标

- 不成为另一个通用 workflow DSL；复杂 DAG 仍可委托给 DSH workflow module。
- 不取代 `@deepseek-ai/dsh-subagent` provider registry；Legion 复用它。
- 不让第三方 adapter 直接取得 Cordis `Context`、Agent、Session 或任意工具执行权。
- 不把每个内部函数都变成公共 seam。一个 adapter 意味着假设 seam，至少两个真实 adapter 才证明 seam 值得稳定。
- 不承诺跨 provider 的完全同质能力；能力必须显式协商并 fail loud，禁止静默降级。

## 2. 经只读检查确认的正式 DSH/Cordis 模式

设计以 `deepseek-ai/deepseek-harness` 的固定审计版本为依据：

1. Host composition 持有跨 Session singleton：`subagents` registry、spawn/fork backend、Agent/Session registry、持久化、sandbox/approval、model route。Agent preset 只贡献本 Session 的工具、persona、prompt section 等。
2. `SubagentProvider` 是正式 transport seam：具名注册、声明 `capabilities` 与 `inheritsParentContext`，通过 `start()` 返回可释放的 `SubagentRun`；不支持能力时由 runtime 在调用前拒绝。
3. `@deepseek-ai/dsh-tool-subagent` 是 model-facing adapter：按配置绑定 provider、tool name、background mode、persona、tool filter、model options 与 depth limit。
4. Provider 注册通过 Cordis effect 管理，重复名称 fail loud；provider 移除阻止新任务但不撤销已返回 run。
5. Continuable child 的 identity、composition、resume、follow-up、report 与 disposal 由 host runtime 管理，而不是由 provider 私自实现。
6. Preset 若发布自身 service，provider 及全部 consumer 必须进入同一 `cordis:group` 的 `isolate` realm；而有 host consumer 的 service 必须留在 Host composition。
7. Cordis side effect 必须随 Fiber 可逆，使用 registry disposer、`ctx.effect()` 或 `ctx.on()`；composition activation failure 应在启动时暴露。

这些事实决定 Legion 的落点：**核心 registry 和 coordinator 属于 Host composition**；model-facing 工具和可选 prompt guidance 属于 Agent preset。Legion 不把 `subagents` 复制进 preset，也不绕过现有 capability checks。

## 3. Module 形状与 depth

外部只有一个协调 module：`LegionRuntime`。调用者不需要理解候选评分、熔断、并发调度、重试、上下文打包、结果归一化和评审投票。

```text
Main agent / Tool / Host caller
             |
             v
+----------------------------------+
| LegionRuntime interface          |
| execute(request) -> result       |
| explain(request) -> decision     |
| register*(adapter) -> disposer   |
+----------------------------------+
| Hidden implementation            |
| validate -> plan -> route         |
| -> schedule -> supervise          |
| -> evaluate -> synthesize         |
| -> audit                          |
+----------------------------------+
             |
             v
DSH subagents / model routes / presets / workflows
```

`execute()` 是主要 deep interface：一次调用覆盖整个 orchestration lifecycle。`explain()` 只做纯决策预览，不启动 child，用于测试、审计和运维。注册方法只提供给 composition/插件作者，不暴露给模型。

删除 Legion 后，预算、路由、fallback、聚合、错误分类和审计会重新散布到主 agent prompt 与调用点，因此它通过 deletion test；它不是 pass-through wrapper。

## 4. 公共配置类型

以下 TypeScript 是建议发布的稳定 interface。代码示例使用英文；配置说明使用中文。

```ts
export type AdapterRef = {
  name: string
  config?: Readonly<Record<string, JsonValue>>
}

export type LegionConfig = {
  version: 1
  defaults?: {
    router?: AdapterRef
    synthesizer?: AdapterRef
    failurePolicy?: FailurePolicy
    limits?: ExecutionLimits
  }
  roles: Readonly<Record<string, RoleConfig>>
  profiles: Readonly<Record<string, ProfileConfig>>
  routes?: readonly RouteRule[]
  security?: SecurityPolicy
  observability?: ObservabilityConfig
}

export type RoleConfig = {
  description: string
  objective?: string
  profile: string
  persona?: string
  toolPolicy?: ToolPolicy
  outputSchema?: ObjectJsonSchema
  replicas?: number
  evaluator?: AdapterRef
  tags?: readonly string[]
}

export type ProfileConfig = {
  adapter: AdapterRef
  model?: {
    provider?: string
    model?: string
    maxTokens?: number
  }
  preset?: string
  transport?: string
  backgroundMode?: "one-shot" | "continuable"
  capabilities?: readonly CapabilityName[]
  concurrency?: number
  timeoutMs?: number
  cost?: {
    inputPerMillion?: number
    outputPerMillion?: number
    currency?: string
  }
  metadata?: Readonly<Record<string, JsonValue>>
}

export type RouteRule = {
  when: RoutePredicate
  prefer: readonly string[]
  exclude?: readonly string[]
  fallback?: readonly string[]
}

export type RoutePredicate = {
  role?: string
  tagsAny?: readonly string[]
  requiredCapabilities?: readonly CapabilityName[]
  minContextTokens?: number
  maxEstimatedCost?: number
}

export type ExecutionLimits = {
  maxAgents?: number
  maxParallel?: number
  maxDepth?: number
  maxAttemptsPerRole?: number
  deadlineMs?: number
  tokenBudget?: number
  costBudget?: number
}

export type FailurePolicy = {
  quorum?: "all" | "majority" | number
  onRoleFailure?: "fail" | "degrade" | "fallback"
  onEvaluationFailure?: "fail" | "use-raw" | "fallback"
  retry?: {
    maxAttempts: number
    backoffMs?: number
    retryableCodes?: readonly LegionErrorCode[]
  }
}

export type ToolPolicy = {
  allow?: readonly string[]
  deny?: readonly string[]
}

export type SecurityPolicy = {
  allowedAdapters?: readonly string[]
  allowedTransports?: readonly string[]
  allowedPresets?: readonly string[]
  allowThirdPartyCode?: boolean
  maxAdapterConfigBytes?: number
}

export type ObservabilityConfig = {
  emitEvents?: boolean
  includePrompts?: boolean
  includeOutputs?: boolean
  redactKeys?: readonly string[]
}
```

### 4.1 配置不变量

- `version` 必须精确匹配；未知 major version 拒绝启动。
- role 引用的 profile 必须存在；所有 adapter、transport 与 preset 引用在 composition 激活或 `execute()` 前完成解析。
- `toolPolicy.allow` 与 `deny` 不可同时为空；未知工具 fail loud。
- profile 声明的 capability 不是信任来源，只是要求；实际能力以 adapter/provider 握手为准。
- 所有预算都按整次 Legion execution 计，不由各 role 自行解释。
- 第三方配置只允许 lossless JSON，不允许函数、Cordis live object、Agent 或 Session reference。
- `preset` 仅适用于能够组合 DSH child 的 profile adapter；远端 product adapter 若不支持 preset 必须返回 `UNSUPPORTED_CAPABILITY`。

## 5. 运行 interface

```ts
export type LegionRequest = {
  task: string
  roles?: readonly string[]
  context?: readonly ContextArtifact[]
  requirements?: {
    capabilities?: readonly CapabilityName[]
    outputSchema?: ObjectJsonSchema
  }
  limits?: ExecutionLimits
  metadata?: Readonly<Record<string, JsonValue>>
  signal: AbortSignal
}

export type ContextArtifact = {
  id: string
  mediaType: string
  content: string
  trust: "user" | "workspace" | "agent" | "external"
}

export type LegionResult = {
  executionId: string
  status: "completed" | "degraded"
  output: readonly ContentBlock[]
  structured?: JsonValue
  decision: RouteDecision
  members: readonly MemberResult[]
  usage: AggregatedUsage
  diagnostics: readonly Diagnostic[]
}

export interface LegionRuntime {
  execute(request: LegionRequest): Promise<LegionResult>
  explain(request: Omit<LegionRequest, "signal">): Promise<RouteDecision>
  registerRoleAdapter(adapter: RoleAdapter): () => void
  registerRouter(adapter: RouterAdapter): () => void
  registerProfileAdapter(adapter: ProfileAdapter): () => void
}
```

`register*()` 返回精确 disposer，并由 Cordis Fiber 持有。`execute()` 在 child/model-level failure 时返回 typed result 或抛 `LegionError`，绝不返回无法区分的字符串错误。取消后不再启动新 member，并等待已启动 member 完成 disposal；超时只是停止原因，不免除清理责任。

## 6. 扩展 seam

### 6.1 Role seam

Role adapter 将领域角色变成可执行 member spec；它不负责选择模型、启动 child 或聚合结果。这保留 locality：角色知识集中，但 transport 与预算逻辑不会复制到每个角色。

```ts
export interface RoleAdapter {
  readonly name: string
  readonly configSchema: ObjectJsonSchema
  compile(input: RoleCompileInput): Promise<CompiledRole>
}

export type RoleCompileInput = {
  roleName: string
  config: RoleConfig
  task: string
  artifacts: readonly ContextArtifact[]
}

export type CompiledRole = {
  prompt: readonly ContentBlock[]
  requiredCapabilities: readonly CapabilityName[]
  outputSchema?: ObjectJsonSchema
  evaluationRubric?: readonly RubricCriterion[]
}
```

内置至少提供 `prompt-role` 与 `review-role` 两个 adapter，证明此 seam 真实存在。第三方 role adapter 只看到 immutable value，不接触 runtime。

### 6.2 Router seam

Router adapter 接收已验证候选和预算快照，返回排序后的 decision。它不直接启动 member；scheduler 仍是 Legion 的隐藏 implementation，避免第三方 router 绕过 concurrency、deadline 或 authority。

```ts
export interface RouterAdapter {
  readonly name: string
  readonly configSchema: ObjectJsonSchema
  route(input: RouteInput): Promise<RouteDecision>
}

export type RouteInput = {
  executionId: string
  roles: readonly CompiledRoleCandidate[]
  profiles: readonly ResolvedProfile[]
  health: Readonly<Record<string, ProfileHealth>>
  remaining: RemainingBudget
}

export type RouteDecision = {
  assignments: readonly Assignment[]
  rationale: readonly DecisionFact[]
}
```

内置至少提供 `rules` 与 `score` 两个 adapter。`score` 可组合质量、成本、延迟、健康度与多样性；内部 tie-break 必须稳定，确保测试可重复。

### 6.3 Profile seam

Profile adapter 是 Legion 与“某种 child 执行环境”的 seam。它将 profile 解析为能力与启动函数。DSH、Codex、Claude Code、ACP 或远端网关都通过同一个 interface 接入。

```ts
export interface ProfileAdapter {
  readonly name: string
  readonly configSchema: ObjectJsonSchema
  resolve(input: ProfileResolveInput): Promise<ResolvedProfile>
}

export type ResolvedProfile = {
  id: string
  capabilities: ReadonlySet<CapabilityName>
  limits: ProfileLimits
  start(request: MemberStartRequest): Promise<MemberRun>
}

export interface MemberRun {
  readonly id: string
  readonly result: Promise<MemberResult>
  dispose(): Promise<void>
}
```

内置 `dsh-subagent` adapter 应调用 host 的 `ctx.subagents.start(provider, request)`；它不重新实现 Session、provider 或 run settlement。第三方 adapter 必须使用 Legion 提供的受限 `AdapterHost`（logger、clock、HTTP/subprocess capability 的可选 wrapper），不得收到完整 `Context`。

### 6.4 可选内部 seam

Evaluator、synthesizer、health store 和 clock 是 internal seam：可供 package 内测试或高级扩展，但不进入 v1 稳定顶层 interface。公开过早会产生浅 module——调用者被迫理解 Legion implementation 的每一步。

## 7. Cordis 插件行与 plane 放置

### 7.1 Host composition

核心 runtime、内置 adapter 和 model-facing tool 所依赖的共享 registry 必须在 Host composition。示意行如下：

```yaml
- id: legion
  name: '@dsh-legion/runtime'
  config:
    configFile: ./legion.yml

- id: legion-profile-dsh
  name: '@dsh-legion/profile-dsh-subagent'

- id: legion-role-prompt
  name: '@dsh-legion/role-prompt'

- id: legion-role-review
  name: '@dsh-legion/role-review'

- id: legion-router-score
  name: '@dsh-legion/router-score'
```

`@dsh-legion/runtime` 提供 process-singleton `legion` registry；Host composition 中的第三方 adapter 通过 `inject: ['legion']` 注册，并由 Fiber disposer 自动撤销。它同时消费 host `subagents`，但不提供或复制后者。

第三方 adapter 示例：

```yaml
- id: legion-profile-acme
  name: '@acme/dsh-legion-profile'
  config:
    endpoint: https://models.example.test/v1
    profileName: acme-reasoner
```

### 7.2 Agent preset

Preset 只贡献模型可调用的工具和 prompt guidance，不发布新的 process-global service：

```yaml
- id: tool-legion
  name: '@dsh-legion/tool-legion'
  config:
    toolName: legion
    defaultRoles:
      - researcher
      - implementer
      - reviewer

- id: legion-guidance
  name: '@dsh-legion/prompt-guidance'
  config:
    mode: concise
```

若未来某个 preset-owned Legion extension 自己发布 service，它和所有 consumer 必须放进一个 `cordis:group`，并为该 service 设置 `isolate: true`。但 v1 不应这样设计，因为 host runtime、UI/API projection 和多个 Session 都要读取统一的 execution 状态；把 registry 放入 preset 会造成 service collision 或跨 Session 查询失效。

## 8. 配置与调用示例

### 8.1 `legion.yml`

```yaml
version: 1

defaults:
  router:
    name: score
  synthesizer:
    name: evidence-weighted
  limits:
    maxAgents: 6
    maxParallel: 3
    maxAttemptsPerRole: 2
    deadlineMs: 600000
    tokenBudget: 180000

roles:
  researcher:
    description: Gather repository evidence and unresolved questions.
    profile: fast-reasoner
    replicas: 2
    tags: [analysis, breadth]

  architect:
    description: Produce a coherent design from verified evidence.
    profile: deep-reasoner
    evaluator:
      name: rubric

  reviewer:
    description: Challenge correctness, security, and missing tradeoffs.
    profile: independent-reviewer
    toolPolicy:
      deny: [write, edit]

profiles:
  fast-reasoner:
    adapter:
      name: dsh-subagent
    transport: spawn
    preset: minimal
    model:
      provider: openrouter
      model: vendor/fast-model
      maxTokens: 12000
    concurrency: 4

  deep-reasoner:
    adapter:
      name: dsh-subagent
    transport: fork
    preset: code
    model:
      provider: anthropic
      model: vendor/deep-model
      maxTokens: 32000
    concurrency: 2

  independent-reviewer:
    adapter:
      name: dsh-product
    transport: codex
    backgroundMode: one-shot
    concurrency: 1

routes:
  - when:
      role: reviewer
      requiredCapabilities: [fresh-context]
    prefer: [independent-reviewer]
    fallback: [fast-reasoner]

security:
  allowedAdapters: [dsh-subagent, dsh-product]
  allowedTransports: [spawn, fork, codex]
  allowedPresets: [minimal, code]
  allowThirdPartyCode: false

observability:
  emitEvents: true
  includePrompts: false
  includeOutputs: false
  redactKeys: [token, apiKey, authorization]
```

注意：示例中的 model/provider 字符串是部署配置，不代表 DSH 对任意供应商的内置保证。adapter 必须在启动前验证 transport、preset 与 capability 是否真实可用。

### 8.2 主 agent 工具调用

```json
{
  "task": "Design a migration plan for the storage subsystem.",
  "roles": ["researcher", "architect", "reviewer"],
  "requirements": {
    "capabilities": ["workspace-read"]
  },
  "limits": {
    "maxAgents": 5,
    "maxParallel": 3,
    "deadlineMs": 300000
  }
}
```

建议工具只暴露任务、role 选择和有限预算 override，不把 router 内部参数、provider 凭证或任意 adapter config 暴露给模型。模型得到 high-leverage interface，部署者保留策略控制。

### 8.3 Host 调用

```ts
const result = await ctx.legion.execute({
  task: "Compare two cache invalidation strategies.",
  roles: ["researcher", "reviewer"],
  requirements: { capabilities: ["workspace-read"] },
  signal,
})
```

## 9. 隐藏 implementation

以下内容明确不属于公共 interface：

1. **Normalization**：schema validation、defaulting、引用解析、secret redaction。
2. **Compilation**：role adapter 将 role + task + artifact 编译为 immutable member spec。
3. **Capability negotiation**：profile adapter 的真实能力与 role 要求求交集；不支持即在启动前报错。
4. **Routing**：过滤候选、稳定评分、多样性约束、fallback chain 与可解释 decision facts。
5. **Scheduling**：全局和每 profile semaphore、deadline、budget reservation、取消传播、公平性。
6. **Supervision**：run publication 后监听 result，区分 child stop reason、infrastructure failure 与 disposal failure。
7. **Evaluation**：schema validation、rubric score、replica disagreement 和低置信度标记。
8. **Synthesis**：以 evidence 与 member diagnostics 为输入生成最终结果，而不是简单拼接文本。
9. **Audit**：记录 sanitized config hash、route decision、member lineage、usage、stop reason 和 error code。
10. **Lifecycle**：provider HMR、registration disposer、关闭时 child-first drain、幂等 disposal。

这些行为应集中在 `@dsh-legion/runtime`，获得 locality。role/router/profile package 只实现各自 seam；不得再层层包装同类 policy，否则会形成大量名字不同、行为很薄的浅 module。

## 10. 依赖分类

| 分类 | 依赖 | 方向与理由 |
|---|---|---|
| Interface dependency | Cordis `Context`/Service lifecycle types | 只用于插件装配和 disposer；不泄漏进第三方 value interface |
| Core runtime dependency | `@deepseek-ai/dsh-subagent` | 复用正式 provider registry、capability check、run lifecycle |
| Core runtime dependency | DSH tools/system prompt | model-facing tool 与 guidance 注册 |
| Optional host dependency | Agent/Session projections、persistence | durable inspection 与 UI；缺失时 runtime 可运行但 observability 降级需显式诊断 |
| Optional execution dependency | workflow engine | 仅当某种策略确实需要 DAG fan-out；核心执行不依赖 workflow DSL |
| Adapter dependency | Codex/Claude/ACP/remote SDK | 各自只存在于 profile adapter package，不进入 core |
| Infrastructure dependency | logger、clock、metrics、HTTP/subprocess wrapper | 通过受限 AdapterHost 注入，便于测试与 authority 控制 |
| Development dependency | Schemastery/JSON Schema validator、Vitest、fake clock | 配置验证与 contract test |
| Forbidden dependency | Web UI、CLI shell、具体 model SDK in core | 防止 core 耦合部署界面或供应商 |

依赖规则是单向的：`tool -> legion runtime -> seam interface <- adapter -> vendor/DSH transport`。Core 不 import 第三方 adapter；adapter 可以 import Legion interface package。这样新增 adapter 不修改 core，且供应商故障 locality 保持在相应 package。

## 11. 错误模式

```ts
export type LegionErrorCode =
  | "INVALID_CONFIG"
  | "UNKNOWN_ROLE"
  | "UNKNOWN_PROFILE"
  | "NO_ADAPTER"
  | "DUPLICATE_ADAPTER"
  | "NO_ROUTE"
  | "UNSUPPORTED_CAPABILITY"
  | "BUDGET_EXHAUSTED"
  | "DEADLINE_EXCEEDED"
  | "CANCELLED"
  | "MEMBER_START_FAILED"
  | "MEMBER_FAILED"
  | "EVALUATION_FAILED"
  | "SYNTHESIS_FAILED"
  | "DISPOSAL_FAILED"
  | "POLICY_DENIED"

export class LegionError extends Error {
  readonly code: LegionErrorCode
  readonly executionId?: string
  readonly role?: string
  readonly profile?: string
  readonly cause?: unknown
  readonly retryable: boolean
}
```

关键错误语义：

- **配置期**：重复 adapter、非法 schema、未知引用、Host/preset plane 错置应阻止 Cordis activation，不延迟到首个用户请求。
- **路由期**：无 candidate 或能力不匹配返回 `NO_ROUTE` / `UNSUPPORTED_CAPABILITY`；禁止偷偷换成能力更弱的模型。
- **启动前失败**：没有 run 可 dispose；不发“member started”事件。
- **发布后失败**：member result 记录 stop reason；`error`、`max-tokens`、`refusal` 不伪装为 success，可按 failure policy 触发 fallback。
- **部分失败**：只有满足 quorum 和 policy 时返回 `degraded`；diagnostics 必须列出丢失的 role/replica。
- **取消与 deadline**：停止 admission，取消已启动工作，await disposal；若执行失败且 disposal 也失败，保留两者并使用 aggregate cause。
- **adapter throw**：未分类异常包装为稳定 code，日志保留 sanitized cause；不得把 secret config 序列化到结果。
- **provider HMR/remove**：新 assignment 重新解析 registry；已发布 run 仍由 holder 完成或 dispose。
- **synthesis failure**：不得丢弃已完成 member；结果可按 policy 返回 raw evidence 或 fail loud。

## 12. 测试面

Interface 是测试面；优先从 `LegionRuntime.execute/explain` 和三个公开 seam 测试，不穿透到私有 scheduler 状态。

### 12.1 配置 contract

- version、unknown key 策略、defaulting、引用完整性、JSON-only config。
- security allowlist、config size、secret redaction。
- property-based 预算边界：非负、安全整数、组合 override 不得扩大部署 hard limit。
- composition activation：缺 service、重复 registry name、错误 realm、未激活 row 均 fail loud。

### 12.2 Seam contract suite

发布可被第三方 adapter 复用的 contract tests：

- role adapter：determinism、immutable input、schema-valid output、无 runtime object 泄漏。
- router adapter：只选择候选集合内 profile、稳定 tie-break、不超 budget、rationale 完整。
- profile adapter：capability truthful、并发 start 独立、pre-publication rejection 清理、post-publication result/dispose 语义、幂等 disposal。
- hostile adapter：throw、hang、返回 malformed data、忽略 abort、超大 output；core 必须隔离并给稳定错误。

### 12.3 Runtime 行为

- 单 role、multi-role、replica、fallback、quorum 与 degraded result。
- 全局/per-profile concurrency，fake clock 下的 deadline 与 retry backoff。
- token/cost reservation 竞争，确保并发任务不能共同超卖预算。
- cancellation race：启动前、publication 瞬间、result 后、dispose 中。
- evaluation/synthesis success、schema mismatch、disagreement、partial evidence。
- provider add/remove/HMR 和 Cordis Fiber disposal。
- determinism：同配置、同 health snapshot、同输入得到同 route decision。

### 12.4 DSH 集成与 E2E

- 使用真实 `SubagentRuntime` + fake providers 验证 capability negotiation 和 lifecycle event pairing。
- spawn/fork：fresh vs inherited context、preset、persona、tool filter、max depth。
- continuable：background start、follow-up、cold resume、report、interrupt、child-first drain。
- product providers：Codex/Claude 缺 executable、认证失败、transport error；测试为 opt-in，不作为离线必过项。
- preset mount validation：model-facing `legion` 工具存在，Host service 不被复制进 isolate realm。
- 多 Session 并发：registry singleton，但 execution、预算与事件按 owner 隔离。

### 12.5 兼容性

- JSON fixture 固化 public config 与 result schema。
- adapter contract version negotiation；minor version 只添加 optional capability。
- 从 v1 配置升级的 migration tests。
- 最低与当前 DSH peer version matrix；不依赖 DSH 私有文件路径或未导出 implementation。

## 13. 取舍与拒绝的设计

### 13.1 一个动态 `execute()` vs 每个 role 一个工具

选择一个 `legion` 工具。每 role 一个工具会扩大 model interface、破坏 tool schema locality，并要求新增 role 时重编 preset。单工具通过配置扩展，depth 更高；代价是工具调用不直接列出全部 role 细节，因此需要 concise prompt guidance 与可读 validation error。

### 13.2 Host singleton vs preset-owned runtime

选择 Host singleton。它支持跨 Session registry、UI/API projection、统一 health 与 provider registration。代价是配置必须严格按 owner 隔离，不能把某 Session 的 secret 或 budget 泄漏给另一 Session。Preset 只决定是否暴露工具。

### 13.3 三个公开 seam vs “所有步骤均可插拔”

只公开 role/router/profile 三个变化轴。Evaluator、scheduler、synthesizer 暂为 internal seam。这样第三方能扩展最有价值的差异，同时避免浅 module 与组合爆炸。未来只有出现两个独立、真实、稳定需求后才升级 internal seam。

### 13.4 Capability negotiation vs 最小公分母

选择显式 negotiation 和 fail loud。最小公分母更容易路由，但会放弃 preset、persona、tool filtering、structured output 等能力，也会让安全假设静默失效。

### 13.5 Adapter in-process vs 隔离执行

Cordis 插件 adapter 默认是 trusted same-process code，性能好、集成简单，但开源生态中的第三方 package 具有 host 权限风险。v1 通过 allowlist、默认禁用第三方 code、受限 AdapterHost 和清晰信任文档缓解；高风险 adapter 应通过 ACP/远端 process profile 接入。完整 sandboxed plugin runtime 不纳入 v1，因为会显著扩大 implementation 与发布面。

### 13.6 配置驱动 vs 通用编程 DSL

选择版本化 declarative config + adapter code。配置适合审计、diff、schema validation 和稳定 deployment；复杂行为由少数 deep adapter 承担。通用 DSL 虽灵活，却把 scheduler implementation 泄漏给用户，并使安全与迁移困难。

### 13.7 SOTA 质量 vs 可复现性与成本

默认 router 可按质量、差异性和健康度选择多个模型，但必须受 hard budget、stable tie-break 和显式 fallback 约束。SOTA 不是“总是调用最多模型”；它是针对任务和预算选择最有效的组合，并能解释 decision。

## 14. 建议 package 切分

```text
@dsh-legion/interface
  Public value types, adapter contracts, error codes, contract-test helpers.

@dsh-legion/runtime
  Cordis host service and hidden orchestration implementation.

@dsh-legion/tool-legion
  Model-facing tool; no provider logic.

@dsh-legion/profile-dsh-subagent
  Adapter over the official DSH subagent seam.

@dsh-legion/role-prompt
@dsh-legion/role-review
@dsh-legion/router-rules
@dsh-legion/router-score
  Built-in adapters proving each public seam.
```

每个 package 必须有足够 depth：例如不要再拆出 `candidate-filter`, `score-normalizer`, `retry-runner` 等只有一个函数的公共 package；这些属于 runtime implementation，保持 locality。Open-source 发布时，`interface` package 应尽量无运行时依赖，adapter contract test helper 放在受控 export path。

## 15. 验收标准

- 一个主 agent 通过单个 `legion` interface 可协调至少两种 model/provider、两个 role adapter 和两个 profile adapter。
- 新增第三方 role/router/profile adapter 不修改 runtime core，也不修改已有调用示例。
- 不支持的 capability 在 child 启动前产生稳定 typed error，无静默降级。
- 所有 run、registration、event 和 timer 都有 Cordis-owned disposer；取消后达到 quiescence。
- Host/preset plane 遵循 DSH 正式 composition 规则，多 Session 下不发生 service collision。
- 测试覆盖配置、三个 seam contract、并发/预算/取消、DSH integration、preset mount 和 compatibility fixtures。
- 公共 interface 保持小而稳定，复杂 orchestration 留在隐藏 implementation，以 depth 换取调用 leverage，以 locality 降低维护成本。
