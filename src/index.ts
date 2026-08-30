import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubagentProvider, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { FIRST_PARTY_SECTION_ORDER } from '@deepseek-ai/dsh-system-prompt'
import { RUN_RECEIPT_TOKEN_FIELDS } from 'dsh-legion-receipts'
import {
  Config,
  materializeConfig,
  materializeCompiledConfigWithDiagnostics,
  validateSettingsSection,
  type LegionConfig,
  type CompiledConfig,
} from './config.ts'
import { registerLegionRunProjection, type HostProjectionContext } from './durable-run/projection.ts'
import {
  assertDurableMutationAvailable,
  detectDurableCapabilities,
  durableActivationAvailable,
  type DurableCapabilityContext,
  type DurableCapabilitySnapshot,
} from './durable-run/capabilities.ts'
import {
  assertCatalogUsable,
  compileDelegationPlan,
  compileSpecialistCatalog,
  type DelegationPlan,
  type RuntimeSnapshot,
} from './compiler.ts'
import { createCoordinatorCatalog, renderCoordinatorGuidance } from './prompt.ts'
import { clearRunReceiptTerminal, renderRunReceiptSummary } from './run-receipt.ts'
import { outputText, settleForeground } from './settlement.ts'
import {
  assertOrchestrationCatalogUsable,
  compileOrchestrationCatalog,
  compileStrategy,
  renderOrchestrationGuidance,
} from './orchestration.ts'
import {
  COHORT_RUN_OUTCOMES,
  createStrategyExecutionSnapshot,
  executeStrategyPlan,
  type StrategyExecutionSnapshot,
} from './execution.ts'
import type { StrategyLimits } from './orchestration-contract.ts'
import { RoutePlanError, applyRoutePlan, compileRoutePlan, observeModelRoutes } from './route.ts'
import { EMPTY_RESOURCE_SNAPSHOT, loadSpecialistResources, type ResourceSnapshot } from './resources.ts'
import { createSerializedRepublication } from './internal/republication.ts'
import {
  LEGION_SETTINGS_NAMESPACE,
  detectSettingsCapabilities,
  installSettingsSection,
  registerSettingsNamespace,
  type SettingsCapabilitySnapshot,
  type SettingsDiagnosticCode,
  type SettingsHostContext,
} from './settings.ts'

