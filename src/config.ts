import z from '@deepseek-ai/schemastery'
export const PROFILE_NAME = /^[a-z][a-z0-9-]*$/
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
  /** Model-facing tool name. */
  toolName: string
  /** Semantic profiles selected by the coordinator instead of raw model ids. */
  profiles: Record<string, LegionProfile>
  /** Profile used when the tool call omits profile. */
  defaultProfile?: string
  /** Whether the tool exposes and accepts run_in_background. */
  enableRunInBackground: boolean
  /** Additional coordinator guidance appended after the generated routing table. */
  guidance?: string
  /** Deployment-owned aliases to directories containing prompt fragments. */
  resourceRoots?: Record<string, string>
  /** Maximum combined prompt-fragment bytes loaded for one profile. */
  maxResourceBytes?: number
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

export interface MaterializedConfig extends Config {
  resourceRoots: Record<string, string>
  maxResourceBytes: number
}

export const Config: z<Config> = z.object({
  toolName: z.string().min(1).default('legion'),
  profiles: z.dict(LegionProfileSchema).required(),
  defaultProfile: z.string().pattern(PROFILE_NAME),
  enableRunInBackground: z.boolean().default(true),
  guidance: z.string(),
  resourceRoots: z.dict(z.string().min(1)).default({}),
  maxResourceBytes: z.number().step(1).min(1).max(4 * 1024 * 1024).default(64 * 1024),
})

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function assertKnownKeys(value: unknown, allowed: readonly string[], at: string): void {
  const source = record(value)
  if (source === undefined) return
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
  assertKnownKeys(
    input,
    [
      'toolName',
      'profiles',
      'defaultProfile',
      'enableRunInBackground',
      'guidance',
      'resourceRoots',
      'maxResourceBytes',
    ],
    'config',
  )
  const profiles = record(record(input)?.profiles)
  if (profiles === undefined) return
  for (const [name, profile] of Object.entries(profiles)) {
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
}

/** Validate, materialize defaults, and detach one untrusted Legion config. */
export function materializeConfig(input: unknown): MaterializedConfig {
  assertKnownConfigKeys(input)
  const parsed = Config(input as Config | null | undefined)
  validateConfig(parsed)
  return {
    toolName: parsed.toolName,
    enableRunInBackground: parsed.enableRunInBackground,
    resourceRoots: { ...parsed.resourceRoots },
    maxResourceBytes: parsed.maxResourceBytes ?? 64 * 1024,
    ...parsed.defaultProfile === undefined ? {} : { defaultProfile: parsed.defaultProfile },
    ...parsed.guidance === undefined ? {} : { guidance: parsed.guidance },
    profiles: Object.fromEntries(Object.keys(parsed.profiles).sort().map((name) => {
      const profile = parsed.profiles[name]!
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
  }
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
