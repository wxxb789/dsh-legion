/**
 * Optional ACP delegation catalog.
 *
 * DSH ships `@deepseek-ai/dsh-subagent-acp`, a generic Agent Client Protocol
 * backend that spawns one subprocess per run and drives it over ACP. Mounting
 * it once per external agent — each with its own `providerName` and
 * `command` — turns Codex, Claude Code, and other ACP-speaking CLIs into
 * ordinary `ctx.subagents` providers. Legion contributes the delegation
 * policy for them: one Profile per agent, constrained to what an
 * out-of-process ACP child can actually honor.
 *
 * Nothing here is enabled by default and nothing here is privileged. An agent
 * is an ordinary {@link AcpAgentSpec} record, the layer is an ordinary
 * {@link CatalogLayer}, and a deployment can define its own agents with the
 * same functions the curated table uses.
 *
 * The mount rows and the Profiles are generated from ONE descriptor list, so a
 * Profile's `subagentProvider` cannot drift from the `providerName` the
 * composition actually registers — the single most common way this setup
 * silently produces an inactive Profile.
 *
 * Generated Profiles and layers are detached but deliberately NOT frozen: they
 * are configuration *input*, and Legion's Schemastery ingestion resolves
 * defaults by writing into the value it is given. `materializeConfig` is what
 * produces the owned, deeply frozen catalog. Descriptors and mount rows are
 * outputs and stay frozen.
 */
import yaml from 'js-yaml'
import type { SpecialistSpec } from './config.ts'
import type { CatalogLayer } from './orchestration-contract.ts'
import { ORCHESTRATION_NAME } from './orchestration-contract.ts'
import { deepFreeze } from './internal/value.ts'

/** The DSH plugin that provides a generic ACP subagent backend. */
export const ACP_PROVIDER_PLUGIN = '@deepseek-ai/dsh-subagent-acp'

/** Catalog layer id used by {@link acpCatalogLayer} when no id is given. */
export const ACP_CATALOG_LAYER_ID = 'legion-acp-v1'

/**
 * How well an entry's ACP entrypoint is known.
 *
 * `verified` — a portable spawn command read off the agent's own
 * documentation or repository. This is the only state that yields a
 * composition row.
 *
 * `deployment-specific` — the agent really does speak ACP, but its entrypoint
 * depends on something only the deployment knows, such as an absolute path to
 * a locally built adapter. The Profile ships so the agent is nameable and
 * documentable; the mount row is the deployment's to write.
 *
 * `unverified` — no authoritative source established an entrypoint. Shipping
 * a guessed command would fail at spawn time as an opaque ENOENT, so nothing
 * is emitted.
 */
export const ACP_ENTRYPOINT_PROVENANCE = ['verified', 'deployment-specific', 'unverified'] as const

export type AcpEntrypointProvenance = typeof ACP_ENTRYPOINT_PROVENANCE[number]

/** One external agent Legion can delegate to over ACP. */
export interface AcpAgentSpec {
  /**
   * Profile name and default `ctx.subagents` provider name. Must match
   * {@link ORCHESTRATION_NAME}.
   */
  readonly id: string
  /** Vendor-facing product name, used in generated guidance. */
  readonly title: string
  /** Coordinator-facing routing description for the generated Profile. */
  readonly description: string
  /**
   * Executable the ACP backend spawns. Present only for a `verified` entry;
   * the other states have no portable command to spawn.
   */
  readonly command?: string
  /** Arguments passed to {@link command}. */
  readonly args?: readonly string[]
  /**
   * Environment variable carrying this agent's credential. Set only where the
   * agent's own ACP documentation names one — an env var inferred from a
   * vendor's general convention is prose, not configuration.
   */
  readonly credentialEnv?: string
  /** Where the ACP entrypoint is documented. */
  readonly reference?: string
  /** How well the entrypoint is known; see {@link ACP_ENTRYPOINT_PROVENANCE}. */
  readonly entrypoint: AcpEntrypointProvenance
}

/** A generated `@deepseek-ai/dsh-subagent-acp` composition row. */
export interface AcpMountRow {
  /** Plugin name to mount. */
  readonly name: typeof ACP_PROVIDER_PLUGIN
  /** Config for that mount. */
  readonly config: {
    readonly providerName: string
    readonly command: string
    readonly args: readonly string[]
    readonly permission: 'allow' | 'reject'
  }
}

