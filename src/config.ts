import z from '@deepseek-ai/schemastery'
import {
  StrategySpecSchema,
  CohortSpecSchema,
  assertKnownOrchestrationKeys,
  type CatalogLayer,
  type StrategySpec,
  type CohortSpec,
  type MemberSlotSpec,
} from './orchestration-contract.ts'
import { resolveCatalogLayers } from './catalog-layer.ts'
import { deepCopy, deepFreeze } from './internal/value.ts'

export const SPECIALIST_NAME = /^[a-z][a-z0-9-]*$/
/** @deprecated Use SPECIALIST_NAME. */
export const PROFILE_NAME = SPECIALIST_NAME
/** Published 1.x no-target materialize/export version. */
export const CURRENT_CONFIG_VERSION = 2 as const
/** Canonical version used by the new current Config interfaces. */
export const CANONICAL_CONFIG_VERSION = 3 as const
const PUBLISHED_CONFIG_VERSION = CURRENT_CONFIG_VERSION
export type ConfigVersion = 1 | typeof PUBLISHED_CONFIG_VERSION | typeof CANONICAL_CONFIG_VERSION
export type ConfigExportTarget = ConfigVersion | 'legacy-unversioned'
export const RESULT_CONTRACTS = Object.freeze(['text', 'findings-v1', 'review-v1', 'plan-delta-v1'] as const)
export type ResultContract = (typeof RESULT_CONTRACTS)[number]

/** Current and retired Config Document keys for the 1.x compatibility window. */
const CONFIG_NAMESPACE_VOCABULARY = Object.freeze({
  specialist: Object.freeze({ current: 'specialists', retired: 'profiles' }),
  defaultSpecialist: Object.freeze({ current: 'defaultSpecialist', retired: 'defaultProfile' }),
  memberSpecialist: Object.freeze({ current: 'specialist', retired: 'profile' }),
  cohort: Object.freeze({ current: 'cohorts', retired: 'teams' }),
  strategyCohort: Object.freeze({ current: 'cohort', retired: 'team' }),
} as const)

const CONFIG_KEY_REMOVAL_VERSION = '2.0.0' as const

export interface ConfigDeprecationDiagnostic {
  readonly code: 'LEGION_CONFIG_KEY_DEPRECATED'
  readonly severity: 'warning'
  readonly path: string
  readonly replacement: string
  readonly removalVersion: typeof CONFIG_KEY_REMOVAL_VERSION
  readonly message: string
}

export interface MaterializedConfigResult {
  readonly config: MaterializedConfig
  readonly diagnostics: readonly ConfigDeprecationDiagnostic[]
}

/**
 * What one composed Legion row contributes.
 *
 * `delegation` is the ordinary agent-plane row: it publishes the delegation
 * tool and the coordinator prompt section into the layer it was mounted in.
 * `settings` is the Host-plane row that owns the process-wide settings
 * namespace and nothing else — no tool, no prompt section, no service — so the
 * configuration surface keeps serving Legion between sessions.
 *
 * The role is a composition fact read from the row's own entry. It is
 * deliberately never taken from the settings layer: a stored section that could
 * flip it would silently withdraw every deployment's delegation tool.
 */
export const LEGION_ROW_ROLES = Object.freeze(['delegation', 'settings'] as const)
export type LegionRowRole = (typeof LEGION_ROW_ROLES)[number]

export interface DurableRunPolicySpec {
  /** Maximum task starts in one single-caller activation. */
  readonly maxStartsPerActivation?: number
  /** Maximum concurrently executing DAG nodes in one activation. */
  readonly maxConcurrentTasks?: number
}

export interface PromptFileReference {
  /** Name of one top-level configured resource root. */
  readonly root: string
  /** Slash-separated relative path below that root. */
  readonly path: string
}

export interface RouteConstraints {
  readonly minContextTokens?: number
  /** Minimum effective request output cap, not a model/provider hard ceiling. */
  readonly minEffectiveOutputTokens?: number
}

export interface RouteCandidate {
  readonly id: string
  readonly provider: string
  readonly model: string
  readonly maxTokens?: number
  readonly constraints?: RouteConstraints
  readonly instructions?: string
}

export interface SpecialistSpec {
  /** Human-readable routing guidance shown to the coordinator. */
  readonly description: string
  /** Named ctx.subagents backend, for example spawn, fork, codex, or claude-code. */
  readonly subagentProvider: string
  /** Optional child LLM route. Omitted fields inherit from the parent Agent. */
  readonly agentOptions?: {
    readonly provider?: string
    readonly model?: string
    readonly maxTokens?: number
  }
  /** Ordered exact LLM routes evaluated immediately before child start. */
  readonly routes?: RouteCandidate[]
  /** Optional child persona shadowing the preset persona. */
  readonly persona?: string
  /** Optional child tool visibility restriction. */
  readonly toolFilter?: {
    allow?: string[]
    deny?: string[]
  }
  /** Absolute delegation depth cap, or provider-managed for external products. */
  readonly maxDepth: number | 'provider-managed'
  /** Whether an omitted run_in_background starts a continuable child. */
  readonly defaultRunInBackground: boolean
  /** Versioned child result contract; structured contracts are foreground-only. */
  readonly result?: ResultContract
  /** Explicit instruction fragments loaded through configured resource roots. */
  readonly promptFiles?: PromptFileReference[]
}

/** @deprecated Use SpecialistSpec. */
export type LegionProfile = SpecialistSpec

type LegacyMemberSlotSpec = Omit<MemberSlotSpec, 'specialist'> & { readonly profile: string }
type LegacyCohortSpec = Omit<CohortSpec, 'members'> & {
  readonly members: Readonly<Record<string, LegacyMemberSlotSpec>>
}
type LegacyStrategySpec = Omit<StrategySpec, 'cohort'> & { readonly team: string }
interface LegacyCatalogDisableSpec {
  readonly profiles?: readonly string[]
  readonly teams?: readonly string[]
  readonly strategies?: readonly string[]
}
interface LegacyCatalogLayer<Specialist> {
  readonly id: string
  readonly profiles?: Readonly<Record<string, Specialist>>
  readonly teams?: Readonly<Record<string, LegacyCohortSpec>>
  readonly strategies?: Readonly<Record<string, LegacyStrategySpec>>
  readonly disable?: LegacyCatalogDisableSpec
}

