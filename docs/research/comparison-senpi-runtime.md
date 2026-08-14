# Senpi Runtime 深度对照报告

> 研究方式：只读源码；结论固定在下列 Git commit，不以工作区后续变更为准。
>
> - Senpi core：[`779c065d3e784168f2bf277112e2351f9d0d1424`](https://github.com/code-yeongyu/senpi/commit/779c065d3e784168f2bf277112e2351f9d0d1424)
> - Oh My OpenAgent（OMO adapter 与 `senpi-task`）：[`038ed0cbbefe2b40677b63867aeea0d16bc303e0`](https://github.com/code-yeongyu/oh-my-openagent/commit/038ed0cbbefe2b40677b63867aeea0d16bc303e0)
> - DeepSeek Harness（DSH 原生 seams）：[`47f943859bef60e4160492346772ded9b24f765a`](https://github.com/deepseek-ai/deepseek-harness/commit/47f943859bef60e4160492346772ded9b24f765a)

## 结论摘要

Senpi 的核心价值不是某个单点功能，而是一套以 **ownership、generation fencing、fail-closed、用户显式选择优先** 为中心的 runtime discipline。OMO 并未另造 Senpi runtime：`omo-senpi` 是面向 Senpi Extension API 的产品 adapter；`senpi-task` 则是独立的 child-task orchestration runtime，刻意隔离资源、状态与恢复输入。DSH 已经拥有更深、更可组合的 Cordis、system-prompt、approval/sandbox、compaction、retry 与 agent/subagent seams，因此不应复制 Senpi 的大一统 `ExtensionAPI`、内建权限系统或整套 compaction/fallback controller。

最值得 DSH 借鉴的是：

1. 为异步派生物统一引入 generation/owner fence，并测试 stale completion 不得发布；
2. model fallback 后重新做 context admission，且用户手动 model/thinking 选择覆盖自动恢复；
3. speculative compaction 在发布前校验完整 identity/branch anchor，并设有硬上限和 circuit breaker；
4. child runtime 的 persisted state 只存可重建 plain-data facts；extension path、environment、auth与live capabilities不持久化，必要时仅由versioned spawn spec保存prompt/instructions/tool names；
5. adapter 启动时做 capability probe，不兼容就整体禁用，同时隔离单个 component 的注册失败。

## 一、必须区分的三层

| 层 | 所有权与职责 | 不属于它的职责 |
|---|---|---|
| **Senpi core** | AgentSession、Extension API/loader/runner、模型 retry/fallback、动态 system prompt、permission、compaction、session replacement | OMO persona、category/agent roster、task persistence |
| **OMO adapter (`packages/omo-senpi`)** | 将 OMO components 注册到 Senpi；配置、工具、消息注入、fallback-architect、UI/status、安装与打包兼容 | 不拥有底层模型循环、原生 compaction、permission adjudication |
| **`senpi-task`** | 子任务 resolve/spawn/steer/resume/reattach、model chain、child progress/completion、最小 child resource loader、可信重建 | 不是通用 Senpi extension host，也不是 OMO adapter 的简单子模块 |

OMO 安装物也明确反映这一边界：主 extension、task extension、member extension 分别产出，而不是把所有逻辑塞进一个入口（[`plugin-artifacts.ts#L9-L15`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-senpi/src/install/plugin-artifacts.ts#L9-L15)）。

## 二、Senpi core

### 2.1 Extension invariants

- Extension factory 加载时只允许注册；运行期 action 在 host 调用 `bindCore()` 后才成立。把顶层副作用或会话操作放进 factory 会踩生命周期空窗（[`loader.ts#L244-L325`](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/extensions/loader.ts#L244-L325)，[`runner.ts#L460-L555`](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/extensions/runner.ts#L460-L555)）。
- 模块/factory cache 不等于 runtime singleton：每次 load 都重建 runtime 并执行 factory，且以 cwd/generation 隔离（[`loader.ts#L634-L721`](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/extensions/loader.ts#L634-L721)）。
- reload/session replacement 后旧 `pi`、event context、command context 与 listeners 必须失效（[`loader.ts#L252-L301`](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/extensions/loader.ts#L252-L301)）。
- pre-bind provider registrations 以统一 sequence drain，保留调用顺序与 last-registration-wins（[`loader.ts#L248-L347`](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/extensions/loader.ts#L248-L347)）。

**已知坑**：公共 Extension API 面积巨大；loader alias、动态加载顺序和 context 生命周期都属于兼容性 contract，局部“简化”容易造成 duplicate runtime、旧 listener 泄漏或 reload 读到旧源码。

### 2.2 Fallback invariants

- 默认启用 model fallback，默认在 cooldown 到期恢复 primary，并倾向中止 provider 自己选择的 server-side fallback（[`settings.ts#L30-L41`](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/retry-fallback/settings.ts#L30-L41)，[`settings.ts#L86-L95`](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/retry-fallback/settings.ts#L86-L95)）。
- chain 配置是覆盖语义；空数组是删除默认链的 tombstone，不能被 normalization 顺手过滤；malformed 配置回落默认链（[`settings.ts#L59-L83`](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/retry-fallback/settings.ts#L59-L83)）。
- transient error 先耗尽当前 candidate retry budget，再切 fallback；hard error/refusal 不在同模型重放；每个新 candidate 获得新 budget（[`agent-session.ts#L1604-L1635`](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/agent-session.ts#L1604-L1635)，[`agent-session.ts#L5990-L6011`](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/agent-session.ts#L5990-L6011)）。
- refusal/billing fallback 是 pinned；用户手动 model/thinking 修改优先，自动 revert 不得覆盖（[`controller.ts#L102-L175`](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/retry-fallback/controller.ts#L102-L175)）。
- **切换或恢复模型后重新执行 context admission**，因为新模型可能有更小 context window（[`agent-session.ts#L6288-L6305`](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/agent-session.ts#L6288-L6305)）。

### 2.3 Prompt invariants

`buildDynamicSystemPrompt()` 是唯一 assembler，按确定顺序组合 identity、intent、parallel/exploration/verification、tools、policies、style，再追加 tuning、context、skills、workstation、date/cwd（[`build.ts#L61-L113`](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/dynamic-prompt/build.ts#L61-L113)）。输出必须保持单字符串；曾尝试拆块时，installed CLI 会重拼，sentinel 反而泄漏给模型（[`build.ts#L115-L121`](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/dynamic-prompt/build.ts#L115-L121)）。

这里可借鉴的是“单一 assembler 与确定顺序”，不是复制其具体 prompt 内容。DSH 已有更明确的 section/context/variable/tools registry。

### 2.4 Permission invariants

- 规则 last-match-wins；无匹配为 ask，而非 allow（[`evaluate.ts#L14-L27`](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/extensions/builtin/permission-system/evaluate.ts#L14-L27)）。
- 多 pattern 请求整体 fail-closed：任一 deny 即拒绝；否则任一 ask 即 pending；全 allow 才执行（[`service.ts#L30-L79`](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/extensions/builtin/permission-system/service.ts#L30-L79)）。
- 无 UI 模式走 CLI override → static rule → auto-deny，不等待不存在的交互（[`non-interactive.ts#L4-L50`](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/extensions/builtin/permission-system/non-interactive.ts#L4-L50)）。
- approval JSONL line shape 是持久化 contract，修改必须迁移（[`storage.ts#L8-L65`](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/extensions/builtin/permission-system/storage.ts#L8-L65)）。

### 2.5 Compaction invariants

- 触发层次为 speculative、threshold、hard limit；hard limit 纳入 pending prompt 和 output reserve，决策优先 hard-limit → threshold → speculative（[`policy.ts#L97-L130`](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/extensions/builtin/compaction/policy.ts#L97-L130)，[`index.ts#L790-L835`](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/extensions/builtin/compaction/index.ts#L790-L835)）。
- speculative summary 发布前验证 generation、完整 model identity、branch/warm anchor；claim 在第一个 `await` 前 detach（[`index.ts#L309-L376`](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/extensions/builtin/compaction/index.ts#L309-L376)）。
- provider-native lane 拥有 context 时，Senpi 的 reduction/emergency prune 必须退让，避免破坏 resident SDK continuity（[`index.ts#L794-L863`](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/extensions/builtin/compaction/index.ts#L794-L863)）。
- compaction 后修复 tool call/result pairing（[`repair-tool-pairs.ts#L19-L65`](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/extensions/builtin/compaction/repair-tool-pairs.ts#L19-L65)）。
- runaway protection：每 session 最多 10 次 accepted compaction；连续 3 次失败熔断（[`per-turn-cap.ts#L3-L32`](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/extensions/builtin/compaction/per-turn-cap.ts#L3-L32)，[`circuit-breaker.ts#L4-L57`](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/extensions/builtin/compaction/circuit-breaker.ts#L4-L57)）。

## 三、OMO adapter (`omo-senpi`)

### 3.1 它做什么

Adapter 在启动时探测 Senpi API 的最小 capability set；不兼容则记录 warning 并整体禁用，不半启用。随后先安装共享 tool capture registry 与 idle injection coordinator，再逐 component 注册；单 component 异常被隔离，不击穿其余组件（[`compose.ts#L10-L18`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-senpi/src/extension/compose.ts#L10-L18)，[`compose.ts#L53-L120`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-senpi/src/extension/compose.ts#L53-L120)）。

它采用一个 200ms injection batch window，将同窗口完成通知合并成一次 steer（[`compose.ts#L86-L96`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-senpi/src/extension/compose.ts#L86-L96)）。这类 batch arbiter 值得借鉴，但必须由 session/fiber owner 清理 timer；裸 `setTimeout` 若缺 lifecycle disposal 会留下 stale injection 风险。

### 3.2 Fallback-architect 的边界

OMO 只消费 Senpi 的 `model_select`/fallback 事实，并注入 OMO 专属 hidden directive、visible notice 与 reminder；它不拥有底层 fallback controller。仅 refusal-driven fallback 激活，恢复 Fable、手动切换或 Senpi `fallback-revert` 时清状态（[`index.ts#L64-L99`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-senpi/src/components/fallback-architect/index.ts#L64-L99)）。Directive 将高阶推理委托到 `architect` category（[`directive.ts#L14-L31`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-senpi/src/components/fallback-architect/directive.ts#L14-L31)）。

**可借鉴**：fallback 是 typed runtime event，adapter 只做产品策略与 UX。**不宜照搬**：把供应商/模型 persona、规避 refusal 的措辞写死在通用 runtime；这应留在产品 preset/agent policy，且需安全审查。

### 3.3 Adapter 已知坑

- Bundle 在 plain Node + jiti 下加载；Bun-only module APIs 在模块顶层会让整个 extension 启动失败，因此有专门静态审计（[`extension-node-runtime-audit.test.ts#L5-L37`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-senpi/src/extension-node-runtime-audit.test.ts#L5-L37)）。
- 单文件 bundle 需约束 external imports、体积和 runtime dependency resolution；不要假设开发 monorepo 的 hoisting 在安装环境存在（[`bundle-purity.test.ts#L39-L42`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-senpi/src/bundle-purity.test.ts#L39-L42)，[`runtime-dependency-resolution.test.ts#L20-L64`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-senpi/src/runtime-dependency-resolution.test.ts#L20-L64)）。
- extension-origin input 必须与 interactive user input 区分，避免把自身注入再次解释为用户触发，形成递归 loop（例如 [`ulw-loop/index.ts#L213`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/omo-senpi/src/components/ulw-loop/index.ts#L213)）。

## 四、`senpi-task`

### 4.1 独立 child runtime，而非 adapter 内部 helper

`senpi-task` 同时支持 process/RPC 与 in-process child。Process child 使用 `--no-extensions` 后只显式加载可信 extension entries；父级 extensions 可以继承，但 task spec 显式值优先（[`runners/types.ts#L20-L32`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/senpi-task/src/runners/types.ts#L20-L32)，[`rpc-process.ts#L17-L25`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/senpi-task/src/runners/rpc-process.ts#L17-L25)）。In-process child 使用 minimal resource loader，明确返回空 extensions/skills/prompts/themes/agents/system prompt，防止递归发现 parent/project resources（[`minimal-resource-loader.ts#L11-L48`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/senpi-task/src/senpi/minimal-resource-loader.ts#L11-L48)）。

这是最重要的隔离 invariant：**child 的能力必须由 orchestrator 明确重建，不能靠 cwd discovery 偶然继承。**

### 4.2 Model chain 与 fallback

Agent/category resolver 将 requested 与 resolved model 分开，并保留 ordered fallback records；per-entry tuning 优先于 agent default，使不同 rung 可使用不同 effort（[`resolve-agent.ts#L89-L182`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/senpi-task/src/agents/resolve-agent.ts#L89-L182)，[`agent-model-entry.ts#L15`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/senpi-task/src/agents/agent-model-entry.ts#L15)）。Runtime fallback 事件更新 active model 与 fallback count，terminal completion 只报告一次 requested→resolved fallback（[`progress.ts#L52-L74`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/senpi-task/src/progress.ts#L52-L74)，[`completion/notification.ts#L133-L137`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/senpi-task/src/completion/notification.ts#L133-L137)）。Context overflow 被明确视为 non-fallback terminal condition（[`in-process-access-terminated-error.test.ts#L33-L45`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/senpi-task/src/runners/in-process-access-terminated-error.test.ts#L33-L45)）。

### 4.3 Prompt、resume 与 persistence invariants

- 某些 agent 使用 canonical prompt contract；例如 plan-review 会替换 caller prompt，而不是拼接含混指令（[`interaction-policy.ts#L4-L21`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/senpi-task/src/agents/interaction-policy.ts#L4-L21)）。
- Resume child 不重放原始 prompt；下一条 follow-up 开启新 tracked turn（[`in-process-resume.test.ts#L171-L189`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/senpi-task/src/runners/in-process-resume.test.ts#L171-L189)）。
- 持久化解析将 legacy `extensions` 与 `member_env` 当作 untrusted launch inputs并丢弃；`createTaskRecord`也不会把任意 runtime `prompt/messages` extras自动复制进record。与此同时，明确版本化的 `SpawnSpecV1`会有意保存plain-data `prompt/instructions/member_scoped_tool_names`，用于没有transcript时的单次重建。边界是“只持久化可审计plain data”，不是“绝不持久化prompt”（[`store/security.test.ts#L206-L224`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/senpi-task/src/store/security.test.ts#L206-L224)，[`store/security.test.ts#L300-L317`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/senpi-task/src/store/security.test.ts#L300-L317)，[`types.ts#L82-L98`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/senpi-task/src/state/types.ts#L82-L98)）。
- fallback handoff 销毁旧 resident 时保留 manager ownership metadata，防止 handoff 被误判为任务终结（[`lifecycle/destroy.ts#L27-L31`](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/senpi-task/src/lifecycle/destroy.ts#L27-L31)）。

## 五、DSH 原生 seams：已有，不应复制

### 5.1 Extension/runtime lifecycle

DSH 的 Cordis composition/fiber 已经把 service、event、tool、prompt section 和 effect 置于作用域生命周期；dynamic Cordis 还提供 immutable Package、run/update/rollback、approval 与 diagnostics。不要移植 Senpi 的大一统 `ExtensionAPI`、jiti loader、`bindCore()` stubs 或手写 listener generation cleanup。应在既有 Cordis fiber 上补 owner/generation 测试与领域事件。

相关原生实现：Cordis dynamic tool lifecycle（[`tool-cordis/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/extensions/tool-cordis/src/index.ts)），fiber state（[`fiber-state.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/extensions/tool-cordis/src/fiber-state.ts)）。

### 5.2 Prompt

DSH 已有 `SystemPrompt` registry：有序 sections、scope shadowing、dynamic context、variables、tool schemas、assemble waterfall、complete prompt 与 strict interpolation（[`system-prompt/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/core/system-prompt/src/index.ts)）。因此不要复制 Senpi 的 hard-coded monolithic assembler；只需保证一个事实只有一个 owner、顺序确定、runtime context append-only、工具可见性与执行 restriction 一致。

### 5.3 Permission/sandbox

DSH 已有 channel-neutral approval seam，缺 answerer 或 responder 失败时 fail-closed；决定只在有效 agent turn 内成立，并写成成对 audit records（[`user-approval/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/interaction/user-approval/src/index.ts)）。工具 pre-execute gate 与 sandbox escalation 已接入该 seam；sandbox policy/local/Windows ACL 也各自分层。不要复制 Senpi 的 extension-local permission service、默认 `full-access` preset 或 JSONL always-allow store。若未来需要 remembered grant，应作为 DSH approval/sandbox 独立能力与审计 schema 设计，而不是藏进工具扩展。

### 5.4 Compaction

DSH 已拆为 definition seam、basic backend、tool-result pruner、command consumer（[`compaction/README.md`](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/compaction/README.md)）。基本 compaction 还有 standalone bracket 与 prompt admission 测试（[`manual-compaction.spec.ts#L239-L341`](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/compaction/compaction-basic/tests/manual-compaction.spec.ts#L239-L341)），tool-result pruner 以 shadow-price event 保留历史解释性（[`compaction-tool-result-pruner/src/index.ts#L128-L162`](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/compaction/compaction-tool-result-pruner/src/index.ts#L128-L162)）。不要复制 Senpi 整个 builtin compaction extension；应选择性补充 speculative summary fencing、absolute cap/circuit breaker 与 provider-owned-context arbitration。

### 5.5 Retry/fallback 与 agent orchestration

DSH 已有 LLM retry policy/plugin（[`llm-retry/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/llm/llm-retry/src/index.ts)）和 agent-loop turn ownership（[`agent-loop/src/agent.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/core/agent-loop/src/agent.ts)），以及独立 subagent registry/UI。不要把 Senpi model fallback、OMO fallback-architect、`senpi-task` manager 合并成一个 DSH 插件。推荐把 model-chain selection、retry classification、model-switch event、subagent residency 分成可组合 seams，并让产品 preset 订阅 typed events。

## 六、建议迁移矩阵

| Senpi/OMO 机制 | DSH 决策 | 理由 |
|---|---|---|
| stale generation/owner fencing | **借鉴并普遍化** | 与 Cordis fiber 互补；异步完成仍需发布前 fence |
| fallback 后 context re-admission | **借鉴** | model context window/能力可能变化 |
| user model/thinking override wins | **借鉴** | 避免自动 policy 覆盖显式意图 |
| candidate 独立 retry budget、typed fallback reason/event | **借鉴** | 解耦 retry 与 product UX |
| speculative compaction identity/anchor 校验 | **借鉴** | 防止陈旧摘要污染新 branch/model |
| compaction hard cap + circuit breaker | **借鉴** | 限制 runaway 成本与循环 |
| child minimal resource loader | **借鉴语义，不照搬实现** | DSH 用 agent preset/tool restriction/composition ownership 实现 |
| persisted task state仅保留versioned plain-data rebuild facts，丢弃live capabilities/env/extensions | **强烈借鉴** | 能力与隐私边界清晰 |
| OMO capability probe + component failure isolation | **借鉴** | adapter 面对 host API 演进时安全降级 |
| Senpi 巨型 ExtensionAPI/jiti loader | **不复制** | DSH Cordis registry/fiber 已更深、更可组合 |
| Senpi permission preset/JSONL always allow | **不复制** | DSH approval + sandbox 已分层且 fail-closed |
| Senpi monolithic prompt assembler | **不复制** | DSH SystemPrompt registry 已拥有排序、scope、tools、waterfall |
| Senpi full compaction controller | **不复制** | DSH compaction capability family 已存在 |
| OMO 模型专属 fallback prompt | **仅放产品 preset** | 不应污染通用 runtime，且含 safety/policy 风险 |
| `senpi-task` 整体 manager | **不复制** | DSH subagent registry 已存在；只补缺失的 residency/fallback facts |

## 七、固定风险清单

1. **Extension cache ≠ runtime ownership**：缓存 factory 不能让 session-scoped state 变 singleton。
2. **Reload stale work**：timer、promise continuation、compaction result、notification 都可能跨 generation 注入。
3. **Fallback 后 context 不再适配**：仅切 model 而不重新 admission 会在较小窗口立即失败。
4. **双重 fallback**：provider server-side fallback 与 host fallback 同时启用会造成不可解释路由。
5. **配置 tombstone 被 normalization 吃掉**：空 chain 的删除语义容易丢失。
6. **Prompt transport 改写**：分块/sentinel 方案必须在 installed transport 验证，不可只测内存 assembler。
7. **Permission rule ordering**：last-match-wins 时 source merge order 就是安全边界；新 preset 若不先 reset wildcard，会继承意外 allow。
8. **Compaction stale publication**：只校验 model id 不够，需 provider、variant/thinking、branch、anchor、generation。
9. **Tool pair corruption**：摘要/修剪后必须维持 tool-call/result pairing。
10. **Child resource recursion**：child 自动发现 parent/project extensions 会重复注册 provider/tool，甚至递归启动 orchestration。
11. **恢复重放 prompt**：reattach/resume 若重放初始 prompt，会重复副作用。
12. **持久化能力输入**：extension path、env、auth和live definitions不得从task record恢复；必要prompt只能进入versioned plain-data rebuild spec，并受no-rerun规则约束。
13. **开发 monorepo 假象**：hoisting、Bun API、TypeScript loader 在发布后的 plain Node 环境可能不存在。
14. **extension-origin loop**：自身注入必须带 source，并被 trigger detector 排除。

## 八、建议的 DSH 最小落地顺序

1. 先盘点 `agent-loop`、`llm-retry`、`compaction-basic`、subagent registry 的 owner/generation 字段与 stale-publication tests。
2. 定义 typed `model/fallback-applied`、`model/fallback-reverted`（或等价）事件，只承载事实；产品 prompt/notice 由 preset consumer 拥有。
3. 在 model switch 成功与 revert 后统一调用 context admission seam，并明确 user override fencing。
4. 为 compaction 加完整 identity/branch anchor fence、accepted absolute cap 和 consecutive-failure breaker；保留 DSH 现有 bracket/event vocabulary。
5. 为 subagent persisted record 明确“事实白名单”，禁止恢复 prompt、environment、extension/tool definitions；reattach 从 host registry/preset 重建能力。
6. 增加 installed-artifact/plain-Node tests，覆盖 bundle external、module resolution、无开发 hoisting 与生命周期 disposal。

最终判断：**借鉴 Senpi 的 runtime invariants，复用 DSH 的 native seams；借鉴 OMO 的 adapter 边界，不复制其产品 prompt；借鉴 `senpi-task` 的 child isolation 与 persistence discipline，不复制整个 task runtime。**
