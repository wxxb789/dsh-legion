# dsh-legion：面向 DeepSeek Harness 的多智能体团队与模型路由

[English](README.md) · **简体中文**

[![CI](https://github.com/wxxb789/dsh-legion/actions/workflows/ci.yml/badge.svg)](https://github.com/wxxb789/dsh-legion/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%5E22.19.0%20%7C%20%3E%3D24.0.0-339933?logo=node.js&logoColor=white)](package.json)

**dsh-legion** 是一个使用 TypeScript 开发的 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness)多智能体编排插件。它为 DSH 提供可配置的 AI Agent Profile、精确模型路由、声明式 Team 与 Strategy、结构化结果，以及有边界的 Subagent 委派能力，同时不会取代 DSH 自身的运行时。

你可以让一个 DSH Agent 只面对 `quick`、`deep`、`review` 这类语义清晰的委派接口；每个选择背后的模型、后端、工具、Persona、限制和输出契约，则由部署者统一控制。

> **重要：** Legion 是 DSH 插件，不是独立的智能体框架或应用。Agent、Session、模型适配器、Subagent 运行时、沙箱、审批机制和 Web GUI 均由兼容版本的 DeepSeek Harness 提供。

## 目录

- [这个项目有什么用？](#这个项目有什么用)
- [主要能力](#主要能力)
- [工作原理](#工作原理)
- [安装](#安装)
- [创建 Legion Agent Preset](#创建-legion-agent-preset)
- [升级](#升级)
- [卸载](#卸载)
- [使用方式](#使用方式)
- [配置参考](#配置参考)
- [Doctor 与 Explain](#doctor-与-explain)
- [状态与限制](#状态与限制)
- [常见问题](#常见问题)

## 这个项目有什么用？

当一个 AI Coding Agent 需要按照明确、可复用的策略，把不同类型的工作委派给不同子智能体时，Legion 会很有用。

- **按任务类型路由。** 将提取、格式化和摘要交给快速模型，将架构设计、复杂调试交给能力更强的模型。
- **执行独立审查。** 为 Reviewer 配置只读工具、独立 Persona，以及结构化的 `review-v1` 结果。
- **构建多智能体流程。** 定义有边界的 Team，以及计划/执行/审查、研究 Fanout 等声明式 Strategy。
- **限制工作量与风险。** 限制深度、并发数、参与者、截止时间、输出大小、工具和可用路由。这些边界能够约束部分成本驱动因素，但 Legion 不提供总 Token 或费用准入上限。
- **统一委派语义。** 即使底层模型或 Subagent 后端发生变化，也能继续使用稳定的 Profile 名称。
- **运行前验证策略。** 使用显式 Provider 能力 Fixture 检查配置并解释最终生效的 Profile。
- **无需 Fork 即可扩展。** 通过 Catalog Layer 添加、替换、禁用或恢复 Profile、Team 和 Strategy。

Legion 面向已经使用 DSH、希望获得可配置多智能体委派能力，但不希望再引入另一套 Scheduler、Session Store 或 Agent Runtime 的开发者与部署者。

## 主要能力

| 能力 | 说明 |
|---|---|
| 语义化 Profile | 使用 `quick`、`deep`、`review` 等命名策略，而不是在每次 Prompt 中选择原始模型。 |
| 精确模型路由 | 每个 Profile 最多配置 8 个有序 Provider/Model 候选，并支持静态上下文和输出预算约束。 |
| 多种 Subagent 后端 | 每个 Profile 可使用 `spawn`、`fork`、`codex`、`claude-code` 或其他 DSH Provider。 |
| 工具与 Persona 策略 | 限制子智能体工具、添加专属指令、控制深度及前台/后台默认行为。 |
| 结构化结果 | 支持版本化的 `text`、`findings-v1` 和 `review-v1` 前台结果契约。 |
| 自定义 Team | 声明引用现有 Profile 的有边界 Member Slot。 |
| 声明式 Strategy | 将类型化 Artifact Graph 编译为冻结的 DSH 委派原语。 |
| 硬性执行限制 | 限制每次 Team Run 的 Agent 数、并发数、截止时间和可接受输出大小。 |
| Catalog 自定义 | 分层添加、替换、禁用和恢复用户或第三方条目。 |
| Prompt Fragment | 从部署者控制的 Root 加载受约束、不可变的 UTF-8 Prompt 资源。 |
| 可解释策略 | 提供稳定 Digest、确定性诊断、路由证据和 JSON Explain 输出。 |
| 原生 DSH 生命周期 | Continuation、取消、结算通知、Provider 生命周期和 HMR 注册仍由 DSH 管理。 |

## 工作原理

~~~text
Catalog Layers
  ├─ Profiles   -> 模型路由、后端、Persona、工具、结果契约
  ├─ Teams      -> 引用 Profile 的有边界 Member Slot
  └─ Strategies -> 类型化 Artifact Graph + 硬性限制
                         │
                         ▼
                冻结的 DSH Primitive IR
                         │
                         ▼
                  原生 DSH Subagent
~~~

一个典型的模型侧 Profile 调用很简单：

~~~json
{
  "profile": "quick",
  "description": "summarize findings",
  "prompt": "Summarize the investigation and preserve source paths.",
  "run_in_background": true
}
~~~

协调 Agent 只选择语义化 Profile；Prompt 无法改变该 Profile 背后由部署者控制的模型、工具、Persona、深度或结果策略。

Legion 不接管 Agent Loop、Session、持久化、模型适配器、凭据、沙箱、审批、Subagent Registry 或 Web GUI。它只使用 DSH 的公开 `ctx.subagents`、`ctx.tools` 和 `ctx.systemPrompt` 接口，从而确保运行时和生命周期只有一个所有者。

## 安装

### 前置条件

- 已安装兼容版本的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。
- `pnpm` 已加入 `PATH`；`dsh plugin` 会将包管理操作转发给 pnpm。
- 一个用于安装插件的 DSH Host Profile，例如默认的 `web`。
- 已配置至少一个 DSH Subagent Provider，以及 Legion Profile 所引用的 LLM Provider 和 Model。
- 本地开发需要 Node.js `^22.19.0 || >=24.0.0` 和 pnpm `11.21.0`。

### 从 GitHub 安装

将不可变的 Commit SHA 安装到 `web` Profile：

~~~bash
dsh plugin --profile web add github:wxxb789/dsh-legion#<commit-sha>
~~~

如果插件应安装到其他 DSH Host Profile，请替换 `web`。当前尚未发布 Release Tag，因此请使用 Commit SHA，而不是会移动的分支。将来 [GitHub Releases](https://github.com/wxxb789/dsh-legion/releases) 出现正式版本后，对应 Tag 也可作为不可变的安装版本。

Git 依赖会执行 Legion 的 `prepare` 构建。pnpm 10+ 可能会拒绝第一次安装，并要求显式允许构建。请把 pnpm 输出的**完整 Key**加入 `$DSH_HOME/profiles/web/pnpm-workspace.yaml`，然后重新执行安装：

~~~yaml
allowBuilds:
  dsh-legion: true
~~~

如果 pnpm 输出的是带来源限定的 Key，请原样使用，不要替换为短名称。

### 从本地源码安装

~~~bash
git clone https://github.com/wxxb789/dsh-legion.git
cd dsh-legion
pnpm install --frozen-lockfile
pnpm run build
dsh plugin --profile web add .
~~~

本地 Checkout 必须先生成 `lib/` 构建产物。Legion 的 Bundle Patch 有意保持为空：安装操作只让用户自定义 Agent Preset 能够解析 `dsh-legion`，不会向整个进程自动注入模型工具。

## 创建 Legion Agent Preset

只安装 Package 还不够；还需要由 Agent Preset 加载 Legion。

### 推荐方式：扩展现有 Preset

1. 打开 DSH Web GUI。
2. 将 DSH 自带的 `standard` Preset 复制为用户自有的 `legion` Preset。
3. 把[示例 Fragment](examples/legion.agent.cordis.fragment.yml)中的 Legion 配置行追加到副本。
4. 根据实际部署调整 Provider 名称、Model ID、工具和限制。
5. 使用 `legion` Preset 创建一个**新 Session**。

不要直接修改 DSH 自带的 `standard` Preset。

### 备选方式：复制完整 Preset

将 [presets/legion](presets/legion) 复制到 `$DSH_HOME/.agent-presets/legion`。其中包含一组专注于编码工作的工具，以及 `deep`、`quick`、`review` 示例 Profile。

复制后的 Preset 是一个版本化模板，不会自动继承 DSH 或 Legion 的后续改动。已有内容的 Session 也不能切换已记录的 Preset，因此修改组合后需要创建新 Session。

## 升级

### 升级 GitHub 安装

使用新的精确 Commit SHA 重新执行 Add。正式 Release 发布后，也可以改用较新的已发布 Release Tag：

~~~bash
dsh plugin --profile web add github:wxxb789/dsh-legion#<new-commit-sha>
~~~

对于 Registry 或移动引用安装，DSH 也会转发 pnpm 的 Update 命令：

~~~bash
dsh plugin --profile web update dsh-legion
~~~

升级后请：

1. 阅读 [CHANGELOG.md](CHANGELOG.md)。
2. 将用户自有 Preset 与最新示例进行比较；Legion 不会自动覆盖 Preset。
3. 重启受影响的 DSH 进程；如果 Preset 组合发生变化，请创建新 Session。

### 升级本地源码

~~~bash
cd dsh-legion
git pull --ff-only
pnpm install --frozen-lockfile
pnpm run build
dsh plugin --profile web add .
~~~

## 卸载

需要从所有安装过 Legion 的 DSH Host Profile 中分别卸载：

1. 从用户自有 Agent Preset 中移除或禁用 `name: dsh-legion` 配置行。
2. 删除已安装的 Package：

   ~~~bash
   dsh plugin --profile web remove dsh-legion
   ~~~

3. 如果不再需要，可删除 `$DSH_HOME/.agent-presets/legion` Preset 副本。
4. 重启受影响的 DSH 进程。

删除 Package 不会自动删除用户自有 Preset 或配置。

## 使用方式

### 通过 Profile 委派

协调 Agent 会看到一个 `legion` 工具以及当前可用 Profile 的描述：

~~~json
{
  "profile": "review",
  "description": "review the authentication change",
  "prompt": "Inspect the diff for correctness and security issues. Cite files and lines.",
  "run_in_background": false
}
~~~

如果配置了 `defaultProfile`，调用时可以省略 `profile`。并行的同级调用使用 DSH 原生并行工具执行能力。

### 运行 Strategy

Strategy 默认不会暴露给模型。部署者必须显式设置 `enableStrategies: true`，同一个工具才会接受严格的 Strategy 请求：

~~~json
{
  "kind": "strategy",
  "strategy": "independent-review",
  "objective": "Review the implementation and return evidence-backed findings.",
  "limits": { "deadlineMs": 60000 }
}
~~~

一个请求不能混用 Profile 和 Strategy 字段；调用级限制只能收紧编译后的 Strategy 限制。

## 配置参考

最小 Agent Preset 配置如下：

~~~yaml
- id: tool-legion
  name: dsh-legion
  config:
    configVersion: 2
    toolName: legion
    defaultProfile: quick
    profiles:
      quick:
        description: Fast exploration, extraction, and summaries.
        subagentProvider: spawn
        agentOptions:
          provider: your-llm-provider
          model: your-fast-model
          maxTokens: 8192
        maxDepth: 2
        defaultRunInBackground: true

      review:
        description: Independent correctness and security review.
        subagentProvider: spawn
        agentOptions:
          provider: your-llm-provider
          model: your-review-model
        toolFilter:
          deny: [write, edit]
        maxDepth: 2
        defaultRunInBackground: false
        result: review-v1
~~~

请使用当前部署中真实有效的 Provider 和 Model ID。更多内容参见[完整 Preset Fragment](examples/legion.agent.cordis.fragment.yml)与[独立配置示例](examples/legion.config.yml)。

### 顶层字段

| 字段 | 默认值 | 含义 |
|---|---:|---|
| `configVersion` | `2` | 当前配置契约；旧版 v1 输入会迁移到 v2。 |
| `toolName` | `legion` | 暴露给模型的工具名称。 |
| `profiles` | 必填 | 语义化 Profile Map。 |
| `defaultProfile` | 无 | 调用未指定 `profile` 时使用的 Profile。 |
| `enableRunInBackground` | `true` | 是否暴露后台委派。 |
| `enableStrategies` | `false` | 是否显式向模型暴露生效的 Strategy。 |
| `guidance` | 无 | 追加给协调 Agent 的说明。 |
| `resourceRoots` | `{}` | Prompt Fragment 的部署者相对 Root。 |
| `maxResourceBytes` | `65536` | 每个 Profile 的 Fragment 字节预算，硬上限为 4 MiB。 |
| `catalogLayers` | `[]` | 有序第三方或项目策略层。 |
| `teams` | `{}` | 最终部署层的 Team。 |
| `strategies` | `{}` | 最终部署层的 Strategy。 |

Profile 名称必须匹配 `^[a-z][a-z0-9-]*$`。

### Profile 字段

| 字段 | 默认值 | 含义 |
|---|---:|---|
| `description` | 必填 | 向协调 Agent 展示的任务适用说明。 |
| `subagentProvider` | `spawn` | DSH Subagent 后端，不是 LLM Provider。 |
| `agentOptions` | 继承 | 固定的 `provider`、`model`、`maxTokens`；不能与 `routes` 同时使用。 |
| `routes` | 无 | 最多 8 个有序精确 Route Candidate。 |
| `persona` | 继承 | 子智能体 Persona/System Policy 覆盖。 |
| `toolFilter.allow` / `deny` | 无 | 子智能体工具可见性限制。 |
| `maxDepth` | `3` | 子智能体深度；外部 One-shot 产品可使用 `provider-managed`。 |
| `defaultRunInBackground` | `true` | 默认启动可继续交互的后台子智能体。 |
| `result` | `text` | `text`、`findings-v1` 或 `review-v1`。 |
| `promptFiles` | 无 | 验证后按顺序加载的 Prompt Fragment。 |

对于 `codex` 和 `claude-code`，Model 选择由外部产品管理。通常应设置 `maxDepth: provider-managed` 和 `defaultRunInBackground: false`。

### 精确 Route Candidate

~~~yaml
routes:
  - id: primary
    provider: your-llm-provider
    model: your-deep-model
    maxTokens: 16384
    constraints:
      minContextTokens: 65536
      minEffectiveOutputTokens: 8192
  - id: fast-static
    provider: your-llm-provider
    model: your-fast-model
    constraints:
      minContextTokens: 32768
~~~

在启动子智能体前，Legion 会观察已注册的 DSH Adapter 和精确 Model Metadata，并选择第一个没有已知静态冲突的候选。缺失的 Metadata 会保持为 Unknown 且仍可接受，Legion 不会将信息缺失误报为健康状态。

Legion 最多启动一个子智能体；如果已选子智能体因 Provider、认证、Quota、网络或执行错误而失败，不会自动重试其他 Route。

### Catalog Layer、Team 与 Strategy

Config v2 可以对 Profile、Team、Strategy 进行分层。后出现的同名定义会替换前者；Tombstone 可以禁用条目；更后面的定义可以重新启用它。Root Map 是最终部署层。

~~~yaml
configVersion: 2
teams:
  coding:
    description: One executor and one reviewer.
    members:
      executor: { profile: deep }
      reviewer: { profile: review }
strategies:
  reviewed:
    description: Execute and review.
    team: coding
    stages:
      - kind: delegate
        id: execute
        member: executor
        inputs: [{ artifact: objective, contract: objective-v1 }]
        output: { artifact: execution, contract: text }
        prompt: Execute and return evidence.
      - kind: delegate
        id: review
        member: reviewer
        inputs: [{ artifact: execution, contract: text }]
        output: { artifact: review, contract: review-v1 }
        prompt: Review the evidence independently.
    completion: { artifact: review, contract: review-v1 }
    limits:
      maxAgents: 2
      maxConcurrent: 1
      deadlineMs: 900000
      maxOutputBytes: 524288
    memberFailure: fail
~~~

Legion 会验证 Artifact Graph，并将合法 Stage 降低为分离、深度冻结的 DSH Primitive IR。它是 DSH One-shot Subagent 的适配器，不是持久化 Scheduler。Default Catalog 以普通可替换数据提供 `independent-review`、`research-panel` 和 `plan-execute-review`，但默认不会暴露给模型。

确定性协议 Gate 和独立的真实模型证据要求参见 [benchmarks/README.md](benchmarks/README.md)。

### Prompt Fragment、结构化结果与信任边界

Prompt Fragment 是显式部署资源，不是任意 Workspace 文件读取。Legion 将相对路径限制在配置的 Root 下，并拒绝链接、非法 UTF-8、NUL、缺失文件和超出字节预算的内容。修改资源后需要重新激活 Plugin 或 Preset。

结构化前台结果契约有意保持精简：

- `findings-v1`：摘要、有证据的发现、决策、验证和未解决风险；
- `review-v1`：结论、带严重级别的发现、建议和验证；
- 后台 Continuation 保持文本与 Session 语义。

Preset、Catalog Layer、Plugin Package、Resource Root 和 Prompt Fragment 都属于受信的部署配置。Tool Filter 与路径约束用于受信部署中的策略和完整性控制，**不是**隔离恶意 Preset 或不可信 Plugin 的安全沙箱。参见 [SECURITY.md](SECURITY.md)。

## Doctor 与 Explain

使用**显式 Provider Fixture**验证独立 Legion 配置：

~~~bash
dsh-legion doctor examples/legion.config.yml --providers examples/providers.fixture.yml
dsh-legion explain examples/legion.config.yml --providers examples/providers.fixture.yml --json
~~~

`doctor` 输出紧凑摘要；`explain` 还会输出 Profile、执行模式、Model Route、结果契约和诊断码；`--json` 输出版本化的 `legion-explain` View。

Fixture 只能证明文件中明确提供的静态事实。CLI 不会检查实时 DSH 进程、凭据、网络可达性、Provider 健康、Quota、账单、延迟或真实 Model 可用性。

退出码：`0` 表示没有错误级诊断，`1` 表示存在能力错误，`2` 表示用法、I/O、资源、解析或 Schema 错误。

## 状态与限制

当前源码声明版本为 `1.1.0`，配置契约为 v2。选择或升级安装版本前，请查看 [CHANGELOG.md](CHANGELOG.md)、[Roadmap](docs/roadmap.md) 和 [GitHub Releases](https://github.com/wxxb789/dsh-legion/releases)。

已知限制：

- Curated Strategy 不会自动向模型开放；部署者可显式设置 `enableStrategies: true`。
- 已选择的子智能体失败后，Legion 不会重试或切换模型。
- 进程内子智能体继承父级命名 DSH Agent Preset；Profile 仍可改变 Model、Persona、Tool、Backend 和限制。
- 当前没有 Legion GUI 设置卡片，需要在用户自有 Agent Preset 中配置。
- 不支持在缺少兼容 DSH Peer 的环境中直接运行裸 Package。

## 常见问题

### dsh-legion 是独立的多智能体框架吗？

不是。它是 DeepSeek Harness 的多智能体策略与委派插件，DSH 仍然是运行时和生命周期所有者。

### Legion 会自动选择最便宜或最健康的模型吗？

不会。它只会按照顺序，根据已知静态事实检查 Route。它不声称知道实时健康、价格、认证、Quota 或延迟，也不会在失败后自动重放。

### 可以创建自定义 Profile、Team 和 Strategy 吗？

可以。自定义能力是核心设计。Default Catalog 与用户和第三方条目使用完全相同的公开、可替换契约。

### 为什么 Legion 工具会消失？

只有 Subagent Provider 已注册的 Profile 才会被发布。如果没有可用 Profile，工具和提示会暂时消失，并在 Provider 恢复后重新出现。还应确认 Legion 安装在正确的 DSH Host Profile 中，并且新 Session 使用了包含 Legion 配置行的 Preset。

### 可以直接编辑 DSH 自带的 `standard` Preset 吗？

不建议。请复制为用户自有 Preset 后再修改，避免 DSH 升级覆盖配置。

## 兼容性、开发与发布

Package 要求 Node.js `^22.19.0 || >=24.0.0`，并要求 DSH Peer 版本位于 `>=0.1.0-rc.6 <0.2.0`。CI 覆盖 Windows、Ubuntu、打包后的 DSH Consumer、公开契约、协议 Benchmark 和可复现 Package。

~~~bash
pnpm install --frozen-lockfile
pnpm run check
~~~

参考文档：

- [实现 Roadmap](docs/roadmap.md)
- [公开契约 v1](docs/public-contract-v1.md)
- [Durable Strategy Runs](docs/durable-runs.md)
- [Journal Contract v1](docs/journal-contract-v1.md)
- [Run Replay](docs/run-replay.md)
- [版本化配置与回滚](docs/adr/0008-versioned-config-and-rollback.md)
- [声明式 Team 与 Strategy IR](docs/adr/0010-declarative-team-strategy-ir.md)
- [显式 Strategy 暴露权限](docs/adr/0012-model-strategy-exposure-is-explicit-authority.md)
- [可复现发布](docs/adr/0009-reproducible-provenance-releases.md)
- [全部 ADR](docs/adr)

欢迎通过 [GitHub Issues](https://github.com/wxxb789/dsh-legion/issues) 反馈问题或参与贡献。

## 许可证

[MIT](LICENSE)

## Durable Strategy Run（v1.1，显式启用）

Durable Run 默认关闭，v1.0 ephemeral 行为保持不变。它把八类 typed event 写入调用方 DSH Session journal，并使用 projection key `legion-run`、state version 5。Run control 提供只读且有界的 `inspect`、单次 activation 的 `resume`、持久化后返回的 `cancel`，以及只能提交 validated proposal 的 `steer`。Task delivery 为 at-least-once；只有匹配 fence 与 generation 的逻辑结果能被接受一次，但不承诺 external effect exactly-once。Mail 在 acknowledge 前必须完成 reserve、context incorporation 与必要的 flush，过期 reservation 可 reclaim。

本 package 不提供 DSH persistence、projection、atomic coordination、global admission 或 child-receipt Host service。已发布 DSH 0.1.0-rc.6 尚无 production durable mutation 所需的 projection/coordination service；此时启用 Durable Run 会在 mutation 前以稳定 capability diagnostic fail closed。Pure contract、validation、replay 与 inspect 仍可使用。参见 [Durable Strategy Runs](docs/durable-runs.md) 与 [Journal Contract v1](docs/journal-contract-v1.md)。
