# dsh-legion

Configurable multi-agent Teams, orchestration Strategies, and model-routed Profiles for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

Legion turns raw model and backend choices into semantic Profiles such as `deep`, `quick`, and `review`. Profiles compose into declarative Teams and bounded Strategies; the compiler validates member cardinality, artifact wiring, limits, completion, and DSH primitive lowering without creating a second runtime.

Legion is customization-first. Users and third-party packages use ordinary ordered Catalog Layers to add, replace, or disable Profiles, Teams, and Strategies. The curated Default Catalog uses exactly the same public contracts and receives no hidden runtime privilege.

```text
Catalog Layers
  ├─ Profiles   -> backend, exact routes, persona, tools, result contract
  ├─ Teams      -> bounded Member Slots referencing Profiles
  └─ Strategies -> typed artifact graph + hard limits
                         │
                         ▼
                frozen DSH primitive IR
```

## Why a DSH plugin?

Legion is an agent-plane Cordis plugin. It consumes DSH's existing Host-owned `ctx.subagents`, `ctx.tools`, and `ctx.systemPrompt` seams instead of replacing the agent loop, Session lifecycle, model adapters, sandbox, approval stack, or subagent registry.

One model-facing tool provides a small interface:

```json
{
  "profile": "quick",
  "description": "summarize findings",
  "prompt": "Summarize the investigation and preserve source paths.",
  "run_in_background": true
}
```

The deployment owner—not the prompt—controls what each profile can use.

## Status

`1.0.0` is the stable customization-first release: config v2 Profiles, Catalog Layers, Teams, executable Strategies, atomic execution snapshots, explicit model authority, evidence gates, and the curated defaults-as-data catalog.

Supported:

- config v2 ordered Catalog Layers with add/replace/disable semantics and deterministic provenance;
- public bounded TeamSpec Member Slots referencing existing Profiles;
- public declarative StrategySpec stages with type-level and runtime artifact wiring;
- immutable lowering to executable `dsh-delegate` and `dsh-subagent-fanout` primitive IR;
- invocation-only limit narrowing and deterministic StrategyPlanDigest;
- direct/fanout execution through real one-shot DSH subagents with completed/degraded/cancelled/failed outcomes;
- ordinary defaults-as-data templates for independent review, research panel, and plan/execute/review;
- multiple named profiles in one Legion-enabled DSH agent preset;
- independent subagent backend per profile (`spawn`, `fork`, `codex`, `claude-code`, or another registered provider);
- legacy fixed child LLM `provider`, `model`, and `maxTokens`, or up to eight ordered exact Route Candidates per Profile;
- pre-start adapter/metadata observation with known constraint rejection, preserved unknowns, and no failure replay;
- per-profile persona, tool allow/deny policy, depth limit, and foreground/background default;
- continuable background children with normal DSH settlement notifications and follow-up support;
- concurrent sibling calls through DSH's parallel tool execution;
- fail-loud provider and capability validation;
- one deterministic compiled catalog shared by tool schema, prompt guidance, activation, and execution;
- stable SHA-256 policy/catalog digests for bounded provenance;
- versioned foreground result contracts: `text`, `findings-v1`, and `review-v1`;
- detached revalidation/materialization of provider-owned structured output;
- reversible Cordis lifecycle and HMR-safe registrations.

Not yet supported:

- automatic benchmark-backed enablement of curated defaults; explicit deployment opt-in is available, but the shipped preset remains off;
- post-failure model fallback/replay or automatic provider health scoring;
- a Legion-owned team/DAG runtime—the adapter walks a frozen plan and delegates every child lifecycle to DSH subagents;
- selecting a different **DSH agent preset** for each child. Current in-process subagents inherit the parent's standing preset composition; Legion profiles can still vary model, persona, tools, and backend. A true per-child preset requires a small upstream DSH subagent composition seam and is tracked as a roadmap item;
- a GUI settings card. External Host settings namespaces are not currently exposed by the DSH Web allowlist, so configuration remains in the user-owned agent preset.

