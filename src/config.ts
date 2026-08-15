import z from '@deepseek-ai/schemastery'
import {
  StrategySpecSchema,
  TeamSpecSchema,
  assertKnownOrchestrationKeys,
  type CatalogLayer,
  type StrategySpec,
  type TeamSpec,
} from './orchestration-contract.ts'
import { resolveCatalogLayers } from './catalog-layer.ts'

export const PROFILE_NAME = /^[a-z][a-z0-9-]*$/
export const CURRENT_CONFIG_VERSION = 2 as const
export type ConfigVersion = 1 | typeof CURRENT_CONFIG_VERSION
export type ConfigExportTarget = ConfigVersion | 'legacy-unversioned'
export const RESULT_CONTRACTS = ['text', 'findings-v1', 'review-v1'] as const
export type ResultContract = (typeof RESULT_CONTRACTS)[number]

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

export interface LegionProfile {
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

export interface Config {
  /** Explicit document version; omission is the pre-v0.4 unversioned v1 shape. */
  readonly configVersion?: ConfigVersion
  /** Model-facing tool name. */
  toolName: string
  /** Semantic profiles selected by the coordinator instead of raw model ids. */
  profiles: Record<string, LegionProfile>
  /** Profile used when the tool call omits profile. */
  defaultProfile?: string
  /** Whether the tool exposes and accepts run_in_background. */
  enableRunInBackground: boolean
  /** Explicit opt-in for model-callable Strategies; defaults to false. */
  readonly enableStrategies?: boolean
  /** Additional coordinator guidance appended after the generated routing table. */
  guidance?: string
  /** Deployment-owned aliases to directories containing prompt fragments. */
  resourceRoots?: Record<string, string>
  /** Maximum combined prompt-fragment bytes loaded for one profile. */
  maxResourceBytes?: number
  /** Ordered installed/project catalog layers; the root maps form the final deployment layer. */
  catalogLayers?: CatalogLayer<LegionProfile>[]
  /** Named declarative Teams in the final deployment layer. */
  teams?: Record<string, TeamSpec>
  /** Named declarative Strategies in the final deployment layer. */
  strategies?: Record<string, StrategySpec>
}

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

export const LegionProfileSchema: z<LegionProfile> = z.object({
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

const CatalogDisableSchema = z.object({
  profiles: z.array(z.string().pattern(PROFILE_NAME)),
  teams: z.array(z.string().pattern(PROFILE_NAME)),
  strategies: z.array(z.string().pattern(PROFILE_NAME)),
})

const CatalogLayerSchema = z.object({
  id: z.string().pattern(PROFILE_NAME).required(),
  profiles: z.dict(LegionProfileSchema),
  teams: z.dict(TeamSpecSchema),
  strategies: z.dict(StrategySpecSchema),
  disable: CatalogDisableSchema,
}) as unknown as z<CatalogLayer<LegionProfile>>

export interface MaterializedConfig extends Config {
  configVersion: typeof CURRENT_CONFIG_VERSION
  resourceRoots: Record<string, string>
  maxResourceBytes: number
  enableStrategies: boolean
  catalogLayers: []
  teams: Record<string, TeamSpec>
  strategies: Record<string, StrategySpec>
}

export const Config: z<Config> = z.object({
  configVersion: z.union([z.const(1 as const), z.const(CURRENT_CONFIG_VERSION)]).default(CURRENT_CONFIG_VERSION),
  toolName: z.string().min(1).default('legion'),
  profiles: z.dict(LegionProfileSchema).required(),
  defaultProfile: z.string().pattern(PROFILE_NAME),
  enableRunInBackground: z.boolean().default(true),
  enableStrategies: z.boolean(),
  guidance: z.string(),
  resourceRoots: z.dict(z.string().min(1)).default({}),
  maxResourceBytes: z.number().step(1).min(1).max(4 * 1024 * 1024).default(64 * 1024),
  catalogLayers: z.array(CatalogLayerSchema).max(31),
  teams: z.dict(TeamSpecSchema),
  strategies: z.dict(StrategySpecSchema),
})

function cloneAuthoredValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneAuthoredValue)
  if (typeof value !== 'object' || value === null) return value
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, cloneAuthoredValue(child)]),
  )
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
    ? value as Record<string, unknown>
    : undefined
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

