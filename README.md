# dsh-legion: Multi-Agent Teams and Model Routing for DeepSeek Harness

**English** · [简体中文](README.zh-cn.md)

<p align="center">
  <a href="https://github.com/wxxb789/dsh-legion"><img src="https://raw.githubusercontent.com/wxxb789/dsh-legion/main/.github/assets/social-preview.png" alt="dsh-legion: multi-agent teams, model routing, and declarative orchestration for DeepSeek Harness" width="840"></a>
</p>

[![CI](https://github.com/wxxb789/dsh-legion/actions/workflows/ci.yml/badge.svg)](https://github.com/wxxb789/dsh-legion/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%5E22.19.0%20%7C%20%3E%3D24.0.0-339933?logo=node.js&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![DSH plugin](https://img.shields.io/badge/DeepSeek%20Harness-dsh--plugin-5b4ee5?logo=github&logoColor=white)](https://github.com/topics/dsh-plugin)

**dsh-legion** is a TypeScript multi-agent orchestration plugin for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness). It adds configurable AI agent Profiles, exact model routing, declarative Teams and Strategies, structured results, and bounded subagent delegation without replacing the DSH runtime.

## TL;DR

- **What it is.** A DeepSeek Harness plugin for multi-agent delegation policy — not a standalone agent framework.
- **What it adds.** One model-facing `legion` tool whose choices are semantic Profiles such as `quick`, `deep`, and `review`. Each Profile carries a deployment-owned model route, subagent backend, persona, tool filter, depth, and result contract.
- **Why it helps.** The coordinating agent picks intent instead of model IDs, a prompt can never widen the policy behind a Profile, and changing the model behind `deep` rewrites no prompts.
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

The coordinator now sees one `legion` tool whose `profile` values are your semantic delegation choices. Step-by-step instructions are in [Install](#install) and [Set up a Legion agent preset](#set-up-a-legion-agent-preset).

## Contents

- [TL;DR](#tldr)
- [Quick start](#quick-start)
- [What is dsh-legion used for?](#what-is-dsh-legion-used-for)
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
- **Build multi-agent workflows.** Define bounded Teams and declarative plan/execute/review or research fanout Strategies.
- **Bound workload and risk.** Limit depth, concurrency, participants, deadlines, output size, tools, and eligible routes. These bounds constrain cost drivers, but Legion does not provide aggregate token or monetary-cost admission.
- **Standardize delegation.** Keep semantic Profile names stable when the underlying model or backend changes.
- **Validate policy before runtime.** Diagnose configuration against explicit provider capability fixtures.
- **Customize without forking.** Add, replace, disable, or revive Profiles, Teams, and Strategies through Catalog Layers.

Legion is for developers and deployment owners who already use DSH and want configurable multi-agent delegation without adopting another scheduler, session store, or agent runtime.

## Capabilities

| Capability | What it provides |
|---|---|
| Semantic Profiles | Named policies such as `quick`, `deep`, and `review` instead of raw model choices in every prompt. |
| Exact model routing | Up to eight ordered provider/model candidates with static context and output-budget constraints. |
| Multiple backends | Use `spawn`, `fork`, `codex`, `claude-code`, or another DSH-registered subagent provider per Profile. |
| Tool and persona policy | Restrict child tools, add Profile instructions, set depth, and choose foreground/background defaults. |
| Structured results | Versioned `text`, `findings-v1`, and `review-v1` foreground result contracts. |
| Custom Teams | Declare bounded Member Slots that reference existing Profiles. |
| Declarative Strategies | Compile typed artifact graphs to frozen DSH delegation primitives. |
| Hard limits | Bound agents, concurrency, deadline, and accepted output size for each Team Run. |
| Catalog customization | Layer, replace, disable, and restore user or third-party catalog entries. |
| Prompt Fragments | Load confined, immutable UTF-8 prompt resources from deployment-owned roots. |
| Explainable policy | Stable digests, deterministic diagnostics, route evidence, and JSON explain output. |
| Live reconfiguration | Optional: when the Host mounts a settings provider, edit the same config through the `legion` namespace and republish without a restart. |
| Web settings card | A plugin card on the DSH Settings → Plugins tab, with staged edits and override badges. See [the settings card](docs/settings-card.md). |
| ACP delegation | Optional Profiles for Codex, Claude Code, oh-my-pi, Kimi Code, Grok Build, Pi, GitHub Copilot CLI, Hermes, and ZCode over DSH's ACP backend. See [ACP delegation](docs/acp-delegation.md). |
| Native DSH lifecycle | Continuations, cancellation, settlement, providers, and HMR-safe registration remain DSH-owned. |

## How it works

~~~text
Catalog Layers
  ├─ Profiles   -> model routes, backend, persona, tools, result contract
  ├─ Teams      -> bounded Member Slots referencing Profiles
  └─ Strategies -> typed artifact graph + hard limits
                         │
                         ▼
                frozen DSH primitive IR
                         │
                         ▼
                 native DSH subagents
~~~

A typical model-facing Profile call is small:

~~~json
{
  "profile": "quick",
  "description": "summarize findings",
  "prompt": "Summarize the investigation and preserve source paths.",
  "run_in_background": true
}
~~~

The coordinator chooses a semantic Profile; the prompt cannot change that Profile's deployment-owned model, tools, persona, depth, or result policy.

Legion intentionally does **not** own the agent loop, sessions, persistence, model adapters, credentials, sandbox, approvals, subagent registry, or Web GUI. It uses DSH's public `ctx.subagents`, `ctx.tools`, and `ctx.systemPrompt` seams so there is only one runtime and lifecycle owner.

### Under the hood: from tool call to child agent

**Activation**, when DSH mounts the plugin on a Cordis fiber:

1. Legion validates the configuration against a strict schema that rejects unknown fields anywhere in the document.
2. Catalog Layers merge in order: a later layer replaces an earlier entry by name, a tombstone disables an inherited one, and any later definition of that name revives it.
3. Prompt Fragments referenced by Profiles are read once, under a per-Profile byte budget, and captured as an immutable snapshot with a content digest.
4. Legion observes which subagent backends and which LLM adapters the Host currently has registered.
5. Each Profile is compiled against that observation and becomes **active** only if its configured backend can actually satisfy the Profile's policy: execution mode, tool filtering, persona, depth, and structured output.
6. The delegation tool is published with a parameter schema derived from the active Profiles, and a matching routing table is contributed to the system prompt.
7. If no Profile is active, the tool is withdrawn and the guidance renders empty. The whole sequence reruns whenever backends or adapters change.

**One delegation**, between the coordinator's tool call and the returned result:

8. Arguments are validated and resolved to exactly one Profile: the one named, or the configured `defaultProfile`.
9. If that Profile declares `routes`, Legion reads each candidate's exact-model metadata and takes the first candidate in your authored order that no static fact contradicts.
10. Only static facts participate, such as context window and output budget. A candidate whose metadata cannot be read stays eligible; the call fails only when every candidate is positively ruled out.
11. Legion starts exactly one child through the Host's subagent API with the Profile's fixed policy applied, and never retries or switches routes when that child or its provider fails.
12. A background call returns a continuable child id immediately; a foreground call waits, revalidates a structured result against its contract, and rebuilds it as fresh plain data before returning.

Two properties follow from that design and are worth stating plainly. Compiled Team and Strategy IR is deep-frozen and detached: it holds no reference to your configuration objects and carries no functions. A compiled Strategy plan is also tracked by object identity in a process-wide registry, so execution accepts only a plan this process compiled — a reconstructed or deserialized copy is rejected even when its contents and digest are identical.

## Install

### Prerequisites

- A compatible [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) installation.
- `pnpm` on `PATH`; `dsh plugin` forwards package operations to pnpm.
- A DSH host profile, such as the default `web` profile.
- A configured DSH subagent provider and the LLM provider/model routes referenced by your Profiles.
- For local development: Node.js `^22.19.0 || >=24.0.0` and pnpm `11.21.0`.

### Install from GitHub

Install the default branch into the `web` profile:

~~~bash
dsh plugin --profile web add github:wxxb789/dsh-legion
~~~

Replace `web` if Legion should be available in another DSH host profile.

This resolves `main` **once, at install time**. `dsh plugin` forwards to pnpm, which records the resolved commit in the host profile's lockfile, so the installed revision does not follow later pushes until you upgrade explicitly.

#### Pin a revision

A git install runs Legion's `prepare` build on your machine, outside any sandbox the agent runs under. Append an immutable revision whenever the installed code has to stay auditable and reproducible — production profiles, shared machines, or a deployment where you review what you allow to build:

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

A local checkout needs built `lib/` artifacts. The bundle patch is intentionally empty: installation makes `dsh-legion` resolvable from user-owned agent presets but does not inject a process-global model tool.

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

Copy [presets/legion](presets/legion) to `$DSH_HOME/.agent-presets/legion`. It contains a focused coding tool set and example `deep`, `quick`, and `review` Profiles.

A copied preset is a versioned template. It does not automatically inherit later DSH or Legion changes. Existing nonblank sessions also cannot change their recorded preset, so start a new session after changing composition.

## Upgrade

### GitHub installation

A branch installation re-resolves to the current `main` commit through pnpm's update command, which DSH forwards:

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

Remove Legion from every DSH host profile where it was installed:

1. Remove or disable the `name: dsh-legion` row in user-owned agent presets.
2. Remove the package:

   ~~~bash
   dsh plugin --profile web remove dsh-legion
   ~~~

3. Optionally delete `$DSH_HOME/.agent-presets/legion` if that copied preset is no longer needed.
4. Restart the affected DSH process.

Package removal does not delete user-owned presets or configuration.

## Usage

### Delegate through a Profile

The coordinator sees one `legion` tool plus active Profile descriptions:

~~~json
{
  "profile": "review",
  "description": "review the authentication change",
  "prompt": "Inspect the diff for correctness and security issues. Cite files and lines.",
  "run_in_background": false
}
~~~

If `defaultProfile` is configured, `profile` may be omitted. Concurrent sibling calls use DSH's normal parallel tool execution.

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

Profile and Strategy fields cannot be mixed. Invocation limits may only narrow compiled Strategy limits.

## Configuration

A minimal agent-preset row:

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

Use valid provider and model IDs for your deployment. See the [complete preset fragment](examples/legion.agent.cordis.fragment.yml) and [standalone configuration example](examples/legion.config.yml).

When the Host mounts a settings provider (DSH 0.1.0-rc.7 serves every registered namespace), Legion also registers this same schema as the `legion` settings namespace: the preset row above becomes the base layer, a stored user section overrides individual fields, and a commit republishes the tool without restarting DSH. Nothing changes in a composition without a settings provider. See [live reconfiguration](docs/settings.md) and [the settings card](docs/settings-card.md).

To delegate to an external coding agent — Codex, Claude Code, Kimi Code, GitHub Copilot CLI, and others — mount DSH's ACP backend once per agent and append the generated catalog layer. See [ACP delegation](docs/acp-delegation.md) and `examples/legion.acp.fragment.yml`.

### Top-level fields

| Field | Default | Meaning |
|---|---:|---|
| `configVersion` | `2` | Current configuration contract. Omitted or `1` is accepted and normalized to `2`; a v1 document that uses `catalogLayers`, `teams`, `strategies`, `enableStrategies`, or durable runs is rejected at activation instead of upgraded. |
| `toolName` | `legion` | Model-facing tool name. |
| `profiles` | required | Semantic Profile map. |
| `defaultProfile` | none | Profile used when a call omits `profile`. |
| `enableRunInBackground` | `true` | Expose background delegation. |
| `enableStrategies` | `false` | Explicitly expose active Strategies to the model. |
| `guidance` | none | Extra coordinator guidance. |
| `resourceRoots` | `{}` | Relative deployment roots for Prompt Fragments. |
| `maxResourceBytes` | `65536` | Prompt Fragment bytes per Profile; hard ceiling 4 MiB. |
| `catalogLayers` | `[]` | Ordered third-party or project policy layers. |
| `teams` | `{}` | Final deployment-layer Teams. |
| `strategies` | `{}` | Final deployment-layer Strategies. |

Profile names must match `^[a-z][a-z0-9-]*$`.

### Profile fields

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

### Catalog Layers, Teams, and Strategies

Config v2 layers Profiles, Teams, and Strategies. A later definition replaces the same name; a tombstone disables it; a later definition may revive it. Root maps are the final deployment layer.

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

Legion validates the artifact graph and lowers accepted stages to detached, deep-frozen DSH primitive IR. It is an adapter over DSH one-shot subagents, not a persistent scheduler. The Default Catalog includes `independent-review`, `research-panel`, and `plan-execute-review` as ordinary replaceable data, with model exposure off by default.

See [benchmarks/README.md](benchmarks/README.md) for deterministic protocol gates and separate real-model evidence requirements.

### Prompt Fragments, structured results, and trust

Prompt Fragments are explicit deployment resources, not arbitrary workspace reads. Legion confines relative paths below configured roots and rejects links, malformed UTF-8, NUL bytes, missing files, and byte-budget violations. Edits require plugin or preset reactivation.

Structured foreground contracts are deliberately narrow:

- `findings-v1`: summary, evidence-backed findings, decisions, verification, and open risks;
- `review-v1`: verdict, severity findings, recommendations, and verification;
- background continuations remain text/session oriented.

Presets, Catalog Layers, plugin packages, resource roots, and Prompt Fragments are trusted deployment configuration. Tool filters and path confinement enforce policy and integrity for that trusted deployment; they are **not** a sandbox for hostile presets or untrusted plugins. See [SECURITY.md](SECURITY.md).

## Doctor and explain

Validate a standalone Legion config against an **explicit provider fixture**:

~~~bash
dsh-legion doctor examples/legion.config.yml --providers examples/providers.fixture.yml
dsh-legion explain examples/legion.config.yml --providers examples/providers.fixture.yml --json
~~~

`doctor` prints a compact summary; `explain` adds Profiles, execution modes, model routes, result contracts, and diagnostic codes. `--json` emits the versioned `legion-explain` view.

The fixture proves only supplied static facts. The CLI does not inspect a live DSH process, credentials, reachability, health, quota, billing, latency, or actual model availability.

Exit codes: `0` for no error diagnostic, `1` for capability errors, and `2` for usage, I/O, resource, parse, or schema failures.

## Status and limitations

The source tree declares version `1.2.0` and config contract v2. Check [CHANGELOG.md](CHANGELOG.md), the [roadmap](docs/roadmap.md), and [GitHub Releases](https://github.com/wxxb789/dsh-legion/releases) before selecting or upgrading an install revision.

Known limitations:

- Curated Strategies are not automatically model-exposed; deployment owners may opt in with `enableStrategies: true`.
- Legion does not retry or switch models after a selected child fails.
- In-process children inherit the parent's named DSH agent preset; Profiles can still vary model, persona, tools, backend, and limits.
- The GUI settings card edits four scalar policies; Profiles, Teams, Strategies, and catalog layers stay in the configuration document.
- The card's browser half reproduces DSH's unpublished client bundle format by hand, so an upstream change to that format fails at load time rather than at build time.
- The Profile `result` schema still accepts `plan-delta-v1`, a contract meant for durable-run plan proposals rather than ordinary delegation. Treat it as unsupported for Profiles until it is either gated or deliberately published.
- A bare package without compatible DSH peers is unsupported.

## FAQ

### Is dsh-legion a standalone multi-agent framework?

No. It is a DeepSeek Harness plugin for multi-agent policy and delegation. DSH remains the runtime and lifecycle owner.

### How does it compare with standalone multi-agent frameworks?

Frameworks such as LangGraph, CrewAI, or AutoGen ship their own runtime, state model, and process lifecycle, so adopting one adds a second orchestrator beside your agent. Legion adds no runtime at all: it is declarative delegation policy for a DSH deployment you already run, compiled to native DSH subagents. If you are not running DSH, Legion is not the right tool.

### Which LLM providers and models can it route to?

Any provider and exact model that your DSH deployment registers as an adapter, named as ordinary configuration. Legion never embeds a provider list, credentials, or pricing: it checks ordered Route Candidates against known static capability facts and starts one child.

### Can it delegate to Codex, Claude Code, or GitHub Copilot CLI?

Yes, through DSH's ACP backend. Legion ships an optional catalog layer with Profiles for Codex, Claude Code, oh-my-pi, Kimi Code, Grok Build, Pi, GitHub Copilot CLI, Hermes, and ZCode. See [ACP delegation](docs/acp-delegation.md).

### Does Legion automatically choose the cheapest or healthiest model?

No. It checks ordered routes against known static facts. It does not claim live health, price, authentication, quota, or latency, and does not replay after failure.

### Can I create custom Profiles, Teams, and Strategies?

Yes. The Default Catalog uses the same public, replaceable contracts as user and third-party entries.

### Why does the Legion tool disappear?

A Profile is published only when its configured backend can actually satisfy that Profile's policy: the execution mode it defaults to, plus tool filtering, persona, depth, and structured output. An unregistered subagent provider deactivates it, and so does a registered backend that cannot supply what the Profile asks for — structured output for a `findings-v1` Profile, for example. If no Profile qualifies, the tool is withdrawn and the guidance renders empty; both return once the missing capability appears. Also verify that Legion is installed into the host profile and that a new session uses the preset containing its row.

### Can I edit DSH's shipped `standard` preset?

Do not. Copy it to a user-owned preset so upgrades cannot overwrite your changes.

## Compatibility, development, and releases

The package requires Node.js `^22.19.0 || >=24.0.0` and DSH peers in `>=0.1.0-rc.6 <0.2.0`. CI covers Windows, Ubuntu, packed DSH consumers, public contracts, protocol benchmarks, and reproducible packages.

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
- [Versioned configuration and rollback](docs/adr/0008-versioned-config-and-rollback.md)
- [Declarative Team and Strategy IR](docs/adr/0010-declarative-team-strategy-ir.md)
- [Explicit Strategy exposure authority](docs/adr/0012-model-strategy-exposure-is-explicit-authority.md)
- [Reproducible releases](docs/adr/0009-reproducible-provenance-releases.md)
- [All architecture decisions](docs/adr)

Issues and contributions are welcome through the [GitHub issue tracker](https://github.com/wxxb789/dsh-legion/issues).

## Durable Strategy Runs (v1.1, opt-in)

Durable runs are disabled by default and preserve v1.0 ephemeral behavior. When enabled by deployment, a Strategy caller explicitly selects journal mode with `execution: { durability: 'journal' }`; omission remains ephemeral. They use eight typed events in the invoking DSH Session journal and projection key `legion-run` at state version 6. Run control supports bounded read-only `inspect`, one-activation `resume`, flushed `cancel`, and validated proposal-only `steer`. Task delivery is at least once; matching fence and generation permit exactly one accepted commit, not exactly-once external effects. Mail is reserved, incorporated, durably flushed when required, then acknowledged; expired reservations are reclaimable.

This package does not ship DSH persistence, projection, atomic coordination, global admission, or child-receipt Host services. Session flush and the projection registry are ordinary DSH services that the base composition already mounts; what no published DSH release provides is the atomic run coordination service, so production durable mutation stays unavailable. No build binds a durable Strategy activation adapter yet either, so journal mode cannot start on any Host. The `execution` parameter is therefore kept out of the model-facing schema, and a programmatic journal request fails closed: with the missing Host capability codes on a release such as 0.1.0-rc.6, and with `LEGION_DURABLE_EXECUTION_ADAPTER_UNAVAILABLE` on an otherwise fully capable Host. Enabling durable runs there produces stable capability diagnostics and fails closed before mutation; pure contracts, validation, replay, and inspection remain usable. See [Durable Strategy Runs](docs/durable-runs.md) and [Journal Contract v1](docs/journal-contract-v1.md).

## Related projects

- [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) — the open-source agent harness that owns the Agent, Session, model adapters, subagent runtime, sandbox, approvals, and Web GUI that Legion plugs into.
- [Cordis](https://github.com/cordiverse/cordis) — the plugin and service framework DSH is built on; Legion registers through ordinary Cordis fibers.
- [Agent Client Protocol](https://agentclientprotocol.com) — the protocol behind DSH's ACP backend, used by Legion's optional external-agent Profiles.
- [`dsh-plugin` topic](https://github.com/topics/dsh-plugin) — discover more DeepSeek Harness plugins.

If dsh-legion saves you work, starring the repository helps other DSH users find it.

## License

[MIT](LICENSE)
