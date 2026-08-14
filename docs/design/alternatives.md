# dsh-legion 架构方案与外部 Interface 备选

> 状态：已被 [ADR 0001](../adr/0001-semantic-profile-router.md) 取代的历史方案比较；本文的 Mission Module 推荐不代表当前 v0.1 实现或验收标准
> 范围：独立、可开源、可安装、可配置的 DeepSeek Harness extension
> 目标：由 SOTA primary model 协调多个 model、多个 agent role 与多个 preset

## 1. 结论摘要

推荐将 **方案 A：声明式 Mission Module** 作为 MVP 的唯一公开 Interface：调用者提交 `MissionSpec`，获得经过校验的 `ExecutionPlan` 或最终 `MissionResult`。dsh-legion 的 Implementation 在内部把 mission 编译为 Harness 已有的 subagent/workflow primitives；三个内建 topology（`supervisor`、`panel`、`pipeline`）属于私有策略，不在 MVP 中承诺第三方 strategy Interface。

推荐交付形态：

1. 一个 public npm package，提供 schema、compiler、runtime 与 CLI；
2. 一个 Host-plane Cordis package，消费 Harness 已有 `ctx.subagents`、`ctx.llm`、`ctx.settings`，并注册一个 narrow model-facing tool；
3. 一个可复制的 agent preset bundle，将该 tool 和 Legion persona 暴露给 primary model；
4. 配置存于 `legion` settings namespace，composition 只承载 deployment base；
5. Adapter compatibility suite 直接验证正式 Harness seams，而不是镜像它们的内部类型。

不建议 MVP 公开 command/event control protocol，也不建议先做任意第三方 strategy ecosystem。二者都扩大长期兼容面，Depth 不足以抵消状态机与供应链成本。

---

## 2. 设计语言与判断标准

本文使用 deep-module 术语：

- **Module**：拥有一个 Interface 与一套 Implementation 的整体；
- **Interface**：调用者正确使用 Module 所需知道的全部事实，包括类型、约束、顺序、错误与性能；
- **Seam**：Interface 所在、可替换行为而无需编辑调用者的位置；
- **Adapter**：在某个 Seam 上满足 Interface 的具体实现；
- **Depth**：每单位 Interface 可驱动多少行为；
- **Leverage**：调用者从 Depth 获得的能力复用；
- **Locality**：知识、变化、错误和验证是否集中；
- **删除测试**：若删除 dsh-legion，模型选择、角色装配、调度、预算、恢复与汇总复杂度是否重新散落到多个 caller。若会，则该 Module 正在创造价值。

核心目标不是把 Harness 每个方法重新包装一遍，而是形成一个 deep Module：primary model 只描述 mission，其余复杂性留在 Implementation。

---

## 3. 正式 Harness patterns 的只读检查

本节仅依据 `Q:\repos\deepseek-harness` 的正式源码、package metadata、preset composition 与 subsystem docs。

### 3.1 Cordis package pattern

正式 package 采用公开 ESM npm package：`type: module`、`main`/`types`、显式 `exports`、受限 `files`、MIT、`publishConfig.access: public`，Harness/Cordis packages 多放在 `peerDependencies`；例如：

- `packages/subagent/subagent/package.json`
- `packages/workflow/workflow/package.json`
- `packages/settings/settings/package.json`

插件源码通常导出：

```ts
export const name = "legion"
export const inject = ["subagents", "llm", "settings"]
export const Config = z.object({ /* ... */ })

export function apply(ctx: Context, config: Config): void {
  // Fiber-owned registrations and disposers.
}
```

正式 pattern 强调：注册应由当前 Cordis fiber 持有，provider/adapter registration 返回 disposer；HMR 或 fiber disposal 后不留下副作用。需要的 service 用 `inject` 声明，真正 optional 的 service 用 `ctx.get(...)`。

### 3.2 Host plane 与 agent preset plane

`apps/cli/config/agent-presets/standard/agent.cordis.yml` 明确区分：