/** Published 1.x Config materialization shape retained until 2.0. */
export interface Config {
  readonly configVersion?: 1 | typeof PUBLISHED_CONFIG_VERSION
  readonly role?: LegionRowRole
  readonly toolName: string
  readonly profiles: Record<string, SpecialistSpec>
  readonly defaultProfile?: string
  readonly enableRunInBackground: boolean
  readonly enableStrategies?: boolean
  readonly enableDurableRuns?: boolean
  readonly durableRunPolicy?: DurableRunPolicySpec
  readonly guidance?: string
  readonly resourceRoots?: Record<string, string>
  readonly maxResourceBytes?: number
  readonly catalogLayers?: LegacyCatalogLayer<SpecialistSpec>[]
  readonly teams?: Record<string, LegacyCohortSpec>
  readonly strategies?: Record<string, LegacyStrategySpec>
}

/** Canonical Config v3 authored dialect used by new current interfaces. */
export interface CurrentConfig {
  readonly configVersion: typeof CANONICAL_CONFIG_VERSION
  readonly role?: LegionRowRole
  readonly toolName: string
  readonly specialists: Record<string, SpecialistSpec>
  readonly defaultSpecialist?: string
  readonly enableRunInBackground: boolean
  readonly enableStrategies?: boolean
  readonly enableDurableRuns?: boolean
  readonly durableRunPolicy?: DurableRunPolicySpec
  readonly guidance?: string
  readonly resourceRoots?: Record<string, string>
  readonly maxResourceBytes?: number
  readonly catalogLayers?: CatalogLayer<SpecialistSpec>[]
  readonly cohorts?: Record<string, CohortSpec>
  readonly strategies?: Record<string, StrategySpec>
}

type AuthoredMemberSlotSpec = Omit<MemberSlotSpec, 'specialist'> & (
  | { readonly specialist: string; readonly profile?: never }
  | { readonly specialist?: never; readonly profile: string }
)
type AuthoredCohortSpec = Omit<CohortSpec, 'members'> & {
  readonly members: Readonly<Record<string, AuthoredMemberSlotSpec>>
}
type AuthoredStrategySpec = Omit<StrategySpec, 'cohort'> & (
  | { readonly cohort: string; readonly team?: never }
  | { readonly cohort?: never; readonly team: string }
)
interface AuthoredCatalogDisableSpec {
  readonly specialists?: readonly string[]
  readonly profiles?: readonly string[]
  readonly cohorts?: readonly string[]
  readonly teams?: readonly string[]
  readonly strategies?: readonly string[]
}
interface AuthoredCatalogLayer<Specialist> {
  readonly id: string
  readonly specialists?: Readonly<Record<string, Specialist>>
  readonly profiles?: Readonly<Record<string, Specialist>>
  readonly cohorts?: Readonly<Record<string, AuthoredCohortSpec>>
  readonly teams?: Readonly<Record<string, AuthoredCohortSpec>>
  readonly strategies?: Readonly<Record<string, AuthoredStrategySpec>>
  readonly disable?: AuthoredCatalogDisableSpec
}
interface LegionConfigFields {
  readonly configVersion?: ConfigVersion
  readonly role?: LegionRowRole
  readonly toolName: string
  readonly specialists?: Record<string, SpecialistSpec>
  readonly profiles?: Record<string, SpecialistSpec>
  readonly defaultSpecialist?: string
  readonly defaultProfile?: string
  readonly enableRunInBackground: boolean
  readonly enableStrategies?: boolean
  readonly enableDurableRuns?: boolean
  readonly durableRunPolicy?: DurableRunPolicySpec
  readonly guidance?: string
  readonly resourceRoots?: Record<string, string>
  readonly maxResourceBytes?: number
  readonly catalogLayers?: AuthoredCatalogLayer<SpecialistSpec>[]
  readonly cohorts?: Record<string, AuthoredCohortSpec>
  readonly teams?: Record<string, AuthoredCohortSpec>
  readonly strategies?: Record<string, AuthoredStrategySpec>
}

/** Compatibility ingress for v1, v2, and v3 authored documents. */
export type LegionConfig = LegionConfigFields & (
  | { readonly specialists: Record<string, SpecialistSpec>; readonly profiles?: Record<string, SpecialistSpec> }
  | { readonly specialists?: Record<string, SpecialistSpec>; readonly profiles: Record<string, SpecialistSpec> }
)

const PromptFileReferenceSchema: z<PromptFileReference> = z.object({
  root: z.string().pattern(PROFILE_NAME).required(),
  path: z.string().min(1).required(),
})

const RouteConstraintsSchema: z<RouteConstraints> = z.object({
  minContextTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
  minEffectiveOutputTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
})

const RouteCandidateSchema: z<RouteCandidate> = z.object({
  id: z.string().pattern(PROFILE_NAME).required(),
  provider: z.string().min(1).required(),
  model: z.string().min(1).required(),
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
  constraints: RouteConstraintsSchema,
  instructions: z.string().min(1),
})

const AgentOptionsSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
}).default(undefined as unknown as { provider: string; model: string; maxTokens: number })

const ToolFilterSchema = z.object({
  allow: z.array(z.string().min(1)).default(undefined as unknown as string[]),
  deny: z.array(z.string().min(1)).default(undefined as unknown as string[]),
}).default(undefined as unknown as { allow: string[]; deny: string[] })

