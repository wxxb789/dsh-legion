import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubagentProvider, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { Config, materializeConfig } from './config.ts'
import { registerLegionRunProjection, type HostProjectionContext } from './durable-run/projection.ts'
import {
  detectDurableCapabilities,
  type DurableCapabilityContext,
} from './durable-run/capabilities.ts'
import {
  assertCatalogUsable,
  compileCatalog,
  compileDelegationPlan,
  type DelegationPlan,
  type RuntimeSnapshot,
} from './compiler.ts'
import { createCoordinatorCatalog, renderCoordinatorGuidance } from './prompt.ts'
import { outputText, settleForeground } from './settlement.ts'
import {
  assertOrchestrationCatalogUsable,
  compileOrchestrationCatalog,
  compileStrategy,
  renderOrchestrationGuidance,
} from './orchestration.ts'
import {
  createStrategyExecutionSnapshot,
  executeStrategyPlan,
  type StrategyExecutionSnapshot,
} from './execution.ts'
import type { StrategyLimits } from './orchestration-contract.ts'
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
  DurableRunPolicySpec,
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
  materializeModelFactsObservations,
  observeModelRoutes,
} from './route.ts'
export type {
  EffectiveOutputBudget,
  ExactModelFact,
  MetadataUnknownCause,
  ModelFactsObservations,
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
  StrategyGenerationId,
  StrategyName,
  StrategyPlanDigest,
  TeamName,
  TeamRunId,
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
export {
  ARTIFACT_CONTRACTS,
  ORCHESTRATION_NAME,
  STAIR_STEP_PAUSE_REASONS,
  STRATEGY_LIMIT_FIELDS,
  STRATEGY_STAGE_KINDS,
  StairStepPolicySpecSchema,
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
  MemberSlotSpec,
  StairStepPauseReason,
  StairStepPolicySpec,
  StrategyLimits,
  StrategySpec,
  StrategyStageSpec,
  SynthesizeStageSpec,
  TeamLimits,
  TeamSpec,
} from './orchestration-contract.ts'
export {
  OrchestrationCompileError,
  assertCompiledStrategyPlan,
  assertOrchestrationCatalogUsable,
  compileOrchestrationCatalog,
  compileStrategy,
  renderOrchestrationGuidance,
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
  OrchestrationDiagnostic,
  OrchestrationDiagnosticCode,
  StrategyCompileRequest,
  StrategyCompileResult,
} from './orchestration.ts'
export { DEFAULT_CATALOG_LAYER } from './default-catalog.ts'
export {
  TEAM_RUN_OUTCOMES,
  createStrategyExecutionSnapshot,
  executeStrategyPlan,
} from './execution.ts'
export type {
  MaterializedStrategyArtifact,
  StrategyExecutionSnapshot,
  StrategyMemberFailure,
  TeamRunOutcome,
} from './execution.ts'

export * from './durable-run/contract.ts'
export * from './durable-run/context.ts'
export * from './durable-run/mailbox.ts'
export * from './durable-run/plan-delta.ts'
export * from './durable-run/continuation.ts'
export * from './durable-run/stair-step.ts'
export * from './durable-run/events.ts'
export * from './durable-run/invariant.ts'
export * from './durable-run/projection.ts'
export * from './durable-run/replay.ts'
export * from './durable-run/graph.ts'
export * from './durable-run/controller.ts'
export * from './durable-run/host.ts'
export * from './durable-run/capabilities.ts'
export * from './durable-run/lease.ts'
export * from './durable-run/recovery.ts'
export * from './durable-run/result-acceptance.ts'
export * from './durable-run/run-control.ts'

export const name = 'dsh-legion'
export const inject = ['tools', 'subagents', 'systemPrompt']

const PROMPT_ORDER = 116.75

interface ProfileToolArgs {
  readonly kind: 'profile'
  readonly profile?: string
  readonly description: string
  readonly prompt: string
  readonly run_in_background?: boolean
}

interface StrategyToolArgs {
  readonly kind: 'strategy'
  readonly strategy: string
  readonly objective: string
  readonly limits?: Partial<StrategyLimits>
}

type ToolArgs = ProfileToolArgs | StrategyToolArgs

function argumentRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('dsh-legion: REQUEST_INVALID: tool arguments must be a plain object')
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('dsh-legion: REQUEST_INVALID: tool arguments must be a plain object')
  }
  return value as Record<string, unknown>
}