- **Host plane**：process-wide registries、persistence、sandbox/approval、model route、subagent provider registry；
- **agent preset plane**：model-facing tools、persona、prompt sections，以及只被该 preset 内部读取的 isolated service；
- preset 中发布 service 必须位于带 `isolate` realm 的 group，否则会发布到 root realm，造成不同 preset 冲突或错误共享；
- `ctx.subagents` 是 Host singleton，provider name 只能注册一次；preset 只选择向所属 agent 暴露哪些 delegation tools；
- `workflowEngine` 没有 named-provider registry，当前 context 只有一个 engine，且标准 preset 把它放进 entry-local isolate realm。

因此 dsh-legion 的共享运行 registry、settings registration 和任何跨 session 状态应属于 Host composition；primary model 所见 tool/persona 应属于 Legion preset。若引入只被该 preset 内部消费的 Legion service，必须放在 `isolate` realm；MVP 最好避免额外 preset-local service，保持 composition 简单。

### 3.3 Preset pattern

`packages/preset/agent-presets/README.md` 定义：

- preset 是包含 `agent.cordis.yml` 的目录，可选 `preset.yml` 只放 display metadata；
- roster 将每个 preset 每 process 挂载一次，session 通过 scope parent chain 加入；resolution 顺序是 `agent → preset → global`；
- child agent 通过 `composeFrom()` 加入 parent 当前 generation，不重新 mount 最新文件；
- user authoring 是 **copy-only**，正式 shipped preset 不应被修改；
- bare package specifier 从 Host composition base 解析，relative path 从 preset directory 解析，因此外部 npm package 可以直接出现在用户 preset row 中；
- 已产出内容的 session 不能切换 preset；preset selection 是 session 起始/空白阶段的 composition 决策。

这意味着 role 不应被实现成“一个运行中 session 随时切换 preset”。MVP 应把 role 解析为**创建 child 时固定的 preset + model + persona/tool policy**；需要另一 role 时创建另一个 child。

建议分发一个 template preset，而不是安装器直接改 shipped preset：

```text
presets/
  legion-primary/
    agent.cordis.yml
    preset.yml
```

用户将其复制到 Harness 的 user preset root，或通过官方 copy flow 从一个已存在 preset 创建后添加 Legion rows。

### 3.4 Subagent pattern

`docs/subsystems/subagent.md` 与 `packages/subagent/tool-subagent/src/index.ts` 展示的正式 Seam 是 `ctx.subagents`：

- 一个 named-provider registry，可同时存在 `spawn`、`fork`、`acp`、`codex`、`claude-code`、`dsh-sdk` 等 Adapter；
- `SubagentProvider.capabilities` 在 start 前 fail loud，不能接受后静默忽略；
- `SubagentStartRequest` 已支持 `agentOptions.provider/model`、`persona`、`toolFilter`、`maxDepth` 和 object-rooted structured output schema；
- one-shot run 是 holder-owned，caller 必须 `dispose()`；child failure 通常作为非 completed stop reason 返回；
- continuable child 使用稳定 Session identity、FIFO inbox、`followup()`、`interrupt()` 和 cold resume；provider 仅贡献 initial creation spec，continuation manager 持有后续 lifecycle；
- provider registration 是 effect-scoped；移除 provider 阻止新 start，但不撤销已返回 run；
- model-facing `dsh-tool-subagent` 会跟随 provider lifecycle 动态注册/移除 tool，并在最早可知的位置拒绝不支持的 capability。

因此 Legion 不应发明第二套 child lifecycle。其 DSH Adapter 应直接组合 `ctx.subagents.start()` / `startContinuable()`，并严格遵守 disposal、cancellation、authority 与 capability contracts。

### 3.5 Workflow pattern

`docs/subsystems/workflow.md` 定义 `ctx.workflowEngine.start(request)`：

