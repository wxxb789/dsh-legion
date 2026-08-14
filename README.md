# dsh-legion

Configurable multi-model subagent profiles for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

Legion turns raw model and backend choices into semantic profiles such as `deep`, `quick`, `explore`, `translation`, and `review`. The main DSH agent chooses a profile by task fit; the plugin resolves that profile to a fixed subagent backend, child model route, persona, tool policy, depth limit, and background policy.

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

`0.1.0` is an MVP for semantic profile routing over DSH subagents.

Supported:

- multiple named profiles in one Legion-enabled DSH agent preset;
- independent subagent backend per profile (`spawn`, `fork`, `codex`, `claude-code`, or another registered provider);
- independent child LLM `provider`, `model`, and `maxTokens` for in-process DSH children;
- per-profile persona, tool allow/deny policy, depth limit, and foreground/background default;
- continuable background children with normal DSH settlement notifications and follow-up support;
- concurrent sibling calls through DSH's parallel tool execution;
- fail-loud provider and capability validation;
- reversible Cordis lifecycle and HMR-safe registrations.

Not yet supported:

- model fallback chains or automatic provider health scoring;
- a Legion-owned team/DAG runtime—the coordinator uses DSH's existing subagent and workflow capabilities;
- selecting a different **DSH agent preset** for each child. Current in-process subagents inherit the parent's standing preset composition; Legion profiles can still vary model, persona, tools, and backend. A true per-child preset requires a small upstream DSH subagent composition seam and is tracked as a roadmap item;
- a GUI settings card. External Host settings namespaces are not currently exposed by the DSH Web allowlist, so v0.1 keeps configuration in the user-owned agent preset.

## Install

### From a local checkout

```powershell
dsh plugin --profile web add Q:\repos\dsh-legion
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
        agentOptions:
          provider: deepseek-official
          model: deepseek-v4-pro
        maxDepth: 3
        defaultRunInBackground: true

      quick:
        description: Translation, exploration, extraction, and summaries.
        subagentProvider: spawn
        agentOptions:
          provider: deepseek-official
          model: deepseek-v4-flash
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

Profile names must match `^[a-z][a-z0-9-]*$`. Legion follows the DSH provider lifecycle: profiles whose `subagentProvider` is absent are omitted from the live tool schema, and the tool plus prompt guidance disappear when no configured provider is available. They return automatically when the provider is registered again.

### Profile

| Field | Default | Meaning |
|---|---:|---|
| `description` | required | Task-fit guidance shown to the coordinator. |
| `subagentProvider` | `spawn` | Named DSH subagent backend. This is not an LLM provider. |
| `agentOptions.provider` | inherited | Child LLM provider route. |
| `agentOptions.model` | inherited | Child model id. |
| `agentOptions.maxTokens` | inherited | Child output token limit. |
| `persona` | inherited | Child persona override; requires provider support. |
| `toolFilter.allow` / `deny` | none | Child tool visibility restriction; requires provider support. |
| `maxDepth` | `3` | Absolute numeric depth, or `provider-managed` for product backends. |
| `defaultRunInBackground` | `true` | Use a continuable child when the tool call omits the flag. |

For `codex` and `claude-code`, the external product owns its model selection. Use `maxDepth: provider-managed` and normally `defaultRunInBackground: false` because those providers are one-shot.

## Development

Requirements: Node `^22.19.0 || >=24` and pnpm.

```bash
pnpm install
pnpm run check
```

The repository's tests exercise the real DSH `ToolRuntime`, `SystemPrompt`, and `SubagentRuntime` interfaces with scripted providers.

## Design notes

- [ADR 0001: Semantic profile router](https://github.com/wxxb789/dsh-legion/blob/main/docs/adr/0001-semantic-profile-router.md)
- [oh-my-openagent research](https://github.com/wxxb789/dsh-legion/blob/main/docs/research/oh-my-openagent.md)
- [Interface alternatives](https://github.com/wxxb789/dsh-legion/blob/main/docs/design/alternatives.md)

## License

MIT