/** Options shared by the layer and mount-row generators. */
export interface AcpCatalogOptions {
  /** Catalog layer id; defaults to {@link ACP_CATALOG_LAYER_ID}. */
  readonly layerId?: string
  /**
   * How the ACP backend auto-answers the child's permission prompts.
   * Defaults to `reject`, matching the DSH backend's own default: an external
   * agent delegated to without a human in the loop should not be granted
   * write authority implicitly.
   */
  readonly permission?: 'allow' | 'reject'
}

/**
 * Every field an ACP Profile must NOT set, with the reason. An out-of-process
 * child has its own runtime, so this process cannot enforce any of them; the
 * catalog compiler would reject the Profile with a provider-capability error
 * once the provider is actually mounted, which is far from the authoring site.
 */
const ACP_FORBIDDEN_FIELDS = Object.freeze({
  persona: 'an ACP child runs its own agent loop and ignores a parent persona',
  toolFilter: 'an ACP child owns its own tool registry',
  promptFiles: 'Prompt Fragments compose into a persona this child cannot receive',
  routes: 'an ACP child selects its own model; it has no DSH LLM route',
  agentOptions: 'an ACP child selects its own model; it has no DSH LLM route',
} as const)

/** An ACP agent spec rejected before it can become a Profile. */
export class AcpCatalogError extends Error {
  /** Stable machine code for callers mapping this to their own taxonomy. */
  readonly code = 'LEGION_ACP_CATALOG_INVALID'

  constructor(message: string) {
    super(`dsh-legion: ${message}`)
    this.name = 'AcpCatalogError'
  }
}

/**
 * Validate and freeze one agent spec.
 * @param spec - the authored descriptor.
 * @returns the frozen descriptor.
 */
export function defineAcpAgent(spec: AcpAgentSpec): AcpAgentSpec {
  if (!ORCHESTRATION_NAME.test(spec.id)) {
    throw new AcpCatalogError(`ACP agent id "${spec.id}" must match ${String(ORCHESTRATION_NAME)}`)
  }
  if (spec.description.trim().length === 0) {
    throw new AcpCatalogError(`ACP agent "${spec.id}" requires a non-empty description`)
  }
  if (spec.entrypoint === 'verified' && (spec.command === undefined || spec.command.length === 0)) {
    throw new AcpCatalogError(`ACP agent "${spec.id}" is marked verified but declares no command`)
  }
  if (spec.entrypoint !== 'verified' && spec.command !== undefined) {
    throw new AcpCatalogError(
      `ACP agent "${spec.id}" declares a command but is not marked verified; an entry that ships a command must be verified`,
    )
  }
  return deepFreeze({ ...spec, args: [...spec.args ?? []] })
}

/**
 * Build the Profile for one ACP agent. Every constraint an out-of-process
 * child cannot honor is fixed here rather than left to the author: depth is
 * provider-managed, the result contract is `text`, and delegation is
 * foreground because the ACP backend exposes no continuable activation.
 * @param spec - the agent descriptor.
 * @returns the Profile, ready for a catalog layer.
 */
export function acpProfile(spec: AcpAgentSpec): SpecialistSpec {
  const agent = defineAcpAgent(spec)
  return {
    description: agent.description,
    subagentProvider: agent.id,
    // An ACP child runs in its own process with its own runtime; this process
    // cannot enforce a numeric delegation depth across that boundary.
    maxDepth: 'provider-managed' as const,
    // The ACP backend registers no continuable activation, so a background
    // request would be rejected by the catalog compiler at compile time.
    defaultRunInBackground: false,
    // Structured contracts require provider-side output schemas, which ACP
    // does not advertise.
    result: 'text' as const,
  }
}

/**
 * Refuse an authored Profile that an ACP provider could never satisfy, naming
 * the field and the reason at the authoring site.
 * @param name - the Profile name, for the diagnostic.
 * @param profile - the authored Profile.
 */