- 每 context 一个 engine，而非 named-provider registry；
- workflow 的 `meta` 与 `args` 是 plain JSON data，并在执行 script 前校验；
- `parent` 必填，cwd、lineage、depth 继续通过 subagent Seam；
- live `WorkflowRun.result` 不 reject，错误通过 closed stop reason 表示；caller 可 cancel 且必须 dispose；
- cancellation/disposal 有 bounded settlement；
- `workflow/*` events 是 observe-only data snapshots，不泄露 live handle；listener failure 被 contained；
- worker-thread Implementation 有 total-agent ceilings，script hooks 对 misuse fail loud。

MVP 可以在 Implementation 内生成 workflow script 作为性能优化，但不应把“模型编写任意 JavaScript”设为 dsh-legion 的外部 Interface。`MissionSpec → ExecutionPlan` 能在调用前验证，兼容 CLI/CI，并避免将 worker protocol 变成项目自己的长期承诺。

### 3.6 Settings extension pattern

`docs/subsystems/settings.md` 与 `packages/llm/llm-pi-ai/src/index.ts` 展示：

- settings document 按 lowercase kebab-case namespace 分区；
- resolved value 的优先级是 schema defaults → composition `base` → user section；
- `ctx.settings.register()` 是 fiber-owned，重复 namespace fail loud；
- schema 之外的 cross-field constraints 由 `validate` 在写入前拒绝；
- snapshot deep-frozen；watch callback 串行、按 commit order；
- `update` 是 sparse merge，`replace` 是 reset/reinherit，wire surface 应使用 redaction 与 revision-aware mutation；
- `applies: live | restart` 只是效果提示；真正 live owner 必须 watch；
- `llm-pi-ai` 使用 `installSettingsSection(...)` 让 Cordis config 成为 base、settings 成为 user layer，并以 atomic registration replacement 保持 last-known-good routes。

Legion 应注册单个 `legion` namespace，并把 secrets 留在 Harness credentials/env references，而非保存 raw API keys。配置变更应构造 immutable snapshot；正在运行的 mission 固定 snapshot，下一次 mission 才采用新配置，避免一次 run 中途换 model/role 语义。

### 3.7 LLM multi-model pattern

`packages/llm/llm/README.md` 定义 `ctx.llm` 为 provider Adapter registry：

- provider route 由 Adapter 独占注册；model identity 属于 Adapter，可动态解析；
- `listProviders/listModels/resolveModelInfo` 用于 discovery 与 capability matching，不是 routing whitelist；
- `prepareCall()` 固定 exact adapter registration 和 immutable retry policy；
- `llm/adapters-updated` 后 consumer 应重新读取目录；
- `llm-pi-ai` 可从 settings 动态增加多个 provider routes，并对 route replacement 做原子切换。

因此 Legion config 应保存 `{ provider, model }`，不能只保存含糊的 model string；validate/plan 时需通过 Harness discovery 做 capability checks。primary model 也是一个明确的 route/model binding，而不是硬编码成某厂商。

---

## 4. 共同领域模型

```ts
export type ModelRef = {
  provider: string
  model: string
  reasoningEffort?: string
}

export type RoleSpec = {
  preset: string
  model: ModelRef
  replicas?: number
  persona?: string
  toolPolicy?: {
    allow?: string[]
    deny?: string[]
  }
}

export type MissionSpec = {
  version: 1
  objective: string
  topology: "supervisor" | "panel" | "pipeline"
  primaryRole: string
  roles: Record<string, RoleSpec>
  stages?: Array<{
    id: string
    roles: string[]
    dependsOn?: string[]
    completion?: "all" | "first-success" | "primary-judges"
    outputSchema?: Record<string, unknown>
  }>
  limits: {
    maxParallel: number
    maxAgents: number
    maxRounds: number
  }
}
```

关键不变量：

1. `primaryRole` 必须引用一个存在的 role；
2. role 在 child 创建时解析并冻结，运行中不切 preset；
3. 每个 role 的 provider/model/preset 必须在当前 Harness installation 可解析；
4. replicas、DAG 与 limits 必须在开始任何 child 前校验；
5. runtime hard limits 优先于 prompt 建议；
6. child output 与 final result 必须是 lossless JSON data 或显式 artifact reference；
7. 所有 run 都有 cancellation，并保证已发布 one-shot run 最终 dispose；
8. failed/partial output 不伪装成 success；
9. provenance 至少包含 Legion version、MissionSpec digest、resolved preset/model、run IDs 与 stop reasons。

