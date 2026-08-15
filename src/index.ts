import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubagentProvider, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { Config, materializeConfig } from './config.ts'
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
import {
  assertOrchestrationCatalogUsable,
  compileOrchestrationCatalog,
} from './orchestration.ts'
import { RoutePlanError, applyRoutePlan, compileRoutePlan, observeModelRoutes } from './route.ts'
import { EMPTY_RESOURCE_SNAPSHOT, loadProfileResources, type ResourceSnapshot } from './resources.ts'

export {
  CURRENT_CONFIG_VERSION,
  Config,
  LegionProfileSchema,
  PROFILE_NAME,
  RESULT_CONTRACTS,
  exportConfigDocument,
  materializeConfig,
  validateConfig,
} from './config.ts'
export type {
  Config as LegionConfig,
  ConfigExportTarget,
  ConfigVersion,
  LegionProfile,
  MaterializedConfig,
  PromptFileReference,
  ResultContract,
  RouteCandidate,
  RouteConstraints,
} from './config.ts'
export {
  CatalogCompileError,
  DelegationPlanError,
  ERROR_DIAGNOSTIC_CODES,
  WARNING_DIAGNOSTIC_CODES,
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
  DiagnosticSeverity,
  ErrorDiagnostic,
  ErrorDiagnosticCode,
  WarningDiagnosticCode,
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
export {
  EMPTY_RESOURCE_SNAPSHOT,
  ProfileResourceError,
  assertResourceSnapshot,
  createResourceSnapshot,
  loadProfileResources,
  promptContentDigest,
  renderPromptFragments,
} from './resources.ts'
export type {
  LoadedPromptFragment,
  ResourceErrorCode,
  ResourceLoadOptions,
  ResourceSnapshot,
} from './resources.ts'
export {
  RoutePlanError,
  applyRoutePlan,
  compileRoutePlan,
  materializeModelFactsSnapshot,
  observeModelRoutes,
} from './route.ts'
export type {
  EffectiveOutputBudget,
  ExactModelFact,
  MetadataUnknownCause,
  ModelFactsSnapshot,
  RouteDecision,
  RouteEvidence,
  RoutePlan,
  RouteRejectCode,
  RouteUnknownCode,
  RoutableProfile,
  SelectedRoutePlan,
  UnroutableRoutePlan,
} from './route.ts'
export {
  CatalogDigest,
  PolicyDigest,
  ProfileName,
  ResourceDigest,
  RoutePlanDigest,
  ArtifactName,
  MemberSlotName,
  StrategyName,
  StrategyPlanDigest,
  TeamName,
} from './identity.ts'
export {
  EXPLAIN_VIEW_V1_SCHEMA,
  assertExplainViewV1,
  compileExplainView,
  explainCatalog,
  materializeExplainViewV1,
  renderExplainHuman,
} from './explain.ts'
export type {
  ExplainOptions,
  ExplainStatus,
  ExplainSummary,
  ExplainViewV1,
  ProfileExplainView,
  ProviderSnapshotSource,
  RenderExplainOptions,
} from './explain.ts'
export { resolveCatalogLayers } from './catalog-layer.ts'
export type {
  CatalogEntryProvenance,
  CatalogNamespace,
  ResolvedCatalogLayers,
} from './catalog-layer.ts'
export {
  ARTIFACT_CONTRACTS,
  ORCHESTRATION_NAME,
  StrategySpecSchema,
  TeamSpecSchema,
  defineStrategy,
  defineStrategyFor,
  defineTeam,
} from './orchestration-contract.ts'
export type {
  ArtifactContract,
  ArtifactInputRef,
  ArtifactOutputSpec,
  CatalogDisableSpec,
  CatalogLayer,
  DefinedTeam,
  DelegateStageSpec,
  FanoutStageSpec,
  GoalStageSpec,
  MemberSlotSpec,
  StrategyLimits,
  StrategySpec,
  StrategyStageSpec,
  SynthesizeStageSpec,
  TeamLimits,
  TeamSpec,
} from './orchestration-contract.ts'
export {
  OrchestrationCompileError,
  assertOrchestrationCatalogUsable,
  compileOrchestrationCatalog,
  compileStrategy,
} from './orchestration.ts'
export type {
  ArtifactAvailability,
  CompiledArtifact,
  CompiledMemberSlot,
  CompiledOrchestrationCatalog,
  CompiledStrategyPlan,
  CompiledStrategyTemplate,
  CompiledTeam,
  DelegatePrimitive,
  DshPrimitive,
  FanoutPrimitive,
  GoalPrimitive,
  OrchestrationDiagnostic,
  OrchestrationDiagnosticCode,
  StrategyCompileRequest,
  StrategyCompileResult,
  StrategyExecutionClass,
} from './orchestration.ts'
export { DEFAULT_CATALOG_LAYER } from './default-catalog.ts'

export const name = 'dsh-legion'
export const inject = ['tools', 'subagents', 'systemPrompt']

const PROMPT_ORDER = 116.75

interface ToolArgs {
  profile?: string
  description: string
  prompt: string
  run_in_background?: boolean
}

function parseToolArgs(value: unknown): ToolArgs {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('dsh-legion: tool arguments must be an object')
  }
  const input = value as Record<string, unknown>
  const allowed = new Set(['profile', 'description', 'prompt', 'run_in_background'])
  const unknown = Object.keys(input).filter(key => !allowed.has(key))
  if (unknown.length > 0) {
    throw new Error(`dsh-legion: tool arguments contain unknown field(s): ${unknown.sort().join(', ')}`)
  }
  if (typeof input.description !== 'string' || input.description.length === 0) {
    throw new Error('dsh-legion: description must be a non-empty string')
  }
  if (typeof input.prompt !== 'string' || input.prompt.length === 0) {
    throw new Error('dsh-legion: prompt must be a non-empty string')
  }
  if (input.profile !== undefined && typeof input.profile !== 'string') {
    throw new Error('dsh-legion: profile must be a string')
  }
  if (input.run_in_background !== undefined && typeof input.run_in_background !== 'boolean') {
    throw new Error('dsh-legion: run_in_background must be a boolean')
  }
  return {
    description: input.description,
    prompt: input.prompt,
    ...input.profile === undefined ? {} : { profile: input.profile },
    ...input.run_in_background === undefined ? {} : { run_in_background: input.run_in_background },
  }
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
  return {
    providers,
    llmProviders: ctx.get('llm')?.listProviders().map(provider => provider.id).sort() ?? [],
  }
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

function requireSelectedLlmAdapter(ctx: Context, plan: DelegationPlan): void {
  const selected = plan.routePlan?.selected
  if (selected === undefined) return
  const registered = ctx.get('llm')?.listProviders().some(provider => provider.id === selected.provider) === true
  if (!registered) {
    throw new Error(
      `dsh-legion: selected LLM adapter "${selected.provider}" disappeared before child start`,
    )
  }
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

function selectedRouteId(value: JsonValue | undefined): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const selected = value.selected
  if (typeof selected !== 'object' || selected === null || Array.isArray(selected)) return undefined
  return typeof selected.id === 'string' ? selected.id : undefined
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
              resourceDigest: { type: 'string', required: true },
              routePlan: { type: 'json' },
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
              resourceDigest: { type: 'string', required: true },
              routePlan: { type: 'json' },
              output: { type: 'array', required: true, items: { type: 'json' } },
              structured: { type: 'json' },
            },
          },
        ],
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.kind === 'continuable'
          ? `started Legion profile ${value.profile}`
            + `${selectedRouteId(value.routePlan) === undefined ? '' : ` via route ${selectedRouteId(value.routePlan)}`}`
            + ` as subagent ${value.subagentId}`
          : `${selectedRouteId(value.routePlan) === undefined ? '' : `selected Legion route ${selectedRouteId(value.routePlan)}\n`}`
            + (value.structured === undefined
              ? outputText(value.output)
              : JSON.stringify(value.structured, null, 2)),
      }],
    },
    isConcurrencySafe: () => true,
    async execute(rawArgs, exec) {
      const args = parseToolArgs(rawArgs)
      const parent = exec.agent
      if (parent === undefined) {
        throw new Error('dsh-legion: tool requires a calling agent')
      }

      let plan = compileDelegationPlan(catalog, {
        ...args.profile === undefined ? {} : { profile: args.profile },
        description: args.description,
        prompt: args.prompt,
        ...args.run_in_background === undefined ? {} : { runInBackground: args.run_in_background },
      })
      const profile = catalog.activeProfiles[plan.profile]!
      if (profile.routes !== undefined) {
        const facts = await observeModelRoutes(ctx.get('llm'), profile.routes, exec.signal)
        const routePlan = compileRoutePlan(
          { ...profile, routes: profile.routes },
          catalog.policyDigest,
          facts,
        )
        if (routePlan.kind === 'unroutable-route-plan') throw new RoutePlanError(routePlan)
        plan = applyRoutePlan(plan, routePlan)
      }
      requireProvider(ctx, plan)
      const request = requestFor(parent, plan)

      if (plan.mode === 'continuable') {
        requireSelectedLlmAdapter(ctx, plan)
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
          resourceDigest: plan.resourceDigest,
          ...plan.routePlan === undefined
            ? {}
            : { routePlan: plan.routePlan as unknown as JsonValue },
        }
      }

      requireSelectedLlmAdapter(ctx, plan)
      const run = await ctx.subagents.start(plan.subagentProvider, {
        ...request,
        signal: exec.signal,
      })
      return settleForeground(plan, run)
    },
  }))
}

