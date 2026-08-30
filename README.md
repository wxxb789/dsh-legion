# dsh-legion: Multi-Agent Orchestration and LLM Model Routing for DeepSeek Harness

**English** · [简体中文](README.zh-cn.md)

<p align="center">
  <a href="https://github.com/wxxb789/dsh-legion"><img src="https://raw.githubusercontent.com/wxxb789/dsh-legion/main/.github/assets/social-preview.png" alt="dsh-legion architecture: a coordinator agent calls one legion tool, which routes to quick, deep, and review Specialists that run as native DeepSeek Harness subagents" width="840"></a>
</p>

[![CI](https://github.com/wxxb789/dsh-legion/actions/workflows/ci.yml/badge.svg)](https://github.com/wxxb789/dsh-legion/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%5E22.19.0%20%7C%20%3E%3D24.0.0-339933?logo=node.js&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![DSH plugin](https://img.shields.io/badge/DeepSeek%20Harness-dsh--plugin-5b4ee5?logo=github&logoColor=white)](https://github.com/topics/dsh-plugin)

**dsh-legion** is a TypeScript multi-agent orchestration plugin for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness). It turns one AI coding agent into a bounded orchestration cohort: configurable AI agent Specialists, an exact LLM model router, declarative Cohorts and Strategies, structured results, and depth-limited subagent delegation — without replacing the DSH runtime.

## TL;DR

- **What it is.** A DeepSeek Harness plugin for multi-agent delegation policy — not a standalone agent framework.
- **What it adds.** One model-facing `legion` tool whose choices are semantic Specialists such as `quick`, `deep`, and `review`. Each Specialist carries a deployment-owned model route, subagent backend, persona, tool filter, depth, and result contract.
- **Why it helps.** The coordinating agent picks intent instead of model IDs, a prompt can never widen the policy behind a Specialist, and changing the model behind `deep` rewrites no prompts.
- **What it costs.** One configuration row in a user-owned agent preset. No extra scheduler, session store, database, or agent runtime.
- **Who it is for.** Developers and deployment owners already running DSH who want reviewable, reusable multi-agent delegation.

> **Important:** Legion is a DSH plugin, not a standalone agent framework or application. DeepSeek Harness supplies the Agent, Session, model adapters, subagent runtime, sandbox, approvals, and Web GUI.

## Quick start

~~~bash
# 1. Install the plugin into a DSH host profile (append #<commit-sha> to pin a revision)
dsh plugin --profile web add github:wxxb789/dsh-legion

# 2. Copy the Legion row into a user-owned agent preset, then start a NEW session
#    template: examples/legion.agent.cordis.fragment.yml

# 3. Validate the routing policy before you depend on it
dsh-legion doctor examples/legion.config.yml --providers examples/providers.fixture.yml
~~~

The coordinator now sees one `legion` tool whose `specialist` values are your semantic delegation choices. Step-by-step instructions are in [Install](#install) and [Set up a Legion agent preset](#set-up-a-legion-agent-preset).

## Contents

- [TL;DR](#tldr)
- [Quick start](#quick-start)
- [What is dsh-legion used for?](#what-is-dsh-legion-used-for)
- [dsh-legion vs standalone multi-agent frameworks](#dsh-legion-vs-standalone-multi-agent-frameworks)
- [Capabilities](#capabilities)
- [How it works](#how-it-works)
  - [Under the hood: from tool call to child agent](#under-the-hood-from-tool-call-to-child-agent)
- [Install](#install)
- [Set up a Legion agent preset](#set-up-a-legion-agent-preset)
- [Upgrade](#upgrade)
- [Uninstall](#uninstall)
- [Usage](#usage)
- [Configuration](#configuration)
- [Doctor and explain](#doctor-and-explain)
- [Status and limitations](#status-and-limitations)
- [FAQ](#faq)
- [Durable Strategy Runs](#durable-strategy-runs-v11-opt-in)
- [Related projects](#related-projects)

## What is dsh-legion used for?

Legion is useful when one AI coding agent should delegate different kinds of work under explicit, reusable policy.

- **Route work by task type.** Send extraction or summaries to a fast model and architecture or debugging to a deeper model.
- **Run independent reviews.** Give a reviewer read-only tools, a separate persona, and a structured `review-v1` result.
- **Build multi-agent workflows.** Define bounded Cohorts and declarative plan/execute/review or research fanout Strategies.
- **Bound workload and risk.** Limit depth, concurrency, participants, deadlines, output size, tools, and eligible routes. These bounds constrain cost drivers, but Legion does not provide aggregate token or monetary-cost admission.
- **Standardize delegation.** Keep semantic Specialist names stable when the underlying model or backend changes.
- **Validate policy before runtime.** Diagnose configuration against explicit provider capability fixtures.
- **Customize without forking.** Add, replace, disable, or revive Specialists, Cohorts, and Strategies through Catalog Layers.

Legion is for developers and deployment owners who already use DSH and want configurable multi-agent delegation without adopting another scheduler, session store, or agent runtime.

## dsh-legion vs standalone multi-agent frameworks

Standalone multi-agent frameworks such as LangGraph, CrewAI, and AutoGen ship their own runtime, state model, and process lifecycle, so adopting one places a second orchestrator beside the coding agent you already run. Legion takes the opposite approach: it adds no runtime at all and compiles delegation policy down to native DSH subagents.

| | dsh-legion | A standalone agent framework |
|---|---|---|
| What you adopt | Delegation policy for an agent you already run | A second runtime, state model, and process lifecycle |
| Who owns the agent loop | DeepSeek Harness | The framework |
| Sessions, sandbox, approvals, model adapters | DSH-owned and unchanged | Framework-owned, parallel to your agent's |
| Model selection | Ordered exact provider/model Route Candidates per Specialist | Usually wired per node or per agent in code |
| Cost to adopt | One configuration row in a user-owned preset | A new dependency tree, service, or process |
| Prompt authority | A prompt selects a Specialist and can never widen that Specialist's model, tools, persona, or depth | Varies by framework |
| Wrong tool when | You do not run DSH | You want one self-contained orchestrator |

If you are not running DeepSeek Harness, Legion is not the right tool, and a standalone framework is the better fit.

## Capabilities

| Capability | What it provides |
|---|---|
| Semantic Specialists | Named policies such as `quick`, `deep`, and `review` instead of raw model choices in every prompt. |
| Exact model routing | Up to eight ordered provider/model candidates with static context and output-budget constraints. |
| Multiple backends | Use `spawn`, `fork`, `codex`, `claude-code`, or another DSH-registered subagent provider per Specialist. |
| Tool and persona policy | Restrict child tools, add Specialist instructions, set depth, and choose foreground/background defaults. |
| Structured results | Versioned `text`, `findings-v1`, and `review-v1` foreground result contracts. |
| Custom Cohorts | Declare bounded Member Slots that reference existing Specialists. |
| Declarative Strategies | Compile typed artifact graphs to frozen DSH delegation primitives. |
| Hard limits | Bound agents, concurrency, deadline, and accepted output size for each Cohort Run. |
| Catalog customization | Layer, replace, disable, and restore user or third-party catalog entries. |
| Prompt Fragments | Load confined, immutable UTF-8 prompt resources from deployment-owned roots. |
| Explainable policy | Stable digests, deterministic diagnostics, route evidence, and JSON explain output. |
| Live reconfiguration | Optional: when the Host mounts a settings provider, edit the same config through the `legion` namespace and republish without a restart. |
| Web settings card | A plugin card on the DSH Settings → Plugins tab, with staged edits and override badges. See [the settings card](docs/settings-card.md). |
| Live Run Receipt | The separately packaged `dsh-legion-receipts` companion shows live per-member Cohort Run facts for the current Session; headless execution keeps the bounded terminal summary. See [Run Receipts](docs/run-receipts.md). |
| ACP delegation | Optional Specialists for Codex, Claude Code, oh-my-pi, Kimi Code, Grok Build, Pi, GitHub Copilot CLI, Hermes, and ZCode over DSH's ACP backend. See [ACP delegation](docs/acp-delegation.md). |
| Native DSH lifecycle | Continuations, cancellation, settlement, providers, and HMR-safe registration remain DSH-owned. |

## How it works

~~~text
Catalog Layers
  ├─ Specialists   -> model routes, backend, persona, tools, result contract
  ├─ Cohorts      -> bounded Member Slots referencing Specialists
  └─ Strategies -> typed artifact graph + hard limits
                         │
                         ▼
                frozen DSH primitive IR
                         │
                         ▼
                 native DSH subagents
~~~

A typical model-facing Specialist call is small:

~~~json
{
  "specialist": "quick",
  "description": "summarize findings",
  "prompt": "Summarize the investigation and preserve source paths.",
  "run_in_background": true
}
~~~

The coordinator chooses a semantic Specialist; the prompt cannot change that Specialist's deployment-owned model, tools, persona, depth, or result policy.

Legion intentionally does **not** own the agent loop, sessions, persistence, model adapters, credentials, sandbox, approvals, subagent registry, or Web GUI. It uses DSH's public `ctx.subagents`, `ctx.tools`, and `ctx.systemPrompt` seams so there is only one runtime and lifecycle owner.

### Under the hood: from tool call to child agent

**Activation**, when DSH mounts the plugin on a Cordis fiber:

1. Legion validates the configuration against a strict schema that rejects unknown fields anywhere in the document.
2. Catalog Layers merge in order: a later layer replaces an earlier entry by name, a tombstone disables an inherited one, and any later definition of that name revives it.
3. Prompt Fragments referenced by Specialists are read once, under a per-Specialist byte budget, and captured as an immutable snapshot with a content digest.
4. Legion observes which subagent backends and which LLM adapters the Host currently has registered.
5. Each Specialist is compiled against that observation and becomes **active** only if its configured backend can actually satisfy the Specialist's policy: execution mode, tool filtering, persona, depth, and structured output.
6. The delegation tool is published with a parameter schema derived from the active Specialists, and a matching routing table is contributed to the system prompt.
7. If no Specialist is active, the tool is withdrawn and the guidance renders empty. The whole sequence reruns whenever backends or adapters change.

**One delegation**, between the coordinator's tool call and the returned result:

8. Arguments are validated and resolved to exactly one Specialist: the one named, or the configured `defaultSpecialist`.
9. If that Specialist declares `routes`, Legion reads each candidate's exact-model metadata and takes the first candidate in your authored order that no static fact contradicts.
10. Only static facts participate, such as context window and output budget. A candidate whose metadata cannot be read stays eligible; the call fails only when every candidate is positively ruled out.
11. Legion starts exactly one child through the Host's subagent API with the Specialist's fixed policy applied, and never retries or switches routes when that child or its provider fails.
12. A background call returns a continuable child id immediately; a foreground call waits, revalidates a structured result against its contract, and rebuilds it as fresh plain data before returning.

Two properties follow from that design and are worth stating plainly. Compiled Cohort and Strategy IR is deep-frozen and detached: it holds no reference to your configuration objects and carries no functions. A compiled Strategy plan is also tracked by object identity in a process-wide registry, so execution accepts only a plan this process compiled — a reconstructed or deserialized copy is rejected even when its contents and digest are identical.

## Install

### Prerequisites

- A compatible [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) installation.
- `pnpm` on `PATH`; `dsh plugin` forwards package operations to pnpm.
- A DSH Host `profile`, such as the default `web` composition.
- A configured DSH subagent provider and the LLM provider/model routes referenced by your Specialists.
- For local development: Node.js `^22.19.0 || >=24.0.0` and pnpm `11.21.0`.

### Install from GitHub

Install the default branch into the `web` Host composition:

~~~bash
dsh plugin --profile web add github:wxxb789/dsh-legion
~~~

Replace `web` if Legion should be available in another DSH Host `profile`.

This resolves `main` **once, at install time**. `dsh plugin` forwards to pnpm, which records the resolved commit in the Host `profile` lockfile, so the installed revision does not follow later pushes until you upgrade explicitly.

#### Pin a revision

A git install runs Legion's `prepare` build on your machine, outside any sandbox the agent runs under. Append an immutable revision whenever the installed code has to stay auditable and reproducible — production Host compositions, shared machines, or a deployment where you review what you allow to build:

~~~bash
dsh plugin --profile web add github:wxxb789/dsh-legion#<commit-sha>
~~~

No release tag is published yet. After a version appears on [GitHub Releases](https://github.com/wxxb789/dsh-legion/releases), that release's tag is an immutable installation spec too.

Git dependencies run Legion's `prepare` build. pnpm 10+ may reject the first install until the package is explicitly allowed. Add the **exact key printed by pnpm** to `$DSH_HOME/profiles/web/pnpm-workspace.yaml`, then repeat the install:

~~~yaml
allowBuilds:
  dsh-legion: true
~~~

If pnpm prints a source-qualified key, use that exact key instead of the short name.

### Install from a local checkout

~~~bash
git clone https://github.com/wxxb789/dsh-legion.git
cd dsh-legion
pnpm install --frozen-lockfile
pnpm run build
dsh plugin --profile web add .
~~~

A local checkout needs both packages' built `lib/` artifacts. The root package installs the exact `dsh-legion-receipts` companion dependency, and the bundle patch mounts two Host-plane rows: `legion-settings` serves the `legion` namespace and Settings card, while `legion-receipts` serves the live Run Receipt feed and Web UI. The two packages are one version-coupled pair; do not override the companion to another version. Missing either Client artifact fails Host activation loudly. Installation still injects no process-global model tool — the delegation tool stays on the agent plane, where a preset asks for it.

## Set up a Legion agent preset

Installing the package is only the first step. Legion must also be loaded by an agent preset.

### Recommended: extend your existing preset

1. Open the DSH Web GUI.
2. Copy the shipped `standard` preset to a user-owned preset named `legion`.
3. Append the Legion row from [the example fragment](examples/legion.agent.cordis.fragment.yml).
4. Adjust provider names, model IDs, tools, and limits for your deployment.
5. Start a **new session** with the `legion` preset.

Do not edit DSH's shipped `standard` preset directly.

### Alternative: copy the bundled preset

Copy [presets/legion](presets/legion) to `$DSH_HOME/.agent-presets/legion`. It contains a focused coding tool set and example `deep`, `quick`, and `review` Specialists.

A copied preset is a versioned template. It does not automatically inherit later DSH or Legion changes. Existing nonblank sessions also cannot change their recorded preset, so start a new session after changing composition.

## Upgrade

### GitHub installation

A branch installation re-resolves to the current `main` commit through pnpm's update command, which DSH forwards. The root update resolves its exact companion dependency with it; do not update the pair independently:

~~~bash
dsh plugin --profile web update dsh-legion
~~~

A pinned installation stays on its recorded revision by design. Move it by adding the new exact revision — a later release tag works the same way:

~~~bash
dsh plugin --profile web add github:wxxb789/dsh-legion#<new-commit-sha>
~~~

After upgrading:

1. Review [CHANGELOG.md](CHANGELOG.md).
2. Compare your user-owned preset with the current example; Legion never overwrites presets automatically.
3. Restart the affected DSH process. If the preset composition changed, start a new session.

### Local checkout

~~~bash
cd dsh-legion
git pull --ff-only
pnpm install --frozen-lockfile
pnpm run build
dsh plugin --profile web add .
~~~

## Uninstall

Remove Legion from every DSH Host `profile` where it was installed:

1. Remove or disable the `name: dsh-legion` row in user-owned agent presets. Removing the root package in the next step removes its exact companion dependency and the bundle layer that contributes both `legion-settings` and `legion-receipts`; a row you copied by hand into a composed `cordis.yml` is yours to remove there.
2. Remove the package:

   ~~~bash
   dsh plugin --profile web remove dsh-legion
   ~~~

3. Optionally delete `$DSH_HOME/.agent-presets/legion` if that copied preset is no longer needed.
4. Restart the affected DSH process.

Package removal does not delete user-owned presets or configuration.

## Usage

### Delegate through a Specialist

The coordinator sees one `legion` tool plus active Specialist descriptions:

~~~json
{
  "specialist": "review",
  "description": "review the authentication change",
  "prompt": "Inspect the diff for correctness and security issues. Cite files and lines.",
  "run_in_background": false
}
~~~

If `defaultSpecialist` is configured, `specialist` may be omitted. Concurrent sibling calls use DSH's normal parallel tool execution.

### Run a Strategy

Strategies are hidden by default. A deployment must explicitly set `enableStrategies: true`. The same tool then accepts a strict Strategy request:

~~~json
{
  "kind": "strategy",
  "strategy": "independent-review",
  "objective": "Review the implementation and return evidence-backed findings.",
  "limits": { "deadlineMs": 60000 }
}
~~~

Specialist and Strategy fields cannot be mixed. Invocation limits may only narrow compiled Strategy limits.

### Observe a Run Receipt

When the Web Host mounts the package bundle, the `dsh-legion-receipts` companion shows the current Session's Cohort Runs in the Run Receipt overlay. It receives a complete baseline before complete replacements, so Client refresh and carrier reconnect recover the same active facts while the parent Session and companion instance remain live.

Full facts are process-local observation state: Session disposal, companion reload, or Host restart starts empty, and browser storage contains presentation preferences only. Remote facts that official DSH seams cannot prove are unavailable rather than zero; known subtotals may therefore have partial coverage. Headless or missing-companion execution still completes and returns the bounded terminal tool summary. See [Run Receipts](docs/run-receipts.md) for operation, state semantics, acceptance evidence, and the manual Web checklist.

## Configuration

A minimal agent-preset row:

~~~yaml
- id: tool-legion
  name: dsh-legion
  config:
    configVersion: 3
    toolName: legion
    defaultSpecialist: quick
    specialists:
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
          allow: [read, glob, grep]
        maxDepth: 2
        defaultRunInBackground: false
        result: review-v1
~~~

Use valid provider and model IDs for your deployment. See the [complete preset fragment](examples/legion.agent.cordis.fragment.yml) and [standalone configuration example](examples/legion.config.yml).

When the Host mounts a settings provider (DSH 0.1.0-rc.7 serves every registered namespace), the `legion` settings namespace is owned by the Host-plane row the bundle patch installs, and it publishes this same schema. The preset row above stays the base layer for its own delegation surface: it applies the stored user section over its own entry, and a commit republishes that tool without restarting DSH. Nothing changes in a composition without a settings provider. See [live reconfiguration](docs/settings.md) and [the settings card](docs/settings-card.md).

To delegate to an external coding agent — Codex, Claude Code, Kimi Code, GitHub Copilot CLI, and others — mount DSH's ACP backend once per agent and append the generated catalog layer. See [ACP delegation](docs/acp-delegation.md) and `examples/legion.acp.fragment.yml`.

### Top-level fields

| Field | Default | Meaning |
|---|---:|---|
| `role` | `delegation` | Composition role of this row, read from the row's own entry and never from the settings layer. A `settings` row registers the `legion` namespace and nothing else — no tool, no prompt section, no projection, no service. |
| `configVersion` | `3` | Canonical current contract. Published 1.x calls that omit an export target still materialize/export v2 until 2.0; legacy v1/v2 keys load with replacement diagnostics and are never rewritten in place. |
| `toolName` | `legion` | Model-facing tool name. |
| `specialists` | required | Semantic Specialist map. |
| `defaultSpecialist` | none | Specialist used when a call omits `specialist`. |
| `enableRunInBackground` | `true` | Expose background delegation. |
| `enableStrategies` | `false` | Explicitly expose active Strategies to the model. |
| `guidance` | none | Extra coordinator guidance. |
| `resourceRoots` | `{}` | Relative deployment roots for Prompt Fragments. |
| `maxResourceBytes` | `65536` | Prompt Fragment bytes per Specialist; hard ceiling 4 MiB. |
| `catalogLayers` | `[]` | Ordered third-party or project policy layers. |
| `cohorts` | `{}` | Final deployment-layer Cohorts. |
| `strategies` | `{}` | Final deployment-layer Strategies. |

Specialist names must match `^[a-z][a-z0-9-]*$`. The package root exports current `Specialist*`, `Cohort*`, `CohortRun*`, Config v3 materializers, diagnostics, and ACP helpers. Published 1.x `Profile*`/`Team*` names remain explicit deprecated compatibility aliases with removal no earlier than 2.0.0.

### Specialist fields

| Field | Default | Meaning |
|---|---:|---|
| `description` | required | Task-fit guidance shown to the coordinator. |
| `subagentProvider` | `spawn` | DSH subagent backend, not an LLM provider. |
| `agentOptions` | inherited | Fixed `provider`, `model`, and `maxTokens`; cannot be combined with `routes`. |
| `routes` | none | Up to eight ordered exact Route Candidates. |
| `persona` | inherited | Child persona/system-policy override. |
| `toolFilter.allow` / `deny` | none | Child tool visibility restriction. |
| `maxDepth` | `3` | Child depth or `provider-managed` for external one-shot products. |
| `defaultRunInBackground` | `true` | Default to a continuable child. |
| `result` | `text` | `text`, `findings-v1`, or `review-v1`. |
| `promptFiles` | none | Ordered Prompt Fragments loaded after validation. |

For `codex` and `claude-code`, model selection belongs to the external product. Normally use `maxDepth: provider-managed` and `defaultRunInBackground: false`.

### Exact Route Candidates

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

Immediately before child start, Legion observes registered DSH adapters and exact-model metadata. It selects the first candidate without a known static contradiction. Missing metadata remains unknown and admissible; Legion never turns absent metadata into a health claim.

Legion starts at most one child and never retries another route after provider, authentication, quota, network, or child failure.

### Catalog Layers, Cohorts, and Strategies

Config v3 layers Specialists, Cohorts, and Strategies. A later definition replaces the same name; a tombstone disables it; a later definition may revive it. Root maps are the final deployment layer.

~~~yaml
configVersion: 3
cohorts:
  coding:
    description: One executor and one reviewer.
    members:
      executor: { specialist: deep }
      reviewer: { specialist: review }
strategies:
  reviewed:
    description: Execute and review.
    cohort: coding
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

Legion validates the artifact graph and lowers accepted stages to detached, deep-frozen DSH primitive IR. It is an adapter over DSH one-shot subagents, not a persistent scheduler. The Default Catalog includes `independent-review`, `research-panel`, and `plan-execute-review` as ordinary replaceable data, with model exposure off by default.

See [benchmarks/README.md](benchmarks/README.md) for deterministic protocol gates and separate real-model evidence requirements.

### Prompt Fragments, structured results, and trust

Prompt Fragments are explicit deployment resources, not arbitrary workspace reads. Legion confines relative paths below configured roots and rejects links, malformed UTF-8, NUL bytes, missing files, and byte-budget violations. Edits require plugin or preset reactivation.

Structured foreground contracts are deliberately narrow:

- `findings-v1`: summary, evidence-backed findings, decisions, verification, and open risks;
- `review-v1`: verdict, severity findings, recommendations, and verification;
- background continuations remain text/session oriented.

Presets, Catalog Layers, plugin packages, resource roots, and Prompt Fragments are trusted deployment configuration. Tool filters and path confinement enforce policy and integrity for that trusted deployment; they are **not** a sandbox for hostile presets or untrusted plugins. See [SECURITY.md](SECURITY.md).

### Tool presentation and read-only review

**The bundled preset runs in `native` mode.** Its `review` Specialist uses an explicit `read`/`glob`/`grep` allowlist, so the child cannot inherit the preset's shell, filesystem mutation, job-control, or delegation tools. `read_image` is intentionally absent because DSH registers it only when an attachment service is present; a portable allowlist cannot name a conditional tool. The official `@deepseek-ai/dsh-agent-tool-presentation` row owns this choice, and Legion does not reimplement presentation in its source.

PTC remains available for trusted coordination deployments. A `ptc` row presents only `run_code` plus a generated SDK whose bindings respect the calling Agent's filtered visible tools. However, DSH's worker-thread code runtime explicitly provides containment rather than a security boundary: model-written code has bash-equivalent access to Node APIs, and `run_code` itself cannot be removed by `toolFilter`. A PTC child must therefore not be described as read-only merely because write-shaped SDK bindings are absent.

Delegated children inherit their coordinator's presentation through the preset standing scope. Switch the bundled row to `mode: ptc` only when every delegated Specialist is trusted with that code-runtime authority. The append-to-your-preset fragment ([`examples/legion.agent.cordis.fragment.yml`](examples/legion.agent.cordis.fragment.yml)) declares no presentation, because a second declaration in an existing composition is refused rather than merged; it follows whichever preset receives it.

A PTC deployment also needs the Host-plane runtime below. Both shipping bundles already compose one; hand-assembled Hosts must add it before selecting `ptc`:

~~~yaml
- id: code-runtime
  name: '@deepseek-ai/dsh-code-runtime-worker-thread'
~~~

When no `codeRuntime` is composed, Legion logs that PTC acceleration is unavailable and continues to work through native tools.

## Doctor and explain

Validate a standalone Legion config against an **explicit provider fixture**:

~~~bash
dsh-legion doctor examples/legion.config.yml --providers examples/providers.fixture.yml
dsh-legion explain examples/legion.config.yml --providers examples/providers.fixture.yml --json
~~~

`doctor` prints a compact summary; `explain` adds Specialists, execution modes, model routes, result contracts, and diagnostic codes. `--json` emits the versioned `legion-explain` view.

The fixture proves only supplied static facts. The CLI does not inspect a live DSH process, credentials, reachability, health, quota, billing, latency, or actual model availability.

Exit codes: `0` for no error diagnostic, `1` for capability errors, and `2` for usage, I/O, resource, parse, or schema failures.

## Status and limitations

The source tree declares version `1.2.0`; canonical current configuration is v3, while published 1.x no-target materialization/export remains v2 for compatibility. Check [CHANGELOG.md](CHANGELOG.md), the [roadmap](docs/roadmap.md), and [GitHub Releases](https://github.com/wxxb789/dsh-legion/releases) before selecting or upgrading an install revision.

Known limitations:

- Curated Strategies are not automatically model-exposed; deployment owners may opt in with `enableStrategies: true`.
- DSH has no unified recovery owner across provider retries and Route Candidates, so Legion starts only the selected child and never retries or switches models after failure.
- DSH binds a prepared call to one adapter generation and one dispatch, but Legion's pre-start Route observations are point-in-time, best-effort facts rather than an atomic adapter-topology snapshot.
- A Specialist cannot override a child's reasoning effort.
- In-process children inherit the parent's named DSH agent preset; no per-child named preset or Specialist-local DSH Skill setup is available across one-shot, continuable, and cold-resume paths. Specialists can still vary model, persona, tools, backend, and limits.
- Legion does not inspect live provider health, credentials, authorization, quota, reachability, or latency; Route Plans report those facts as unknown.
- Aggregate token or monetary-cost admission remains a future Host-owned capability; it is unrelated to the observation-only Run Receipt companion. Current limits cover members, concurrency, deadlines, accepted output, tools, and eligible routes.
- The GUI settings card edits five scalar policies; Specialists, Cohorts, Strategies, and catalog layers stay in the configuration document.
- DSH now publishes assessed-line client contracts, including the `settings.plugin.item` slot declaration, but not its `clientBundle` build preset. Legion therefore typechecks against public packages while reproducing the loader artifact format by hand; a Host format change fails at load time rather than at build time.
- The Specialist `result` schema still accepts `plan-delta-v1`, a contract meant for durable-run plan proposals rather than ordinary delegation. Treat it as unsupported for Specialists until it is either gated or deliberately published.
- A bare package without compatible DSH peers is unsupported.

## FAQ

### Is dsh-legion a standalone multi-agent framework?

No. It is a DeepSeek Harness plugin for multi-agent policy and delegation. DSH remains the runtime and lifecycle owner.

### How does it compare with LangGraph, CrewAI, or AutoGen?

Those frameworks ship their own runtime, state model, and process lifecycle, so adopting one adds a second orchestrator beside your agent. Legion adds no runtime at all: it is declarative delegation policy for a DSH deployment you already run, compiled to native DSH subagents. See [dsh-legion vs standalone multi-agent frameworks](#dsh-legion-vs-standalone-multi-agent-frameworks) for the full comparison.

### Which LLM providers and models can it route to?

Any provider and exact model that your DSH deployment registers as an adapter, named as ordinary configuration. Legion never embeds a provider list, credentials, or pricing: it checks ordered Route Candidates against known static capability facts and starts one child.

### Can it delegate to Codex, Claude Code, or GitHub Copilot CLI?

Yes, through DSH's ACP backend. Legion ships an optional catalog layer with Specialists for Codex, Claude Code, oh-my-pi, Kimi Code, Grok Build, Pi, GitHub Copilot CLI, Hermes, and ZCode. See [ACP delegation](docs/acp-delegation.md).

### Does Legion automatically choose the cheapest or healthiest model?

No. It checks ordered routes against known static facts. It does not claim live health, price, authentication, quota, or latency, and does not replay after failure.

### Can I create custom Specialists, Cohorts, and Strategies?

Yes. The Default Catalog uses the same public, replaceable contracts as user and third-party entries.

### Why does the Legion tool disappear?

A Specialist is published only when its configured backend can actually satisfy that Specialist's policy: the execution mode it defaults to, plus Agent option overrides, tool filtering, persona, depth, and structured output. An unregistered subagent provider deactivates it, and so does a registered backend that cannot supply what the Specialist asks for — structured output for a `findings-v1` Specialist, for example. If no Specialist qualifies, the tool is withdrawn and the guidance renders empty; both return once the missing capability appears. Also verify that Legion is installed into the intended Host `profile` and that a new session uses the preset containing its row.

### Can I edit DSH's shipped `standard` preset?

Do not. Copy it to a user-owned preset so upgrades cannot overwrite your changes.

## Compatibility, development, and releases

The package requires Node.js `^22.19.0 || >=24.0.0` and the DSH peer range declared in [`contracts/compatibility.json`](contracts/compatibility.json). Legion tracks the assessed Host line from that single policy: the package peer range, declared minimum, latest tested version, CI channels, and packed verifier are checked against it rather than copying version literals. CI covers Windows, Ubuntu, packed DSH consumers, public contracts, protocol benchmarks, and reproducible packages.

~~~bash
pnpm install --frozen-lockfile
pnpm run check
~~~

Useful references:

- [Implementation roadmap](docs/roadmap.md)
- [Public contract v1](docs/public-contract-v1.md)
- [Durable Strategy Runs](docs/durable-runs.md)
- [Journal contract v1](docs/journal-contract-v1.md)
- [Run replay](docs/run-replay.md)
- [Run Receipts](docs/run-receipts.md)
- [Versioned configuration and rollback](docs/adr/0008-versioned-config-and-rollback.md)
- [Declarative Cohort and Strategy IR](docs/adr/0010-declarative-team-strategy-ir.md)
- [Explicit Strategy exposure authority](docs/adr/0012-model-strategy-exposure-is-explicit-authority.md)
- [Reproducible releases](docs/adr/0009-reproducible-provenance-releases.md)
- [All architecture decisions](docs/adr)

Issues and contributions are welcome through the [GitHub issue tracker](https://github.com/wxxb789/dsh-legion/issues).

## Durable Strategy Runs (v1.1, opt-in)

Durable runs are disabled by default and preserve v1.0 ephemeral behavior. When enabled by deployment, a Strategy caller explicitly selects journal mode with `execution: { durability: 'journal' }`; omission remains ephemeral. They use eight typed events in the invoking DSH Session journal and projection key `legion-run` at state version 7. Run control supports bounded read-only `inspect`, one-activation `resume`, flushed `cancel`, and validated proposal-only `steer`. Task delivery is at least once; matching fence and generation permit exactly one accepted commit, not exactly-once external effects. Mail is reserved, incorporated, durably flushed when required, then acknowledged; expired reservations are reclaimable.

This package does not ship DSH persistence, projection, Session Query, atomic coordination, global admission, or child-receipt Host services. DSH 0.1.2-alpha.1 still provides no atomic run coordination service, and its persistence reader has no registration seam for out-of-repository `legion/*` events. Production durable mutation therefore remains unavailable and fails closed before append. No build binds a durable Strategy activation adapter either, so `execution` stays out of the model-facing schema; a programmatic journal request returns the missing Host capability codes or `LEGION_DURABLE_EXECUTION_ADAPTER_UNAVAILABLE`. Pure contracts, validation, replay, and inspection remain usable. Ephemeral Cohort Run Receipts publish full live facts only through the optional `dsh-legion-receipts` companion: the same live Session and companion instance survive Client refresh/reconnect, while Session disposal, companion reload, or Host restart starts empty. Headless and missing-companion deployments still receive the bounded terminal tool summary, and no custom Session event or Receipt storage is used. See [Durable Strategy Runs](docs/durable-runs.md), [Journal Contract v1](docs/journal-contract-v1.md), and the [DSH 0.1.2-alpha.1 audit](docs/notes/dsh-0.1.2-alpha.1-upgrade.md).

## Related projects

- [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) — the open-source agent harness that owns the Agent, Session, model adapters, subagent runtime, sandbox, approvals, and Web GUI that Legion plugs into.
- [Cordis](https://github.com/cordiverse/cordis) — the plugin and service framework DSH is built on; Legion registers through ordinary Cordis fibers.
- [Agent Client Protocol](https://agentclientprotocol.com) — the protocol behind DSH's ACP backend, used by Legion's optional external-agent Specialists.
- [`dsh-plugin` topic](https://github.com/topics/dsh-plugin) — discover more DeepSeek Harness plugins.

If dsh-legion saves you work, starring the repository helps other DSH users find it.

## License

[MIT](LICENSE)