---

## 5. 方案 A：声明式 Mission Module

### 5.1 外部 Interface

```ts
export interface Legion {
  validate(spec: MissionSpec): Promise<ValidationResult>
  plan(spec: MissionSpec): Promise<ExecutionPlan>
  run(spec: MissionSpec, options?: RunOptions): Promise<MissionResult>
}

export type ValidationResult =
  | { ok: true; resolved: ResolvedMission }
  | { ok: false; diagnostics: Diagnostic[] }

export type MissionResult = {
  status: "completed" | "blocked" | "failed" | "cancelled"
  answer?: string
  outputs: Record<string, unknown[]>
  artifacts: ArtifactRef[]
  diagnostics: Diagnostic[]
  provenance: Provenance
}
```

CLI 保持相同 Interface：

```bash
pnpm dsh-legion validate legion.yaml
pnpm dsh-legion plan legion.yaml
pnpm dsh-legion run legion.yaml
```

配置示例：

```yaml
version: 1
objective: Audit the repository architecture and propose an executable migration plan.
topology: panel
primaryRole: chief
roles:
  chief:
    preset: legion-primary
    model:
      provider: deepseek
      model: deepseek-reasoner
  architecture-reviewer:
    preset: review-readonly
    replicas: 2
    model:
      provider: anthropic
      model: claude-sonnet-4-5
  test-reviewer:
    preset: review-readonly
    model:
      provider: openai
      model: gpt-5.2
limits:
  maxParallel: 3
  maxAgents: 5
  maxRounds: 4
```

### 5.2 Seam 与 Implementation

外部 Seam 是 `MissionSpec → ExecutionPlan/MissionResult`。Implementation 隐藏：

- settings/base/user layering；
- provider/model/preset resolution；
- capability matching；
- role prompt 构造；
- topology expansion 与 DAG validation；
- subagent provider selection；
- foreground/continuable lifecycle；
- concurrency、agent/round limits；
- structured output capture；
- retry、partial failure、primary judgment；
- cancellation、dispose 与 provenance。

内部 Harness Adapter 不应镜像整个 Harness，而应表达 Legion 所需语义：

```ts
export interface LegionHarnessAdapter {
  resolve(spec: MissionSpec): Promise<ResolvedMission>
  execute(plan: ExecutionPlan, signal: AbortSignal): Promise<ExecutionOutcome>
}
```

Adapter 的两个真实 Implementation 才使 Seam 成立：

- `DeepSeekHarnessAdapter`：组合正式 `ctx.subagents`、`ctx.llm`、preset roster 与 optional workflow engine；
- `InMemoryHarnessAdapter`：确定性 fake，用于 compiler/runtime contract tests。

### 5.3 评价

- **Depth：高。** 三个操作覆盖配置校验、解释与完整执行；调用者无需学习 child handle、events、disposal 或 Cordis scopes。
- **Leverage：高且均衡。** 同一个 spec 可被 CLI、CI、model tool、tests 与 future UI 使用。
- **Locality：高。** role resolution、limits、failure policy 和 topology knowledge 集中于 compiler/runtime。
- **兼容性：强。** Harness 变化主要由 Adapter 与 schema migration 吸收；spec 可版本化、diff、锁定与复现。
- **可测试性：最佳。** `validate`/compiler 可做 pure/golden tests；runtime 穿过 InMemory Adapter；真实 DSH Adapter 运行 conformance suite。

主要风险是 MissionSpec 膨胀成 Implementation 的序列化。约束：一个新字段若不能服务至少两个 topology，就留在 private topology options，不能进入 top-level Interface。

---

## 6. 方案 B：会话式 Legion Control Protocol

### 6.1 外部 Interface

