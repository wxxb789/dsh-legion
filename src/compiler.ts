import type { SubagentCapabilities } from '@deepseek-ai/dsh-subagent'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { CompiledConfig, DurableRunPolicySpec, SpecialistSpec, ResultContract, RouteCandidate } from './config.ts'
import { materializeCompiledConfig, projectConfigToPublishedV2 } from './config.ts'
import { deepFreeze, sha256Digest } from './internal/value.ts'
import { outputSchemaFor } from './result-contract.ts'
import type { SelectedRoutePlan } from './route.ts'
import type { StrategySpec, CohortSpec } from './orchestration-contract.ts'
import {
  EMPTY_RESOURCE_SNAPSHOT,
  assertResourceSnapshot,
  renderPromptFragments,
  type LoadedPromptFragment,
  type ResourceSnapshot,
} from './resources.ts'
import {
  CatalogDigest as catalogDigest,
  PolicyDigest as policyDigest,
  SpecialistName as specialistName,
  type CatalogDigest,
  type PolicyDigest,
  type SpecialistName,
  type ResourceDigest,
} from './identity.ts'

export const WARNING_DIAGNOSTIC_CODES = Object.freeze([
  'PROFILE_PROVIDER_UNAVAILABLE',
  'PROFILE_LLM_ADAPTER_UNAVAILABLE',
  'DEFAULT_PROFILE_INACTIVE',
] as const)
export type WarningDiagnosticCode = (typeof WARNING_DIAGNOSTIC_CODES)[number]

export const ERROR_DIAGNOSTIC_CODES = Object.freeze([
  'PROFILE_CONTINUABLE_UNSUPPORTED',
  'PROFILE_AGENT_OPTIONS_UNSUPPORTED',
  'PROFILE_DEPTH_UNSUPPORTED',
  'PROFILE_PERSONA_UNSUPPORTED',
  'PROFILE_TOOL_FILTER_UNSUPPORTED',
  'PROFILE_OUTPUT_SCHEMA_UNSUPPORTED',
  'PROFILE_STRUCTURED_BACKGROUND_UNSUPPORTED',
] as const)
export type ErrorDiagnosticCode = (typeof ERROR_DIAGNOSTIC_CODES)[number]

export type SpecialistDiagnostic =
  | {
      readonly code: WarningDiagnosticCode
      readonly severity: 'warning'
      readonly message: string
      readonly specialist: SpecialistName
    }
  | {
      readonly code: ErrorDiagnosticCode
      readonly severity: 'error'
      readonly message: string
      readonly specialist: SpecialistName
    }

export type SpecialistDiagnosticCode = SpecialistDiagnostic['code']
export type SpecialistDiagnosticSeverity = SpecialistDiagnostic['severity']
export type SpecialistErrorDiagnostic = Extract<SpecialistDiagnostic, { severity: 'error' }>

/** Published V1 diagnostic shape retained at the explain boundary. */
export type LegacyDiagnostic =
  | {
      readonly code: WarningDiagnosticCode
      readonly severity: 'warning'
      readonly message: string
      readonly profile: SpecialistName
    }
  | {
      readonly code: ErrorDiagnosticCode
      readonly severity: 'error'
      readonly message: string
      readonly profile: SpecialistName
    }
export type LegacyErrorDiagnostic = Extract<LegacyDiagnostic, { severity: 'error' }>

export interface ProviderFacts {
  readonly capabilities: SubagentCapabilities
  readonly continuable: boolean
}

export interface RuntimeSnapshot {
  readonly providers: Readonly<Record<string, ProviderFacts>>
  /** Registered LLM adapter routes; absence means the observer has no topology evidence. */
  readonly llmProviders?: readonly string[]
}

export type EffectiveMode = 'foreground' | 'continuable'

export interface EffectiveSpecialist extends Omit<SpecialistSpec, 'agentOptions' | 'routes' | 'toolFilter' | 'promptFiles'> {
  readonly name: SpecialistName
  readonly agentOptions?: Readonly<NonNullable<SpecialistSpec['agentOptions']>>
  readonly routes?: readonly Readonly<RouteCandidate>[]
  readonly toolFilter?: {
    readonly allow?: readonly string[]
    readonly deny?: readonly string[]
  }
  readonly promptFiles?: readonly Readonly<NonNullable<SpecialistSpec['promptFiles']>[number]>[]
  readonly active: boolean
  readonly defaultMode: EffectiveMode
  readonly allowedModes: readonly EffectiveMode[]
  readonly result: ResultContract
  readonly promptFragments: readonly LoadedPromptFragment[]
}

