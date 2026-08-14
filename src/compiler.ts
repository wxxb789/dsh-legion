import { createHash } from 'node:crypto'
import type { SubagentCapabilities } from '@deepseek-ai/dsh-subagent'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { Config, LegionProfile, ResultContract } from './config.ts'
import { Config as ConfigSchema, validateConfig } from './config.ts'
import { outputSchemaFor } from './result-contract.ts'

export type DiagnosticSeverity = 'warning' | 'error'

export type DiagnosticCode =
  | 'PROFILE_PROVIDER_UNAVAILABLE'
  | 'PROFILE_CONTINUABLE_UNSUPPORTED'
  | 'PROFILE_DEPTH_UNSUPPORTED'
  | 'PROFILE_PERSONA_UNSUPPORTED'
  | 'PROFILE_TOOL_FILTER_UNSUPPORTED'
  | 'PROFILE_OUTPUT_SCHEMA_UNSUPPORTED'
  | 'PROFILE_STRUCTURED_BACKGROUND_UNSUPPORTED'
  | 'DEFAULT_PROFILE_INACTIVE'

export interface Diagnostic {
  readonly code: DiagnosticCode
  readonly severity: DiagnosticSeverity
  readonly message: string
  readonly profile?: string
}

export interface ProviderFacts {
  readonly capabilities: SubagentCapabilities
  readonly continuable: boolean
}

export interface RuntimeSnapshot {
  readonly providers: Readonly<Record<string, ProviderFacts>>
}

export type EffectiveMode = 'foreground' | 'continuable'

export interface EffectiveProfile extends LegionProfile {
  readonly name: string
  readonly active: boolean
  readonly defaultMode: EffectiveMode
  readonly allowedModes: readonly EffectiveMode[]
  readonly result: ResultContract
}

export class CatalogCompileError extends Error {
  readonly diagnostics: Diagnostic[]

  constructor(diagnostics: Diagnostic[]) {
    super(`dsh-legion: invalid compiled catalog: ${diagnostics.map(item => `${item.code}: ${item.message}`).join('; ')}`)
    this.name = 'CatalogCompileError'
    this.diagnostics = diagnostics.map(item => ({ ...item }))
  }
}

export interface DelegationInvocation {
  readonly profile?: string
  readonly description: string
  readonly prompt: string
  readonly runInBackground?: boolean
}

export interface DelegationPlan {
  readonly profile: string
  readonly mode: EffectiveMode
  readonly subagentProvider: string
  readonly label: string
  readonly prompt: string
  readonly result: ResultContract
  readonly policyDigest: string
  readonly catalogDigest: string
  readonly agentOptions?: LegionProfile['agentOptions']
  readonly persona?: string
  readonly toolFilter?: LegionProfile['toolFilter']
  readonly maxDepth?: number
  readonly outputSchema?: ObjectJsonSchema
}

export class DelegationPlanError extends Error {
  readonly code: 'PROFILE_REQUIRED' | 'PROFILE_UNKNOWN' | 'PROFILE_INACTIVE' | 'BACKGROUND_DISABLED' | 'MODE_UNSUPPORTED' | 'STRUCTURED_BACKGROUND_UNSUPPORTED'

  constructor(code: DelegationPlanError['code'], message: string) {
    super(`dsh-legion: ${message}`)
    this.name = 'DelegationPlanError'
    this.code = code
  }
}

export interface CompiledCatalog {
  readonly toolName: string
  readonly enableRunInBackground: boolean
  readonly defaultProfile?: string
  readonly guidance?: string
  readonly profiles: Record<string, EffectiveProfile>
  readonly activeProfiles: Record<string, EffectiveProfile>
  readonly diagnostics: Diagnostic[]
  /** Digest of authored policy after schema defaults, independent of live provider state. */
  readonly policyDigest: string
  /** Digest of policy plus the runtime provider snapshot used for this compilation. */
  readonly catalogDigest: string
}