function assertAllowedArguments(input: Record<string, unknown>, allowed: readonly string[]): void {
  const known = new Set(allowed)
  const unknown = Object.keys(input).filter(key => !known.has(key))
  if (unknown.length > 0) {
    throw new Error(
      `dsh-legion: REQUEST_INVALID: tool arguments contain unknown field(s): ${unknown.sort().join(', ')}`,
    )
  }
}

function parseToolArgs(value: unknown, enableStrategies: boolean): ToolArgs {
  const input = argumentRecord(value)
  const strategySignal = input.kind === 'strategy'
    || Object.hasOwn(input, 'strategy')
    || Object.hasOwn(input, 'objective')
    || Object.hasOwn(input, 'limits')
  if (strategySignal) {
    if (!enableStrategies) throw new Error('dsh-legion: STRATEGIES_DISABLED: model Strategy calls are disabled')
    assertAllowedArguments(input, ['kind', 'strategy', 'objective', 'limits'])
    if (input.kind !== 'strategy') {
      throw new Error('dsh-legion: REQUEST_INVALID: Strategy calls require kind "strategy"')
    }
    if (typeof input.strategy !== 'string' || input.strategy.trim().length === 0) {
      throw new Error('dsh-legion: REQUEST_INVALID: strategy must be a non-empty string')
    }
    if (typeof input.objective !== 'string' || input.objective.trim().length === 0) {
      throw new Error('dsh-legion: REQUEST_INVALID: objective must be a non-empty string')
    }
    if (input.limits !== undefined) argumentRecord(input.limits)
    return {
      kind: 'strategy',
      strategy: input.strategy,
      objective: input.objective,
      ...input.limits === undefined ? {} : { limits: input.limits as Partial<StrategyLimits> },
    }
  }
  assertAllowedArguments(input, enableStrategies
    ? ['kind', 'profile', 'description', 'prompt', 'run_in_background']
    : ['profile', 'description', 'prompt', 'run_in_background'])
  if (input.kind !== undefined && input.kind !== 'profile') {
    throw new Error('dsh-legion: REQUEST_INVALID: kind must be "profile" or "strategy"')
  }
  if (typeof input.description !== 'string' || input.description.trim().length === 0) {
    throw new Error('dsh-legion: REQUEST_INVALID: description must be a non-empty string')
  }
  if (typeof input.prompt !== 'string' || input.prompt.trim().length === 0) {
    throw new Error('dsh-legion: REQUEST_INVALID: prompt must be a non-empty string')
  }
  if (input.profile !== undefined && typeof input.profile !== 'string') {
    throw new Error('dsh-legion: REQUEST_INVALID: profile must be a string')
  }
  if (input.run_in_background !== undefined && typeof input.run_in_background !== 'boolean') {
    throw new Error('dsh-legion: REQUEST_INVALID: run_in_background must be a boolean')
  }
  return {
    kind: 'profile',
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

function renderStrategyOutcome(value: JsonValue): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'invalid Strategy outcome'
  const kind = typeof value.kind === 'string' ? value.kind : 'unknown'
  let detail: unknown
  if (kind === 'completed' || kind === 'degraded') {
    const final = typeof value.final === 'object' && value.final !== null && !Array.isArray(value.final)
      ? value.final
      : undefined
    detail = final?.value
  } else if (kind === 'failed') {
    detail = value.failure
  } else {
    detail = value.reason
  }
  const rendered = typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2)
  const bounded = rendered === undefined
    ? ''
    : rendered.length <= 16_000 ? rendered : `${rendered.slice(0, 15_997)}...`
  return `Strategy outcome: ${kind}${bounded.length === 0 ? '' : `\n${bounded}`}`
}

function selectedRouteId(value: JsonValue | undefined): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const selected = value.selected
  if (typeof selected !== 'object' || selected === null || Array.isArray(selected)) return undefined
  return typeof selected.id === 'string' ? selected.id : undefined
}