```ts
export interface Legion {
  open(options: SessionOptions): Promise<LegionSession>
}

export interface LegionSession {
  dispatch(command: LegionCommand): Promise<CommandReceipt>
  events(): AsyncIterable<LegionEvent>
  snapshot(): Promise<LegionSnapshot>
  close(reason?: string): Promise<LegionOutcome>
}

export type LegionCommand =
  | { type: "recruit"; role: string; count?: number }
  | { type: "assign"; agents: AgentSelector; objective: string }
  | { type: "consult"; agents: AgentSelector; question: string }
  | { type: "decide"; proposalIds: string[]; rule: "primary" | "vote" }
  | { type: "interrupt"; agents: AgentSelector }
  | { type: "release"; agents: AgentSelector }
```

使用示例：

```ts
const session = await legion.open({ primaryRole: "chief" })
await session.dispatch({ type: "recruit", role: "reviewer", count: 3 })
await session.dispatch({
  type: "assign",
  agents: { role: "reviewer" },
  objective: "Find independent architecture risks"
})

for await (const event of session.events()) {
  if (event.type === "proposal-ready") {
    await session.dispatch({
      type: "decide",
      proposalIds: [event.proposalId],
      rule: "primary"
    })
  }
}
```

### 6.2 Seam 与 Implementation

Seam 位于 stable command/event protocol。Implementation 隐藏 logical agent 与 Harness child Session 的映射、mailbox、ordering、backpressure、resume、context distribution 与 event normalization。

### 6.3 评价

- **Depth：中等。** 命令数不多，但 caller 必须理解状态机、事件顺序、幂等性、断线与 close semantics。
- **Leverage：对探索性、动态任务最高。** primary 可以根据中间结果临时招募、改派或追问。
- **Locality：中等偏低。** lifecycle mechanics 集中，但 orchestration policy 容易散落到每个 caller 的 event loop。
- **兼容性：中等。** 与 Harness continuable subagent 很贴合，却把 ordering/reconnect/replay 变成 dsh-legion 的永久兼容承诺。
- **可测试性：中等。** 需要 transcript replay、property tests 和故障注入；state space 明显大于方案 A。

该设计适合后续 advanced SDK，但不适合 MVP 的 YAML/CLI/installability 目标。

---

## 7. 方案 C：Strategy Package Module

### 7.1 外部 Interface

```ts
export type StrategyRef =
  | "supervisor-review"
  | "independent-panel"
  | "research-synthesize"
  | { package: string; export?: string }

export interface Legion {
  execute(
    strategy: StrategyRef,
    input: LegionInput,
    overrides?: ConfigOverrides
  ): Promise<LegionOutcome>
}
```

使用示例：

```ts
const outcome = await legion.execute(
  "independent-panel",
  {
    objective: "Review the proposed architecture",
    resources: [{ type: "workspace", path: "." }]
  },
  {
    panelSize: 4,
    judgeRole: "chief-architect"
  }
)
```

### 7.2 Seam 与 Implementation

Seam 位于 `strategy + input → outcome`。每个 strategy 是满足统一 Interface 的 Adapter，把高层协作模式转换为内部 execution primitives。

### 7.3 评价

- **Depth：标准场景最高。** caller 只选“协作学说”。
- **Leverage：重复场景极高，非标准场景骤降。** 用户可能必须发布新 package 才能表达一个任务。
- **Locality：单个 strategy 内高，生态整体低。** 配置、错误和版本治理会分散到多个 package。
- **兼容性：core 强，ecosystem 弱。** 第三方 strategy contract、package discovery、permissions 与 supply-chain trust 都变成产品职责。
- **可测试性：core 很好，生态不均。** 可提供 conformance suite，但无法保证第三方模型行为与配置质量。

MVP 可在 Implementation 内使用 private strategy functions，但根据“一种 Adapter 只是 hypothetical Seam；两种独立实现才是真 Seam”的原则，不应提前公开第三方 strategy Interface。

---

## 8. 横向比较

