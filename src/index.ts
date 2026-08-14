import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubagentProvider, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { Config, validateConfig } from './config.ts'
import {
  assertCatalogUsable,
  compileCatalog,
  compileDelegationPlan,
  type CompiledCatalog,
  type DelegationPlan,
  type RuntimeSnapshot,
} from './compiler.ts'
import { renderCoordinatorGuidance } from './prompt.ts'
import { outputText, settleForeground } from './settlement.ts'

export { Config, LegionProfileSchema, PROFILE_NAME, RESULT_CONTRACTS, validateConfig } from './config.ts'
export type { Config as LegionConfig, LegionProfile, ResultContract } from './config.ts'
export {
  CatalogCompileError,
  DelegationPlanError,
  assertCatalogUsable,
  compileCatalog,
  compileDelegationPlan,
} from './compiler.ts'
export type {
  CompiledCatalog,
  DelegationInvocation,
  DelegationPlan,
  Diagnostic,
  DiagnosticCode,
  EffectiveProfile,
  ProviderFacts,
  RuntimeSnapshot,
} from './compiler.ts'
export {
  FINDINGS_V1_SCHEMA,
  REVIEW_V1_SCHEMA,
  materializeStructuredResult,
  outputSchemaFor,
} from './result-contract.ts'
export { renderCoordinatorGuidance } from './prompt.ts'
export type { CoordinatorCatalog, CoordinatorProfile } from './prompt.ts'

export const name = 'dsh-legion'
export const inject = ['tools', 'subagents', 'systemPrompt']

const PROMPT_ORDER = 116.75

interface ToolArgs {
  profile?: string
  description: string
  prompt: string
  run_in_background?: boolean
}

function runtimeSnapshot(ctx: Context, config: Config): RuntimeSnapshot {
  const providers = Object.fromEntries(
    [...new Set(Object.values(config.profiles).map(profile => profile.subagentProvider))]
      .sort()
      .flatMap((name) => {
        const provider = ctx.subagents.getProvider(name)
        return provider === undefined
          ? []
          : [[name, {
              capabilities: { ...provider.capabilities },
              continuable: provider.prepareContinuable !== undefined,
            }]]
      }),
  )
  return { providers }
}

function requireProvider(ctx: Context, plan: DelegationPlan): SubagentProvider {
  const provider = ctx.subagents.getProvider(plan.subagentProvider)
  if (provider === undefined) {
    throw new Error(
      `dsh-legion: profile "${plan.profile}" requires unavailable subagent provider "${plan.subagentProvider}"`,
    )
  }
  if (plan.mode === 'continuable') {
    if (provider.prepareContinuable === undefined) {
      throw new Error(
        `dsh-legion: profile "${plan.profile}" cannot run in the background because provider "${provider.name}" is not continuable`,
      )
    }
    return provider
  }
  if (plan.maxDepth !== undefined && !provider.capabilities.depthLimit) {
    throw new Error(
      `dsh-legion: profile "${plan.profile}" sets numeric maxDepth but provider "${provider.name}" cannot enforce it; use provider-managed`,
    )
  }
  if (plan.persona !== undefined && !provider.capabilities.persona) {
    throw new Error(
      `dsh-legion: profile "${plan.profile}" sets persona but provider "${provider.name}" does not support it`,
    )
  }
  if (plan.toolFilter !== undefined && !provider.capabilities.toolFilter) {
    throw new Error(
      `dsh-legion: profile "${plan.profile}" sets toolFilter but provider "${provider.name}" does not support it`,
    )
  }
  if (plan.outputSchema !== undefined && !provider.capabilities.outputSchema) {
    throw new Error(
      `dsh-legion: profile "${plan.profile}" requires structured output but provider "${provider.name}" does not support it`,
    )
  }
  return provider
}

function requestFor(
  parent: SubagentStartRequest['parent'],
  plan: DelegationPlan,
): Omit<SubagentStartRequest, 'signal'> {
  return {
    label: plan.label,
    prompt: [{ type: 'text', text: plan.prompt }] as ContentBlock[],
    parent,
    ...plan.agentOptions === undefined ? {} : { agentOptions: plan.agentOptions },
    ...plan.persona === undefined ? {} : { persona: plan.persona },
    ...plan.toolFilter === undefined ? {} : { toolFilter: plan.toolFilter },
    ...plan.maxDepth === undefined ? {} : { maxDepth: plan.maxDepth },
    ...plan.outputSchema === undefined ? {} : { outputSchema: plan.outputSchema },
  }
}