export function assertAcpProfileCompatible(name: string, profile: SpecialistSpec): void {
  const fields = profile as unknown as Record<string, unknown>
  for (const [field, reason] of Object.entries(ACP_FORBIDDEN_FIELDS)) {
    if (fields[field] !== undefined) {
      throw new AcpCatalogError(`ACP Profile "${name}" must not set ${field}: ${reason}`)
    }
  }
  if (typeof profile.maxDepth === 'number') {
    throw new AcpCatalogError(
      `ACP Profile "${name}" must use maxDepth "provider-managed": an out-of-process child cannot enforce a numeric depth`,
    )
  }
  if (profile.defaultRunInBackground) {
    throw new AcpCatalogError(
      `ACP Profile "${name}" must set defaultRunInBackground false: the ACP backend registers no continuable activation`,
    )
  }
  if (profile.result !== undefined && profile.result !== 'text') {
    throw new AcpCatalogError(
      `ACP Profile "${name}" must use the "text" result contract: ACP advertises no structured output`,
    )
  }
}

/**
 * Build an opt-in catalog layer of ACP Profiles.
 * @param agents - the agents to expose.
 * @param options - layer id and permission policy.
 * @returns the frozen catalog layer, ready for `catalogLayers`.
 */
export function acpCatalogLayer(
  agents: readonly AcpAgentSpec[],
  options: AcpCatalogOptions = {},
): CatalogLayer<SpecialistSpec> {
  const profiles: Record<string, SpecialistSpec> = {}
  for (const agent of agents) {
    if (profiles[agent.id] !== undefined) {
      throw new AcpCatalogError(`duplicate ACP agent id "${agent.id}"`)
    }
    const profile = acpProfile(agent)
    assertAcpProfileCompatible(agent.id, profile)
    profiles[agent.id] = profile
  }
  return { id: options.layerId ?? ACP_CATALOG_LAYER_ID, profiles }
}

/**
 * Render a copy-pasteable composition fragment for a set of ACP agents: the
 * DSH provider rows and the Legion catalog layer, in one document, generated
 * from the same descriptors so the two halves cannot disagree.
 * @param agents - the agents to document.
 * @param options - layer id and permission policy.
 * @returns the YAML fragment.
 */
export function renderAcpFragment(
  agents: readonly AcpAgentSpec[],
  options: AcpCatalogOptions = {},
): string {
  const rows = acpMountRows(agents, options)
  const layer = acpCatalogLayer(agents, options)
  const incomplete = agents.filter(agent => agent.entrypoint !== 'verified')
  const header = [
    '# Optional ACP delegation. Generated from the ACP agent catalog — do not edit by hand.',
    '#',
    '# acpProviderRows mounts one DSH ACP backend per external agent. Those rows',
    "# belong in the DSH agent preset that already mounts dsh-legion, NOT in Legion",
    '# config: registering a ctx.subagents provider is DSH\'s job, not Legion\'s.',
    '#',
    '# legionCatalogLayer gives each registered provider a Profile. Append it to',
    '# Legion\'s catalogLayers; it requires configVersion 2. A Profile whose provider',
    '# is not mounted stays inactive with a PROFILE_PROVIDER_UNAVAILABLE warning,',
    '# never a hard failure, so you can adopt these one at a time.',
    '#',
    '# Each agent must be installed and authenticated separately. Each runs in its',
    '# own process with its own model, credentials, and tools; none of them inherit',
    '# this conversation. permission: reject declines the child\'s own permission',
    '# prompts — raise it deliberately, per agent, once you trust the delegation.',
    ...incomplete.length === 0 ? [] : [
      '#',
      `# No portable spawn command exists for: ${incomplete.map(agent => agent.id).join(', ')}.`,
      '# Mount those yourself with @deepseek-ai/dsh-subagent-acp, using a providerName',
      '# equal to the Profile name.',
    ],
    '',
  ].join('\n')
  const body = yaml.dump({ acpProviderRows: rows, legionCatalogLayer: layer }, {
    noRefs: true,
    lineWidth: 100,
    sortKeys: false,
  })
  return `${header}${body}`
}

/**
 * Curated external agents with an established ACP entrypoint.
 *
 * Every command here was read off the agent's own documentation or repository
 * and independently re-checked against the npm registry. Two findings shaped
 * the table and are recorded so they are not silently "fixed" back:
 *
 * - Claude Code's adapter moved: `@zed-industries/claude-code-acp` is
 *   deprecated and renamed to `@agentclientprotocol/claude-agent-acp`.
 * - The Zed registry entry for Grok pins `@xai-official/grok@1.0.4`, a version
 *   that does not exist on npm (latest is 1.0.1). The installed `grok` binary
 *   is used instead, which is both authoritative and pin-free.
 *
 * This is ordinary data. A deployment can extend, replace, or ignore it.
 */