| 维度 | A：Mission Module | B：Control Protocol | C：Strategy Package |
|---|---|---|---|
| 外部 Interface | Declarative spec | Command/event session | Strategy + input |
| Seam 位置 | Mission 与 execution 之间 | Caller control loop 与 child runtime 之间 | Use case 与 collaboration strategy 之间 |
| Depth | 高 | 中等 | 标准场景最高 |
| Leverage | 广泛、均衡 | 动态任务最高 | 重复场景最高 |
| Locality | 高 | 中等偏低 | Package 内高、生态层低 |
| Harness 兼容性 | 强，Adapter 可吸收变化 | 较直接但耦合事件语义 | Core 强、插件治理复杂 |
| Preset 兼容性 | 创建时解析并冻结，契合正式 pattern | 动态 recruit 可行，但不能热切已有 child preset | 取决于每个 strategy |
| 配置友好度 | 最佳，适合 YAML/settings/CLI | 较差，通常还需脚本层 | 好，但 schema 易碎片化 |
| 动态适应性 | 中等；可由 topology 内部实现 | 最佳 | 取决于 strategy |
| 可测试性 | 最佳 | 最难 | Core 好、生态不均 |
| MVP 成本 | 中 | 高 | 低到中，但后续治理高 |
| 长期兼容负担 | Schema evolution | State machine + replay | Plugin contract + supply chain |

删除测试结果：

- 删除方案 A，复杂度会重新散落到每个 caller，Module 有真实 Depth；
- 删除方案 B，部分状态机会回到 caller，但方案 B 本身也要求 caller 学习大量状态，Depth 较弱；
- 删除方案 C，标准 strategy 的复杂度回到 caller，但每个新场景都可能产生一个 package，Locality 在生态层下降。

---

## 9. 推荐 MVP architecture

### 9.1 Public Module

只承诺：

```ts
validate(spec)
plan(spec)
run(spec, options)
```

Model-facing tool 进一步收窄为一个操作，避免 SOTA primary model 学习 compiler internals：

```ts
legion_run({
  objective,
  topology,
  roles,
  limits
})
```

`plan` 与 `validate` 主要给 CLI、tests 和 configuration UI；model tool 的 execute 内先 validate/plan，失败时返回 structured diagnostics。

### 9.2 Internal Modules

```text
packages/
  core/                 # Mission Interface, schema, diagnostics
  compiler/             # MissionSpec -> immutable ExecutionPlan
  runtime/              # limits, cancellation, aggregation, provenance
  adapter-dsh/          # Cordis Host package over official Harness seams
  tool-legion/          # narrow model-facing tool
  cli/                  # validate, plan, run
presets/
  legion-primary/       # copyable agent preset template
```

内部 Seam：

```text
MissionSpec
   |
   v
Compiler ----> ExecutionPlan ----> Runtime
                                  |
                                  v
                      LegionHarnessAdapter
                       /                  \
          DeepSeekHarnessAdapter    InMemoryAdapter
```

### 9.3 Harness composition placement

Host composition 安装共享 packages：

```yaml
- id: legion-runtime
  name: "@dsh-legion/adapter-dsh"
  config:
    settingsNamespace: legion

- id: legion-tool
  name: "@dsh-legion/tool-legion"
```

实际 MVP 若 tool registration 是 scope-layered，应将 `tool-legion` row 放入 preset，而 `adapter-dsh` 留在 Host；不要让 preset 重复注册 process singleton。

Legion primary preset 示例：

```yaml
- id: persona
  name: "@deepseek-ai/dsh-persona"
  config:
    text: >-
      You are the primary coordinator. Delegate through legion_run and judge
      structured evidence before producing a final answer.

- id: tool-legion
  name: "@dsh-legion/tool-legion"
```

若 `tool-legion` 只消费 Host registry 并提供 no service，则无需 isolate。若未来 preset 内新增 `legionRuntime` service，必须放进 `cordis:group` 的 `isolate` realm，或更好地移回 Host plane。

### 9.4 Settings