export class CatalogCompileError extends Error {
  readonly diagnostics: SpecialistErrorDiagnostic[]

  constructor(diagnostics: readonly SpecialistErrorDiagnostic[]) {
    super(`dsh-legion: invalid compiled catalog: ${diagnostics.map(item => `${item.code}: ${item.message}`).join('; ')}`)
    this.name = 'CatalogCompileError'
    this.diagnostics = diagnostics.map(item => ({ ...item }))
  }
}

export interface DelegationInvocation {
  readonly specialist?: string
  /** @deprecated Use specialist. */
  readonly profile?: string
  readonly description: string
  readonly prompt: string
  readonly runInBackground?: boolean
}

export interface DelegationPlan {
  readonly specialist: SpecialistName
  readonly mode: EffectiveMode
  readonly subagentProvider: string
  readonly label: string
  readonly prompt: string
  readonly result: ResultContract
  readonly policyDigest: PolicyDigest
  readonly catalogDigest: CatalogDigest
  readonly resourceDigest: ResourceDigest
  readonly promptFragments: readonly LoadedPromptFragment[]
  readonly agentOptions?: SpecialistSpec['agentOptions']
  readonly persona?: string
  readonly toolFilter?: SpecialistSpec['toolFilter']
  readonly maxDepth?: number
  readonly outputSchema?: ObjectJsonSchema
  readonly routePlan?: SelectedRoutePlan
}

export class DelegationPlanError extends Error {
  readonly code: 'REQUEST_INVALID' | 'PROFILE_REQUIRED' | 'PROFILE_UNKNOWN' | 'PROFILE_INACTIVE' | 'BACKGROUND_DISABLED' | 'MODE_UNSUPPORTED' | 'STRUCTURED_BACKGROUND_UNSUPPORTED'

  constructor(code: DelegationPlanError['code'], message: string) {
    super(`dsh-legion: ${message}`)
    this.name = 'DelegationPlanError'
    this.code = code
  }
}

export interface CompiledSpecialistCatalog {
  readonly toolName: string
  readonly enableRunInBackground: boolean
  readonly enableStrategies: boolean
  readonly enableDurableRuns: boolean
  readonly durableRunPolicy: Readonly<Required<DurableRunPolicySpec>>
  readonly configuredDefaultSpecialist?: SpecialistName
  readonly defaultSpecialist?: SpecialistName
  readonly guidance?: string
  readonly specialists: Readonly<Record<string, EffectiveSpecialist>>
  readonly activeSpecialists: Readonly<Record<string, EffectiveSpecialist>>
  readonly cohorts: Readonly<Record<string, CohortSpec>>
  readonly strategies: Readonly<Record<string, StrategySpec>>
  readonly diagnostics: readonly SpecialistDiagnostic[]
  /** Digest of authored policy after schema defaults, independent of live provider state. */
  readonly policyDigest: PolicyDigest
  /** Digest of policy plus the runtime provider snapshot used for this compilation. */
  readonly catalogDigest: CatalogDigest
  readonly resourceDigest: ResourceDigest
}

/** @deprecated Use CompiledSpecialistCatalog. */
export type CompiledCatalog = CompiledSpecialistCatalog
/** @deprecated Use SpecialistDiagnostic. */
export type Diagnostic = LegacyDiagnostic
/** @deprecated Use SpecialistDiagnosticCode. */
export type DiagnosticCode = SpecialistDiagnosticCode
/** @deprecated Use SpecialistDiagnosticSeverity. */
export type DiagnosticSeverity = SpecialistDiagnosticSeverity
/** @deprecated Use SpecialistErrorDiagnostic. */
export type ErrorDiagnostic = LegacyErrorDiagnostic
/** @deprecated Use EffectiveSpecialist. */
export type EffectiveProfile = EffectiveSpecialist