## Install

### From a local checkout

A local checkout needs built `lib/` artifacts, but profile-level build approval is not required. Prepare a clean checkout first, then add it:

```bash
git clone https://github.com/wxxb789/dsh-legion.git
cd dsh-legion
pnpm install --frozen-lockfile
pnpm run build
dsh plugin --profile web add .
```

### From GitHub

```bash
dsh plugin --profile web add github:wxxb789/dsh-legion#<commit>
```

Git dependencies run this package's `prepare` build. pnpm 10+ may reject the first install until the package is explicitly allowed. Add the exact key printed by pnpm to `$DSH_HOME/profiles/web/pnpm-workspace.yaml`, then rerun the install:

```yaml
allowBuilds:
  dsh-legion: true
```

If the diagnostic prints a source-qualified key, use that exact key instead of the short name above. Published npm tarballs contain prebuilt `lib/` files and do not need build approval.

The bundle patch is intentionally empty: installing it makes `dsh-legion` resolvable from user-authored agent presets without adding a process-global model tool.

## Create a Legion agent preset

Do not edit DSH's shipped `standard` preset. Two supported starting points are included:

1. **Recommended for an existing setup:** in the Web GUI, copy `standard` to a user preset named `legion`, open that copy, and append the Legion row from [`examples/legion.agent.cordis.fragment.yml`](examples/legion.agent.cordis.fragment.yml).
2. **Ready-to-copy standalone preset:** copy [`presets/legion`](presets/legion) into `$DSH_HOME/.agent-presets/legion`. It contains a focused coding tool set plus the default `deep`, `quick`, and `review` profiles. Treat it as a versioned template; a copied preset does not automatically inherit later changes from DSH's shipped `standard` preset.

The fragment starts with:

```yaml
- id: tool-legion
  name: dsh-legion
  config:
    toolName: legion
    defaultProfile: quick
    profiles:
      deep:
        description: Complex architecture, debugging, and implementation.
        subagentProvider: spawn
        routes:
          - id: primary
            provider: deepseek-official
            model: deepseek-v4-pro
            constraints:
              minContextTokens: 65536
              minEffectiveOutputTokens: 8192
          - id: fast-static
            provider: deepseek-official
            model: deepseek-v4-flash
            constraints:
              minContextTokens: 65536
              minEffectiveOutputTokens: 8192
        maxDepth: 3
        defaultRunInBackground: true

      quick:
        description: Translation, exploration, extraction, and summaries.
        subagentProvider: spawn
        routes:
          - id: primary
            provider: deepseek-official
            model: deepseek-v4-flash
            maxTokens: 8192
          - id: quality-static
            provider: deepseek-official
            model: deepseek-v4-pro
            maxTokens: 8192
        maxDepth: 2
        defaultRunInBackground: true
```

Start a new session with the `legion` preset. Existing nonblank sessions cannot change preset because their recorded tool calls were produced under the old composition.

You may remove or disable the generic `subagent` row in your copied preset if you want every delegation to go through Legion profiles.

## Configuration

### Top level

| Field | Default | Meaning |
|---|---:|---|
| `configVersion` | `2` | Versioned document contract. Omission is legacy v1 and migrates to v2. |
| `toolName` | `legion` | Model-facing tool name. |
| `profiles` | required | Map from semantic profile name to fixed child policy. |
| `defaultProfile` | none | Profile used when a call omits `profile`; otherwise `profile` is required. |
| `enableRunInBackground` | `true` | Expose and accept `run_in_background`. |
| `enableStrategies` | `false` | Explicitly expose active Strategies to the model-facing tool; programmatic compilation/execution is unaffected. |
| `guidance` | none | Additional coordinator guidance appended to the generated profile table. |
| `resourceRoots` | `{}` | Deployment-owned aliases for relative directories containing Prompt Fragments. |
| `maxResourceBytes` | `65536` | Maximum combined raw Prompt Fragment bytes loaded for one Profile; hard ceiling 4 MiB. |
| `catalogLayers` | `[]` | Ordered third-party/project policy layers; later definitions replace and tombstones disable. |
| `teams` | `{}` | Final deployment-layer TeamSpec map. |
| `strategies` | `{}` | Final deployment-layer StrategySpec map. |

