import z from '@deepseek-ai/schemastery'
export const PROFILE_NAME = /^[a-z][a-z0-9-]*$/
export const RESULT_CONTRACTS = ['text', 'findings-v1', 'review-v1'] as const
export type ResultContract = (typeof RESULT_CONTRACTS)[number]

export interface LegionProfile {
  /** Human-readable routing guidance shown to the coordinator. */
  description: string
  /** Named ctx.subagents backend, for example spawn, fork, codex, or claude-code. */
  subagentProvider: string
  /** Optional child LLM route. Omitted fields inherit from the parent Agent. */
  agentOptions?: {
    provider?: string
    model?: string
    maxTokens?: number
  }
  /** Optional child persona shadowing the preset persona. */
  persona?: string
  /** Optional child tool visibility restriction. */
  toolFilter?: {
    allow?: string[]
    deny?: string[]
  }
  /** Absolute delegation depth cap, or provider-managed for external products. */
  maxDepth: number | 'provider-managed'
  /** Whether an omitted run_in_background starts a continuable child. */
  defaultRunInBackground: boolean
  /** Versioned child result contract; structured contracts are foreground-only. */
  result?: ResultContract
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
}

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
  persona: z.string(),
  toolFilter: ToolFilterSchema,
  maxDepth: z.union([
    z.natural().max(Number.MAX_SAFE_INTEGER),
    z.const('provider-managed' as const),
  ]).default(3),
  defaultRunInBackground: z.boolean().default(true),
  result: z.union(RESULT_CONTRACTS).default('text'),
})

export const Config: z<Config> = z.object({
  toolName: z.string().min(1).default('legion'),
  profiles: z.dict(LegionProfileSchema).required(),
  defaultProfile: z.string().pattern(PROFILE_NAME),
  enableRunInBackground: z.boolean().default(true),
  guidance: z.string(),
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

function assertKnownConfigKeys(input: unknown): void {
  assertKnownKeys(
    input,
    ['toolName', 'profiles', 'defaultProfile', 'enableRunInBackground', 'guidance'],
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
        'persona',
        'toolFilter',
        'maxDepth',
        'defaultRunInBackground',
        'result',
      ],
      `profiles.${name}`,
    )
    const profileRecord = record(profile)
    assertKnownKeys(profileRecord?.agentOptions, ['provider', 'model', 'maxTokens'], `profiles.${name}.agentOptions`)
    assertKnownKeys(profileRecord?.toolFilter, ['allow', 'deny'], `profiles.${name}.toolFilter`)
  }
}

/** Validate, materialize defaults, and detach one untrusted Legion config. */
export function materializeConfig(input: unknown): Config {
  assertKnownConfigKeys(input)
  const parsed = Config(input as Config | null | undefined)
  validateConfig(parsed)
  return {
    toolName: parsed.toolName,
    enableRunInBackground: parsed.enableRunInBackground,
    ...parsed.defaultProfile === undefined ? {} : { defaultProfile: parsed.defaultProfile },
    ...parsed.guidance === undefined ? {} : { guidance: parsed.guidance },
    profiles: Object.fromEntries(Object.keys(parsed.profiles).sort().map((name) => {
      const profile = parsed.profiles[name]!
      return [name, {
        description: profile.description,
        subagentProvider: profile.subagentProvider,
        ...profile.agentOptions === undefined ? {} : { agentOptions: { ...profile.agentOptions } },
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
      } satisfies LegionProfile]
    })),
  }
}

/** Validate cross-field facts Schemastery cannot express. */
export function validateConfig(config: Config): void {
  if (config.toolName.trim().length === 0) {
    throw new Error('dsh-legion: toolName must not be blank')
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
    if (profile.toolFilter !== undefined
      && profile.toolFilter.allow === undefined
      && profile.toolFilter.deny === undefined) {
      throw new Error(
        `dsh-legion: profile "${name}" toolFilter names neither allow nor deny`,
      )
    }
  }

  if (config.defaultProfile !== undefined && config.profiles[config.defaultProfile] === undefined) {
    throw new Error(`dsh-legion: defaultProfile "${config.defaultProfile}" does not exist`)
  }
}
