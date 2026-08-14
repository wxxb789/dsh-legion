import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubagentProvider, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { Config, type LegionProfile, validateConfig } from './config.ts'
import { renderCoordinatorGuidance } from './prompt.ts'
import { outputText, settleForeground } from './settlement.ts'

export { Config, LegionProfileSchema, PROFILE_NAME, validateConfig } from './config.ts'
export type { Config as LegionConfig, LegionProfile } from './config.ts'
export { renderCoordinatorGuidance } from './prompt.ts'

export const name = 'dsh-legion'
export const inject = ['tools', 'subagents', 'systemPrompt']

const PROMPT_ORDER = 116.75

interface ToolArgs {
  profile?: string
  description: string
  prompt: string
  run_in_background?: boolean
}

function requireProfile(config: Config, name: string | undefined): [string, LegionProfile] {
  const selected = name ?? config.defaultProfile
  if (selected === undefined) {
    throw new Error('dsh-legion: profile is required because no defaultProfile is configured')
  }
  const profile = config.profiles[selected]
  if (profile === undefined) {
    throw new Error(`dsh-legion: unknown profile "${selected}"`)
  }
  return [selected, profile]
}

function requireProvider(
  ctx: Context,
  profileName: string,
  profile: LegionProfile,
  runInBackground: boolean,
): SubagentProvider {
  const provider = ctx.subagents.getProvider(profile.subagentProvider)
  if (provider === undefined) {
    throw new Error(
      `dsh-legion: profile "${profileName}" requires unavailable subagent provider "${profile.subagentProvider}"`,
    )
  }
  if (runInBackground) {
    if (provider.prepareContinuable === undefined) {
      throw new Error(
        `dsh-legion: profile "${profileName}" cannot run in the background because provider "${provider.name}" is not continuable`,
      )
    }
    // Continuable children are composed by the DSH continuation manager, not
    // SubagentProvider.start(). The manager itself enforces depth and installs
    // persona/toolFilter, so one-shot capability flags do not apply here.
    return provider
  }
  if (typeof profile.maxDepth === 'number' && !provider.capabilities.depthLimit) {
    throw new Error(
      `dsh-legion: profile "${profileName}" sets numeric maxDepth but provider "${provider.name}" cannot enforce it; use provider-managed`,
    )
  }
  if (profile.persona !== undefined && !provider.capabilities.persona) {
    throw new Error(
      `dsh-legion: profile "${profileName}" sets persona but provider "${provider.name}" does not support it`,
    )
  }
  if (profile.toolFilter !== undefined && !provider.capabilities.toolFilter) {
    throw new Error(
      `dsh-legion: profile "${profileName}" sets toolFilter but provider "${provider.name}" does not support it`,
    )
  }
  return provider
}

function runInBackground(config: Config, profile: LegionProfile, args: ToolArgs): boolean {
  if (!config.enableRunInBackground) {
    if (args.run_in_background === true) {
      throw new Error('dsh-legion: run_in_background is disabled for this plugin instance')
    }
    return false
  }
  return args.run_in_background ?? profile.defaultRunInBackground
}

function requestFor(
  parent: Agent,
  args: ToolArgs,
  profile: LegionProfile,
): Omit<SubagentStartRequest, 'signal'> {
  return {
    label: args.description,
    prompt: [{ type: 'text', text: args.prompt }] as ContentBlock[],
    parent,
    ...profile.agentOptions === undefined ? {} : { agentOptions: profile.agentOptions },
    ...profile.persona === undefined ? {} : { persona: profile.persona },
    ...profile.toolFilter === undefined ? {} : { toolFilter: profile.toolFilter },
    ...typeof profile.maxDepth === 'number' ? { maxDepth: profile.maxDepth } : {},
  }
}