Profile names must match `^[a-z][a-z0-9-]*$`. Legion follows the DSH provider lifecycle: profiles whose `subagentProvider` is absent are omitted from the live tool schema, and the tool plus prompt guidance disappear when no configured provider is available. They return automatically when the provider is registered again. When a provider is present, the profile's default execution mode is capability-checked immediately; an invalid default fails activation instead of waiting for the first tool call.

### Profile

| Field | Default | Meaning |
|---|---:|---|
| `description` | required | Task-fit guidance shown to the coordinator. |
| `subagentProvider` | `spawn` | Named DSH subagent backend. This is not an LLM provider. |
| `agentOptions.provider` | inherited | Child LLM provider route. |
| `agentOptions.model` | inherited | Child model id. |
| `agentOptions.maxTokens` | inherited | Legacy fixed child output token limit. `agentOptions` cannot be combined with `routes`. |
| `routes` | none | Up to eight priority-ordered exact Route Candidates evaluated immediately before child start. |
| `persona` | inherited | Child persona override. Foreground requires the provider's one-shot capability; continuable children are composed by the DSH manager. |
| `toolFilter.allow` / `deny` | none | Child tool visibility restriction. Foreground requires provider support; the continuation manager installs it directly for background children. |
| `maxDepth` | `3` | Absolute depth. Foreground numeric limits require `depthLimit`; the continuation manager enforces background limits. Use `provider-managed` for external one-shot products. |
| `defaultRunInBackground` | `true` | Use a continuable child when the tool call omits the flag. |
| `result` | `text` | `text`, `findings-v1`, or `review-v1`; structured contracts require foreground one-shot execution and provider `outputSchema` support. |
| `promptFiles` | none | Ordered `{ root, path }` Prompt Fragments appended to the child persona after confinement and content validation. |

For `codex` and `claude-code`, the external product owns its model selection. Use `maxDepth: provider-managed` and normally `defaultRunInBackground: false` because those providers are one-shot.

### Exact Route Candidates

Profiles may replace legacy `agentOptions` with an ordered static policy:

```yaml
routes:
  - id: primary
    provider: deepseek-official
    model: deepseek-v4-pro
    maxTokens: 16384
    constraints:
      minContextTokens: 65536
      minEffectiveOutputTokens: 8192
  - id: fast-static
    provider: deepseek-official
    model: deepseek-v4-flash
    constraints:
      minContextTokens: 65536
    instructions: Preserve the Profile's evidence threshold on this route.
```

Immediately before starting a child, Legion snapshots whether each exact provider has a registered DSH adapter and asks that adapter for exact-model metadata. It selects the first candidate without a **known static contradiction**. An absent advisory model-catalog entry is never a rejection: adapters may accept unlisted model IDs. Missing metadata remains `unknown` and admissible rather than becoming an invented failure.

Known missing adapters, exact-model rejection, insufficient context, or an insufficient effective request output budget reject a candidate. `minEffectiveOutputTokens` compares an explicit candidate `maxTokens` or the adapter default that Legion freezes into the selected start projection; it is not a claim about the model's hard output ceiling. Selectable reasoning efforts are included as evidence only: DSH does not yet expose a per-child reasoning-effort override, and absent reasoning metadata does not prove that a model cannot reason. Registration and metadata resolution never prove auth, quota, reachability, latency, or health.

The frozen Route Plan records every selected, rejected, and lower-priority skipped candidate, includes a stable digest, and reports live availability as unknown. Its effective `maxTokens` applies to the initial child activation; DSH continuable cold resume intentionally restores provider/model/persona/tools but not a previous activation's token budget. The tool returns this bounded explain snapshot. Legion starts exactly one child: if that child later fails, no other Route Candidate is tried. Route-specific `instructions` are additive system/persona policy, not a replacement task and not a user-message fallback.

