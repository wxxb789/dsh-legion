# dsh-legion

Configurable multi-model subagent profiles for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

Legion turns raw model and backend choices into semantic profiles such as `deep`, `quick`, `explore`, `translation`, and `review`. The main DSH agent chooses a profile by task fit; the plugin resolves that profile to a fixed subagent backend, child model route, persona, tool policy, depth limit, result contract, and background policy.

Legion is customization-first: users can define their own Profiles and, on the v1.0 path, compose them into custom Teams with custom bounded orchestration Strategies. Legion will ship a polished Default Catalog, but every default uses the same replaceable public contracts and receives no hidden runtime privilege. Version 0.2 implements the Profile layer; Team and Strategy contracts are tracked in the [roadmap](docs/roadmap.md).

```text
SOTA coordinator
  └─ legion(profile, prompt)
       ├─ deep        -> SOTA reasoning model
       ├─ quick       -> lightweight model
       ├─ explore     -> fast search model + read-only tools
       └─ review      -> independent critic model
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

`0.3.0` adds deterministic exact Route Candidates and immutable pre-start Route Plans without Legion-owned failure replay.

Supported:

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

- model fallback chains or automatic provider health scoring;
- a Legion-owned team/DAG runtime—the coordinator uses DSH's existing subagent and workflow capabilities;
- selecting a different **DSH agent preset** for each child. Current in-process subagents inherit the parent's standing preset composition; Legion profiles can still vary model, persona, tools, and backend. A true per-child preset requires a small upstream DSH subagent composition seam and is tracked as a roadmap item;
- a GUI settings card. External Host settings namespaces are not currently exposed by the DSH Web allowlist, so v0.2 keeps configuration in the user-owned agent preset.

## Install

### From a local checkout

A local checkout needs built `lib/` artifacts, but profile-level build approval is not required. Prepare a clean checkout first, then add it:

```bash
git clone https://github.com/wxxb789/dsh-legion.git
cd dsh-legion
pnpm install
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
| `toolName` | `legion` | Model-facing tool name. |
| `profiles` | required | Map from semantic profile name to fixed child policy. |
| `defaultProfile` | none | Profile used when a call omits `profile`; otherwise `profile` is required. |
| `enableRunInBackground` | `true` | Expose and accept `run_in_background`. |
| `guidance` | none | Additional coordinator guidance appended to the generated profile table. |
| `resourceRoots` | `{}` | Deployment-owned aliases for relative directories containing Prompt Fragments. |
| `maxResourceBytes` | `65536` | Maximum combined raw Prompt Fragment bytes loaded for one Profile; hard ceiling 4 MiB. |

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

## Development

Requirements: Node `^22.19.0 || >=24` and pnpm.

```bash
pnpm install
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
- [OMO + Senpi inspirations and pitfalls](https://github.com/wxxb789/dsh-legion/blob/main/docs/research/omo-senpi-inspirations-and-pitfalls.md)
- [Feature leakage audit vs oh-my-openagent](https://github.com/wxxb789/dsh-legion/blob/main/docs/research/feature-leakage-audit.md)
- [oh-my-openagent research](https://github.com/wxxb789/dsh-legion/blob/main/docs/research/oh-my-openagent.md)
- [Interface alternatives](https://github.com/wxxb789/dsh-legion/blob/main/docs/design/alternatives.md)

## License

MIT