function copyPromptFragments(
  fragments: readonly LoadedPromptFragment[],
): readonly LoadedPromptFragment[] {
  return Object.freeze(fragments.map(fragment => Object.freeze({ ...fragment })))
}

function copySpecialist(
  name: SpecialistName,
  profile: SpecialistSpec,
  active: boolean,
  defaultMode: EffectiveMode,
  allowedModes: readonly EffectiveMode[],
  promptFragments: readonly LoadedPromptFragment[],
): EffectiveSpecialist {
  const agentOptions = profile.agentOptions === undefined
    ? undefined
    : Object.freeze({ ...profile.agentOptions })
  const routes = profile.routes === undefined
    ? undefined
    : Object.freeze(profile.routes.map(route => Object.freeze({
        ...route,
        ...route.constraints === undefined
          ? {}
          : { constraints: Object.freeze({ ...route.constraints }) },
      })))
  const toolFilter = profile.toolFilter === undefined
    ? undefined
    : Object.freeze({
        ...profile.toolFilter.allow === undefined
          ? {}
          : { allow: Object.freeze([...profile.toolFilter.allow]) },
        ...profile.toolFilter.deny === undefined
          ? {}
          : { deny: Object.freeze([...profile.toolFilter.deny]) },
      })
  const promptFiles = profile.promptFiles === undefined
    ? undefined
    : Object.freeze(profile.promptFiles.map(reference => Object.freeze({ ...reference })))
  return Object.freeze({
    name,
    description: profile.description,
    subagentProvider: profile.subagentProvider,
    ...agentOptions === undefined ? {} : { agentOptions },
    ...routes === undefined ? {} : { routes },
    ...profile.persona === undefined ? {} : { persona: profile.persona },
    ...toolFilter === undefined ? {} : { toolFilter },
    maxDepth: profile.maxDepth,
    defaultRunInBackground: profile.defaultRunInBackground,
    result: profile.result ?? 'text',
    ...promptFiles === undefined ? {} : { promptFiles },
    promptFragments: copyPromptFragments(promptFragments),
    active,
    defaultMode,
    allowedModes: Object.freeze([...allowedModes]),
  })
}

function providerError(
  diagnostics: SpecialistDiagnostic[],
  specialist: SpecialistName,
  code: ErrorDiagnosticCode,
  message: string,
): void {
  diagnostics.push({ code, severity: 'error', specialist, message })
}

function isErrorDiagnostic(diagnostic: SpecialistDiagnostic): diagnostic is SpecialistErrorDiagnostic {
  return diagnostic.severity === 'error'
}

/** Reject a catalog whose present providers cannot satisfy configured defaults. */
export function assertCatalogUsable(catalog: CompiledSpecialistCatalog): void {
  const errors = catalog.diagnostics.filter(isErrorDiagnostic)
  if (errors.length > 0) throw new CatalogCompileError(errors)
}

/**
 * Compile one detached, deterministic Specialist catalog from schema-materialized
 * policy and a plain provider snapshot. No Cordis or DSH live object crosses
 * this seam.
 */
export function compileCatalog(
  input: unknown,
  snapshot: RuntimeSnapshot,
  resources: ResourceSnapshot = EMPTY_RESOURCE_SNAPSHOT,
): CompiledSpecialistCatalog {
  return compileSpecialistCatalog(materializeCompiledConfig(input), snapshot, resources)
}