function assertKnownConfigKeys(input: unknown): void {
  const source = record(input)
  if (source !== undefined
    && Object.hasOwn(source, 'configVersion')
    && source.configVersion !== undefined
    && source.configVersion !== 1
    && source.configVersion !== CURRENT_CONFIG_VERSION) {
    throw new Error(`dsh-legion: unsupported configVersion ${String(source.configVersion)}`)
  }
  const authoredVersion = source?.configVersion ?? 1
  if (authoredVersion === 1
    && (Array.isArray(source?.catalogLayers) && source.catalogLayers.length > 0
      || Object.keys(record(source?.teams) ?? {}).length > 0
      || Object.keys(record(source?.strategies) ?? {}).length > 0
      || source?.enableStrategies === true)) {
    throw new Error(
      'dsh-legion: configVersion 2 is required for catalogLayers, teams, strategies, or enableStrategies',
    )
  }
  assertKnownKeys(
    input,
    [
      'configVersion',
      'toolName',
      'profiles',
      'defaultProfile',
      'enableRunInBackground',
      'enableStrategies',
      'guidance',
      'resourceRoots',
      'maxResourceBytes',
      'catalogLayers',
      'teams',
      'strategies',
    ],
    'config',
  )
  const profiles = record(source?.profiles)
  if (source?.profiles !== undefined && profiles === undefined) {
    throw new Error('dsh-legion: profiles must be a plain object')
  }
  if (profiles !== undefined) for (const [name, profile] of Object.entries(profiles)) {
    assertKnownKeys(
      profile,
      [
        'description',
        'subagentProvider',
        'agentOptions',
        'routes',
        'persona',
        'toolFilter',
        'maxDepth',
        'defaultRunInBackground',
        'result',
        'promptFiles',
      ],
      `profiles.${name}`,
    )
    const profileRecord = record(profile)
    assertKnownKeys(profileRecord?.agentOptions, ['provider', 'model', 'maxTokens'], `profiles.${name}.agentOptions`)
    assertKnownKeys(profileRecord?.toolFilter, ['allow', 'deny'], `profiles.${name}.toolFilter`)
    if (Array.isArray(profileRecord?.routes)) {
      profileRecord.routes.forEach((route, index) => {
        assertKnownKeys(
          route,
          ['id', 'provider', 'model', 'maxTokens', 'constraints', 'instructions'],
          `profiles.${name}.routes[${String(index)}]`,
        )
        assertKnownKeys(
          record(route)?.constraints,
          ['minContextTokens', 'minEffectiveOutputTokens'],
          `profiles.${name}.routes[${String(index)}].constraints`,
        )
      })
    }
    if (Array.isArray(profileRecord?.promptFiles)) {
      profileRecord.promptFiles.forEach((reference, index) => {
        assertKnownKeys(reference, ['root', 'path'], `profiles.${name}.promptFiles[${String(index)}]`)
      })
    }
  }
  assertKnownOrchestrationKeys(source?.teams, source?.strategies)
  if (Array.isArray(source?.catalogLayers)) {
    source.catalogLayers.forEach((layer, index) => {
      const layerRecord = record(layer)
      assertKnownKeys(
        layer,
        ['id', 'profiles', 'teams', 'strategies', 'disable'],
        `catalogLayers[${String(index)}]`,
      )
      assertKnownKeys(
        layerRecord?.disable,
        ['profiles', 'teams', 'strategies'],
        `catalogLayers[${String(index)}].disable`,
      )
      assertKnownConfigKeys({
        configVersion: 2,
        profiles: layerRecord?.profiles ?? {},
        teams: layerRecord?.teams ?? {},
        strategies: layerRecord?.strategies ?? {},
      })
    })
  }
}