```yaml
legion:
  primary:
    provider: deepseek
    model: deepseek-reasoner
  roles:
    architecture-reviewer:
      preset: review-readonly
      model:
        provider: anthropic
        model: claude-sonnet-4-5
    implementation-reviewer:
      preset: code
      model:
        provider: openai
        model: gpt-5.2
  defaults:
    maxParallel: 4
    maxAgents: 8
    maxRounds: 4
```

语义：

- Cordis `config` 是 deployment base；
- `legion:` user section 覆盖允许编辑的字段；
- cross-field checks 在 write 前 fail loud；
- credentials 只引用 Harness credentials/env，不进入 Legion document；
- config watch 产生新的 immutable catalog snapshot；active mission 保持原 snapshot；
- `replace({})` 回到 composition base/schema defaults。

### 9.5 MVP topologies

1. **`supervisor`**：primary 生成任务分解，roles 并行/串行执行，primary 依据 structured outputs 裁决；
2. **`panel`**：多个不同 model/role 独立作答，primary 做 synthesis，减少 correlated failure；
3. **`pipeline`**：stage DAG 传递显式 structured artifact，适合 research → design → review。

Implementation 可以直接启动 one-shot subagents；当任务需要 follow-up 才使用 continuable children。大量独立 stage 可选择 workflow engine，但该选择不泄露进 public Interface。

### 9.6 Failure semantics

- validation errors：任何 child 开始前返回 `invalid-spec` diagnostics；
- unsupported provider/model/preset/capability：fail loud，不降级到默认；
- child non-completed：记录 partial output，但不能作为 successful evidence；
- primary failure：保留 role outputs，overall 为 `failed`，允许 caller 决定重跑；
- cancellation：停止新 admission，interrupt/cancel active work，dispose 所有 holder-owned runs；
- config changed：不影响 active mission；
- provider removed：已返回 run 继续 holder-owned，新 start 失败；
- budget exceeded：runtime hard-stop，不靠 prompt 自律；
- observer/logging failure：不得改变 mission result，除非 durable provenance 是明确的 required policy。

---

## 10. 可测试性方案

### 10.1 Interface tests

所有主要测试穿过 public Interface：

```ts
const result = await legion.run(spec, { signal })
expect(result.status).toBe("completed")
expect(result.provenance.missionDigest).toBeDefined()
```

避免测试越过 Interface 直接操纵 scheduler internals；需要内部 seam tests 时保持其 private。

### 10.2 Test pyramid

1. **Schema/property tests**：invalid DAG、unknown role、limits、duplicate stage、JSON ownership；
2. **Compiler golden tests**：同一 spec 产生稳定 plan/digest；
3. **Runtime state tests**：InMemory Adapter 注入 delay、partial failure、cancellation、provider removal；
4. **Topology contract tests**：三个 topology 对相同 fixtures 的 admission、aggregation、stop semantics；
5. **DSH Adapter conformance**：真实 `ctx.subagents` 验证 publication、stop reason、dispose、continuable FIFO、capability rejection；
6. **Composition tests**：Host/preset 分层、无 root-realm service leakage、fiber disposal/HMR 后无残留；
7. **Settings tests**：base/user layering、cross-field rejection、last-known-good snapshot、revision conflict、secret redaction；
8. **Package install smoke**：从 packed tarball 安装，不依赖 monorepo `workspace:` resolution；
9. **Preset smoke**：复制 template preset 后新 session 能发现 tool，child 固定加入预期 preset generation。

### 10.3 Compatibility matrix

```text
Harness version × provider Adapter × subagent mode × topology
```

MVP 至少覆盖：

- current supported Harness release；
- spawn one-shot；
- spawn continuable；
- one remote/product provider where available；
- settings absent 与 settings present；
- workflow engine absent 与 present。

`workflowEngine` 不应是 MVP hard dependency；这使 Legion 在 minimal Host composition 上仍可使用 direct subagent scheduling。

---

## 11. 兼容与发布策略