### Catalog Layers, Teams, and Strategies

Config v2 adds three ordinary catalog namespaces. Layers are processed in order; a new name extends the catalog, the same name replaces it, and `disable` creates a tombstone that a later definition may revive. The root `profiles`, `teams`, and `strategies` maps form the final deployment layer.

```yaml
configVersion: 2
catalogLayers:
  - id: package-policy
    teams:
      coding:
        description: One executor and reviewer.
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
```

Member Slot `minParticipants` is a Team participation requirement: a positive minimum requires the Strategy to select that slot, while zero permits omission; a stage that selects the slot still starts its declared one/fanout participant count. `compileOrchestrationCatalog()` resolves Teams against the current compiled Profile catalog and lowers valid stages to detached, deep-frozen DSH primitive IR. `compileStrategy()` binds a bounded objective and permits only narrower invocation limits. External YAML/JSON receives strict runtime validation; TypeScript authors can use `defineTeam()`, `defineStrategy()`, and `defineStrategyFor()` for compile-time member and artifact wiring checks.

The exported `DEFAULT_CATALOG_LAYER` and shipped preset define `independent-review`, `research-panel`, and `plan-execute-review` through this exact interface. The shipped preset keeps them absent from the model-facing tool. A deployment may explicitly set `enableStrategies: true` to expose its active user/default catalog under its own authority; that opt-in is not a claim that curated defaults passed the real-model exposure gate. Programmatic callers may execute every compiled plan through `executeStrategyPlan(ctx, createStrategyExecutionSnapshot(profileCatalog, orchestrationCatalog), plan, parent, signal)`. The Strategy vocabulary contains only executable one-shot subagent stages; DSH Goals remain a separate single-objective session lifecycle rather than a Strategy member primitive.

`pnpm run benchmark:protocol` is a blocking deterministic regression gate over scripted direct-vs-strategy fixtures. It proves artifact aggregation, defect/source preservation, bounded child counts, and completed outcomes; it explicitly does **not** claim general model-quality uplift. Curated model exposure requires separate paired real-model campaigns with frozen case packs, blind scoring, safety metrics, cost/latency evidence, and a positive confidence interval. See [`benchmarks/README.md`](benchmarks/README.md).

When enabled, the same `legion` tool accepts a strict Strategy branch: `{ "kind": "strategy", "strategy": "independent-review", "objective": "...", "limits": { "deadlineMs": 60000 } }`. Profile calls retain the legacy `{ profile?, description, prompt, run_in_background? }` shape; fields cannot be mixed across branches.

`createStrategyExecutionSnapshot()` atomically binds the Profile policy and orchestration generation; a stale plan or mismatched catalog fails before child admission. `maxConcurrent` is a hard per-Team-Run ceiling for the current serial-stage/single-fanout IR; separate concurrent tool calls own separate Team Runs. Deployment-global admission requires the Host authority described by ADR 0013. The adapter walks only the already-validated static primitive list. It uses real one-shot `ctx.subagents` starts, applies the selected Profile policy and exact Route Plan, runs fanout members concurrently in canonical index order, validates structured artifacts, enforces deadline/output bounds, and owns every published run through quiescent, failed, or explicitly pending cleanup. Outcomes are a closed union: `completed | degraded | cancelled | failed`. This is not a persistent scheduler, retry owner, or Team runtime.

### Prompt Fragments

Prompt Fragments are explicit deployment resources, not arbitrary workspace reads:

```yaml
resourceRoots:
  bundled: resources

profiles:
  review:
    # ...normal profile fields...
    promptFiles:
      - root: bundled
        path: review.md
```