export const SpecialistSpecSchema: z<SpecialistSpec> = z.object({
  description: z.string().min(1).required(),
  subagentProvider: z.string().min(1).default('spawn'),
  agentOptions: AgentOptionsSchema,
  routes: z.array(RouteCandidateSchema).default(undefined as unknown as RouteCandidate[]),
  persona: z.string(),
  toolFilter: ToolFilterSchema,
  maxDepth: z.union([
    z.natural().max(Number.MAX_SAFE_INTEGER),
    z.const('provider-managed' as const),
  ]).default(3),
  defaultRunInBackground: z.boolean().default(true),
  result: z.union(RESULT_CONTRACTS).default('text'),
  promptFiles: z.array(PromptFileReferenceSchema).default(undefined as unknown as PromptFileReference[]),
})

/** @deprecated Use SpecialistSpecSchema. */
export const LegionProfileSchema = SpecialistSpecSchema

const CatalogDisableSchema = z.object({
  [CONFIG_NAMESPACE_VOCABULARY.specialist.current]: z.array(z.string().pattern(PROFILE_NAME)),
  [CONFIG_NAMESPACE_VOCABULARY.specialist.retired]: z.array(z.string().pattern(PROFILE_NAME))
    .description('Deprecated: use "specialists" instead.')
    .deprecated(),
  [CONFIG_NAMESPACE_VOCABULARY.cohort.current]: z.array(z.string().pattern(PROFILE_NAME)),
  [CONFIG_NAMESPACE_VOCABULARY.cohort.retired]: z.array(z.string().pattern(PROFILE_NAME))
    .description('Deprecated: use "cohorts" instead.')
    .deprecated(),
  strategies: z.array(z.string().pattern(PROFILE_NAME)),
}) as unknown as z<AuthoredCatalogDisableSpec>

const CatalogLayerSchema = z.object({
  id: z.string().pattern(PROFILE_NAME).required(),
  [CONFIG_NAMESPACE_VOCABULARY.specialist.current]: z.dict(SpecialistSpecSchema),
  [CONFIG_NAMESPACE_VOCABULARY.specialist.retired]: z.dict(SpecialistSpecSchema)
    .description('Deprecated: use "specialists" instead.')
    .deprecated(),
  [CONFIG_NAMESPACE_VOCABULARY.cohort.current]: z.dict(CohortSpecSchema),
  [CONFIG_NAMESPACE_VOCABULARY.cohort.retired]: z.dict(CohortSpecSchema)
    .description('Deprecated: use "cohorts" instead.')
    .deprecated(),
  strategies: z.dict(StrategySpecSchema),
  disable: CatalogDisableSchema,
}) as unknown as z<AuthoredCatalogLayer<SpecialistSpec>>

export interface MaterializedConfig extends Config {
  readonly configVersion: typeof PUBLISHED_CONFIG_VERSION
  readonly profiles: Record<string, SpecialistSpec>
  readonly resourceRoots: Record<string, string>
  readonly maxResourceBytes: number
  readonly enableStrategies: boolean
  readonly enableDurableRuns: boolean
  readonly durableRunPolicy: Required<DurableRunPolicySpec>
  readonly catalogLayers: []
  readonly teams: Record<string, LegacyCohortSpec>
  readonly strategies: Record<string, LegacyStrategySpec>
}

export interface MaterializedCurrentConfig extends CurrentConfig {
  readonly configVersion: typeof CANONICAL_CONFIG_VERSION
  readonly specialists: Record<string, SpecialistSpec>
  readonly resourceRoots: Record<string, string>
  readonly maxResourceBytes: number
  readonly enableStrategies: boolean
  readonly enableDurableRuns: boolean
  readonly durableRunPolicy: Required<DurableRunPolicySpec>
  readonly catalogLayers: []
  readonly cohorts: Record<string, CohortSpec>
  readonly strategies: Record<string, StrategySpec>
}

export interface MaterializedCurrentConfigResult {
  readonly config: MaterializedCurrentConfig
  readonly diagnostics: readonly ConfigDeprecationDiagnostic[]
}

const DurableRunPolicySchema: z<DurableRunPolicySpec> = z.object({
  maxStartsPerActivation: z.number().step(1).min(1).max(32),
  maxConcurrentTasks: z.number().step(1).min(1).max(16),
})

export const Config = z.object({
  configVersion: z.union([
    z.const(1 as const), z.const(PUBLISHED_CONFIG_VERSION), z.const(CANONICAL_CONFIG_VERSION),
  ]),
  // Hidden from configuration surfaces on purpose: the role is read from the
  // row entry, so a control offering to change it in the stored document would
  // offer a change no row obeys.
  role: z.union(LEGION_ROW_ROLES).default('delegation').hidden(),
  toolName: z.string().min(1).default('legion'),
  [CONFIG_NAMESPACE_VOCABULARY.specialist.current]: z.dict(SpecialistSpecSchema),
  [CONFIG_NAMESPACE_VOCABULARY.specialist.retired]: z.dict(SpecialistSpecSchema)
    .description('Deprecated: use "specialists" instead.')
    .deprecated(),
  defaultSpecialist: z.string().pattern(PROFILE_NAME),
  defaultProfile: z.string().pattern(PROFILE_NAME)
    .description('Deprecated: use "defaultSpecialist" instead.')
    .deprecated(),
  enableRunInBackground: z.boolean().default(true),
  enableStrategies: z.boolean(),
  enableDurableRuns: z.boolean(),
  durableRunPolicy: DurableRunPolicySchema,
  guidance: z.string(),
  resourceRoots: z.dict(z.string().min(1)).default({}),
  maxResourceBytes: z.number().step(1).min(1).max(4 * 1024 * 1024).default(64 * 1024),
  catalogLayers: z.array(CatalogLayerSchema).max(31),
  [CONFIG_NAMESPACE_VOCABULARY.cohort.current]: z.dict(CohortSpecSchema),
  [CONFIG_NAMESPACE_VOCABULARY.cohort.retired]: z.dict(CohortSpecSchema)
    .description('Deprecated: use "cohorts" instead.')
    .deprecated(),
  strategies: z.dict(StrategySpecSchema),
}) as unknown as z<LegionConfig>