function createToolDefinition(ctx: Context, snapshot: StrategyExecutionSnapshot): ToolDefinition {
  const { profiles: catalog, orchestration } = snapshot
  const profileNames = Object.keys(catalog.activeProfiles)
  const strategyNames = catalog.enableStrategies
    ? Object.values(orchestration.strategies)
        .filter(strategy => strategy.active)
        .map(strategy => String(strategy.name))
        .sort()
    : []
  const hasStrategySurface = strategyNames.length > 0
  const profileRequired = catalog.defaultProfile === undefined && !hasStrategySurface
  const profileDescription = catalog.defaultProfile === undefined
    ? 'Configured semantic profile. Choose by task fit, not by raw model preference.'
    : `Configured semantic profile. Defaults to ${catalog.defaultProfile}.`

  const definition = defineTool({
    name: catalog.toolName,
    description: (hasStrategySurface
      ? 'Delegate through a configured Legion Profile or execute an explicitly enabled bounded Team Strategy. '
      : 'Delegate focused work through a configured Legion profile. Each profile fixes child policy. ')
      + (catalog.enableRunInBackground
        ? 'Background execution returns a durable child id immediately; foreground execution waits for the final result.'
        : 'This instance only allows foreground execution.'),
    parameters: {
      ...hasStrategySurface ? {
        kind: {
          type: 'string' as const,
          enum: ['profile', 'strategy'],
          description: 'Request discriminator. Strategy calls must set strategy; legacy Profile calls may omit it.',
        },
      } : {},
      profile: {
        type: 'string',
        ...profileRequired ? { required: true as const } : {},
        enum: profileNames,
        description: profileDescription,
      },
      description: {
        type: 'string',
        ...hasStrategySurface ? {} : { required: true as const },
        description: 'A short 3-5 word label for the delegated task.',
      },
      prompt: {
        type: 'string',
        ...hasStrategySurface ? {} : { required: true as const },
        description: 'A complete standalone task for a fresh profile, or focused follow-up context for an inheriting backend.',
      },
      ...hasStrategySurface ? {
        strategy: {
          type: 'string' as const,
          enum: strategyNames,
          description: 'Explicit configured Strategy name. Requires kind strategy.',
        },
        objective: {
          type: 'string' as const,
          description: 'Complete bounded objective for the Team Strategy.',
        },
        limits: {
          type: 'json' as const,
          description: 'Optional positive-integer narrowing limits: maxAgents, maxConcurrent, deadlineMs, maxOutputBytes.',
        },
      } : {},
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
          ...hasStrategySurface ? [{
            type: 'object' as const,
            additionalProperties: false,
            properties: {
              kind: { type: 'string' as const, required: true as const, const: 'strategy' },
              strategy: { type: 'string' as const, required: true as const },
              planDigest: { type: 'string' as const, required: true as const },
              outcome: { type: 'json' as const, required: true as const },
            },
          }] : [],
        ],
      },
      render: (_args, value) => [{
        type: 'text',
        text: 'strategy' in value
          ? `Legion Strategy ${value.strategy}\n${renderStrategyOutcome(value.outcome)}`
          : 'subagentId' in value
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
      const args = parseToolArgs(rawArgs, catalog.enableStrategies)
      const parent = exec.agent
      if (parent === undefined) {
        throw new Error('dsh-legion: tool requires a calling agent')
      }
      if (args.kind === 'strategy') {
        if (!strategyNames.includes(args.strategy)) {
          throw new Error('dsh-legion: STRATEGY_UNAVAILABLE: unknown or inactive Strategy')
        }
        const compiled = compileStrategy(orchestration, {
          strategy: args.strategy,
          objective: args.objective,
          ...args.limits === undefined ? {} : { limits: args.limits },
        })
        if (!compiled.ok) {
          const details = compiled.diagnostics.map(item => `${item.code}: ${item.message}`).join('; ')
          throw new Error(`dsh-legion: STRATEGY_COMPILE_FAILED: ${details}`)
        }
        const outcome = await executeStrategyPlan(ctx, snapshot, compiled.plan, parent, exec.signal)
        return {
          kind: 'strategy' as const,
          strategy: args.strategy,
          planDigest: compiled.plan.planDigest,
          outcome: outcome as unknown as JsonValue,
        }
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
      return settleForeground(
        plan,
        () => ctx.subagents.start(plan.subagentProvider, {
          ...request,
          signal: exec.signal,
        }),
        exec.signal,
        cleanup => {
          if (cleanup.kind !== 'quiescent') {
            ctx.logger.warn(`dsh-legion: late foreground cleanup ended ${cleanup.kind}`)
          }
        },
      )
    },
  })
  if (!hasStrategySurface) return definition
  const flat = definition.parameters as {
    properties: Record<string, unknown>
  }
  const profileProperties = Object.fromEntries(
    ['kind', 'profile', 'description', 'prompt', 'run_in_background']
      .flatMap(key => flat.properties[key] === undefined ? [] : [[key, flat.properties[key]]]),
  )
  profileProperties.kind = { type: 'string', const: 'profile' }
  const strategyProperties = Object.fromEntries(
    ['kind', 'strategy', 'objective']
      .map(key => [key, flat.properties[key]]),
  )
  strategyProperties.kind = { type: 'string', const: 'strategy' }
  strategyProperties.limits = {
    type: 'object',
    additionalProperties: false,
    properties: {
      maxAgents: { type: 'integer', minimum: 1 },
      maxConcurrent: { type: 'integer', minimum: 1 },
      deadlineMs: { type: 'integer', minimum: 1 },
      maxOutputBytes: { type: 'integer', minimum: 1 },
    },
  }
  return {
    ...definition,
    parameters: {
      type: 'object',
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          properties: profileProperties,
          required: ['description', 'prompt'],
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: strategyProperties,
          required: ['kind', 'strategy', 'objective'],
        },
      ],
    },
  }
}