Root directories and file paths must use slash-separated relative paths without `.`, `..`, backslashes, drive letters, UNC paths, or device paths. Roots and every file segment must already exist below the physical config/plugin base and may not be a symlink or junction. Legion accepts only regular files, strict UTF-8 with an optional UTF-8 BOM, no NUL, at most 32 files per Profile, and a bounded aggregate byte budget. Missing, linked, malformed, or oversized explicit references fail activation and doctor with exit code `2`; they are never skipped or truncated.

The loader publishes one immutable content generation at activation. Provider lifecycle changes reuse it; edits require plugin/preset reactivation. `policyDigest` tracks authored references and root policy, `resourceDigest` tracks loaded raw bytes, and `catalogDigest` tracks policy + resources + provider facts. Absolute host paths and file contents are not emitted in diagnostics.

Prompt Fragments use the existing DSH child persona/system composition seam. Providers without that capability fail preflight—Legion does not silently inject system policy as a user task. Skills remain owned by DSH's scoped `ctx.skills` registry; profile-local Skill contributions are waiting for one upstream child-setup seam that also covers continuable cold resume.

Structured contracts are deliberately narrow:

- `findings-v1` returns `summary`, evidence-backed `findings`, `decisions`, `verification`, and `openRisks`;
- `review-v1` returns a `pass | needs-changes | block` verdict, evidence-backed severity findings, recommendations, and verification;
- the provider-owned `unknown` value is validated again and projected leaf-by-leaf into detached lossless JSON before Legion returns it;
- continuable background children remain text/session oriented because DSH does not attach one activation-wide `outputSchema` contract.

## Doctor and explain

The CLI validates one standalone Legion config against an explicit provider capability fixture:

```bash
dsh-legion doctor examples/legion.config.yml \
  --providers examples/providers.fixture.yml

dsh-legion explain examples/legion.config.yml \
  --providers examples/providers.fixture.yml --json
```

`doctor` prints a compact catalog summary; `explain` adds every effective profile, allowed execution mode, authored primary model route, result contract, and diagnostic code. `--json` emits the versioned `legion-explain` catalog view used by `explainCatalog()`. Actual selected/rejected Route Candidate evidence is invocation-specific and is returned in that Legion tool result's `routePlan`.

A provider fixture proves only the supplied static capability facts. The CLI does not attach to a live DSH process and does not inspect credentials, network reachability, provider health, quota, billing, latency, or model availability. Omitting `--providers` uses an empty fixture and produces unavailable-profile warnings rather than a false health claim.

Exit codes:

- `0`: inputs parsed and no error-severity catalog diagnostic; warnings are allowed;
- `1`: explain view generated with one or more capability errors;
- `2`: usage, I/O, Prompt Fragment confinement/content, YAML/JSON parse, or runtime schema validation failed.

### Config migration and rollback

`configVersion: 2` is the current runtime-validated document contract. Existing unversioned and explicit v1 Profile documents migrate to v2 with empty Team/Strategy namespaces and `enableStrategies: false`. Unknown future versions fail before plugin effects; v1 documents cannot smuggle v2 catalog fields.

Programmatic callers can use `exportConfigDocument(input)` for normalized v2 output. Export to `1` or `legacy-unversioned` is lossless only while no v2 Team/Strategy data is present; otherwise rollback fails loudly rather than discarding orchestration policy. All exports are detached and rematerialization-tested. File replacement, backup, and atomic rename remain the deployment owner's responsibility—Legion does not overwrite user presets.

## Compatibility and releases

The committed pnpm 11 lockfile is enforced with `--frozen-lockfile`. Required CI covers Windows at the exact Node 22.19.0 lower bound, Ubuntu Node 24, and isolated packed consumers at the minimum and latest-compatible DSH peer versions. The packed E2E installs the tarball into a clean consumer and executes one real, credential-free DSH child through the official in-process provider and a scripted LLM.

