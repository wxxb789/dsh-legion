import { createHash } from 'node:crypto'
import type { SubagentCapabilities } from '@deepseek-ai/dsh-subagent'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { Config, LegionProfile, ResultContract } from './config.ts'
import { materializeConfig } from './config.ts'
import { outputSchemaFor } from './result-contract.ts'
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
  ProfileName as profileName,
  type CatalogDigest,
  type PolicyDigest,
  type ProfileName,
  type ResourceDigest,
} from './identity.ts'

export const WARNING_DIAGNOSTIC_CODES = [
  'PROFILE_PROVIDER_UNAVAILABLE',
  'DEFAULT_PROFILE_INACTIVE',
] as const
export type WarningDiagnosticCode = (typeof WARNING_DIAGNOSTIC_CODES)[number]

export const ERROR_DIAGNOSTIC_CODES = [
  'PROFILE_CONTINUABLE_UNSUPPORTED',
  'PROFILE_DEPTH_UNSUPPORTED',
  'PROFILE_PERSONA_UNSUPPORTED',
  'PROFILE_TOOL_FILTER_UNSUPPORTED',
  'PROFILE_OUTPUT_SCHEMA_UNSUPPORTED',
  'PROFILE_STRUCTURED_BACKGROUND_UNSUPPORTED',
] as const
export type ErrorDiagnosticCode = (typeof ERROR_DIAGNOSTIC_CODES)[number]

export type Diagnostic =
  | {
      readonly code: WarningDiagnosticCode
      readonly severity: 'warning'
      readonly message: string
      readonly profile: ProfileName
    }
  | {
      readonly code: ErrorDiagnosticCode
      readonly severity: 'error'
      readonly message: string
      readonly profile: ProfileName
    }

export type DiagnosticCode = Diagnostic['code']
export type DiagnosticSeverity = Diagnostic['severity']
export type ErrorDiagnostic = Extract<Diagnostic, { severity: 'error' }>

export interface ProviderFacts {
  readonly capabilities: SubagentCapabilities
  readonly continuable: boolean
}

export interface RuntimeSnapshot {
  readonly providers: Readonly<Record<string, ProviderFacts>>
}

export type EffectiveMode = 'foreground' | 'continuable'

export interface EffectiveProfile extends Omit<LegionProfile, 'agentOptions' | 'toolFilter' | 'promptFiles'> {
  readonly name: ProfileName
  readonly agentOptions?: Readonly<NonNullable<LegionProfile['agentOptions']>>
  readonly toolFilter?: {
    readonly allow?: readonly string[]
    readonly deny?: readonly string[]
  }
  readonly promptFiles?: readonly Readonly<NonNullable<LegionProfile['promptFiles']>[number]>[]
  readonly active: boolean
  readonly defaultMode: EffectiveMode
  readonly allowedModes: readonly EffectiveMode[]
  readonly result: ResultContract
  readonly promptFragments: readonly LoadedPromptFragment[]
}

export class CatalogCompileError extends Error {
  readonly diagnostics: ErrorDiagnostic[]