function cloneAuthoredValue(
  value: unknown,
  ancestors: WeakSet<object> = new WeakSet(),
): unknown {
  if (typeof value !== 'object' || value === null) return value
  if (ancestors.has(value)) throw new Error('dsh-legion: config must not contain circular references')
  ancestors.add(value)
  try {
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new Error('dsh-legion: config must not contain symbol properties')
    }
    const descriptors = Object.getOwnPropertyDescriptors(value)
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor.enumerable && ('get' in descriptor || 'set' in descriptor)) {
        throw new Error(`dsh-legion: config field "${key}" must be plain data, not an accessor`)
      }
    }
    if (Array.isArray(value)) {
      return Array.from({ length: value.length }, (_, index) => {
        const descriptor = descriptors[String(index)]
        return descriptor === undefined ? undefined : cloneAuthoredValue(descriptor.value, ancestors)
      })
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return value
    return Object.fromEntries(Object.entries(descriptors).flatMap(([key, descriptor]) =>
      descriptor.enumerable ? [[key, cloneAuthoredValue(descriptor.value, ancestors)]] : []))
  } finally {
    ancestors.delete(value)
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
    ? value as Record<string, unknown>
    : undefined
}

type VocabularyKeys = { readonly current: string; readonly retired: string }
type NormalizeEntry = (value: unknown, at: string, diagnostics: ConfigDeprecationDiagnostic[]) => unknown

function appendDeprecationDiagnostic(
  retiredValue: unknown,
  keys: VocabularyKeys,
  at: string,
  diagnostics: ConfigDeprecationDiagnostic[],
): void {
  if (retiredValue === undefined) return
  const path = `${at}.${keys.retired}`
  const replacement = `${at}.${keys.current}`
  diagnostics.push({
    code: 'LEGION_CONFIG_KEY_DEPRECATED',
    severity: 'warning',
    path,
    replacement,
    removalVersion: CONFIG_KEY_REMOVAL_VERSION,
    message: `dsh-legion: ${path} is deprecated; use ${replacement} instead`,
  })
}

function mergeScalarSpelling(
  source: Record<string, unknown>,
  keys: VocabularyKeys,
  at: string,
  diagnostics: ConfigDeprecationDiagnostic[],
): unknown {
  const current = source[keys.current]
  const retired = source[keys.retired]
  appendDeprecationDiagnostic(retired, keys, at, diagnostics)
  if (current !== undefined && retired !== undefined) {
    throw new Error(
      `dsh-legion: ${at} cannot use both "${keys.current}" and retired "${keys.retired}"`,
    )
  }
  return current ?? retired
}

function mergeNamespaceEntries(
  source: Record<string, unknown>,
  keys: VocabularyKeys,
  at: string,
  diagnostics: ConfigDeprecationDiagnostic[],
  normalizeEntry?: NormalizeEntry,
): Record<string, unknown> | undefined {
  const currentValue = source[keys.current]
  const retiredValue = source[keys.retired]
  appendDeprecationDiagnostic(retiredValue, keys, at, diagnostics)
  const current = currentValue === undefined ? undefined : record(currentValue)
  const retired = retiredValue === undefined ? undefined : record(retiredValue)
  if (currentValue !== undefined && current === undefined) {
    throw new Error(`dsh-legion: ${at}.${keys.current} must be a plain object`)
  }
  if (retiredValue !== undefined && retired === undefined) {
    throw new Error(`dsh-legion: ${at}.${keys.retired} must be a plain object`)
  }
  const duplicate = Object.keys(current ?? {}).sort().find(name => Object.hasOwn(retired ?? {}, name))
  if (duplicate !== undefined) {
    throw new Error(
      `dsh-legion: ${at} entry "${duplicate}" cannot use both "${keys.current}" and retired "${keys.retired}"`,
    )
  }
  if (current === undefined && retired === undefined) return undefined
  const normalize = (entries: Record<string, unknown> | undefined, key: string) => Object.fromEntries(
    Object.keys(entries ?? {}).sort().map(name => [
      name,
      normalizeEntry?.(entries![name], `${at}.${key}.${name}`, diagnostics) ?? entries![name],
    ]),
  )
  return {
    ...normalize(retired, keys.retired),
    ...normalize(current, keys.current),
  }
}

function mergeNamespaceNames(
  source: Record<string, unknown>,
  keys: VocabularyKeys,
  at: string,
  diagnostics: ConfigDeprecationDiagnostic[],
): readonly unknown[] | undefined {
  const currentValue = source[keys.current]
  const retiredValue = source[keys.retired]
  appendDeprecationDiagnostic(retiredValue, keys, at, diagnostics)
  if (currentValue !== undefined && !Array.isArray(currentValue)) {
    throw new Error(`dsh-legion: ${at}.${keys.current} must be an array`)
  }
  if (retiredValue !== undefined && !Array.isArray(retiredValue)) {
    throw new Error(`dsh-legion: ${at}.${keys.retired} must be an array`)
  }
  const current = currentValue as readonly unknown[] | undefined
  const retired = retiredValue as readonly unknown[] | undefined
  const duplicate = current?.find(name => retired?.includes(name))
  if (duplicate !== undefined) {
    throw new Error(
      `dsh-legion: ${at} entry "${String(duplicate)}" cannot use both "${keys.current}" and retired "${keys.retired}"`,
    )
  }
  if (current === undefined && retired === undefined) return undefined
  return [...retired ?? [], ...current ?? []]
}

function normalizeMemberSlot(
  input: unknown,
  at: string,
  diagnostics: ConfigDeprecationDiagnostic[],
): unknown {
  const source = record(input)
  if (source === undefined) return input
  const specialist = mergeScalarSpelling(
    source, CONFIG_NAMESPACE_VOCABULARY.memberSpecialist, at, diagnostics,
  )
  const { specialist: _specialist, profile: _profile, ...rest } = source
  return { ...rest, ...specialist === undefined ? {} : { specialist } }
}