function registerTool(ctx: Context, catalog: CompiledCatalog): () => void {
  const profileNames = Object.keys(catalog.activeProfiles)
  const profileRequired = catalog.defaultProfile === undefined
  const profileDescription = catalog.defaultProfile === undefined
    ? 'Configured semantic profile. Choose by task fit, not by raw model preference.'
    : `Configured semantic profile. Defaults to ${catalog.defaultProfile}.`

  return ctx.tools.register(defineTool({
    name: catalog.toolName,
    description:
      'Delegate focused work through a configured Legion profile. Each profile fixes the child backend, model route, persona, tools, and depth policy. '
      + (catalog.enableRunInBackground
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
      ...catalog.enableRunInBackground ? {
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
              policyDigest: { type: 'string', required: true },
              catalogDigest: { type: 'string', required: true },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'foreground' },
              profile: { type: 'string', required: true },
              runId: { type: 'string', required: true },
              resultContract: { type: 'string', required: true },
              policyDigest: { type: 'string', required: true },
              catalogDigest: { type: 'string', required: true },
              output: { type: 'array', required: true, items: { type: 'json' } },
              structured: { type: 'json' },
            },
          },
        ],
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.kind === 'continuable'
          ? `started Legion profile ${value.profile} as subagent ${value.subagentId}`
          : value.structured === undefined
            ? outputText(value.output)
            : JSON.stringify(value.structured, null, 2),
      }],
    },
    isConcurrencySafe: () => true,
    async execute(rawArgs, exec) {
      const args = rawArgs as unknown as ToolArgs
      const parent = exec.agent
      if (parent === undefined) {
        throw new Error('dsh-legion: tool requires a calling agent')
      }

      const plan = compileDelegationPlan(catalog, {
        ...args.profile === undefined ? {} : { profile: args.profile },
        description: args.description,
        prompt: args.prompt,
        ...args.run_in_background === undefined ? {} : { runInBackground: args.run_in_background },
      })
      requireProvider(ctx, plan)
      const request = requestFor(parent, plan)

      if (plan.mode === 'continuable') {
        const started = await ctx.subagents.startContinuable({
          provider: plan.subagentProvider,
          label: plan.label,
          request,
          signal: exec.signal,
        })
        return {
          kind: 'continuable' as const,
          profile: plan.profile,
          subagentId: started.childId,
          policyDigest: plan.policyDigest,
          catalogDigest: plan.catalogDigest,
        }
      }

      const run = await ctx.subagents.start(plan.subagentProvider, {
        ...request,
        signal: exec.signal,
      })
      return settleForeground(plan, run)
    },
  }))
}

export function apply(ctx: Context, config: Config): void {
  validateConfig(config)
  let activeCatalog: CompiledCatalog | undefined
  let disposeTool: (() => void) | undefined

  const refresh = (): void => {
    const next = compileCatalog(config, runtimeSnapshot(ctx, config))
    assertCatalogUsable(next)
    disposeTool?.()
    disposeTool = undefined
    activeCatalog = next
    if (Object.keys(next.activeProfiles).length > 0) disposeTool = registerTool(ctx, next)
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
    activeCatalog = undefined
  }, 'dsh-legion.activeTool()')

  ctx.systemPrompt.section({
    name: `tool:${config.toolName}`,
    order: PROMPT_ORDER,
    text: () => activeCatalog === undefined || Object.keys(activeCatalog.activeProfiles).length === 0
      ? ''
      : renderCoordinatorGuidance({
          toolName: activeCatalog.toolName,
          enableRunInBackground: activeCatalog.enableRunInBackground,
          profiles: activeCatalog.activeProfiles,
          ...activeCatalog.defaultProfile === undefined ? {} : { defaultProfile: activeCatalog.defaultProfile },
          ...activeCatalog.guidance === undefined ? {} : { guidance: activeCatalog.guidance },
        }),
  })
  refresh()
}