/** Validate, materialize defaults, and detach one untrusted Legion config. */
export function materializeConfig(input: unknown): MaterializedConfig {
  assertKnownConfigKeys(input)
  const parsed = Config(cloneAuthoredValue(input) as Config | null | undefined)
  const layerIds = new Set((parsed.catalogLayers ?? []).map(layer => layer.id))
  let deploymentLayerId = 'deployment'
  for (let suffix = 2; layerIds.has(deploymentLayerId); suffix += 1) {
    deploymentLayerId = `deployment-${String(suffix)}`
  }
  const resolved = resolveCatalogLayers([
    ...(parsed.catalogLayers ?? []),
    {
      id: deploymentLayerId,
      profiles: parsed.profiles,
      teams: parsed.teams ?? {},
      strategies: parsed.strategies ?? {},
    },
  ])
  const effective: Config = {
    ...parsed,
    configVersion: CURRENT_CONFIG_VERSION,
    enableStrategies: parsed.enableStrategies ?? false,
    profiles: { ...resolved.profiles },
    teams: { ...resolved.teams },
    strategies: { ...resolved.strategies },
    catalogLayers: [],
  }
  validateConfig(effective)
  return {
    configVersion: CURRENT_CONFIG_VERSION,
    toolName: effective.toolName,
    enableRunInBackground: effective.enableRunInBackground,
    enableStrategies: effective.enableStrategies ?? false,
    resourceRoots: { ...effective.resourceRoots },
    maxResourceBytes: effective.maxResourceBytes ?? 64 * 1024,
    ...effective.defaultProfile === undefined ? {} : { defaultProfile: effective.defaultProfile },
    ...effective.guidance === undefined ? {} : { guidance: effective.guidance },
    profiles: Object.fromEntries(Object.keys(effective.profiles).sort().map((name) => {
      const profile = effective.profiles[name]!
      return [name, {
        description: profile.description,
        subagentProvider: profile.subagentProvider,
        ...profile.agentOptions === undefined ? {} : { agentOptions: { ...profile.agentOptions } },
        ...profile.routes === undefined
          ? {}
          : {
              routes: profile.routes.map(route => ({
                id: route.id,
                provider: route.provider,
                model: route.model,
                ...route.maxTokens === undefined ? {} : { maxTokens: route.maxTokens },
                ...route.constraints === undefined
                  ? {}
                  : {
                      constraints: {
                        ...route.constraints.minContextTokens === undefined
                          ? {}
                          : { minContextTokens: route.constraints.minContextTokens },
                        ...route.constraints.minEffectiveOutputTokens === undefined
                          ? {}
                          : {
                              minEffectiveOutputTokens:
                                route.constraints.minEffectiveOutputTokens,
                            },
                      },
                    },
                ...route.instructions === undefined ? {} : { instructions: route.instructions },
              })),
            },
        ...profile.persona === undefined ? {} : { persona: profile.persona },
        ...profile.toolFilter === undefined
          ? {}
          : {
              toolFilter: {
                ...profile.toolFilter.allow === undefined ? {} : { allow: [...profile.toolFilter.allow] },
                ...profile.toolFilter.deny === undefined ? {} : { deny: [...profile.toolFilter.deny] },
              },
            },
        maxDepth: profile.maxDepth,
        defaultRunInBackground: profile.defaultRunInBackground,
        result: profile.result ?? 'text',
        ...profile.promptFiles === undefined
          ? {}
          : { promptFiles: profile.promptFiles.map(reference => ({ ...reference })) },
      } satisfies LegionProfile]
    })),
    catalogLayers: [],
    teams: { ...resolved.teams },
    strategies: { ...resolved.strategies },
  }
}