function normalizeCohort(
  input: unknown,
  at: string,
  diagnostics: ConfigDeprecationDiagnostic[],
): unknown {
  const source = record(input)
  if (source === undefined) return input
  const members = record(source.members)
  if (source.members !== undefined && members === undefined) return input
  return {
    ...source,
    ...members === undefined
      ? {}
      : {
          members: Object.fromEntries(Object.keys(members).sort().map(name => [
            name,
            normalizeMemberSlot(members[name], `${at}.members.${name}`, diagnostics),
          ])),
        },
  }
}

function normalizeStrategy(
  input: unknown,
  at: string,
  diagnostics: ConfigDeprecationDiagnostic[],
): unknown {
  const source = record(input)
  if (source === undefined) return input
  const cohort = mergeScalarSpelling(source, CONFIG_NAMESPACE_VOCABULARY.strategyCohort, at, diagnostics)
  const { cohort: _cohort, team: _team, ...rest } = source
  return { ...rest, ...cohort === undefined ? {} : { cohort } }
}

function normalizeStrategyMap(
  input: unknown,
  at: string,
  diagnostics: ConfigDeprecationDiagnostic[],
): unknown {
  const strategies = record(input)
  if (strategies === undefined) return input
  return Object.fromEntries(Object.keys(strategies).sort().map(name => [
    name,
    normalizeStrategy(strategies[name], `${at}.${name}`, diagnostics),
  ]))
}

function normalizeCatalogDisable(
  input: unknown,
  at: string,
  diagnostics: ConfigDeprecationDiagnostic[],
): unknown {
  const source = record(input)
  if (source === undefined) return input
  const specialists = mergeNamespaceNames(source, CONFIG_NAMESPACE_VOCABULARY.specialist, at, diagnostics)
  const cohorts = mergeNamespaceNames(source, CONFIG_NAMESPACE_VOCABULARY.cohort, at, diagnostics)
  const { specialists: _specialists, profiles: _profiles, cohorts: _cohorts, teams: _teams, ...rest } = source
  return {
    ...rest,
    ...specialists === undefined ? {} : { specialists },
    ...cohorts === undefined ? {} : { cohorts },
  }
}

function normalizeCatalogLayer(
  input: unknown,
  index: number,
  diagnostics: ConfigDeprecationDiagnostic[],
): unknown {
  const source = record(input)
  if (source === undefined) return input
  const at = `config.catalogLayers[${String(index)}]`
  const specialists = mergeNamespaceEntries(source, CONFIG_NAMESPACE_VOCABULARY.specialist, at, diagnostics)
  const cohorts = mergeNamespaceEntries(
    source, CONFIG_NAMESPACE_VOCABULARY.cohort, at, diagnostics, normalizeCohort,
  )
  const { specialists: _specialists, profiles: _profiles, cohorts: _cohorts, teams: _teams, strategies, disable, ...rest } = source
  return {
    ...rest,
    ...specialists === undefined ? {} : { specialists },
    ...cohorts === undefined ? {} : { cohorts },
    ...strategies === undefined ? {} : { strategies: normalizeStrategyMap(strategies, `${at}.strategies`, diagnostics) },
    ...disable === undefined ? {} : { disable: normalizeCatalogDisable(disable, `${at}.disable`, diagnostics) },
  }
}

function normalizeConfigNamespaces(
  input: unknown,
  diagnostics: ConfigDeprecationDiagnostic[],
): unknown {
  const source = record(input)
  if (source === undefined) return input
  const specialists = mergeNamespaceEntries(source, CONFIG_NAMESPACE_VOCABULARY.specialist, 'config', diagnostics)
  const defaultSpecialist = mergeScalarSpelling(
    source, CONFIG_NAMESPACE_VOCABULARY.defaultSpecialist, 'config', diagnostics,
  )
  const cohorts = mergeNamespaceEntries(
    source, CONFIG_NAMESPACE_VOCABULARY.cohort, 'config', diagnostics, normalizeCohort,
  )
  const { configVersion: _configVersion, specialists: _specialists, profiles: _profiles,
    defaultSpecialist: _defaultSpecialist, defaultProfile: _defaultProfile,
    cohorts: _cohorts, teams: _teams, strategies, catalogLayers, ...rest } = source
  return {
    ...rest,
    configVersion: CANONICAL_CONFIG_VERSION,
    ...specialists === undefined ? {} : { specialists },
    ...defaultSpecialist === undefined ? {} : { defaultSpecialist },
    ...cohorts === undefined ? {} : { cohorts },
    ...strategies === undefined ? {} : { strategies: normalizeStrategyMap(strategies, 'config.strategies', diagnostics) },
    ...catalogLayers === undefined
      ? {}
      : {
          catalogLayers: Array.isArray(catalogLayers)
            ? catalogLayers.map((layer, index) => normalizeCatalogLayer(layer, index, diagnostics))
            : catalogLayers,
        },
  }
}

function assertNoNull(value: unknown, at = 'config'): void {
  if (value === null) throw new Error(`dsh-legion: ${at} must not be null`)
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertNoNull(child, `${at}[${String(index)}]`))
    return
  }
  if (typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) assertNoNull(child, `${at}.${key}`)
}

function assertKnownKeys(value: unknown, allowed: readonly string[], at: string): void {
  if (value === undefined || value === null) return
  const source = record(value)
  if (source === undefined) throw new Error(`dsh-legion: ${at} must be a plain object`)
  const known = new Set(allowed)
  const unknown = Object.keys(source).filter(key => !known.has(key))
  if (unknown.length > 0) {
    throw new Error(`dsh-legion: ${at} contains unknown field(s): ${unknown.sort().join(', ')}`)
  }
}

function assertPortableRelativePath(path: string, at: string): void {
  const segments = path.split('/')
  if (path.length === 0
    || path.includes('\0')
    || path.includes('\\')
    || path.startsWith('/')
    || /^[A-Za-z]:/.test(path)
    || segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`dsh-legion: ${at} must be a slash-separated relative path without . or .. segments`)
  }
}