function profileResourceBase(ctx: Context, config: Config): string | undefined {
  const hasReferences = Object.values(config.profiles).some(profile => (profile.promptFiles?.length ?? 0) > 0)
  if (!hasReferences) return undefined
  if (ctx.baseUrl === undefined) {
    throw new Error('dsh-legion: prompt file references require a file-based plugin context')
  }
  const url = new URL('.', ctx.baseUrl)
  if (url.protocol !== 'file:') {
    throw new Error('dsh-legion: prompt file references require a file: plugin base URL')
  }
  return fileURLToPath(url)
}

export async function apply(ctx: Context, config: Config): Promise<void> {
  const resolvedConfig = materializeConfig(config)
  const resourceBase = profileResourceBase(ctx, resolvedConfig)
  const resources: ResourceSnapshot = resourceBase === undefined
    ? EMPTY_RESOURCE_SNAPSHOT
    : await loadProfileResources(resolvedConfig, { baseDirectory: resourceBase })
  ctx.fiber.assertActive()
  let activeCatalog: CompiledCatalog | undefined
  let disposeTool: (() => void) | undefined
  let refreshing = false
  let registrationFailed = false

  const refresh = (): void => {
    if (refreshing) return
    refreshing = true
    registrationFailed = false
    try {
      const next = compileCatalog(resolvedConfig, runtimeSnapshot(ctx, resolvedConfig), resources)
      assertCatalogUsable(next)
      assertOrchestrationCatalogUsable(compileOrchestrationCatalog(next))
      disposeTool?.()
      disposeTool = undefined
      activeCatalog = undefined
      if (Object.keys(next.activeProfiles).length > 0) {
        try {
          disposeTool = registerTool(ctx, next)
        } catch (error: unknown) {
          registrationFailed = true
          throw error
        }
      }
      activeCatalog = next
    } finally {
      refreshing = false
    }
  }

  ctx.on('subagent/provider-added', (provider) => {
    if (Object.values(resolvedConfig.profiles).some(profile => profile.subagentProvider === provider.name)) refresh()
  })
  ctx.on('subagent/provider-removed', (providerName) => {
    if (Object.values(resolvedConfig.profiles).some(profile => profile.subagentProvider === providerName)) refresh()
  })
  ctx.on('llm/adapters-updated', refresh)
  ctx.on('tools/change', () => {
    if (registrationFailed && !refreshing) refresh()
  })
  ctx.effect(() => () => {
    disposeTool?.()
    disposeTool = undefined
    activeCatalog = undefined
  }, 'dsh-legion.activeTool()')

  ctx.systemPrompt.section({
    name: `tool:${resolvedConfig.toolName}`,
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