/** Export one normalized current document or a rollback-compatible unversioned document. */
export function exportConfigDocument(
  input: unknown,
  target: ConfigExportTarget = CURRENT_CONFIG_VERSION,
): Config {
  const current = materializeConfig(input)
  const document = current
  if (target === CURRENT_CONFIG_VERSION) return document
  if (current.enableStrategies
    || Object.keys(current.teams).length > 0
    || Object.keys(current.strategies).length > 0) {
    throw new Error(
      'dsh-legion: config v2 Strategy exposure or Teams/Strategies cannot be rolled back to config v1',
    )
  }
  const {
    configVersion: _configVersion,
    catalogLayers: _catalogLayers,
    enableStrategies: _enableStrategies,
    teams: _teams,
    strategies: _strategies,
    ...v1
  } = document
  return target === 1 ? { ...v1, configVersion: 1 } : v1
}

/** Validate cross-field facts Schemastery cannot express. */
export function validateConfig(config: Config): void {
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

  const entries = Object.entries(config.profiles)
  if (entries.length === 0) {
    throw new Error('dsh-legion: profiles must define at least one profile')
  }

  for (const [name, profile] of entries) {
    if (!PROFILE_NAME.test(name)) {
      throw new Error(`dsh-legion: profile name "${name}" must match ${String(PROFILE_NAME)}`)
    }
    if (profile.description.trim().length === 0) {
      throw new Error(`dsh-legion: profile "${name}" description must not be blank`)
    }
    if (profile.subagentProvider.trim().length === 0) {
      throw new Error(`dsh-legion: profile "${name}" subagentProvider must not be blank`)
    }
    if (profile.routes !== undefined && profile.agentOptions !== undefined) {
      throw new Error(`dsh-legion: profile "${name}" cannot combine routes with legacy agentOptions`)
    }
    if (profile.routes !== undefined) {
      if (profile.routes.length === 0 || profile.routes.length > 8) {
        throw new Error(`dsh-legion: profile "${name}" routes must contain between 1 and 8 candidates`)
      }
      const routeIds = new Set<string>()
      for (const route of profile.routes) {
        if (routeIds.has(route.id)) {
          throw new Error(`dsh-legion: profile "${name}" repeats route id "${route.id}"`)
        }
        routeIds.add(route.id)
        if (route.provider.trim().length === 0 || route.model.trim().length === 0) {
          throw new Error(`dsh-legion: profile "${name}" route "${route.id}" needs an exact provider and model`)
        }
        if (route.instructions !== undefined && route.instructions.trim().length === 0) {
          throw new Error(`dsh-legion: profile "${name}" route "${route.id}" instructions must not be blank`)
        }
        if (route.maxTokens !== undefined
          && route.constraints?.minEffectiveOutputTokens !== undefined
          && route.maxTokens < route.constraints.minEffectiveOutputTokens) {
          throw new Error(
            `dsh-legion: profile "${name}" route "${route.id}" maxTokens is below minEffectiveOutputTokens`,
          )
        }
      }
    }
    if (profile.toolFilter !== undefined
      && profile.toolFilter.allow === undefined
      && profile.toolFilter.deny === undefined) {
      throw new Error(
        `dsh-legion: profile "${name}" toolFilter names neither allow nor deny`,
      )
    }
    if ((profile.promptFiles?.length ?? 0) > 32) {
      throw new Error(`dsh-legion: profile "${name}" promptFiles exceeds the limit of 32`)
    }
    const references = new Set<string>()
    for (const reference of profile.promptFiles ?? []) {
      if (config.resourceRoots?.[reference.root] === undefined) {
        throw new Error(
          `dsh-legion: profile "${name}" prompt file references unknown root "${reference.root}"`,
        )
      }
      assertPortableRelativePath(reference.path, `profile "${name}" prompt file path`)
      const key = `${reference.root}:${reference.path}`
      if (references.has(key)) {
        throw new Error(`dsh-legion: profile "${name}" repeats prompt file "${key}"`)
      }
      references.add(key)
    }
  }

  if (config.defaultProfile !== undefined && config.profiles[config.defaultProfile] === undefined) {
    throw new Error(`dsh-legion: defaultProfile "${config.defaultProfile}" does not exist`)
  }
}