/** Compile an already-normalized internal configuration without re-entering compatibility parsing. */
export function compileSpecialistCatalog(
  config: CompiledConfig,
  snapshot: RuntimeSnapshot,
  resources: ResourceSnapshot = EMPTY_RESOURCE_SNAPSHOT,
): CompiledSpecialistCatalog {
  assertResourceSnapshot(config, resources)
  const diagnostics: SpecialistDiagnostic[] = []
  const llmProviders = snapshot.llmProviders === undefined
    ? undefined
    : new Set(snapshot.llmProviders)
  const specialists: Record<string, EffectiveSpecialist> = {}
  const activeSpecialists: Record<string, EffectiveSpecialist> = {}

  for (const name of Object.keys(config.specialists).sort()) {
    const identity = specialistName(name)
    const profile = config.specialists[name]!
    const result = profile.result ?? 'text'
    const promptFragments = resources.profiles[name] ?? []
    const defaultMode: EffectiveMode = config.enableRunInBackground && profile.defaultRunInBackground
      ? 'continuable'
      : 'foreground'
    const provider = snapshot.providers[profile.subagentProvider]
    const llmAdapterUnavailable = profile.routes !== undefined
      && llmProviders !== undefined
      && profile.routes.every(route => !llmProviders.has(route.provider))
    if (llmAdapterUnavailable) {
      diagnostics.push({
        code: 'PROFILE_LLM_ADAPTER_UNAVAILABLE',
        severity: 'warning',
        specialist: identity,
        message: `Specialist "${name}" has no Route Candidate with a registered LLM adapter`,
      })
    }
    let foregroundSupported = false
    let continuableSupported = false

    if (provider === undefined) {
      diagnostics.push({
        code: 'PROFILE_PROVIDER_UNAVAILABLE',
        severity: 'warning',
        specialist: identity,
        message: `Specialist "${name}" requires unavailable subagent provider "${profile.subagentProvider}"`,
      })
    } else {
      const agentOptionsSupported = (profile.agentOptions === undefined && profile.routes === undefined)
        || provider.capabilities.agentOptions
      const depthSupported = typeof profile.maxDepth !== 'number' || provider.capabilities.depthLimit
      const needsPersonaComposition = profile.persona !== undefined
        || promptFragments.length > 0
        || profile.routes?.some(route => route.instructions !== undefined) === true
      const personaSupported = !needsPersonaComposition || provider.capabilities.persona
      const toolFilterSupported = profile.toolFilter === undefined || provider.capabilities.toolFilter
      const outputSupported = result === 'text' || provider.capabilities.outputSchema
      foregroundSupported = agentOptionsSupported && depthSupported && personaSupported && toolFilterSupported && outputSupported
      continuableSupported = config.enableRunInBackground
        && provider.continuable
        && result === 'text'

      if (defaultMode === 'continuable') {
        if (!provider.continuable) {
          providerError(
            diagnostics,
            identity,
            'PROFILE_CONTINUABLE_UNSUPPORTED',
            `provider "${profile.subagentProvider}" does not support continuable children`,
          )
        }
        if (result !== 'text') {
          providerError(
            diagnostics,
            identity,
            'PROFILE_STRUCTURED_BACKGROUND_UNSUPPORTED',
            `structured result contract "${result}" is foreground-only`,
          )
        }
      } else {
        if (!agentOptionsSupported) {
          providerError(
            diagnostics,
            identity,
            'PROFILE_AGENT_OPTIONS_UNSUPPORTED',
            `provider "${profile.subagentProvider}" does not support Agent option overrides`,
          )
        }
        if (!depthSupported) {
          providerError(
            diagnostics,
            identity,
            'PROFILE_DEPTH_UNSUPPORTED',
            `provider "${profile.subagentProvider}" cannot enforce numeric maxDepth`,
          )
        }
        if (!personaSupported) {
          providerError(
            diagnostics,
            identity,
            'PROFILE_PERSONA_UNSUPPORTED',
            `provider "${profile.subagentProvider}" does not support configured persona or Prompt Fragments`,
          )
        }
        if (!toolFilterSupported) {
          providerError(
            diagnostics,
            identity,
            'PROFILE_TOOL_FILTER_UNSUPPORTED',
            `provider "${profile.subagentProvider}" does not support toolFilter`,
          )
        }
        if (!outputSupported) {
          providerError(
            diagnostics,
            identity,
            'PROFILE_OUTPUT_SCHEMA_UNSUPPORTED',
            `provider "${profile.subagentProvider}" does not support structured output`,
          )
        }
      }
    }

    if (llmAdapterUnavailable) {
      foregroundSupported = false
      continuableSupported = false
    }
    const allowedModes: EffectiveMode[] = []
    if (foregroundSupported) allowedModes.push('foreground')
    if (continuableSupported) allowedModes.push('continuable')
    const effective = copySpecialist(
      identity,
      profile,
      allowedModes.includes(defaultMode),
      defaultMode,
      allowedModes,
      promptFragments,
    )
    specialists[name] = effective
    if (effective.active) activeSpecialists[name] = effective
  }

  if (config.defaultSpecialist !== undefined && activeSpecialists[config.defaultSpecialist] === undefined) {
    diagnostics.push({
      code: 'DEFAULT_PROFILE_INACTIVE',
      severity: 'warning',
      specialist: specialistName(config.defaultSpecialist),
      message: `default Specialist "${config.defaultSpecialist}" is not active in this runtime snapshot`,
    })
  }

  const published = projectConfigToPublishedV2(config)
  const policy = {
    configVersion: published.configVersion,
    toolName: published.toolName,
    enableRunInBackground: published.enableRunInBackground,
    enableStrategies: published.enableStrategies,
    enableDurableRuns: published.enableDurableRuns,
    durableRunPolicy: published.durableRunPolicy,
    ...published.defaultProfile === undefined ? {} : { defaultProfile: published.defaultProfile },
    ...published.guidance === undefined ? {} : { guidance: published.guidance },
    resourceRoots: published.resourceRoots,
    maxResourceBytes: published.maxResourceBytes,
    profiles: published.profiles,
    teams: published.teams,
    strategies: published.strategies,
  }
  const runtime = {
    providers: Object.fromEntries(Object.keys(snapshot.providers).sort().map(name => [name, snapshot.providers[name]])),
    ...snapshot.llmProviders === undefined
      ? {}
      : { llmProviders: [...new Set(snapshot.llmProviders)].sort() },
    resourceDigest: resources.digest,
  }

  const activeDefaultSpecialist = config.defaultSpecialist === undefined
    ? undefined
    : activeSpecialists[config.defaultSpecialist]?.name

  const frozenSpecialists = Object.freeze({ ...specialists })
  const frozenActiveSpecialists = Object.freeze({ ...activeSpecialists })
  const frozenDiagnostics = Object.freeze(
    diagnostics.map(diagnostic => Object.freeze({ ...diagnostic })),
  )
  return Object.freeze({
    toolName: config.toolName,
    enableRunInBackground: config.enableRunInBackground,
    enableStrategies: config.enableStrategies,
    enableDurableRuns: config.enableDurableRuns,
    durableRunPolicy: deepFreeze({ ...config.durableRunPolicy }),
    ...config.defaultSpecialist === undefined
      ? {}
      : { configuredDefaultSpecialist: specialistName(config.defaultSpecialist) },
    ...activeDefaultSpecialist === undefined ? {} : { defaultSpecialist: activeDefaultSpecialist },
    ...config.guidance === undefined ? {} : { guidance: config.guidance },
    specialists: frozenSpecialists,
    activeSpecialists: frozenActiveSpecialists,
    cohorts: deepFreeze({ ...config.cohorts }),
    strategies: deepFreeze({ ...config.strategies }),
    diagnostics: frozenDiagnostics,
    policyDigest: policyDigest(sha256Digest({ version: 1, kind: 'legion-policy', policy })),
    catalogDigest: catalogDigest(sha256Digest({ version: 1, kind: 'legion-catalog', policy, runtime })),
    resourceDigest: resources.digest,
  })
}