1. `MissionSpec.version` 从 1 开始，读取旧版本可 migrate，未知未来版本 fail loud；
2. `peerDependencies` 声明支持的 `@deepseek-ai/dsh-*` 与 Cordis ranges，不复制 Harness types；
3. 发布 tarball 只包含 build outputs、schemas、preset templates 与 license；
4. CLI 提供 `doctor`/`validate`，只读检查 provider/model/preset/tool availability；
5. 不自动编辑 shipped preset；安装说明采用 copy/edit user preset；
6. Adapter 只依赖正式 exported package entries，不依赖 `src/*` 或 private fields；
7. 记录 resolved identities 与 package versions，避免同名 preset/model 的语义漂移不可诊断；
8. 第三方 topology/strategy Seam 延后，直到至少存在两个独立、真实的外部 Adapter 需求。

---

## 12. 主要风险与缓解

| 风险 | 缓解 |
|---|---|
| MissionSpec 膨胀，Module 变浅 | 新字段需跨至少两个 topology；特殊行为留在 private Implementation |
| Adapter 只是逐项转发 Harness | Adapter 表达 `resolve/execute` 的 Legion semantics，不镜像 tool names |
| Primary 成为 token/cost bottleneck | 分层 structured summary、artifact refs、context caps |
| 多模型能力不等价 | `resolveModelInfo` + capability matching；unsupported fail loud |
| Preset 同名但语义漂移 | validate 时解析 path/trust/generation，provenance 记录 digest/version |
| 运行中配置变化造成 split-brain | mission-start immutable snapshot；change 仅影响下一 run |
| One-shot run 泄漏 | holder-owned cleanup registry + finally/dispose contract tests |
| 多 agent 成本或权限失控 | runtime hard ceilings、preset allowlist、toolPolicy、cancellation |
| Prompt injection 跨 role 扩散 | structured outputs、role-specific read/write presets、primary treats reports as untrusted evidence |
| Fake tests 与真实 Harness 偏差 | DSH Adapter conformance suite 与 packed-install integration tests |
| 过早插件生态 | MVP 内建 strategies；暂不开放 arbitrary package loading |

---

## 13. MVP 验收标准

- npm tarball 可在 Harness 外部安装，不要求修改 Harness repository；
- 用户可通过 user preset 暴露一个 `legion_run` tool；
- settings 可配置至少三个 role，分别绑定不同 `{provider, model}` 与 preset；
- `panel` 可并行运行至少两个不同 model，并由 primary 结构化汇总；
- `pipeline` 可传递 object-rooted structured stage output；
- invalid model/preset/capability 在启动 child 前 fail loud；
- cancellation 后所有已发布 one-shot runs 均 dispose；
- active run 不受 settings hot update 影响，下一 run 使用新 snapshot；
- result 包含 status、role outputs、diagnostics 与 provenance；
- InMemory Adapter test suite 与真实 DSH Adapter conformance tests 均通过；
- 安装器或文档不会修改 shipped presets，只指导复制/编辑 user preset。

---

## 14. Source map

主要依据如下：

- Cordis/preset composition：`apps/cli/config/agent-presets/standard/agent.cordis.yml`
- Preset roster 与 authoring：`packages/preset/agent-presets/README.md`
- Preset package metadata：`packages/preset/agent-presets/package.json`
- Subagent contracts：`docs/subsystems/subagent.md`
- Subagent model-facing consumer：`packages/subagent/tool-subagent/src/index.ts`
- Subagent package metadata：`packages/subagent/subagent/package.json`
- Multiple product provider composition：`examples/acp-agent/product-subagent-both.cordis.yml`
- Workflow contracts：`docs/subsystems/workflow.md`
- Workflow package metadata：`packages/workflow/workflow/package.json`
- Settings contracts：`docs/subsystems/settings.md`
- Dynamic multi-provider settings implementation：`packages/llm/llm-pi-ai/src/index.ts`
- LLM Adapter registry：`packages/llm/llm/README.md`
- Multi-provider config behavior：`packages/llm/llm-pi-ai/README.md`

以上 paths 均相对于 `Q:\repos\deepseek-harness`，检查过程为只读。