export const ACP_AGENT_CATALOG: readonly AcpAgentSpec[] = Object.freeze([
  defineAcpAgent({
    id: 'codex',
    title: 'OpenAI Codex CLI',
    description: 'Delegate to OpenAI Codex in its own workspace process.',
    command: 'npx',
    args: ['-y', '@agentclientprotocol/codex-acp'],
    credentialEnv: 'CODEX_API_KEY',
    reference: 'https://github.com/agentclientprotocol/codex-acp',
    entrypoint: 'verified',
  }),
  defineAcpAgent({
    id: 'claude-code',
    title: 'Anthropic Claude Code',
    description: 'Delegate to Claude Code in its own workspace process.',
    command: 'npx',
    args: ['-y', '@agentclientprotocol/claude-agent-acp'],
    reference: 'https://github.com/zed-industries/claude-agent-acp',
    entrypoint: 'verified',
  }),
  defineAcpAgent({
    id: 'oh-my-pi',
    title: 'oh-my-pi',
    description: 'Delegate to the oh-my-pi coding agent in its own workspace process.',
    command: 'omp',
    args: ['acp'],
    reference: 'https://github.com/can1357/oh-my-pi',
    entrypoint: 'verified',
  }),
  defineAcpAgent({
    id: 'kimi-code',
    title: 'Moonshot Kimi Code CLI',
    description: 'Delegate to Kimi Code in its own workspace process.',
    command: 'kimi',
    args: ['acp'],
    reference: 'https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-acp.html',
    entrypoint: 'verified',
  }),
  defineAcpAgent({
    id: 'zcode',
    title: 'ZCode',
    description: 'Delegate to ZCode in its own workspace process.',
    // ZCode itself speaks its own app-server protocol; the ACP bridge is a
    // third-party adapter run from a locally built absolute path, so there is
    // no portable command to ship.
    reference: 'https://github.com/william0wang/zcode-acp',
    entrypoint: 'deployment-specific',
  }),
  defineAcpAgent({
    id: 'grok-build',
    title: 'xAI Grok Build',
    description: 'Delegate to xAI Grok Build in its own workspace process.',
    command: 'grok',
    args: ['agent', 'stdio'],
    reference: 'https://docs.x.ai/build/cli/reference',
    entrypoint: 'verified',
  }),
  defineAcpAgent({
    id: 'pi',
    title: 'Pi Coding Agent',
    description: 'Delegate to the Pi coding agent in its own workspace process.',
    command: 'npx',
    args: ['-y', 'pi-acp'],
    reference: 'https://github.com/svkozak/pi-acp',
    entrypoint: 'verified',
  }),
  defineAcpAgent({
    id: 'github-copilot',
    title: 'GitHub Copilot CLI',
    description: 'Delegate to GitHub Copilot CLI in its own workspace process.',
    // The GitHub CLI (`gh`) does not speak ACP; the Copilot CLI (`copilot`) does.
    command: 'copilot',
    args: ['--acp'],
    reference: 'https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server',
    entrypoint: 'verified',
  }),
  defineAcpAgent({
    id: 'hermes',
    title: 'Nous Research Hermes Agent',
    description: 'Delegate to the Hermes agent in its own workspace process.',
    command: 'hermes',
    args: ['acp'],
    reference: 'https://hermes-agent.nousresearch.com/docs/user-guide/features/acp',
    entrypoint: 'verified',
  }),
])

/**
 * Build the composition rows that register these agents as ACP providers.
 * Only `verified` entries produce a row: the other states have no portable
 * command, and emitting a placeholder would fail at run time instead of at
 * composition time.
 * @param agents - the agents to mount.
 * @param options - permission policy.
 * @returns one mount row per agent with a known entrypoint, in agent order.
 */
export function acpMountRows(
  agents: readonly AcpAgentSpec[],
  options: AcpCatalogOptions = {},
): readonly AcpMountRow[] {
  const permission = options.permission ?? 'reject'
  return deepFreeze(agents.flatMap((agent) => {
    if (agent.command === undefined) return []
    return [{
      name: ACP_PROVIDER_PLUGIN,
      config: {
        providerName: agent.id,
        command: agent.command,
        args: [...agent.args ?? []],
        permission,
      },
    }]
  }))
}