export {
  CANONICAL_CONFIG_VERSION,
  CURRENT_CONFIG_VERSION,
  Config,
  LegionProfileSchema,
  SpecialistSpecSchema,
  SPECIALIST_NAME,
  PROFILE_NAME,
  RESULT_CONTRACTS,
  exportConfigDocument,
  exportCurrentConfigDocument,
  materializeConfig,
  materializeConfigWithDiagnostics,
  materializeCurrentConfig,
  materializeCurrentConfigWithDiagnostics,
  validateConfig,
} from './config.ts'
export type {
  CompiledConfig,
  CompiledConfigResult,
  ConfigDeprecationDiagnostic,
  CurrentConfig,
  LegionConfig,
  LegionProfile,
  ConfigExportTarget,
  ConfigVersion,
  DurableRunPolicySpec,
  MaterializedConfig,
  MaterializedConfigResult,
  MaterializedCurrentConfig,
  MaterializedCurrentConfigResult,
  PromptFileReference,
  ResultContract,
  RouteCandidate,
  RouteConstraints,
  SpecialistSpec,
} from './config.ts'
export {
  CatalogCompileError,
  DelegationPlanError,
  ERROR_DIAGNOSTIC_CODES,
  WARNING_DIAGNOSTIC_CODES,
  assertCatalogUsable,
  compileCatalog,
  compileDelegationPlan,
  compileSpecialistCatalog,
} from './compiler.ts'
export type {
  CompiledCatalog,
  CompiledSpecialistCatalog,
  DelegationInvocation,
  DelegationPlan,
  Diagnostic,
  DiagnosticCode,
  DiagnosticSeverity,
  EffectiveProfile,
  EffectiveSpecialist,
  ErrorDiagnostic,
  ErrorDiagnosticCode,
  ProviderFacts,
  RuntimeSnapshot,
  SpecialistDiagnostic,
  SpecialistDiagnosticCode,
  SpecialistDiagnosticSeverity,
  SpecialistErrorDiagnostic,
  WarningDiagnosticCode,
} from './compiler.ts'
export {
  FINDINGS_V1_SCHEMA,
  REVIEW_V1_SCHEMA,
  materializeStructuredResult,
  outputSchemaFor,
} from './result-contract.ts'
export {
  EMPTY_RESOURCE_SNAPSHOT,
  SpecialistResourceError,
  ProfileResourceError,
  assertResourceSnapshot,
  createResourceSnapshot,
  loadProfileResources,
  loadSpecialistResources,
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
  RoutableSpecialist,
  SelectedRoutePlan,
  UnroutableRoutePlan,
} from './route.ts'
export {
  CatalogDigest,
  PolicyDigest,
  ProfileName,
  SpecialistName,
  ResourceDigest,
  RoutePlanDigest,
  ArtifactName,
  MemberSlotName,
  StrategyGenerationId,
  StrategyName,
  StrategyPlanDigest,
  CohortName,
  CohortRunId,
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
  CohortSpecSchema,
  TeamSpecSchema,
  defineStrategy,
  defineStrategyFor,
  defineCohort,
  defineTeam,
} from './orchestration-contract.ts'
export type {
  ArtifactContract,
  ArtifactInputRef,
  ArtifactOutputSpec,
  CatalogDisableSpec,
  CatalogLayer,
  CohortLimits,
  CohortSpec,
  DefinedCohort,
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
  CompiledCohort,
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
  ACP_AGENT_CATALOG,
  ACP_CATALOG_LAYER_ID,
  ACP_ENTRYPOINT_PROVENANCE,
  ACP_PROVIDER_PLUGIN,
  AcpCatalogError,
  acpMountRows,
  acpSpecialist,
  acpSpecialistCatalogLayer,
  assertAcpSpecialistCompatible,
  defineAcpAgent,
  renderAcpFragment,
} from './acp-catalog.ts'
/** @deprecated Use acpSpecialistCatalogLayer. */
export { acpCatalogLayer } from './acp-catalog.ts'
/** @deprecated Use acpSpecialist. */
export { acpProfile } from './acp-catalog.ts'
/** @deprecated Use assertAcpSpecialistCompatible. */
export { assertAcpProfileCompatible } from './acp-catalog.ts'
export type {
  AcpAgentSpec,
  AcpCatalogOptions,
  AcpSpecialistCatalogLayer,
  AcpEntrypointProvenance,
  AcpMountRow,
} from './acp-catalog.ts'
export {
  LEGION_SETTINGS_NAMESPACE,
  LEGION_SETTINGS_SERVICE_KEY,
  SETTINGS_DIAGNOSTIC_CODES,
  detectSettingsCapabilities,
  installSettingsSection,
} from './settings.ts'
export type {
  SettingsCapabilitySnapshot,
  SettingsDiagnosticCode,
  SettingsHostContext,
  SettingsProviderLike,
  SettingsRegisterOptionsLike,
  SettingsScopeLike,
  SettingsSectionHooks,
} from './settings.ts'
export {
  COHORT_RUN_OUTCOMES,
  TEAM_RUN_OUTCOMES,
  createStrategyExecutionSnapshot,
  executeStrategyPlan,
} from './execution.ts'
export type {
  CohortRunOutcome,
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
export * from './durable-run/environment.ts'
export * from './durable-run/attempt-binding.ts'
export * from './durable-run/dispatch.ts'
export * from './durable-run/admission.ts'
export * from './durable-run/reducer.ts'
export * from './durable-run/metrics.ts'
export * from './durable-run/events.ts'
export * from './durable-run/invariant.ts'
export * from './durable-run/projection.ts'
export * from './durable-run/replay.ts'
export {
  compileStaticPlanGraph,
  deriveReadyFrontier,
  deriveTaskReadiness,
  evolvePlanGraph,
  materializePlanGraph,
} from './durable-run/graph.ts'
export type {
  FrontierArtifact,
  FrontierTaskState,
  InvokeTaskSpec,
  PlanEdge,
  PlanEdgeReason,
  PlanGraph,
  TaskArtifactInput,
  TaskArtifactOutput,
  TaskBlockedReason,
  TaskReadiness,
  TaskSpec,
  TaskWaitingReason,
} from './durable-run/graph.ts'
export * from './durable-run/controller.ts'
export * from './durable-run/host.ts'
export * from './durable-run/capabilities.ts'
export * from './durable-run/lease.ts'
export * from './durable-run/recovery.ts'
export * from './durable-run/result-acceptance.ts'
export * from './durable-run/run-control.ts'

export const name = 'dsh-legion'

/**
 * Services a delegation row waits for.
 *
 * They are declared on the delegation half rather than on the package,
 * because a settings row publishes no tool, no prompt section, and starts no
 * child: made a package-level dependency, the Host-plane row would sit PENDING
 * on a composition that serves settings without one of them, and the only
 * symptom would be a card that never appears.
 */
export const DELEGATION_INJECT = Object.freeze([
  'tools',
  'subagents',
  'systemPrompt',
] as const)

const PROMPT_ORDER = (
  FIRST_PARTY_SECTION_ORDER.TOOL_SUBAGENT + FIRST_PARTY_SECTION_ORDER.TOOL_REPORT
) / 2

interface SpecialistToolArgs {
  readonly kind: 'specialist'
  readonly specialist?: string
  readonly description: string
  readonly prompt: string
  readonly run_in_background?: boolean
}

interface StrategyToolArgs {
  readonly kind: 'strategy'
  readonly strategy: string
  readonly objective: string
  readonly limits?: Partial<StrategyLimits>
  readonly execution?: {
    readonly durability: 'ephemeral' | 'journal'
    readonly advancement?: 'continuous' | 'checkpoint'
  }
}

type ToolArgs = SpecialistToolArgs | StrategyToolArgs

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


function parseStrategyExecution(
  value: unknown,
): NonNullable<StrategyToolArgs['execution']> {
  const source = argumentRecord(value)
  assertAllowedArguments(source, ['durability', 'advancement'])
  if (source.durability !== 'ephemeral' && source.durability !== 'journal') {
    throw new Error('dsh-legion: REQUEST_INVALID: execution.durability must be ephemeral or journal')
  }
  if (source.advancement !== undefined
    && source.advancement !== 'continuous'
    && source.advancement !== 'checkpoint') {
    throw new Error('dsh-legion: REQUEST_INVALID: execution.advancement is invalid')
  }
  return {
    durability: source.durability,
    ...(source.advancement === undefined ? {} : { advancement: source.advancement }),
  }
}

function parseToolArgs(
  value: unknown,
  enableStrategies: boolean,
  enableDurableRuns: boolean,
): ToolArgs {
  const input = argumentRecord(value)
  const strategySignal = input.kind === 'strategy'
    || Object.hasOwn(input, 'strategy')
    || Object.hasOwn(input, 'objective')
    || Object.hasOwn(input, 'limits')
    || Object.hasOwn(input, 'execution')
  if (strategySignal) {
    if (!enableStrategies) throw new Error('dsh-legion: STRATEGIES_DISABLED: model Strategy calls are disabled')
    assertAllowedArguments(input, [
      'kind', 'strategy', 'objective', 'limits',
      ...(enableDurableRuns ? ['execution'] : []),
    ])
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
      ...input.execution === undefined
        ? {}
        : { execution: parseStrategyExecution(input.execution) },
    }
  }
  assertAllowedArguments(input, enableStrategies
    ? ['kind', 'specialist', 'profile', 'description', 'prompt', 'run_in_background']
    : ['specialist', 'profile', 'description', 'prompt', 'run_in_background'])
  if (input.kind !== undefined && input.kind !== 'specialist' && input.kind !== 'profile') {
    throw new Error('dsh-legion: REQUEST_INVALID: kind must be "specialist" or "strategy"')
  }
  if (typeof input.description !== 'string' || input.description.trim().length === 0) {
    throw new Error('dsh-legion: REQUEST_INVALID: description must be a non-empty string')
  }
  if (typeof input.prompt !== 'string' || input.prompt.trim().length === 0) {
    throw new Error('dsh-legion: REQUEST_INVALID: prompt must be a non-empty string')
  }
  if (input.specialist !== undefined && typeof input.specialist !== 'string') {
    throw new Error('dsh-legion: REQUEST_INVALID: specialist must be a string')
  }
  if (input.profile !== undefined && typeof input.profile !== 'string') {
    throw new Error('dsh-legion: REQUEST_INVALID: profile must be a string')
  }
  if (input.specialist !== undefined && input.profile !== undefined) {
    throw new Error('dsh-legion: REQUEST_INVALID: specialist and deprecated profile cannot be combined')
  }
  if (input.run_in_background !== undefined && typeof input.run_in_background !== 'boolean') {
    throw new Error('dsh-legion: REQUEST_INVALID: run_in_background must be a boolean')
  }
  const specialist = input.specialist ?? input.profile
  return {
    kind: 'specialist',
    description: input.description,
    prompt: input.prompt,
    ...specialist === undefined ? {} : { specialist },
    ...input.run_in_background === undefined ? {} : { run_in_background: input.run_in_background },
  }
}