function assertAuthoredConfigVersion(input: unknown): void {
  const source = record(input)
  if (source !== undefined
    && Object.hasOwn(source, 'configVersion')
    && source.configVersion !== undefined
    && source.configVersion !== 1
    && source.configVersion !== PUBLISHED_CONFIG_VERSION
    && source.configVersion !== CANONICAL_CONFIG_VERSION) {
    throw new Error(`dsh-legion: unsupported configVersion ${String(source.configVersion)}`)
  }
  const authoredVersion = source?.configVersion ?? 1
  const durablePolicy = record(source?.durableRunPolicy)
  const hasNonDefaultDurablePolicy = durablePolicy !== undefined
    && (durablePolicy.maxStartsPerActivation !== undefined
      && durablePolicy.maxStartsPerActivation !== 16
      || durablePolicy.maxConcurrentTasks !== undefined
      && durablePolicy.maxConcurrentTasks !== 4)
  if (authoredVersion === 1
    && (Array.isArray(source?.catalogLayers) && source.catalogLayers.length > 0
      || Object.keys(record(source?.teams) ?? {}).length > 0
      || Object.keys(record(source?.cohorts) ?? {}).length > 0
      || Object.keys(record(source?.strategies) ?? {}).length > 0
      || source?.enableStrategies === true
      || source?.enableDurableRuns === true
      || hasNonDefaultDurablePolicy)) {
    throw new Error(
      'dsh-legion: configVersion 2 is required for catalogLayers, teams, strategies, enableStrategies, or durable runs',
    )
  }
}

function assertKnownSpecialists(value: unknown, at: string): void {
  const specialists = record(value)
  if (value !== undefined && specialists === undefined) {
    throw new Error(`dsh-legion: ${at} must be a plain object`)
  }
  for (const [name, specialist] of Object.entries(specialists ?? {})) {
    const path = `${at}.${name}`
    assertKnownKeys(
      specialist,
      [
        'description', 'subagentProvider', 'agentOptions', 'routes', 'persona', 'toolFilter',
        'maxDepth', 'defaultRunInBackground', 'result', 'promptFiles',
      ],
      path,
    )
    const specialistRecord = record(specialist)
    assertKnownKeys(specialistRecord?.agentOptions, ['provider', 'model', 'maxTokens'], `${path}.agentOptions`)
    assertKnownKeys(specialistRecord?.toolFilter, ['allow', 'deny'], `${path}.toolFilter`)
    if (Array.isArray(specialistRecord?.routes)) {
      specialistRecord.routes.forEach((route, index) => {
        assertKnownKeys(
          route,
          ['id', 'provider', 'model', 'maxTokens', 'constraints', 'instructions'],
          `${path}.routes[${String(index)}]`,
        )
        assertKnownKeys(
          record(route)?.constraints,
          ['minContextTokens', 'minEffectiveOutputTokens'],
          `${path}.routes[${String(index)}].constraints`,
        )
      })
    }
    if (Array.isArray(specialistRecord?.promptFiles)) {
      specialistRecord.promptFiles.forEach((reference, index) => {
        assertKnownKeys(reference, ['root', 'path'], `${path}.promptFiles[${String(index)}]`)
      })
    }
  }
}

function assertKnownConfigKeys(input: unknown): void {
  const source = record(input)
  assertKnownKeys(
    input,
    [
      'configVersion', 'role', 'toolName', 'specialists', 'defaultSpecialist',
      'enableRunInBackground', 'enableStrategies', 'enableDurableRuns', 'durableRunPolicy',
      'guidance', 'resourceRoots', 'maxResourceBytes', 'catalogLayers', 'cohorts', 'strategies',
    ],
    'config',
  )
  assertKnownKeys(source?.durableRunPolicy, ['maxStartsPerActivation', 'maxConcurrentTasks'], 'durableRunPolicy')
  assertKnownSpecialists(source?.specialists, 'config.specialists')
  assertKnownOrchestrationKeys(source?.cohorts, source?.strategies, 'config')
  if (Array.isArray(source?.catalogLayers)) {
    source.catalogLayers.forEach((layer, index) => {
      const at = `config.catalogLayers[${String(index)}]`
      const layerRecord = record(layer)
      assertKnownKeys(layer, ['id', 'specialists', 'cohorts', 'strategies', 'disable'], at)
      assertKnownKeys(layerRecord?.disable, ['specialists', 'cohorts', 'strategies'], `${at}.disable`)
      assertKnownSpecialists(layerRecord?.specialists, `${at}.specialists`)
      assertKnownOrchestrationKeys(layerRecord?.cohorts, layerRecord?.strategies, at)
    })
  }
}

function copyNamedEntries<Value>(
  entries: Readonly<Record<string, Value>>,
): Record<string, Value> {
  return Object.fromEntries(Object.keys(entries).sort().map(name => [
    name,
    deepCopy(entries[name]!),
  ]))
}