  constructor(diagnostics: readonly ErrorDiagnostic[]) {
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
  readonly profile: ProfileName
  readonly mode: EffectiveMode
  readonly subagentProvider: string
  readonly label: string
  readonly prompt: string
  readonly result: ResultContract
  readonly policyDigest: PolicyDigest
  readonly catalogDigest: CatalogDigest
  readonly resourceDigest: ResourceDigest
  readonly promptFragments: readonly LoadedPromptFragment[]
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
  readonly configuredDefaultProfile?: ProfileName
  readonly defaultProfile?: ProfileName
  readonly guidance?: string
  readonly profiles: Readonly<Record<string, EffectiveProfile>>
  readonly activeProfiles: Readonly<Record<string, EffectiveProfile>>
  readonly diagnostics: readonly Diagnostic[]
  /** Digest of authored policy after schema defaults, independent of live provider state. */
  readonly policyDigest: PolicyDigest
  /** Digest of policy plus the runtime provider snapshot used for this compilation. */
  readonly catalogDigest: CatalogDigest
  readonly resourceDigest: ResourceDigest
}

function copyPromptFragments(
  fragments: readonly LoadedPromptFragment[],
): readonly LoadedPromptFragment[] {
  return Object.freeze(fragments.map(fragment => Object.freeze({ ...fragment })))
}

function copyProfile(
  name: ProfileName,
  profile: LegionProfile,
  active: boolean,
  defaultMode: EffectiveMode,
  allowedModes: readonly EffectiveMode[],
  promptFragments: readonly LoadedPromptFragment[],
): EffectiveProfile {
  const agentOptions = profile.agentOptions === undefined
    ? undefined
    : Object.freeze({ ...profile.agentOptions })
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

function deepFreeze<Value>(value: Value): Value {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
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

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}`
}

function providerError(
  diagnostics: Diagnostic[],
  profile: ProfileName,
  code: ErrorDiagnosticCode,
  message: string,
): void {
  diagnostics.push({ code, severity: 'error', profile, message })
}

function isErrorDiagnostic(diagnostic: Diagnostic): diagnostic is ErrorDiagnostic {
  return diagnostic.severity === 'error'
}

/** Reject a catalog whose present providers cannot satisfy configured defaults. */
export function assertCatalogUsable(catalog: CompiledCatalog): void {
  const errors = catalog.diagnostics.filter(isErrorDiagnostic)
  if (errors.length > 0) throw new CatalogCompileError(errors)
}

/**
 * Compile one detached, deterministic profile catalog from schema-materialized
 * policy and a plain provider snapshot. No Cordis or DSH live object crosses
 * this seam.
 */
export function compileCatalog(
  input: Config,
  snapshot: RuntimeSnapshot,
  resources: ResourceSnapshot = EMPTY_RESOURCE_SNAPSHOT,
): CompiledCatalog {
  const config = materializeConfig(input)
  assertResourceSnapshot(config, resources)
  const diagnostics: Diagnostic[] = []
  const profiles: Record<string, EffectiveProfile> = {}
  const activeProfiles: Record<string, EffectiveProfile> = {}

  for (const name of Object.keys(config.profiles).sort()) {
    const identity = profileName(name)
    const profile = config.profiles[name]!
    const result = profile.result ?? 'text'
    const promptFragments = resources.profiles[name] ?? []
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
        profile: identity,
        message: `profile "${name}" requires unavailable subagent provider "${profile.subagentProvider}"`,
      })
    } else {
      const depthSupported = typeof profile.maxDepth !== 'number' || provider.capabilities.depthLimit
      const personaSupported = (profile.persona === undefined && promptFragments.length === 0)
        || provider.capabilities.persona
      const toolFilterSupported = profile.toolFilter === undefined || provider.capabilities.toolFilter
      const outputSupported = result === 'text' || provider.capabilities.outputSchema
      foregroundSupported = depthSupported && personaSupported && toolFilterSupported && outputSupported
      continuableSupported = config.enableRunInBackground && provider.continuable && result === 'text'

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

    const allowedModes: EffectiveMode[] = []
    if (foregroundSupported) allowedModes.push('foreground')
    if (continuableSupported) allowedModes.push('continuable')
    const effective = copyProfile(
      identity,
      profile,
      allowedModes.includes(defaultMode),
      defaultMode,
      allowedModes,
      promptFragments,
    )
    profiles[name] = effective
    if (effective.active) activeProfiles[name] = effective
  }

  if (config.defaultProfile !== undefined && activeProfiles[config.defaultProfile] === undefined) {
    diagnostics.push({
      code: 'DEFAULT_PROFILE_INACTIVE',
      severity: 'warning',
      profile: profileName(config.defaultProfile),
      message: `default profile "${config.defaultProfile}" is not active in this runtime snapshot`,
    })
  }

  const policy = {
    toolName: config.toolName,
    enableRunInBackground: config.enableRunInBackground,
    ...config.defaultProfile === undefined ? {} : { defaultProfile: config.defaultProfile },
    ...config.guidance === undefined ? {} : { guidance: config.guidance },
    resourceRoots: Object.fromEntries(Object.keys(config.resourceRoots).sort().map(name => [name, config.resourceRoots[name]])),
    maxResourceBytes: config.maxResourceBytes,
    profiles: Object.fromEntries(Object.keys(config.profiles).sort().map(name => [name, config.profiles[name]])),
  }
  const runtime = {
    providers: Object.fromEntries(Object.keys(snapshot.providers).sort().map(name => [name, snapshot.providers[name]])),
    resourceDigest: resources.digest,
  }

  const activeDefaultProfile = config.defaultProfile === undefined
    ? undefined
    : activeProfiles[config.defaultProfile]?.name

  const frozenProfiles = Object.freeze({ ...profiles })
  const frozenActiveProfiles = Object.freeze({ ...activeProfiles })
  const frozenDiagnostics = Object.freeze(
    diagnostics.map(diagnostic => Object.freeze({ ...diagnostic })),
  )
  return Object.freeze({
    toolName: config.toolName,
    enableRunInBackground: config.enableRunInBackground,
    ...config.defaultProfile === undefined
      ? {}
      : { configuredDefaultProfile: profileName(config.defaultProfile) },
    ...activeDefaultProfile === undefined ? {} : { defaultProfile: activeDefaultProfile },
    ...config.guidance === undefined ? {} : { guidance: config.guidance },
    profiles: frozenProfiles,
    activeProfiles: frozenActiveProfiles,
    diagnostics: frozenDiagnostics,
    policyDigest: policyDigest(sha256({ version: 1, kind: 'legion-policy', policy })),
    catalogDigest: catalogDigest(sha256({ version: 1, kind: 'legion-catalog', policy, runtime })),
    resourceDigest: resources.digest,
  })
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
  const fragmentInstructions = renderPromptFragments(profile.promptFragments)
  const persona = [profile.persona, fragmentInstructions]
    .filter((value): value is string => value !== undefined && value.length > 0)
    .join('\n\n') || undefined
  return deepFreeze({
    profile: profile.name,
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
