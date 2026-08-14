# OMO + Senpi 对 dsh-legion 的灵感与避坑路线

> 审计基线：
>
> - dsh-legion `62e1257ce76f7274811c68ce3651a619dd170083`
> - oh-my-openagent `038ed0cbbefe2b40677b63867aeea0d16bc303e0`
> - Senpi `779c065d3e784168f2bf277112e2351f9d0d1424`
> - DeepSeek Harness `47f943859bef60e4160492346772ded9b24f765a`
>
> Senpi 官方将自身标为 experimental、in-flight、面向单一 AI assistant 需求的 pi-mono fork；本文把它当作运行时工程案例和失败样本，不把其 API 当作 Legion 兼容目标。[Senpi README](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/README.md#L9-L22)

## 1. 核心判断

OMO、Senpi 和 DSH 分别提供三种不同价值：

| 参考 | 最值得借鉴的层 | Legion 不应复制的层 |
|---|---|---|
| **OMO** | semantic category、model-chain resolution、role contract、config layering、doctor、plan/execute/review product policy | OpenCode hook 堆叠、固定神话角色、硬编码模型榜单、无限自治、edition compatibility baggage |
| **Senpi core** | extension-first、纯 policy compiler、用户 override precedence、fallback failure taxonomy、model-aware surface arbitration、stale-generation guards、严谨 QA/release discipline | AgentSession、model registry、provider/auth、compaction、permission engine、TUI、extension event bus |
| **OMO Senpi task** | status/residency 分离、plain-data spawn spec、epoch、exactly-once notification、lease/CAS、tombstone TTL、chaos invariants | task manager、child runner、RPC process、mailbox、team runtime、task persistence |
| **DSH** | Legion 真实宿主：subagent/workflow/goal/session/preset/skills/security/UI/telemetry | 不需要另一个 parallel runtime |

因此最正确的方向不是“把 OMO 和 Senpi 移植到 DSH”，而是：

> **借 OMO 的 control-plane product ideas，借 Senpi 的 runtime invariants 和 failure lessons，用 DSH 原生 seams 实现一个更小、更可解释、更有边界的 delegation policy module。**

当前单 `legion` tool Interface 应保留。下一步应加深其背后的 compiler/resolver/diagnostics，而不是扩张成第二个 agent OS。

## 2. 从 OMO 继续吸收什么

### 2.1 Semantic request 与 model implementation 解耦

OMO 最重要的抽象仍是 category，而不是角色名：主模型根据任务语义选择 `quick/deep/writing/...`，runtime 再把 category 解析成 exact route。它没有独立代码 classifier；选择 category 和 Legion 选择 profile 一样，主要是 orchestrator LLM 行为。真正领先的是**选名后的 model-chain resolver**。

Legion 应保留：

```text
semantic profile selected by coordinator
  -> deterministic candidate resolution
  -> exact DSH provider/model/backend plan
```

而不是让模型直接指定 provider/model。

### 2.2 Configurable fallback，而非内置排行榜

OMO 展示了 user override、category default、user fallback、built-in chain、system default 等来源，但默认模型榜单快速漂移，并且 OpenCode/Senpi 的 spawn/retry 语义并不统一。

Legion 应吸收：

- ordered candidates；
- explicit override precedence；
- attempted/rejected candidate diagnostics；
- selected source与fallback index；
- frozen chain；
- per-candidate reasoning/output bounds。

Legion 不应吸收：

- 当前 OMO 模型名称和优先级；
- fuzzy match explicit user route；
- 多 edition 各自维护一份相似 chain；
- spawn 与 retry 使用不同 resolver。

### 2.3 Role 是 contract，不是品牌

Prometheus/Atlas/Metis/Momus/Oracle 证明了 planner、executor、gap analysis、independent review 各自解决真实问题。应迁移职责和 artifact handoff，而不是名字：

```text
planner:      produces bounded plan artifact
executor:     executes against plan digest
reviewer:     checks concrete artifact/test evidence
repair:       one bounded revision cycle
```

### 2.4 Effective config 是产品能力

复杂 orchestration 只有 schema 不够。需要回答：

- 哪些 layer参与？
- 每个 leaf 来自哪里？
- 哪个默认被 materialize？
- 哪个字段被 normalization？
- 哪个 route因何不可用？
- doctor 验证了文件、mount，还是 live capability？

Legion 应建立一份 single compiled view，供 runtime、prompt、tool schema、doctor 和未来 UI 共同消费。

### 2.5 Skills 与 result contract 属于 profile

OMO 的 category/agent 不只是模型别名，还组合 skills、prompt、tools 和结果期望。Legion 最应优先补的不是 Team Mode，而是：

- per-profile skills；
- versioned `outputSchema` aliases；
- prompt fragments；
- capability requirements；
- findings/review/evidence result contracts。

## 3. 从 Senpi core 吸收什么

### 3.1 Extension-first，但保持单一 owner

Senpi 尽量把功能做成 ordered builtin extensions，并记录每个不可由 extension 完成的 core change；这是长期 fork maintenance 的自救机制。[Fork strategy](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/README.md#L262-L280)

Legion 的对应原则：

- 优先 Cordis plugin/service/event；
- 只在 DSH 缺少真实 seam 时提出最小 upstream extension；
- 每项能力只允许一个状态 owner；
- registration order 不应成为隐藏 correctness dependency；
- HMR/reload 后旧 generation 必须失效。

Senpi 后来为 stale ExtensionContext 增加显式 invalidation 和 throwing guard；这说明“Fiber dispose 了”不等于所有异步闭包自动安全。Legion 的异步 resolver、probe、admission lease 都必须携带 generation/AbortSignal，并在 commit 前重验。

### 3.2 纯 section prompt compiler

Senpi dynamic prompt 把 identity、intent、exploration、parallelism、verification、tool reference、policies、style 和 model tuning 分为纯函数；per-model tuning 是独立轴。[Dynamic prompt contract](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/dynamic-prompt/AGENTS.md#L1-L56)

Legion 可借鉴：

- shared delegation contract 与 model tuning 分离；
- profile persona 与 route tuning 分离；
- pure builder + size budget；
- registered tool fact决定 prompt，不写不存在的工具；
- snapshot test pin section ids/order，而不是脆弱全文。

不要照搬 forced visible intent line；它会把内部 routing scaffold 暴露到用户输出，也不能替代机器可审计 decision record。

### 3.3 Manual override 永远优先

Senpi recommendation/fallback 后续增加了规则：显式 model、手动 model change 和手动 thinking change必须阻止自动恢复覆盖用户选择。Legion 应采用同一优先级：

```text
explicit caller profile/route
> deployment policy
> automatic recommendation
> fallback
```

自动 resolver只能填补 omitted/default，不能静默替换明确选择。

### 3.4 Fallback 需要 failure taxonomy 和状态

Senpi fallback 区分 `transient/refusal/hard-error/billing`，跟踪 tried selectors、cooldown、pinned fallback、primary restoration和事件。[Fallback controller](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/retry-fallback/controller.ts#L16-L55)

可借鉴的纯 policy：

- typed failure causes；
- candidate skip reasons；
- per-operation tried set；
- billing/quota 与 rate-limit/transport 分离；
- `Retry-After`；
- bounded attempts/time；
- cancellation；
- selected/rejected events。

不应照搬到 Legion 的 runtime：

- 修改 parent session model；
- session-owned cooldown timers；
- probe-back scheduler；
- auth storage/rotation；
- primary restoration；
- provider request retry。

Legion 在 v0.2 只借 failure taxonomy 做诊断和**启动前候选解析**，不在 child 已失败后自行重启新 child。否则 DSH provider retry 与 Legion child replay 会形成两个 recovery owner并放大attempt/成本。若未来确需跨 route recovery，应先为 DSH增加统一 recovery seam，让provider retry、route switch、cancellation与attempt/time/token/cost共享一份预算。每次目标route/model变化还必须按目标模型已知context/output limits重新admission；metadata unknown时记录`unknown`，不能假装验证通过或盲目重放。

### 3.5 Native/client tool arbitration 必须有 truth table

Senpi image generation 曾同时涉及 native injector、client tool和skill贡献，最后用23-row truth table保证三者一致。[Arbitration regression](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/extensions/builtin/imagegen/changes.md#L24-L49)

Legion future profile skills/native tools 同样需要：

- one active surface；
- model switch重新评估；
- provider capability、credentials、compat override 一致；
- tool schema/prompt/execute 三者同源；
- mutation test证明 gate失效会红。

### 3.6 Security policy 必须解析真实 action

Senpi permission engine 用 parser-aware bash prefix、file glob、apply_patch body paths，而不是只看tool name。[Permission contract](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/packages/coding-agent/src/core/extensions/builtin/permission-system/AGENTS.md#L38-L72)

DSH 已拥有更合适的 sandbox/approval owner。Legion 应只声明 capability envelope，并保证 project/profile层只能收窄，绝不复制 permission store，也不推荐 wildcard full-access。

### 3.7 Fork/release discipline

Senpi 的 `changes.md`、exact pins、lock/shrinkwrap audits、faux provider、real CLI QA、issue regression目录和 evidence receipts很值得借鉴。[Repository quality gates](https://github.com/code-yeongyu/senpi/blob/779c065d3e784168f2bf277112e2351f9d0d1424/AGENTS.md#L107-L127)

Legion 应增加：

- lockfile/reproducible install；
- packed-install + live tool + harmless dispatch probe；
- Windows CI；
- DSH peer compatibility matrix；
- no-network faux provider tests；
- issue regression目录；
- release SBOM/provenance/tag/tarball consistency。

## 4. 从 OMO Senpi task 吸收的 runtime invariants

这些设计主要用于理解“长期后台系统为什么难”。DSH 已经拥有 child lifecycle，Legion 不应复制 task manager；但未来 admission/provenance层应继承这些不变量。

### 4.1 Task status 与 residency 必须正交

Senpi task 将 logical status（pending/running/completed/error/...）与 residency（resident/persisted_only/rpc_detached/disposed/...）分开。[Task record](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/senpi-task/src/state/types.ts#L1-L39)

Legion implication：不要用一个 `running` boolean同时表达：

- 任务是否终态；
- child是否在内存；
- provider是否仍连接；
- notification是否已送达；
- admission slot是否占用。

但这些轴应尽量读取 DSH native child/Session facts，而不是另存一份副本。

### 4.2 Persist plain data，不 persist live capability

Senpi `SpawnSpecV1` 只保存 cwd/prompt/instructions/tool names，不保存 tool objects、auth、registry或extensions。[Spawn spec](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/senpi-task/src/state/types.ts#L73-L98)

Legion decision record 同样只能保存：

- profile/version/digest；
- exact route ids；
- requirements；
- native child/run ids；
- attempt/outcome/evidence refs。

不得保存 Context、Service、Agent、Session、tool definitions、credentials或closures。

### 4.3 Late terminal 必须幂等且受 epoch约束

Senpi state machine 忽略 terminal之后的late transition并记录audit。[Transitions](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/senpi-task/src/state/transitions.ts#L114-L159)

Legion retry/protocol 若产生多个 child attempt，最终写入必须比较：

```text
operation id + attempt epoch + owner generation
```

旧 attempt晚到只能成为observed stale outcome，不能覆盖当前结果。

### 4.4 Exactly-once notification 需要 durable identity

Senpi 用 `(task_id, run_epoch)`、notified epoch 和失败 epoch去重；mailbox使用reserve→inject→observed→commit。Legion 应复用 DSH settlement notice，不自建通知；若增加route/protocol completion事件，也必须有稳定decision/attempt id并与原生child id关联。

### 4.5 Resume 必须 session-scoped、lease-fenced、fail-closed

Senpi task经历多轮修复后采用：

- parent-session scoped revival；
- reclamation与new admission分离；
- expected-owner CAS；
- renewable lease；
- capacity overflow保持deferred，不标lost；
- exact persisted model/tool重新解析；
- retryable失败rollback到suspended；
- terminal不重跑。[Resume contract](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/senpi-task/AGENTS.md#L86-L100)

Legion 不应实现该链；应验证 DSH提供的subagent/goal/workflow恢复语义。只有在相应`sessionPersistence`、descriptor/projection已挂载且相关flush成功时，才能从明确持久化的有限事实重建bounded diagnostics；否则状态必须是`unknown/unavailable`。Legion不承诺durable decision event、完整attempt恢复或exactly-once额外通知。

### 4.6 TTL删除必须两阶段

Senpi task的scan-then-delete曾面对revival、live owner、undelivered notification和Windows handle竞态，最终采用lock内revalidate+tombstone、lock外清artifacts、crash后补完。[TTL](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/senpi-task/src/lifecycle/ttl.ts#L6-L57)

Legion 若未来有独立cache/decision artifacts，只可删除自己拥有的终态派生数据；不得TTL删除DSH child/session，并应使用同类tombstone模式。

### 4.7 Chaos invariants 值得直接采用

Senpi task seeded chaos bench覆盖200次随机interleaving，并固定：

- exactly-once notification；
- terminal idempotence；
- no slot leak；
- no unhandled rejection；
- every waiter settles；
- cancelled pending never launches；
- suspend/revive ownership、cap、PID与no-terminal-rerun laws。[Chaos bench](https://github.com/code-yeongyu/oh-my-openagent/blob/038ed0cbbefe2b40677b63867aeea0d16bc303e0/packages/senpi-task/src/__adversarial__/chaos-bench.test.ts#L9-L24)

Legion route retry、admission lease和protocol templates也应有seeded property/chaos tests，而不是只有happy-path mocks。

## 5. 重点避坑清单

| Pitfall | OMO/Senpi 已发生的问题 | Legion prevention |
|---|---|---|
| Prompt/hook重复owner | duplicate injection、goal/ulw control message累积 | logical directive id；ephemeral request context；不把control prompt当状态 |
| Admission当成功 | ghost child、zero-message session、doctor“OK”但能力没加载 | admitted/dispatched/observed/verified分开；doctor做live harmless probe |
| Late result覆盖新owner | suspend/fallback/reconcile后旧handle晚到 | operation/attempt/generation CAS；stale outcome只审计 |
| Resume helper无writer | Senpi #808/#854：有reader/test但无生产checkpoint写入 | durability claim必须有writer/read/crash E2E/release version四证 |
| Goal exhaustion loop | Senpi #748：account exhausted被当普通stop，自动续行 | typed terminal provider cause；blocked状态；fresh progress/budget gate |
| Retry重发烧钱 | [Senpi #723](https://github.com/code-yeongyu/senpi/issues/723)：cache controls丢失/移动，5.7×成本 | immutable request digest；稳定cache boundary；全局attempt/cost/deadline cap |
| Provider retry与child replay叠加 | DSH provider retry后Legion再启动新child，会让attempt、side effect与成本相乘 | 单一recovery owner；没有统一DSH recovery seam前，Legion不做失败后自动child replay |
| Stream永久stall | Senpi #683：tool result后无watchdog | first-byte/idle/total deadlines；abort→typed retry；最终terminal事件 |
| Unbounded compaction | Senpi #650：数十次120s summarize，13.5M tokens | total attempts+wall-clock+token budget；start/end event；circuit breaker；DSH owner |
| Fallback分类错误 | billing误归rate-limit导致反复revert/thrash | adapter typed cause；billing/quota pin，transient cooldown，respect Retry-After |
| Empty catalog永久有效 | Senpi #839：第一次fetch失败后`{}`被当健康 | `never_fetched/fresh/stale/fetch_failed/empty_verified`状态；LKG+diagnostic |
| Defaults-before-merge | project omitted field被schema default覆盖global | presence-preserving partial IR；merge authored keys；最后统一defaults |
| Doctor false reassurance | files/schema存在但runtime inventory不可用 | effective config+loaded hash+live tool/model+probe；unknown≠pass |
| Installer partial mutation | settings先写、artifact缺失、scope错误、旧/新路径并存 | preflight→stage→verify→atomic switch→receipt→rollback |
| Stale extension context | reload/session switch后closure继续commit | Fiber/generation invalidation；AbortSignal；commit前assert active |
| Tool surface double exposure | native/client/skill三处gate漂移 | single arbitration seam+truth table+model-switch refresh |
| Permission scope过宽 | Senpi default/full-access与raw wildcard | DSH sandbox/approval唯一owner；profile只能收窄；deny noninteractive ask |
| Recursive watcher失控 | large/home root产生数十万watch导致event-loop starvation | approved root class、bounded traversal、cancellable watch、counts/diagnostics |
| Team rollback伤及无关task | transaction ownership不清导致siblings lost | transaction-owned resource set；不要默认实现Team runtime |
| Mailbox exactly-once错觉 | inject后commit前crash导致duplicate/loss | DSH inbox/settlement唯一owner；不要另建mailbox |
| Transcript冒充事实 | compaction summary/phantom output与Git/todo冲突 | typed receipts/evidence refs；resume重验外部状态 |
| Edition/version漂移 | Senpi pin、adapter、task、generated bundle不同步 | single compatibility lock+capability manifest+packed E2E |
| Fork merge成本 | 大量core change与sync-conflict issues | 不fork DSH；最小upstream seam；compat tests代替vendored core |

## 6. Legion architecture proposal

## v0.2 — Explainable profile compiler

保持现有 model-facing schema不变，先建立package-internal深module：

```ts
interface CompiledCatalog {
  profiles: Record<string, EffectiveProfile>
  diagnostics: Diagnostic[]
  digest: string
}

compile(config: LegionConfig, snapshot: RuntimeSnapshot): CompiledCatalog
```

职责：

- materialize defaults once；
- subagent backend presence + known LLM metadata snapshot；model未列出或metadata缺失记为`unknown`，不等同route unavailable；credential/quota/health不做无根据的preflight；
- cross-field validation；
- stable error codes；
- source/provenance；
- canonical digest；
- 同一结果驱动tool enum、prompt、activation和doctor。

同时加入：

- versioned `result: text | findings-v1 | review-v1`；
- one-shot `outputSchema`；
- bounded profile skill/prompt references；
- canonical path confinement；
- `explain` read-only diagnostics。

## v0.3 — Deterministic route planning（不是失败后 recovery）

```ts
interface RouteCandidate {
  subagentProvider: string
  selection?: {
    provider?: string
    model?: string
    reasoningEffort?: string
    maxTokens?: number
  }
}

interface RoutePolicy {
  candidates: RouteCandidate[]
  unknownMetadata: 'allow-with-warning' | 'reject'
}
```

Rules：

- candidate chain在child start前freeze；
- explicit profile/route优先；
- 验证subagent backend与LLM provider adapter已注册；已知model metadata可用于reasoning/context/output约束，未列出的合法model保持`unknown`而不是假定不可用；
- credential、quota、billing、rate-limit与实时health只能来自运行时typed failure，除非DSH未来提供redacted health seam；
- 在已知metadata下，每次目标route/model变化都重新做context/output admission；context capacity未知时不能声称验证成功；
- preflight只选择一个exact route并启动一次child；child失败后Legion不自动replay，不修改parent session model，也不实现Senpi cooldown/probe/revert runtime。

若未来确需跨route recovery，应先落地统一DSH recovery seam；provider retry、route switch和所有attempt必须共享一份cancellation与attempt/time/token/cost预算。

## v0.4 — Route decision provenance

当前只返回bounded explain diagnostics，不建立attempt ledger：

```ts
interface LegionExplainView {
  version: 1
  profile: string
  policyDigest: string
  selected?: RouteCandidate
  rejected: Array<{ candidate: RouteCandidate; reason: string }>
  diagnostics: Diagnostic[]
}
```

该view是请求时owned snapshot，不承诺durable persistence或exactly-once delivery。只有出现第二个真实consumer或已证实的审计问题后，才考虑DSH SessionEvent/projection/Web decoration；即便如此，也不得复制child status、transcript、usage或完整attempt store。持久重建仅在对应DSH persistence/projection已挂载且flush成功时成立，否则显示`unknown/unavailable`。

## v1.0 — Optional quality protocols

只有benchmark证明有收益后，提供：

```text
delegate
independent-review
research-panel
plan-execute-review
```

实现方式：编译到DSH workflow/subagent/goal；固定members、attempts、deadline、output bytes、cost，使用structured evidence packet。禁止Team mailbox、Senpi task table和自有resume engine。

## Shared admission policy — only when measured need exists

如果真实多session负载证明 provider/model throttling必要，再增加Host-plane `AdmissionPolicy`：

```ts
acquire(routeKey, owner, signal): Promise<Lease>
```

只管理：

- provider/model并发；
- FIFO/fairness；
- Retry-After cooldown；
- cost/time reservation；
- release accounting。

不管理child status、Session、resume、notification或TTL；这些仍属DSH。

## 7. Prevention invariants

1. 一个side effect只有一个durable owner。
2. Admission不是success；必须区分registered/admitted/dispatched/observed/verified。
3. 每个decision/attempt有稳定id、epoch和generation。
4. 配置只经一个presence-preserving compiler。
5. explicit user/deployment choice永远优先。
6. pre-start route candidate plan在operation开始时freeze。
7. typed failure cause，不解析rendered error text；统一recovery seam出现前只用于诊断，不触发Legion replay。
8. cancellation优先且阻止任何新工作。
9. future retry只能由统一DSH recovery owner执行，并要求replaySafe声明和硬预算。
10. 该recovery owner的same-route retry必须保持request/cache digest稳定。
11. unknown capability与false分开。
12. profile/security/project层只能收窄DSH authority。
13. persist plain JSON ids/facts，不persist live objects/credentials/closures。
14. old generation在任何await后commit前重验。
15. started/terminal events必须配对；terminal first-wins。
16. doctor的unknown/unprobed不是pass。
17. optional path不存在不注册；explicit missing path才warning。
18. installer全量preflight后原子switch。
19. analytics与audit provenance分离。
20. DSH native Session/subagent/workflow/goal/security仍是唯一事实源。

## 8. QA strategy inspired by Senpi

### Pure policy tests

- route-chain golden + property tests；
- config layer presence/provenance round trip；
- failure taxonomy truth table；
- tool/prompt/execute arbitration truth table；
- mutation tests证明关键gate反转会红。

### Faux provider/runtime tests

- missing subagent backend / missing LLM provider adapter；
- unlisted model与missing metadata产生`unknown`而非假定invalid；
- quota/billing/rate-limit/overload/transport/refusal/context/max-token作为运行时typed failure fixtures；
- 当前Legion观察失败但不自动replay child；cancel后绝不启动新工作；
- 若未来DSH统一recovery seam落地，再验证Retry-After、fallback exhaustion与same-route byte-identical request/cache digest；
- partial output + dispose failure。

### Chaos tests

Seeded interleavings至少固定：

- one terminal result；
- no slot/lease leak；
- every waiter settles；
- cancelled pending never starts；
- stale generation cannot commit；
- fallback attempt IDs never overwrite；
- all promises observed，无unhandled rejection。

### Packed/compatibility tests

- tarball→profile→preset mount→provider activation→harmless delegation；
- DSH peer min/latest matrix；
- Node engines lower bound；
- Windows + Linux；
- source/Git/tarball install；
- version/capability manifest hash；
- release tag/tarball/SBOM consistency。

### Evidence-driven benchmarks

- single profile vs fallback chain：success/token/latency/cost；
- single reviewer vs bounded independent review；
- profile skill/result contract有效率；
- provider outage与slow-first-byte；
- long-context retry cache cost；
- no real credentials/network in default unit tests。

## 9. Explicit non-roadmap

Legion 不应实现：

- Senpi AgentSession/extension runner/model registry/provider/auth；
- Senpi compaction/permission/TUI/tool middleware；
- OMO/Senpi task store、RPC runner、residency、TTL、reconcile、mailbox、Team；
- DSH Session/subagent/workflow/goal/jobs的替代品；
- 固定神话角色、硬编码模型榜单、forced visible intent line；
- wildcard full-access preset；
- 默认telemetry；
- fork DSH core；
- 无上限autonomy/review/compaction/fallback；
- 未实现但预留在schema里的phantom feature。

## 10. Prioritized next backlog

### Now

1. EffectiveProfile compiler + stable diagnostics/digest。
2. DSH LLM provider adapter presence + known model metadata validation；unlisted/unknown metadata不得冒充unavailable。
3. Versioned child result schemas。
4. Doctor/explain read-only view。
5. Lockfile、Windows CI、DSH peer compatibility matrix。

### Next

6. Explicit candidates + frozen pre-start route plan。
7. Route-specific additive tuning。
8. Bounded explain snapshot（不建attempt ledger）。
9. Packed harmless real delegation E2E。
10. Config migration/rollback contract。

### Later, evidence-gated

11. Unified DSH recovery seam；只有此后才考虑跨route retry/fallback；
12. bounded independent-review/research-panel workflows；
13. Host admission policy；
14. DSH upstream child reasoningEffort/per-child preset seams；
15. decision projection/Web decoration（第二个真实consumer之后）；
16. release signing/SBOM/automated publish。

## 11. Final answer

为了让 dsh-legion 更完善：

- **从 OMO 学 policy/product layer**：semantic profiles、route chain、roles、effective config、doctor、artifact review；
- **从 Senpi 学 engineering discipline**：extension-first、override precedence、typed fallback、stale-generation guards、arbitration truth tables、bounded recovery、QA evidence；
- **从 Senpi task 学 invariants，不学 runtime**：epoch、exactly-once、lease、tombstone、plain-data spec、chaos tests；
- **用 DSH 实现所有底层生命周期**。

最优的 Legion 不是 OMO 或 Senpi 的复制品，而是：

> **一个比 OMO 更可解释、比 Senpi 更少状态、由 DSH 原生生命周期托底的 semantic delegation policy layer。**

## Supporting documents

- [`comparison-senpi-runtime.md`](comparison-senpi-runtime.md)
- [`omo-senpi-pitfalls.md`](omo-senpi-pitfalls.md)
- [`../design/omo-senpi-inspirations.md`](../design/omo-senpi-inspirations.md)
- [`feature-leakage-audit.md`](feature-leakage-audit.md)