/** Compile one invocation into detached plain data before crossing the live DSH start edge. */
export function compileDelegationPlan(
  catalog: CompiledSpecialistCatalog,
  invocation: DelegationInvocation,
): DelegationPlan {
  if (typeof invocation !== 'object' || invocation === null || Array.isArray(invocation)) {
    throw new DelegationPlanError('REQUEST_INVALID', 'delegation invocation must be a plain object')
  }
  const prototype = Object.getPrototypeOf(invocation)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new DelegationPlanError('REQUEST_INVALID', 'delegation invocation must be a plain object')
  }
  const descriptors = Object.getOwnPropertyDescriptors(invocation)
  if (Object.getOwnPropertySymbols(invocation).length > 0
    || Object.values(descriptors).some(descriptor =>
      descriptor.enumerable && ('get' in descriptor || 'set' in descriptor))) {
    throw new DelegationPlanError('REQUEST_INVALID', 'delegation invocation must contain plain data')
  }
  const source = invocation as unknown as Record<string, unknown>
  const allowed = new Set(['specialist', 'profile', 'description', 'prompt', 'runInBackground'])
  const unknownFields = Object.keys(source).filter(key => !allowed.has(key))
  if (unknownFields.length > 0
    || (source.specialist !== undefined && typeof source.specialist !== 'string')
    || (source.profile !== undefined && typeof source.profile !== 'string')
    || (source.runInBackground !== undefined && typeof source.runInBackground !== 'boolean')) {
    throw new DelegationPlanError('REQUEST_INVALID', 'delegation invocation fields are invalid')
  }
  if (invocation.specialist !== undefined && invocation.profile !== undefined) {
    throw new DelegationPlanError(
      'REQUEST_INVALID',
      'specialist and deprecated profile cannot be combined',
    )
  }
  if (typeof invocation.description !== 'string'
    || invocation.description.trim().length === 0
    || invocation.description.length > 100_000
    || typeof invocation.prompt !== 'string'
    || invocation.prompt.trim().length === 0
    || invocation.prompt.length > 100_000) {
    throw new DelegationPlanError(
      'REQUEST_INVALID',
      'description and prompt must be non-empty bounded strings',
    )
  }
  const selected = invocation.specialist ?? invocation.profile ?? catalog.defaultSpecialist
  if (selected === undefined) {
    throw new DelegationPlanError('PROFILE_REQUIRED', 'Specialist is required because no active default is configured')
  }
  const known = catalog.specialists[selected]
  if (known === undefined) {
    throw new DelegationPlanError('PROFILE_UNKNOWN', `unknown Specialist "${selected}"`)
  }
  const profile = catalog.activeSpecialists[selected]
  if (profile === undefined) {
    throw new DelegationPlanError('PROFILE_INACTIVE', `Specialist "${selected}" is inactive in this runtime snapshot`)
  }
  if (!catalog.enableRunInBackground && invocation.runInBackground === true) {
    throw new DelegationPlanError('BACKGROUND_DISABLED', 'run_in_background is disabled for this plugin instance')
  }
  const background = catalog.enableRunInBackground
    && (invocation.runInBackground ?? profile.defaultRunInBackground)
  const mode: EffectiveMode = background ? 'continuable' : 'foreground'
  if (mode === 'continuable' && profile.result !== 'text') {
    throw new DelegationPlanError(
      'STRUCTURED_BACKGROUND_UNSUPPORTED',
      `Specialist "${selected}" uses foreground-only result contract "${profile.result}"`,
    )
  }
  if (!profile.allowedModes.includes(mode)) {
    throw new DelegationPlanError(
      'MODE_UNSUPPORTED',
      `Specialist "${selected}" does not support ${mode} execution in this runtime snapshot`,
    )
  }
  const schema = mode === 'foreground' ? outputSchemaFor(profile.result) : undefined
  const fragmentInstructions = renderPromptFragments(profile.promptFragments)
  const persona = [profile.persona, fragmentInstructions]
    .filter((value): value is string => value !== undefined && value.length > 0)
    .join('\n\n') || undefined
  return deepFreeze({
    specialist: profile.name,
    mode,
    subagentProvider: profile.subagentProvider,
    label: invocation.description,
    prompt: invocation.prompt,
    result: profile.result ?? 'text',
    policyDigest: catalog.policyDigest,
    catalogDigest: catalog.catalogDigest,
    resourceDigest: catalog.resourceDigest,
    promptFragments: profile.promptFragments.map(fragment => ({ ...fragment })),
    ...profile.agentOptions === undefined ? {} : { agentOptions: { ...profile.agentOptions } },
    ...persona === undefined ? {} : { persona },
    ...profile.toolFilter === undefined
      ? {}
      : {
          toolFilter: {
            ...profile.toolFilter.allow === undefined ? {} : { allow: [...profile.toolFilter.allow] },
            ...profile.toolFilter.deny === undefined ? {} : { deny: [...profile.toolFilter.deny] },
          },
        },
    ...typeof profile.maxDepth === 'number' ? { maxDepth: profile.maxDepth } : {},
    ...schema === undefined ? {} : { outputSchema: schema },
  })
}