function materializeCurrentConfigInternal(
  input: unknown,
  diagnostics: ConfigDeprecationDiagnostic[],
): MaterializedCurrentConfig {
  const authored = cloneAuthoredValue(input)
  assertNoNull(authored)
  assertAuthoredConfigVersion(authored)
  const normalized = normalizeConfigNamespaces(authored, diagnostics)
  assertKnownConfigKeys(normalized)
  const parsedDocument = Config(normalized as LegionConfig | null | undefined) as unknown as CurrentConfig
  validateSettingsSection(parsedDocument as LegionConfig)
  const parsedLayers = parsedDocument.catalogLayers ?? []
  const layerIds = new Set(parsedLayers.map(layer => layer.id))
  let deploymentLayerId = 'deployment'
  for (let suffix = 2; layerIds.has(deploymentLayerId); suffix += 1) {
    deploymentLayerId = `deployment-${String(suffix)}`
  }
  const resolved = resolveCatalogLayers([
    ...parsedLayers,
    {
      id: deploymentLayerId,
      specialists: parsedDocument.specialists ?? {},
      cohorts: parsedDocument.cohorts ?? {},
      strategies: parsedDocument.strategies ?? {},
    },
  ])
  const effective: MaterializedCurrentConfig = {
    configVersion: CANONICAL_CONFIG_VERSION,
    toolName: parsedDocument.toolName,
    enableRunInBackground: parsedDocument.enableRunInBackground,
    enableStrategies: parsedDocument.enableStrategies ?? false,
    enableDurableRuns: parsedDocument.enableDurableRuns ?? false,
    durableRunPolicy: {
      maxStartsPerActivation: parsedDocument.durableRunPolicy?.maxStartsPerActivation ?? 16,
      maxConcurrentTasks: parsedDocument.durableRunPolicy?.maxConcurrentTasks ?? 4,
    },
    resourceRoots: { ...parsedDocument.resourceRoots },
    maxResourceBytes: parsedDocument.maxResourceBytes ?? 64 * 1024,
    ...parsedDocument.defaultSpecialist === undefined
      ? {}
      : { defaultSpecialist: parsedDocument.defaultSpecialist },
    ...parsedDocument.guidance === undefined ? {} : { guidance: parsedDocument.guidance },
    specialists: copyNamedEntries(resolved.specialists),
    catalogLayers: [],
    cohorts: copyNamedEntries(resolved.cohorts),
    strategies: copyNamedEntries(resolved.strategies),
  }
  validateCurrentConfig(
    effective,
    diagnostics.some(diagnostic => diagnostic.path === 'config.defaultProfile')
      ? 'defaultProfile'
      : 'defaultSpecialist',
  )
  return deepFreeze(effective)
}

function legacyCohort(spec: CohortSpec): LegacyCohortSpec {
  return {
    description: spec.description,
    members: Object.fromEntries(Object.keys(spec.members).sort().map(name => {
      const { specialist, ...member } = spec.members[name]!
      return [name, { ...deepCopy(member), profile: specialist }]
    })),
    ...spec.limits === undefined ? {} : { limits: deepCopy(spec.limits) },
  }
}

function legacyStrategy(spec: StrategySpec): LegacyStrategySpec {
  const { cohort, ...rest } = spec
  return { ...deepCopy(rest), team: cohort }
}

/** Project canonical v3 data to the published v2 spelling without re-entering validation. */
export function projectConfigToPublishedV2(config: CompiledConfig): MaterializedConfig {
  return deepFreeze({
    configVersion: PUBLISHED_CONFIG_VERSION,
    toolName: config.toolName,
    enableRunInBackground: config.enableRunInBackground,
    enableStrategies: config.enableStrategies,
    enableDurableRuns: config.enableDurableRuns,
    durableRunPolicy: { ...config.durableRunPolicy },
    resourceRoots: { ...config.resourceRoots },
    maxResourceBytes: config.maxResourceBytes,
    ...config.defaultSpecialist === undefined ? {} : { defaultProfile: config.defaultSpecialist },
    ...config.guidance === undefined ? {} : { guidance: config.guidance },
    profiles: copyNamedEntries(config.specialists),
    catalogLayers: [],
    teams: Object.fromEntries(Object.keys(config.cohorts).sort().map(name => [
      name,
      legacyCohort(config.cohorts[name]!),
    ])),
    strategies: Object.fromEntries(Object.keys(config.strategies).sort().map(name => [
      name,
      legacyStrategy(config.strategies[name]!),
    ])),
  })
}

/** Validate and migrate one authored document to the canonical Config v3 model. */
export function materializeCurrentConfigWithDiagnostics(input: unknown): MaterializedCurrentConfigResult {
  const diagnostics: ConfigDeprecationDiagnostic[] = []
  const config = materializeCurrentConfigInternal(input, diagnostics)
  return deepFreeze({ config, diagnostics })
}

export function materializeCurrentConfig(input: unknown): MaterializedCurrentConfig {
  return materializeCurrentConfigWithDiagnostics(input).config
}

/** Published 1.x materialization remains v2 until the 2.0 default switch. */
export function materializeConfigWithDiagnostics(input: unknown): MaterializedConfigResult {
  const current = materializeCurrentConfigWithDiagnostics(input)
  return deepFreeze({
    config: projectConfigToPublishedV2(current.config),
    diagnostics: current.diagnostics,
  })
}

export function materializeConfig(input: unknown): MaterializedConfig {
  return materializeConfigWithDiagnostics(input).config
}

/** Canonical configuration consumed after the authored compatibility boundary. */
export type CompiledConfig = MaterializedCurrentConfig
export type CompiledConfigResult = MaterializedCurrentConfigResult

export function materializeCompiledConfigWithDiagnostics(input: unknown): CompiledConfigResult {
  return materializeCurrentConfigWithDiagnostics(input)
}

export function materializeCompiledConfig(input: unknown): CompiledConfig {
  return materializeCurrentConfig(input)
}

export function exportConfigDocument(input: unknown, target: typeof CANONICAL_CONFIG_VERSION): MaterializedCurrentConfig
export function exportConfigDocument(
  input: unknown,
  target?: 1 | typeof PUBLISHED_CONFIG_VERSION | 'legacy-unversioned',
): Config
export function exportConfigDocument(
  input: unknown,
  target: ConfigExportTarget = PUBLISHED_CONFIG_VERSION,
): Config | MaterializedCurrentConfig {
  if (target !== CANONICAL_CONFIG_VERSION
    && target !== PUBLISHED_CONFIG_VERSION
    && target !== 1
    && target !== 'legacy-unversioned') {
    throw new Error(`dsh-legion: unsupported config export target ${String(target)}`)
  }
  const current = materializeCurrentConfig(input)
  if (target === CANONICAL_CONFIG_VERSION) return deepCopy(current)
  const document = deepCopy(projectConfigToPublishedV2(current))
  if (target === PUBLISHED_CONFIG_VERSION) return document
  if (current.enableStrategies
    || current.enableDurableRuns
    || current.durableRunPolicy.maxStartsPerActivation !== 16
    || current.durableRunPolicy.maxConcurrentTasks !== 4
    || Object.keys(current.cohorts).length > 0
    || Object.keys(current.strategies).length > 0) {
    throw new Error(
      'dsh-legion: config v2 Strategy exposure or Cohorts/Strategies cannot be rolled back to config v1',
    )
  }
  const {
    configVersion: _configVersion,
    catalogLayers: _catalogLayers,
    enableStrategies: _enableStrategies,
    enableDurableRuns: _enableDurableRuns,
    durableRunPolicy: _durableRunPolicy,
    teams: _teams,
    strategies: _strategies,
    ...v1
  } = document
  return target === 1 ? { ...v1, configVersion: 1 } : v1
}