Tags must equal `v<package.json version>` and have a dated CHANGELOG entry. The release workflow reruns all gates, creates one immutable tarball, an SPDX SBOM derived from that tarball, SHA-256 checksums, and a GitHub build attestation, then publishes npm provenance and creates a GitHub Release. Configure npm Trusted Publishing for this repository before creating a release tag; the workflow intentionally carries no long-lived npm token.

## Development

Requirements: Node `^22.19.0 || >=24` and pnpm.

```bash
pnpm install --frozen-lockfile
pnpm run check
```

The repository's tests exercise the real DSH `ToolRuntime`, `SystemPrompt`, and `SubagentRuntime` interfaces with scripted providers.

## Design notes

- [Implementation roadmap](https://github.com/wxxb789/dsh-legion/blob/main/docs/roadmap.md)
- [ADR 0001: Semantic profile router](https://github.com/wxxb789/dsh-legion/blob/main/docs/adr/0001-semantic-profile-router.md)
- [ADR 0002: EffectiveProfile compiler](https://github.com/wxxb789/dsh-legion/blob/main/docs/adr/0002-effective-profile-compiler.md)
- [ADR 0003: Customization first; defaults as data](https://github.com/wxxb789/dsh-legion/blob/main/docs/adr/0003-customization-first-defaults-as-data.md)
- [ADR 0004: Type-driven orchestration contracts](https://github.com/wxxb789/dsh-legion/blob/main/docs/adr/0004-type-driven-contracts.md)
- [ADR 0005: Doctor explains fixtures, not health](https://github.com/wxxb789/dsh-legion/blob/main/docs/adr/0005-doctor-explains-fixtures-not-health.md)
- [ADR 0006: Confined Prompt Fragment snapshots](https://github.com/wxxb789/dsh-legion/blob/main/docs/adr/0006-confined-prompt-resource-snapshots.md)
- [ADR 0007: Pre-start exact Route Plans](https://github.com/wxxb789/dsh-legion/blob/main/docs/adr/0007-pre-start-exact-route-plans.md)
- [ADR 0008: Versioned config and rollback](https://github.com/wxxb789/dsh-legion/blob/main/docs/adr/0008-versioned-config-and-rollback.md)
- [ADR 0009: Reproducible provenance releases](https://github.com/wxxb789/dsh-legion/blob/main/docs/adr/0009-reproducible-provenance-releases.md)
- [ADR 0010: Declarative Team/Strategy IR](https://github.com/wxxb789/dsh-legion/blob/main/docs/adr/0010-declarative-team-strategy-ir.md)
- [ADR 0011: Two-tier Strategy benchmark gate](https://github.com/wxxb789/dsh-legion/blob/main/docs/adr/0011-two-tier-strategy-benchmark-gate.md)
- [ADR 0012: Explicit model Strategy authority](https://github.com/wxxb789/dsh-legion/blob/main/docs/adr/0012-model-strategy-exposure-is-explicit-authority.md)
- [ADR 0013: Aggregate budgets require Host admission authority](https://github.com/wxxb789/dsh-legion/blob/main/docs/adr/0013-aggregate-budgets-require-host-admission-authority.md)
- [ADR 0014: V1 deep Modules own lifecycle and publication](https://github.com/wxxb789/dsh-legion/blob/main/docs/adr/0014-v1-deep-modules-own-lifecycle-and-publication.md)
- [Public contract v1](https://github.com/wxxb789/dsh-legion/blob/main/docs/public-contract-v1.md)
- [OMO + Senpi inspirations and pitfalls](https://github.com/wxxb789/dsh-legion/blob/main/docs/research/omo-senpi-inspirations-and-pitfalls.md)
- [Feature leakage audit vs oh-my-openagent](https://github.com/wxxb789/dsh-legion/blob/main/docs/research/feature-leakage-audit.md)
- [oh-my-openagent research](https://github.com/wxxb789/dsh-legion/blob/main/docs/research/oh-my-openagent.md)
- [Interface alternatives](https://github.com/wxxb789/dsh-legion/blob/main/docs/design/alternatives.md)

## License

MIT