function delegatingToolDefinition(
  name: string,
  current: () => ToolDefinition,
): ToolDefinition {
  return {
    name,
    get description() { return current().description },
    get parameters() { return current().parameters },
    get output() { return current().output },
    isConcurrencySafe(args) { return current().isConcurrencySafe?.(args) ?? false },
    execute(args, execution) {
      const definition = current()
      return definition.execute(args, execution)
    },
  }
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
  registerLegionRunProjection(ctx as unknown as HostProjectionContext)
  const resolvedConfig = materializeConfig(config)
  const durableCapabilities = detectDurableCapabilities(
    ctx as unknown as DurableCapabilityContext,
  )
  if (resolvedConfig.enableDurableRuns && !durableCapabilities.durableMutation) {
    ctx.logger.warn(
      `dsh-legion: durable runs disabled: ${durableCapabilities.diagnostics.join(', ')}`,
    )
  }
  const resourceBase = profileResourceBase(ctx, resolvedConfig)
  const resources: ResourceSnapshot = resourceBase === undefined
    ? EMPTY_RESOURCE_SNAPSHOT
    : await loadProfileResources(resolvedConfig, { baseDirectory: resourceBase })
  ctx.fiber.assertActive()
  let activeSnapshot: StrategyExecutionSnapshot | undefined
  let activeDefinition: ToolDefinition | undefined
  let disposeTool: (() => void) | undefined
  let refreshing = false
  let registrationFailed = false

  const refresh = (): void => {
    if (refreshing) return
    refreshing = true
    registrationFailed = false
    try {
      const nextProfiles = compileCatalog(resolvedConfig, runtimeSnapshot(ctx, resolvedConfig), resources)
      assertCatalogUsable(nextProfiles)
      const nextOrchestration = compileOrchestrationCatalog(nextProfiles)
      assertOrchestrationCatalogUsable(nextOrchestration)
      const nextSnapshot = createStrategyExecutionSnapshot(nextProfiles, nextOrchestration)
      const nextDefinition = Object.keys(nextProfiles.activeProfiles).length === 0
        ? undefined
        : createToolDefinition(ctx, nextSnapshot)
      if (nextDefinition === undefined) {
        activeSnapshot = nextSnapshot
        activeDefinition = undefined
        disposeTool?.()
        disposeTool = undefined
      } else if (disposeTool === undefined) {
        const previousSnapshot = activeSnapshot
        activeSnapshot = nextSnapshot
        activeDefinition = nextDefinition
        try {
          disposeTool = ctx.tools.register(delegatingToolDefinition(
            nextProfiles.toolName,
            () => {
              if (activeDefinition === undefined) throw new Error('dsh-legion: no published tool generation')
              return activeDefinition
            },
          ))
        } catch (error: unknown) {
          registrationFailed = true
          activeSnapshot = previousSnapshot
          activeDefinition = undefined
          throw error
        }
      } else {
        activeSnapshot = nextSnapshot
        activeDefinition = nextDefinition
        ctx.emit('tools/change')
      }
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
    activeDefinition = undefined
    activeSnapshot = undefined
  }, 'dsh-legion.activeTool()')

  ctx.systemPrompt.section({
    name: `tool:${resolvedConfig.toolName}`,
    order: PROMPT_ORDER,
    text: () => {
      if (activeSnapshot === undefined
        || Object.keys(activeSnapshot.profiles.activeProfiles).length === 0) return ''
      const catalog = activeSnapshot.profiles
      const profileGuidance = renderCoordinatorGuidance(createCoordinatorCatalog({
        toolName: catalog.toolName,
        enableRunInBackground: catalog.enableRunInBackground,
        profiles: catalog.activeProfiles,
        ...catalog.defaultProfile === undefined ? {} : { defaultProfile: catalog.defaultProfile },
        ...catalog.guidance === undefined ? {} : { guidance: catalog.guidance },
      }))
      const strategyGuidance = catalog.enableStrategies
        ? renderOrchestrationGuidance(activeSnapshot.orchestration)
        : ''
      return [profileGuidance, strategyGuidance].filter(Boolean).join('\n\n')
    },
  })
  refresh()
}