function runtimeSnapshot(ctx: Context, config: CompiledConfig): RuntimeSnapshot {
  const providers = Object.fromEntries(
    [...new Set(Object.values(config.specialists).map(profile => profile.subagentProvider))]
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
      `dsh-legion: Specialist "${plan.specialist}" requires unavailable subagent provider "${plan.subagentProvider}"`,
    )
  }
  if (plan.mode === 'continuable') {
    if (provider.prepareContinuable === undefined) {
      throw new Error(
        `dsh-legion: Specialist "${plan.specialist}" cannot run in the background because provider "${provider.name}" is not continuable`,
      )
    }
    return provider
  }
  if (plan.agentOptions !== undefined && !provider.capabilities.agentOptions) {
    throw new Error(
      `dsh-legion: Specialist "${plan.specialist}" requires Agent option overrides but provider "${provider.name}" does not support them`,
    )
  }
  if (plan.maxDepth !== undefined && !provider.capabilities.depthLimit) {
    throw new Error(
      `dsh-legion: Specialist "${plan.specialist}" sets numeric maxDepth but provider "${provider.name}" cannot enforce it; use provider-managed`,
    )
  }
  if (plan.persona !== undefined && !provider.capabilities.persona) {
    throw new Error(
      `dsh-legion: Specialist "${plan.specialist}" sets persona but provider "${provider.name}" does not support it`,
    )
  }
  if (plan.toolFilter !== undefined && !provider.capabilities.toolFilter) {
    throw new Error(
      `dsh-legion: Specialist "${plan.specialist}" sets toolFilter but provider "${provider.name}" does not support it`,
    )
  }
  if (plan.outputSchema !== undefined && !provider.capabilities.outputSchema) {
    throw new Error(
      `dsh-legion: Specialist "${plan.specialist}" requires structured output but provider "${provider.name}" does not support it`,
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

function createToolDefinition(
  ctx: Context,
  snapshot: StrategyExecutionSnapshot,
  durable: {
    readonly enabled: boolean
    readonly capabilities: DurableCapabilitySnapshot
  },
): ToolDefinition {
  const { specialists: catalog, orchestration } = snapshot
  const specialistNames = Object.keys(catalog.activeSpecialists)
  const strategyNames = catalog.enableStrategies
    ? Object.values(orchestration.strategies)
        .filter(strategy => strategy.active)
        .map(strategy => String(strategy.name))
        .sort()
    : []
  const hasStrategySurface = strategyNames.length > 0
  const durableExecutionExposed = durable.enabled
    && durableActivationAvailable(durable.capabilities)
  const specialistRequired = catalog.defaultSpecialist === undefined && !hasStrategySurface
  const specialistDescription = catalog.defaultSpecialist === undefined
    ? 'Configured Specialist. Choose by task fit, not by raw model preference.'
    : `Configured Specialist. Defaults to ${catalog.defaultSpecialist}.`

  const definition = defineTool({
    name: catalog.toolName,
    description: (hasStrategySurface
      ? 'Delegate through a configured Legion Specialist or execute an explicitly enabled bounded Cohort Strategy. '
      : 'Delegate focused work through a configured Legion Specialist. Each Specialist fixes child policy. ')
      + (catalog.enableRunInBackground
        ? 'Background execution returns a durable child id immediately; foreground execution waits for the final result.'
        : 'This instance only allows foreground execution.'),
    parameters: {
      ...hasStrategySurface ? {
        kind: {
          type: 'string' as const,
          enum: ['specialist', 'strategy'],
          description: 'Request discriminator. Strategy calls must set strategy; Specialist calls may omit it.',
        },
      } : {},
      specialist: {
        type: 'string',
        enum: specialistNames,
        description: specialistDescription,
      },
      description: {
        type: 'string',
        ...hasStrategySurface ? {} : { required: true as const },
        description: 'A short 3-5 word label for the delegated task.',
      },
      prompt: {
        type: 'string',
        ...hasStrategySurface ? {} : { required: true as const },
        description: 'A complete standalone task for a fresh Specialist, or focused follow-up context for an inheriting backend.',
      },
      ...hasStrategySurface ? {
        strategy: {
          type: 'string' as const,
          enum: strategyNames,
          description: 'Explicit configured Strategy name. Requires kind strategy.',
        },
        objective: {
          type: 'string' as const,
          description: 'Complete bounded objective for the Cohort Strategy.',
        },
        limits: {
          type: 'json' as const,
          description: 'Optional positive-integer narrowing limits: maxAgents, maxConcurrent, deadlineMs, maxOutputBytes.',
        },
        ...durableExecutionExposed ? {
          execution: {
            type: 'json' as const,
            description: 'Optional { durability: ephemeral | journal, advancement?: continuous | checkpoint }. Omission runs the ephemeral executor.',
          },
        } : {},
      } : {},
      ...catalog.enableRunInBackground ? {
        run_in_background: {
          type: 'boolean' as const,
          description: 'Whether to return a durable child id immediately. When omitted, the selected Specialist decides.',
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
              receipt: {
                type: 'object' as const,
                required: true as const,
                additionalProperties: false,
                properties: {
                  runId: { type: 'string' as const, required: true as const },
                  outcome: {
                    type: 'string' as const,
                    required: true as const,
                    enum: COHORT_RUN_OUTCOMES,
                  },
                  elapsedMs: { type: 'number' as const, required: true as const },
                  stageCounts: {
                    type: 'object' as const,
                    required: true as const,
                    additionalProperties: false,
                    properties: {
                      total: { type: 'number' as const, required: true as const },
                      pending: { type: 'number' as const, required: true as const },
                      completed: { type: 'number' as const, required: true as const },
                      degraded: { type: 'number' as const, required: true as const },
                      cancelled: { type: 'number' as const, required: true as const },
                      failed: { type: 'number' as const, required: true as const },
                    },
                  },
                  participationCounts: {
                    type: 'object' as const,
                    required: true as const,
                    additionalProperties: false,
                    properties: {
                      total: { type: 'number' as const, required: true as const },
                      local: { type: 'number' as const, required: true as const },
                      remote: { type: 'number' as const, required: true as const },
                      running: { type: 'number' as const, required: true as const },
                      idle: { type: 'number' as const, required: true as const },
                      ended: { type: 'number' as const, required: true as const },
                    },
                  },
                  tokenTotals: {
                    type: 'object' as const,
                    required: true as const,
                    additionalProperties: false,
                    properties: Object.fromEntries(RUN_RECEIPT_TOKEN_FIELDS.map(field => [
                      field,
                      {
                        required: true as const,
                        oneOf: [{ type: 'number' as const }, { type: 'null' as const }] as const,
                      },
                    ])) as Record<(typeof RUN_RECEIPT_TOKEN_FIELDS)[number], {
                      readonly required: true
                      readonly oneOf: readonly [
                        { readonly type: 'number' },
                        { readonly type: 'null' },
                      ]
                    }>,
                  },
                  unavailableCounts: {
                    type: 'object' as const,
                    required: true as const,
                    additionalProperties: false,
                    properties: {
                      participation: { type: 'number' as const, required: true as const },
                      timing: { type: 'number' as const, required: true as const },
                      tokenDimensions: { type: 'number' as const, required: true as const },
                    },
                  },
                  truncatedCounts: {
                    type: 'object' as const,
                    required: true as const,
                    additionalProperties: false,
                    properties: {
                      participation: { type: 'number' as const, required: true as const },
                      tokenSessions: { type: 'number' as const, required: true as const },
                    },
                  },
                  coverage: {
                    type: 'object' as const,
                    required: true as const,
                    additionalProperties: false,
                    properties: {
                      participation: { type: 'string' as const, required: true as const, enum: ['complete', 'partial', 'unavailable'] },
                      timing: { type: 'string' as const, required: true as const, enum: ['complete', 'partial', 'unavailable'] },
                      tokens: { type: 'string' as const, required: true as const, enum: ['complete', 'partial', 'unavailable'] },
                    },
                  },
                  feed: {
                    type: 'object' as const,
                    required: true as const,
                    additionalProperties: false,
                    properties: {
                      status: {
                        type: 'string' as const,
                        required: true as const,
                        enum: ['available', 'unavailable', 'rejected', 'incompatible'],
                      },
                      failure: {
                        required: true as const,
                        oneOf: [{ type: 'string' as const }, { type: 'null' as const }] as const,
                      },
                    },
                  },
                },
              },
            },
          }] : [],
        ],
      },
      render: (_args, value) => [{
        type: 'text',
        text: 'strategy' in value
          ? `Legion Strategy ${value.strategy}\n${renderStrategyOutcome(value.outcome)}\n${renderRunReceiptSummary(value.receipt)}`
          : 'subagentId' in value
            ? `started Legion Specialist ${value.profile}`
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
      const args = parseToolArgs(
        rawArgs,
        catalog.enableStrategies,
        durable.enabled,
      )
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
        if (args.execution?.durability === 'journal') {
          assertDurableMutationAvailable(durable.capabilities)
          throw new Error(
            'dsh-legion: LEGION_DURABLE_EXECUTION_ADAPTER_UNAVAILABLE: '
            + 'this build binds no durable Strategy activation adapter, so journal mode cannot start',
          )
        }
        const { receipt, ...outcome } = await executeStrategyPlan(
          ctx, snapshot, compiled.plan, parent, exec.signal,
        )
        return {
          kind: 'strategy' as const,
          strategy: args.strategy,
          planDigest: compiled.plan.planDigest,
          outcome: outcome as unknown as JsonValue,
          receipt,
        }
      }

      let plan = compileDelegationPlan(catalog, {
        ...args.specialist === undefined ? {} : { specialist: args.specialist },
        description: args.description,
        prompt: args.prompt,
        ...args.run_in_background === undefined ? {} : { runInBackground: args.run_in_background },
      })
      const profile = catalog.activeSpecialists[plan.specialist]!
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
      requireSelectedLlmAdapter(ctx, plan)

      if (plan.mode === 'continuable') {
        exec.signal.throwIfAborted()
        clearRunReceiptTerminal(ctx, parent.session)
        const started = await ctx.subagents.startContinuable({
          provider: plan.subagentProvider,
          label: plan.label,
          request,
          signal: exec.signal,
        })
        return {
          kind: 'continuable' as const,
          profile: plan.specialist,
          subagentId: started.childId,
          policyDigest: plan.policyDigest,
          catalogDigest: plan.catalogDigest,
          resourceDigest: plan.resourceDigest,
          ...plan.routePlan === undefined
            ? {}
            : { routePlan: plan.routePlan as unknown as JsonValue },
        }
      }

      return settleForeground(
        plan,
        () => {
          clearRunReceiptTerminal(ctx, parent.session)
          return ctx.subagents.start(plan.subagentProvider, {
            ...request,
            signal: exec.signal,
          })
        },
        exec.signal,
        cleanup => {
          if (cleanup.kind !== 'quiescent') {
            ctx.logger.warn(`dsh-legion: late foreground cleanup ended ${cleanup.kind}`)
          }
        },
      )
    },
  })
  const flat = definition.parameters as {
    properties: Record<string, unknown>
  }
  const specialistProperties = Object.fromEntries(
    ['kind', 'specialist', 'description', 'prompt', 'run_in_background']
      .flatMap(key => flat.properties[key] === undefined ? [] : [[key, flat.properties[key]]]),
  )
  if (hasStrategySurface) {
    specialistProperties.kind = { type: 'string', const: 'specialist' }
  }
  const specialistRequiredFields = [
    ...(specialistRequired ? ['specialist'] : []),
    'description',
    'prompt',
  ]
  if (!hasStrategySurface) {
    return {
      ...definition,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: specialistProperties,
        required: specialistRequiredFields,
      },
    }
  }
  const strategyProperties = Object.fromEntries(
    ['kind', 'strategy', 'objective', 'execution']
      .flatMap(key => flat.properties[key] === undefined ? [] : [[key, flat.properties[key]]]),
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
          properties: specialistProperties,
          required: specialistRequiredFields,
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

function profileResourceBase(ctx: Context, config: CompiledConfig): string | undefined {
  const hasReferences = Object.values(config.specialists).some(profile => (profile.promptFiles?.length ?? 0) > 0)
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

/**
 * One fully materialized configuration input to a published Tool generation.
 * Config and prompt-fragment resources move together because a Specialist's
 * fragments are named by the same document that names the Specialist: publishing
 * one without the other would show a catalog whose prompts belong to a
 * different revision.
 */
interface ConfigGeneration {
  readonly config: CompiledConfig
  readonly resources: ResourceSnapshot
}

/**
 * Serve the Legion settings namespace for the lifetime of this composition and
 * contribute nothing else.
 *
 * A settings namespace is process-wide, but a Specialist catalog belongs to the
 * row that composed it, so this row registers the namespace and publishes no
 * tool, no prompt section, no projection, and no service. Mounting it from the
 * Host composition is what keeps the configuration surface offering Legion
 * between sessions: registration is an effect on the registering fiber, so the
 * same namespace registered from an Agent Preset is served exactly while a
 * session using that preset is alive.
 * @param ctx - the settings row plugin context.
 * @param config - the row entry, layered under the stored user section.
 */
async function applySettingsRow(ctx: Context, config: LegionConfig): Promise<void> {
  const declared = Object.keys(config.profiles ?? {}).length
    + Object.keys(config.specialists ?? {}).length
    + Object.keys(config.teams ?? {}).length
    + Object.keys(config.cohorts ?? {}).length
    + Object.keys(config.strategies ?? {}).length
  if (declared > 0) {
    // Catalog data on this row would be silently unreachable, which is exactly
    // the kind of quiet misconfiguration a coordinator must not keep to itself.
    ctx.logger.warn(
      'dsh-legion: a role: settings row publishes no delegation surface, so the '
      + `${String(declared)} Specialist, Cohort, and Strategy entries it declares are ignored; `
      + 'move them to the delegation row that publishes the tool',
    )
  }
  // Attached unconditionally, awaited only when a provider is already there.
  // The attach is an injected scope, so a provider composed after this row —
  // Host rows activate on service availability, not in file order — still
  // reaches it; awaiting that wait instead would leave the row PENDING for the
  // whole life of a deployment that composes no settings provider at all.
  const attached = registerSettingsNamespace(
    ctx as unknown as SettingsHostContext,
    LEGION_SETTINGS_NAMESPACE,
    Config,
    config,
    {
      // Only the facts that hold for any catalog: this row owns a namespace
      // several rows read, and each of those judges its own cross-references.
      validate: (value) => { validateSettingsSection(value) },
      onError: (error) => {
        ctx.logger.warn(
          `dsh-legion: ${'LEGION_SETTINGS_REGISTRATION_REJECTED' satisfies SettingsDiagnosticCode}`
          + ': the settings namespace is not served by this row',
        )
        ctx.logger.warn(error)
      },
    },
  )
  if (detectSettingsCapabilities(ctx as unknown as SettingsHostContext).liveReconfiguration) {
    await attached
  }
}

/**
 * The delegation half, as its own plugin so it can declare the services it
 * actually uses. Mounted by {@link apply} for every row that is not a settings
 * row; the child fiber derives from the row context, so its tool and prompt
 * section land in the same layer and unwind with the row.
 */
const delegationRow = {
  name: `${name}:delegation`,
  inject: [...DELEGATION_INJECT],
  apply: applyDelegationRow,
}

export async function apply(ctx: Context, config: LegionConfig): Promise<void> {
  if (config.role === 'settings') return applySettingsRow(ctx, config)
  await ctx.plugin(delegationRow, config)
}

async function applyDelegationRow(ctx: Context, config: LegionConfig): Promise<void> {
  registerLegionRunProjection(ctx as unknown as HostProjectionContext)
  const durableCapabilities = detectDurableCapabilities(
    ctx as unknown as DurableCapabilityContext,
  )
  const settingsCapabilities: SettingsCapabilitySnapshot = detectSettingsCapabilities(
    ctx as unknown as SettingsHostContext,
  )

  // The composition entry is the authoritative source until a settings service
  // attaches, and becomes authoritative again the moment one detaches.
  let configSource: () => LegionConfig = () => config
  let warnedDurableGap = false
  // These guards are read by `republish`, which the settings attach can call
  // before the publication state below exists, so they are bound first.
  let requestRepublication: (() => Promise<void>) | undefined
  let prepublishPending = false
  // Republication is armed only once the first generation is published: the
  // initial materialization already reads through the attached settings scope,
  // so an attach-time notification has nothing left to re-derive.
  let published = false
  let stopped = false

  const materializeGeneration = async (authored: LegionConfig): Promise<ConfigGeneration> => {
    const materialized = materializeCompiledConfigWithDiagnostics(authored)
    for (const diagnostic of materialized.diagnostics) {
      ctx.logger.warn(`${diagnostic.code}: ${diagnostic.message}`)
    }
    const resolved = materialized.config
    const resourceBase = profileResourceBase(ctx, resolved)
    const resources: ResourceSnapshot = resourceBase === undefined
      ? EMPTY_RESOURCE_SNAPSHOT
      : await loadSpecialistResources(authored, { baseDirectory: resourceBase })
    return { config: resolved, resources }
  }

  // Legion is a development coordinator, and PTC mode is what makes coordination
  // efficient: one program starts several delegations together and reduces their
  // results without a model round trip per child. The TypeScript runtime that
  // mode needs is host-plane — a preset can select the presentation but cannot
  // supply the runtime — so when a deployment composes none, the actionable fact
  // is which package to add, not that Legion is broken. Legion keeps working in
  // the native presentation; this is a notice, never a refusal.
  //
  // Read-only probe, never an `inject`: taking the runtime as a dependency would
  // make the Legion row itself unmountable exactly on the deployments this notice
  // exists to help. Probed once at activation, after the Host bundle has booted.
  const announceCodeRuntimeGap = (): void => {
    if (ctx.get?.('codeRuntime') !== undefined) return
    ctx.logger.warn(
      'dsh-legion: no ctx.codeRuntime in this deployment, so delegation runs in the native '
      + 'tool presentation. Install @deepseek-ai/dsh-code-runtime-worker-thread and add '
      + "'- id: code-runtime' / \"name: '@deepseek-ai/dsh-code-runtime-worker-thread'\" to the "
      + 'Host composition to enable PTC mode. The shipped dsh bundles compose it already.',
    )
  }

  const announceDurableGap = (resolved: CompiledConfig): void => {
    const gap = resolved.enableDurableRuns && !durableCapabilities.durableMutation
    if (!gap || warnedDurableGap) {
      warnedDurableGap = gap
      return
    }
    warnedDurableGap = true
    ctx.logger.warn(
      `dsh-legion: durable runs disabled: ${durableCapabilities.diagnostics.join(', ')}`,
    )
  }

  // Wiring the settings source can only widen where configuration comes from,
  // so it happens before the first generation is materialized: the initial
  // publish then already reflects a stored user section instead of publishing
  // the entry and immediately republishing over it.
  //
  // The wiring is attached unconditionally and awaited only when a provider is
  // already there. There is nothing stored to wait for otherwise, and the
  // injected scope still catches a provider that attaches later — awaiting that
  // wait instead would hold the row PENDING for the life of a deployment that
  // composes no settings provider at all.
  {
    const attached = installSettingsSection(
      ctx as unknown as SettingsHostContext,
      LEGION_SETTINGS_NAMESPACE,
      Config,
      config,
      {
        setSource: (current) => { configSource = current },
        onChange: () => { republish() },
        // Owning the namespace, this refuses the write while the caller is
        // still there to read why. Consuming one, the same check runs on the
        // committed section instead: a catalog cross-reference is judged per
        // row, so the owner cannot refuse it for everyone (see ADR 0023) and a
        // row that cannot materialize a section keeps its last generation.
        validate: (value) => { materializeConfig(value) },
        onError: (error) => {
          ctx.logger.warn(
            `dsh-legion: ${'LEGION_SETTINGS_REGISTRATION_REJECTED' satisfies SettingsDiagnosticCode}`
            + ': using the composition entry',
          )
          ctx.logger.warn(error)
        },
      },
    )
    if (settingsCapabilities.liveReconfiguration) await attached
  }
  // The attach notification is already reflected by the source read below;
  // only later commits during asynchronous initial materialization need replay.
  prepublishPending = false

  let generation = await materializeGeneration(configSource())
  ctx.fiber.assertActive()
  announceCodeRuntimeGap()
  announceDurableGap(generation.config)
  let activeSnapshot: StrategyExecutionSnapshot | undefined
  let activeDefinition: ToolDefinition | undefined
  let disposeTool: (() => void) | undefined
  let refreshing = false
  let registrationFailed = false

  let publishedToolName: string | undefined

  const refresh = (): void => {
    if (refreshing) return
    refreshing = true
    registrationFailed = false
    try {
      const { config: resolved, resources } = generation
      const nextProfiles = compileSpecialistCatalog(resolved, runtimeSnapshot(ctx, resolved), resources)
      assertCatalogUsable(nextProfiles)
      const nextOrchestration = compileOrchestrationCatalog(nextProfiles)
      assertOrchestrationCatalogUsable(nextOrchestration)
      const nextSnapshot = createStrategyExecutionSnapshot(nextProfiles, nextOrchestration)
      const nextDefinition = Object.keys(nextProfiles.activeSpecialists).length === 0
        ? undefined
        : createToolDefinition(ctx, nextSnapshot, {
            enabled: resolved.enableDurableRuns,
            capabilities: durableCapabilities,
          })
      // A renamed tool cannot be swapped in place: the Host keys registrations
      // by name, so the old name has to be withdrawn before the new one exists.
      if (disposeTool !== undefined && publishedToolName !== nextProfiles.toolName) {
        disposeTool()
        disposeTool = undefined
        publishedToolName = undefined
      }
      if (nextDefinition === undefined) {
        activeSnapshot = nextSnapshot
        activeDefinition = undefined
        disposeTool?.()
        disposeTool = undefined
        publishedToolName = undefined
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
          publishedToolName = nextProfiles.toolName
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

  const republication = createSerializedRepublication({
    active: () => published && !stopped,
    publishLatest: async () => {
      const next = await materializeGeneration(configSource())
      if (stopped) return
      generation = next
      announceDurableGap(next.config)
      refresh()
    },
    onError: (error) => {
      // The last published generation is still a working catalog, so a bad
      // reload degrades to staleness rather than to no delegation surface.
      ctx.logger.warn('dsh-legion: configuration republication failed; keeping the published generation')
      ctx.logger.warn(error)
    },
  })
  requestRepublication = () => republication.request()

  /**
   * Request configuration-sourced republication. Loading prompt fragments is
   * asynchronous, so the serializer keeps one in-flight pass and one latest
   * pending follow-up; a failed pass reports independently and cannot consume
   * a newer committed generation.
   */
  function republish(): void {
    if (stopped) return
    if (!published) {
      prepublishPending = true
      return
    }
    void requestRepublication?.()
  }

  ctx.on('subagent/provider-added', (provider) => {
    if (Object.values(generation.config.specialists).some(profile => profile.subagentProvider === provider.name)) refresh()
  })
  ctx.on('subagent/provider-removed', (providerName) => {
    if (Object.values(generation.config.specialists).some(profile => profile.subagentProvider === providerName)) refresh()
  })
  ctx.on('llm/adapters-updated', refresh)
  ctx.on('tools/change', () => {
    if (registrationFailed && !refreshing) refresh()
  })
  ctx.effect(() => () => {
    stopped = true
    disposeTool?.()
    disposeTool = undefined
    publishedToolName = undefined
    activeDefinition = undefined
    activeSnapshot = undefined
  }, 'dsh-legion.activeTool()')

  ctx.systemPrompt.section({
    name: `tool:${generation.config.toolName}`,
    order: PROMPT_ORDER,
    text: () => {
      if (activeSnapshot === undefined
        || Object.keys(activeSnapshot.specialists.activeSpecialists).length === 0) return ''
      const catalog = activeSnapshot.specialists
      const profileGuidance = renderCoordinatorGuidance(createCoordinatorCatalog({
        toolName: catalog.toolName,
        enableRunInBackground: catalog.enableRunInBackground,
        specialists: catalog.activeSpecialists,
        ...catalog.defaultSpecialist === undefined ? {} : { defaultSpecialist: catalog.defaultSpecialist },
        ...catalog.guidance === undefined ? {} : { guidance: catalog.guidance },
      }))
      const strategyGuidance = catalog.enableStrategies
        ? renderOrchestrationGuidance(activeSnapshot.orchestration)
        : ''
      return [profileGuidance, strategyGuidance].filter(Boolean).join('\n\n')
    },
  })
  refresh()
  published = true
  if (prepublishPending) {
    prepublishPending = false
    republish()
  }
}
