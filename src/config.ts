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
