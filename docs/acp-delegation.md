# ACP delegation to external coding agents

DSH ships `@deepseek-ai/dsh-subagent-acp`, a generic [Agent Client Protocol](https://agentclientprotocol.com) backend. It spawns one subprocess per run and drives it over ACP, so mounting it once per external agent turns any ACP-speaking CLI into an ordinary `ctx.subagents` provider. Legion contributes the delegation policy: one Profile per agent, constrained to what an out-of-process child can actually honor.

Nothing here is on by default.

## What an ACP child is, and is not

An ACP child has its **own process, session, model, credentials, and tools**. Nothing of this conversation crosses the boundary except the workspace directory. That is the whole point — and it is also why an ACP Profile is more constrained than a local one:

| Legion Profile field | ACP | Why |
|---|---|---|
| `maxDepth` | must be `provider-managed` | this process cannot enforce a depth limit inside another runtime |
| `defaultRunInBackground` | must be `false` | the ACP backend registers no continuable activation |
| `result` | must be `text` | ACP advertises no structured output schema |
| `persona`, `promptFiles` | forbidden | the child runs its own agent loop and never receives a parent persona |
| `toolFilter` | forbidden | the child owns its own tool registry |
| `routes`, `agentOptions` | forbidden | the child picks its own model; it has no DSH LLM route |

`acpProfile()` fixes all of these by construction, and `assertAcpProfileCompatible()` rejects an authored Profile that violates them — at the authoring site, rather than as a provider-capability error once the provider is finally mounted.

## Supported agents

| Profile | Agent | Spawns |
|---|---|---|
| `codex` | OpenAI Codex CLI | `npx -y @agentclientprotocol/codex-acp` |
| `claude-code` | Anthropic Claude Code | `npx -y @agentclientprotocol/claude-agent-acp` |
| `oh-my-pi` | oh-my-pi | `omp acp` |
| `kimi-code` | Moonshot Kimi Code CLI | `kimi acp` |
| `grok-build` | xAI Grok Build | `grok agent stdio` |
| `pi` | Pi Coding Agent | `npx -y pi-acp` |
| `github-copilot` | GitHub Copilot CLI | `copilot --acp` |
| `hermes` | Nous Research Hermes Agent | `hermes acp` |
| `zcode` | ZCode | no portable command — see below |

Two details worth keeping:

- **`gh` is not an ACP agent.** The GitHub *CLI* does not speak ACP; the GitHub *Copilot* CLI (`copilot`) does, behind `--acp`. The Profile is named `github-copilot` for that reason.
- **Claude Code's adapter moved.** `@zed-industries/claude-code-acp` is deprecated and renamed to `@agentclientprotocol/claude-agent-acp`. Legion ships the current one.

### zcode

ZCode speaks its own app-server protocol, and its ACP bridge is a third-party adapter you build locally and run by absolute path. There is no portable command to ship, so `zcode` is marked `deployment-specific`: it gets a Profile so the agent is nameable and documentable, but no generated mount row. Write that row yourself, with `providerName: zcode`.

## Setting it up

`examples/legion.acp.fragment.yml` is generated from the catalog and carries both halves. Regenerate it with `pnpm run render:acp`.

1. **Install and authenticate each agent you want.** They are separate products with separate credentials. An agent that is not installed simply fails to spawn.
2. **Mount one ACP backend per agent** in the DSH agent preset that already mounts `dsh-legion` — registering a `ctx.subagents` provider is DSH's job:

   ~~~yaml
   - name: '@deepseek-ai/dsh-subagent-acp'
     config:
       providerName: codex
       command: npx
       args: ['-y', '@agentclientprotocol/codex-acp']
       permission: reject
   ~~~

3. **Append the catalog layer** to Legion's `catalogLayers` (requires `configVersion: 2`).

The `providerName` in step 2 must equal the Profile name in step 3. Generating both from one descriptor list is exactly what `acpMountRows()` and `acpCatalogLayer()` are for — a mismatch produces a Profile that is silently inactive rather than an error.

## Adopting one agent at a time

A Profile whose provider is not mounted is **not** a failure. It compiles to a `PROFILE_PROVIDER_UNAVAILABLE` warning and stays inactive, so it never reaches the model and never breaks the rest of the catalog. Add the whole layer, then mount backends as you install agents.

`dsh-legion doctor` reports which Profiles are inactive and why.

## Permissions and trust

`permission: reject` is the default here and in DSH: the ACP backend auto-declines the child's `session/request_permission` prompts, and no prompt reaches a human. An external agent delegated to unattended should not receive write authority implicitly. Raise it per agent, deliberately, once you trust that delegation — and remember the child's tools are its own, so Legion's `toolFilter` cannot restrain it.

Credentials are per agent. The ACP backend forwards a credential-scrubbed copy of the parent environment plus whatever you put in its `env`, so an explicit key reaches the child while ambient secrets do not leak implicitly.

## Bringing your own agent

The curated table is ordinary data, and the same functions build your own:

~~~ts
import { acpCatalogLayer, acpMountRows, defineAcpAgent } from 'dsh-legion'

const agents = [defineAcpAgent({
  id: 'my-agent',
  title: 'My Agent',
  description: 'Delegate to my agent in its own workspace process.',
  command: 'my-agent',
  args: ['acp'],
  reference: 'https://example.invalid/docs',
  entrypoint: 'verified',
})]

const layer = acpCatalogLayer(agents)   // -> Legion catalogLayers entry
const rows = acpMountRows(agents)       // -> DSH composition rows
~~~

`entrypoint` records how well the spawn command is known: `verified` (portable, from the agent's own docs — the only state that yields a mount row), `deployment-specific` (real ACP support, but the command depends on a local path), or `unverified` (no authoritative source). Legion never ships a guessed command, because a guess fails at spawn time as an opaque `ENOENT`.