function registerTool(ctx: Context, config: Config): () => void {
  const profileNames = Object.keys(config.profiles)
  const profileRequired = config.defaultProfile === undefined
  const profileDescription = config.defaultProfile === undefined
    ? 'Configured semantic profile. Choose by task fit, not by raw model preference.'
    : `Configured semantic profile. Defaults to ${config.defaultProfile}.`

  return ctx.tools.register(defineTool({
    name: config.toolName,
    description:
      'Delegate focused work through a configured Legion profile. Each profile fixes the child backend, model route, persona, tools, and depth policy. '
      + (config.enableRunInBackground
        ? 'Background execution returns a durable child id immediately; foreground execution waits for the final result.'
        : 'This instance only allows foreground execution.'),
    parameters: {
      profile: {
        type: 'string',
        ...profileRequired ? { required: true as const } : {},
        enum: profileNames,
        description: profileDescription,
      },
      description: {
        type: 'string',
        required: true,
        description: 'A short 3-5 word label for the delegated task.',
      },
      prompt: {
        type: 'string',
        required: true,
        description: 'A complete standalone task for a fresh profile, or focused follow-up context for an inheriting backend.',
      },
      ...config.enableRunInBackground ? {
        run_in_background: {
          type: 'boolean' as const,
          description: 'Whether to return a durable child id immediately. When omitted, the selected profile decides.',
        },
      } : {},
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'continuable' },
              profile: { type: 'string', required: true },
              subagentId: { type: 'string', required: true },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'foreground' },
              profile: { type: 'string', required: true },
              runId: { type: 'string', required: true },
              output: { type: 'array', required: true, items: { type: 'json' } },
            },
          },
        ],
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.kind === 'continuable'
          ? `started Legion profile ${value.profile} as subagent ${value.subagentId}`
          : outputText(value.output),
      }],
    },
    isConcurrencySafe: () => true,
    async execute(rawArgs, exec) {
      const args = rawArgs as unknown as ToolArgs
      const parent = exec.agent
      if (parent === undefined) {
        throw new Error('dsh-legion: tool requires a calling agent')
      }

      const [profileName, profile] = requireProfile(config, args.profile)
      const background = runInBackground(config, profile, args)
      requireProvider(ctx, profileName, profile, background)
      const request = requestFor(parent, args, profile)

      if (background) {
        const started = await ctx.subagents.startContinuable({
          provider: profile.subagentProvider,
          label: args.description,
          request,
          signal: exec.signal,
        })
        return {
          kind: 'continuable' as const,
          profile: profileName,
          subagentId: started.childId,
        }
      }

      const run = await ctx.subagents.start(profile.subagentProvider, {
        ...request,
        signal: exec.signal,
      })
      return settleForeground(profileName, run)
    },
  }))
}

function availableConfig(ctx: Context, config: Config): Config | undefined {
  const profiles = Object.fromEntries(
    Object.entries(config.profiles)
      .filter(([profileName, profile]) => {
        if (ctx.subagents.getProvider(profile.subagentProvider) === undefined) return false
        const defaultBackground = config.enableRunInBackground && profile.defaultRunInBackground
        requireProvider(ctx, profileName, profile, defaultBackground)
        return true
      }),
  )
  if (Object.keys(profiles).length === 0) return undefined
  const { defaultProfile, ...rest } = config
  return {
    ...rest,
    profiles,
    ...defaultProfile !== undefined && profiles[defaultProfile] !== undefined
      ? { defaultProfile }
      : {},
  }
}

export function apply(ctx: Context, config: Config): void {
  validateConfig(config)
  let activeConfig: Config | undefined
  let disposeTool: (() => void) | undefined

  const refresh = (): void => {
    const next = availableConfig(ctx, config)
    disposeTool?.()
    disposeTool = undefined
    activeConfig = next
    if (next !== undefined) disposeTool = registerTool(ctx, next)
  }

  ctx.on('subagent/provider-added', (provider) => {
    if (Object.values(config.profiles).some(profile => profile.subagentProvider === provider.name)) refresh()
  })
  ctx.on('subagent/provider-removed', (providerName) => {
    if (Object.values(config.profiles).some(profile => profile.subagentProvider === providerName)) refresh()
  })
  ctx.effect(() => () => {
    disposeTool?.()
    disposeTool = undefined
    activeConfig = undefined
  }, 'dsh-legion.activeTool()')

  ctx.systemPrompt.section({
    name: `tool:${config.toolName}`,
    order: PROMPT_ORDER,
    text: () => activeConfig === undefined ? '' : renderCoordinatorGuidance(activeConfig),
  })
  refresh()
}