function copyProfile(
  name: string,
  profile: LegionProfile,
  active: boolean,
  defaultMode: EffectiveMode,
  allowedModes: readonly EffectiveMode[],
): EffectiveProfile {
  return {
    name,
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
    active,
    defaultMode,
    allowedModes: [...allowedModes],
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (typeof value !== 'object' || value === null) return value
  const record = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(record).sort().flatMap((key) =>
      record[key] === undefined ? [] : [[key, canonical(record[key])]]),
  )
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}`
}

function providerError(
  diagnostics: Diagnostic[],
  profile: string,
  code: DiagnosticCode,
  message: string,
): void {
  diagnostics.push({ code, severity: 'error', profile, message })
}

/** Reject a catalog whose present providers cannot satisfy configured defaults. */
export function assertCatalogUsable(catalog: CompiledCatalog): void {
  const errors = catalog.diagnostics.filter(item => item.severity === 'error')
  if (errors.length > 0) throw new CatalogCompileError(errors)
}

/**
 * Compile one detached, deterministic profile catalog from schema-materialized
 * policy and a plain provider snapshot. No Cordis or DSH live object crosses
 * this seam.
 */
export function compileCatalog(config: Config, snapshot: RuntimeSnapshot): CompiledCatalog {
  config = ConfigSchema(config)
  validateConfig(config)
  const diagnostics: Diagnostic[] = []
  const profiles: Record<string, EffectiveProfile> = {}
  const activeProfiles: Record<string, EffectiveProfile> = {}

  for (const name of Object.keys(config.profiles).sort()) {
    const profile = config.profiles[name]!
    const result = profile.result ?? 'text'
    const defaultMode: EffectiveMode = config.enableRunInBackground && profile.defaultRunInBackground
      ? 'continuable'
      : 'foreground'
    const provider = snapshot.providers[profile.subagentProvider]
    let foregroundSupported = false
    let continuableSupported = false

    if (provider === undefined) {
      diagnostics.push({
        code: 'PROFILE_PROVIDER_UNAVAILABLE',
        severity: 'warning',
        profile: name,
        message: `profile "${name}" requires unavailable subagent provider "${profile.subagentProvider}"`,
      })
    } else {
      const depthSupported = typeof profile.maxDepth !== 'number' || provider.capabilities.depthLimit
      const personaSupported = profile.persona === undefined || provider.capabilities.persona
      const toolFilterSupported = profile.toolFilter === undefined || provider.capabilities.toolFilter
      const outputSupported = result === 'text' || provider.capabilities.outputSchema
      foregroundSupported = depthSupported && personaSupported && toolFilterSupported && outputSupported
      continuableSupported = config.enableRunInBackground && provider.continuable && result === 'text'

      if (defaultMode === 'continuable') {
        if (!provider.continuable) {
          providerError(
            diagnostics,
            name,
            'PROFILE_CONTINUABLE_UNSUPPORTED',
            `provider "${profile.subagentProvider}" does not support continuable children`,
          )
        }
        if (result !== 'text') {
          providerError(
            diagnostics,
            name,
            'PROFILE_STRUCTURED_BACKGROUND_UNSUPPORTED',
            `structured result contract "${result}" is foreground-only`,
          )
        }
      } else {
        if (!depthSupported) {
          providerError(
            diagnostics,
            name,
            'PROFILE_DEPTH_UNSUPPORTED',
            `provider "${profile.subagentProvider}" cannot enforce numeric maxDepth`,
          )
        }
        if (!personaSupported) {
          providerError(
            diagnostics,
            name,
            'PROFILE_PERSONA_UNSUPPORTED',
            `provider "${profile.subagentProvider}" does not support persona`,
          )
        }
        if (!toolFilterSupported) {
          providerError(
            diagnostics,
            name,
            'PROFILE_TOOL_FILTER_UNSUPPORTED',
            `provider "${profile.subagentProvider}" does not support toolFilter`,
          )
        }
        if (!outputSupported) {
          providerError(
            diagnostics,
            name,
            'PROFILE_OUTPUT_SCHEMA_UNSUPPORTED',
            `provider "${profile.subagentProvider}" does not support structured output`,
          )
        }
      }
    }

    const allowedModes: EffectiveMode[] = []
    if (foregroundSupported) allowedModes.push('foreground')
    if (continuableSupported) allowedModes.push('continuable')
    const effective = copyProfile(name, profile, allowedModes.includes(defaultMode), defaultMode, allowedModes)
    profiles[name] = effective
    if (effective.active) activeProfiles[name] = effective
  }

  if (config.defaultProfile !== undefined && activeProfiles[config.defaultProfile] === undefined) {
    diagnostics.push({
      code: 'DEFAULT_PROFILE_INACTIVE',
      severity: 'warning',
      profile: config.defaultProfile,
      message: `default profile "${config.defaultProfile}" is not active in this runtime snapshot`,
    })
  }

  const policy = {
    toolName: config.toolName,
    enableRunInBackground: config.enableRunInBackground,
    ...config.defaultProfile === undefined ? {} : { defaultProfile: config.defaultProfile },
    ...config.guidance === undefined ? {} : { guidance: config.guidance },
    profiles: Object.fromEntries(Object.keys(config.profiles).sort().map(name => [name, config.profiles[name]])),
  }
  const runtime = {
    providers: Object.fromEntries(Object.keys(snapshot.providers).sort().map(name => [name, snapshot.providers[name]])),
  }

  const activeDefaultProfile = config.defaultProfile !== undefined
    && activeProfiles[config.defaultProfile] !== undefined
    ? config.defaultProfile
    : undefined

  return {
    toolName: config.toolName,
    enableRunInBackground: config.enableRunInBackground,
    ...activeDefaultProfile === undefined ? {} : { defaultProfile: activeDefaultProfile },
    ...config.guidance === undefined ? {} : { guidance: config.guidance },
    profiles,
    activeProfiles,
    diagnostics,
    policyDigest: digest(policy),
    catalogDigest: digest({ policy, runtime }),
  }
}

/** Compile one invocation into detached plain data before crossing the live DSH start edge. */
export function compileDelegationPlan(
  catalog: CompiledCatalog,
  invocation: DelegationInvocation,
): DelegationPlan {
  const selected = invocation.profile ?? catalog.defaultProfile
  if (selected === undefined) {
    throw new DelegationPlanError('PROFILE_REQUIRED', 'profile is required because no active default is configured')
  }
  const known = catalog.profiles[selected]
  if (known === undefined) {
    throw new DelegationPlanError('PROFILE_UNKNOWN', `unknown profile "${selected}"`)
  }
  const profile = catalog.activeProfiles[selected]
  if (profile === undefined) {
    throw new DelegationPlanError('PROFILE_INACTIVE', `profile "${selected}" is inactive in this runtime snapshot`)
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
      `profile "${selected}" uses foreground-only result contract "${profile.result}"`,
    )
  }
  if (!profile.allowedModes.includes(mode)) {
    throw new DelegationPlanError(
      'MODE_UNSUPPORTED',
      `profile "${selected}" does not support ${mode} execution in this runtime snapshot`,
    )
  }
  const schema = mode === 'foreground' ? outputSchemaFor(profile.result) : undefined
  return {
    profile: selected,
    mode,
    subagentProvider: profile.subagentProvider,
    label: invocation.description,
    prompt: invocation.prompt,
    result: profile.result ?? 'text',
    policyDigest: catalog.policyDigest,
    catalogDigest: catalog.catalogDigest,
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
    ...typeof profile.maxDepth === 'number' ? { maxDepth: profile.maxDepth } : {},
    ...schema === undefined ? {} : { outputSchema: schema },
  }
}