export function exportCurrentConfigDocument(input: unknown): MaterializedCurrentConfig {
  return exportConfigDocument(input, CANONICAL_CONFIG_VERSION)
}

/**
 * Validate the cross-field facts that hold for any Legion row, whatever
 * Profiles it composes.
 *
 * The settings namespace is process-wide while a Profile catalog belongs to one
 * row, so this is exactly the judgement a namespace owner may make about a
 * stored section: a `defaultProfile` naming a Profile is valid for the row that
 * defines it and invalid for the row next to it, and refusing the write on
 * behalf of one catalog would refuse it for every other. Catalog cross-checks
 * therefore stay in {@link validateConfig}, which each row runs against its own
 * effective catalog.
 * @param config - a schema-resolved section or entry.
 */
export function validateSettingsSection(config: LegionConfig): void {
  if (config.durableRunPolicy?.maxConcurrentTasks !== undefined
    && config.durableRunPolicy.maxStartsPerActivation !== undefined
    && config.durableRunPolicy.maxConcurrentTasks > config.durableRunPolicy.maxStartsPerActivation) {
    throw new Error(
      'dsh-legion: durableRunPolicy.maxConcurrentTasks cannot exceed maxStartsPerActivation',
    )
  }
  if (config.toolName.trim().length === 0) {
    throw new Error('dsh-legion: toolName must not be blank')
  }

  for (const [name, root] of Object.entries(config.resourceRoots ?? {})) {
    if (!PROFILE_NAME.test(name)) {
      throw new Error(`dsh-legion: resource root name "${name}" must match ${String(PROFILE_NAME)}`)
    }
    if (root.trim().length === 0) throw new Error(`dsh-legion: resource root "${name}" must not be blank`)
    assertPortableRelativePath(root, `resource root "${name}"`)
  }
}

function validateCurrentConfig(
  config: MaterializedCurrentConfig,
  defaultKey: 'defaultSpecialist' | 'defaultProfile',
): void {
  const entries = Object.entries(config.specialists)
  if (entries.length === 0) {
    throw new Error('dsh-legion: specialists must define at least one specialist')
  }

  for (const [name, profile] of entries) {
    if (!PROFILE_NAME.test(name)) {
      throw new Error(`dsh-legion: Specialist name "${name}" must match ${String(SPECIALIST_NAME)}`)
    }
    if (profile.description.trim().length === 0) {
      throw new Error(`dsh-legion: Specialist "${name}" description must not be blank`)
    }
    if (profile.subagentProvider.trim().length === 0) {
      throw new Error(`dsh-legion: Specialist "${name}" subagentProvider must not be blank`)
    }
    if (profile.routes !== undefined && profile.agentOptions !== undefined) {
      throw new Error(`dsh-legion: Specialist "${name}" cannot combine routes with legacy agentOptions`)
    }
    if (profile.routes !== undefined) {
      if (profile.routes.length === 0 || profile.routes.length > 8) {
        throw new Error(`dsh-legion: Specialist "${name}" routes must contain between 1 and 8 candidates`)
      }
      const routeIds = new Set<string>()
      for (const route of profile.routes) {
        if (routeIds.has(route.id)) {
          throw new Error(`dsh-legion: Specialist "${name}" repeats route id "${route.id}"`)
        }
        routeIds.add(route.id)
        if (route.provider.trim().length === 0 || route.model.trim().length === 0) {
          throw new Error(`dsh-legion: Specialist "${name}" route "${route.id}" needs an exact provider and model`)
        }
        if (route.instructions !== undefined && route.instructions.trim().length === 0) {
          throw new Error(`dsh-legion: Specialist "${name}" route "${route.id}" instructions must not be blank`)
        }
        if (route.maxTokens !== undefined
          && route.constraints?.minEffectiveOutputTokens !== undefined
          && route.maxTokens < route.constraints.minEffectiveOutputTokens) {
          throw new Error(
            `dsh-legion: Specialist "${name}" route "${route.id}" maxTokens is below minEffectiveOutputTokens`,
          )
        }
      }
    }
    if (profile.toolFilter !== undefined
      && profile.toolFilter.allow === undefined
      && profile.toolFilter.deny === undefined) {
      throw new Error(
        `dsh-legion: Specialist "${name}" toolFilter names neither allow nor deny`,
      )
    }
    if ((profile.promptFiles?.length ?? 0) > 32) {
      throw new Error(`dsh-legion: Specialist "${name}" promptFiles exceeds the limit of 32`)
    }
    const references = new Set<string>()
    for (const reference of profile.promptFiles ?? []) {
      if (config.resourceRoots?.[reference.root] === undefined) {
        throw new Error(
          `dsh-legion: Specialist "${name}" prompt file references unknown root "${reference.root}"`,
        )
      }
      assertPortableRelativePath(reference.path, `Specialist "${name}" prompt file path`)
      const key = `${reference.root}:${reference.path}`
      if (references.has(key)) {
        throw new Error(`dsh-legion: Specialist "${name}" repeats prompt file "${key}"`)
      }
      references.add(key)
    }
  }

  if (config.defaultSpecialist !== undefined
    && config.specialists[config.defaultSpecialist] === undefined) {
    throw new Error(`dsh-legion: ${defaultKey} "${config.defaultSpecialist}" does not exist`)
  }
}

/** Validate a published v2 Config through the canonical compatibility boundary. */
export function validateConfig(config: Config): void {
  materializeCurrentConfig(config)
}
