import {
  CatalogDigest as catalogDigest,
  PolicyDigest as policyDigest,
  ProfileName as profileName,
  type CatalogDigest,
  type PolicyDigest,
  type ProfileName,
} from './identity.ts'
import {
  validateJsonSchemaValue,
  type JsonValue,
  type ObjectJsonSchema,
} from '@deepseek-ai/dsh-tools'
import {
  ERROR_DIAGNOSTIC_CODES,
  WARNING_DIAGNOSTIC_CODES,
  compileCatalog,
  type CompiledCatalog,
  type Diagnostic,
  type DiagnosticCode,
  type EffectiveMode,
  type EffectiveProfile,
  type RuntimeSnapshot,
} from './compiler.ts'
import type { Config, ResultContract } from './config.ts'
import type { ResourceSnapshot } from './resources.ts'

export type ExplainStatus = 'ok' | 'warnings' | 'errors'
export type ProviderSnapshotSource = 'live-dsh-registry' | 'fixture' | 'empty-fixture'

export interface ExplainSummary {
  readonly status: ExplainStatus
  readonly configuredProfiles: number
  readonly activeProfiles: number
  readonly inactiveProfiles: number
  readonly errors: number
  readonly warnings: number
}

export interface ProfileRouteView {
  readonly provider?: string
  readonly model?: string
  readonly maxTokens?: number
}

interface ProfileExplainBase {
  readonly name: ProfileName
  readonly subagentProvider: string
  readonly description: string
  readonly defaultMode: EffectiveMode
  readonly resultContract: ResultContract
  readonly route: ProfileRouteView
}

export type ProfileExplainView =
  | ProfileExplainBase & {
      readonly kind: 'active-profile'
      readonly allowedModes: readonly [EffectiveMode, ...EffectiveMode[]]
    }
  | ProfileExplainBase & {
      readonly kind: 'inactive-profile'
      readonly allowedModes: readonly EffectiveMode[]
      readonly diagnosticCodes: readonly DiagnosticCode[]
    }

export interface ExplainViewV1 {
  readonly version: 1
  readonly kind: 'legion-explain'
  readonly source: {
    readonly providerSnapshot: ProviderSnapshotSource
  }
  readonly summary: ExplainSummary
  readonly policyDigest: PolicyDigest
  readonly catalogDigest: CatalogDigest
  readonly tool: {
    readonly name: string
    readonly backgroundEnabled: boolean
    readonly configuredDefaultProfile?: ProfileName
    readonly activeDefaultProfile?: ProfileName
  }
  readonly profiles: readonly ProfileExplainView[]
  readonly diagnostics: readonly Diagnostic[]
}

const routeSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    provider: { type: 'string' as const },
    model: { type: 'string' as const },
    maxTokens: { type: 'integer' as const },
  },
}

const profileProperties = {
  name: { type: 'string' as const },
  subagentProvider: { type: 'string' as const },
  description: { type: 'string' as const },
  defaultMode: { type: 'string' as const, enum: ['foreground', 'continuable'] },
  resultContract: { type: 'string' as const, enum: ['text', 'findings-v1', 'review-v1'] },
  route: routeSchema,
  allowedModes: {
    type: 'array' as const,
    items: { type: 'string' as const, enum: ['foreground', 'continuable'] },
  },
}

const diagnosticProperties = {
  code: {
    type: 'string' as const,
    enum: [...WARNING_DIAGNOSTIC_CODES, ...ERROR_DIAGNOSTIC_CODES],
  },
  severity: { type: 'string' as const, enum: ['warning', 'error'] },
  message: { type: 'string' as const },
  profile: { type: 'string' as const },
}

export const EXPLAIN_VIEW_V1_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    version: { type: 'integer', const: 1 },
    kind: { type: 'string', const: 'legion-explain' },
    source: {
      type: 'object',
      additionalProperties: false,
      properties: {
        providerSnapshot: {
          type: 'string',
          enum: ['live-dsh-registry', 'fixture', 'empty-fixture'],
        },
      },
      required: ['providerSnapshot'],
    },
    summary: {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { type: 'string', enum: ['ok', 'warnings', 'errors'] },
        configuredProfiles: { type: 'integer' },
        activeProfiles: { type: 'integer' },
        inactiveProfiles: { type: 'integer' },
        errors: { type: 'integer' },
        warnings: { type: 'integer' },
      },
      required: [
        'status', 'configuredProfiles', 'activeProfiles', 'inactiveProfiles', 'errors', 'warnings',
      ],
    },
    policyDigest: { type: 'string' },
    catalogDigest: { type: 'string' },
    tool: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string' },
        backgroundEnabled: { type: 'boolean' },
        configuredDefaultProfile: { type: 'string' },
        activeDefaultProfile: { type: 'string' },
      },
      required: ['name', 'backgroundEnabled'],
    },
    profiles: {
      type: 'array',
      items: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              ...profileProperties,
              kind: { type: 'string', const: 'active-profile' },
            },
            required: [
              'kind', 'name', 'subagentProvider', 'description', 'defaultMode', 'resultContract',
              'route', 'allowedModes',
            ],
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              ...profileProperties,
              kind: { type: 'string', const: 'inactive-profile' },
              diagnosticCodes: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: [...WARNING_DIAGNOSTIC_CODES, ...ERROR_DIAGNOSTIC_CODES],
                },
              },
            },
            required: [
              'kind', 'name', 'subagentProvider', 'description', 'defaultMode', 'resultContract',
              'route', 'allowedModes', 'diagnosticCodes',
            ],
          },
        ],
      },
    },
    diagnostics: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: diagnosticProperties,
        required: ['code', 'severity', 'message', 'profile'],
      },
    },
  },
  required: [
    'version', 'kind', 'source', 'summary', 'policyDigest', 'catalogDigest', 'tool', 'profiles',
    'diagnostics',
  ],
}

export interface ExplainOptions {
  readonly providerSnapshot: ProviderSnapshotSource
}

function copyJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(copyJson)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copyJson(child)]))
}

/** Runtime-check the public V1 explain contract and its cross-field invariants. */
export function assertExplainViewV1(value: unknown): asserts value is ExplainViewV1 {
  const violations = validateJsonSchemaValue(EXPLAIN_VIEW_V1_SCHEMA, value, 'explain')
  if (violations.length > 0) {
    throw new Error(`dsh-legion: invalid ExplainViewV1: ${violations.join('; ')}`)
  }
  const view = value as ExplainViewV1
  policyDigest(view.policyDigest)
  catalogDigest(view.catalogDigest)
  if (view.tool.configuredDefaultProfile !== undefined) profileName(view.tool.configuredDefaultProfile)
  if (view.tool.activeDefaultProfile !== undefined) profileName(view.tool.activeDefaultProfile)
  const names = view.profiles.map(profile => String(profile.name))
  const sortedNames = [...names].sort()
  if (new Set(names).size !== names.length || names.some((name, index) => name !== sortedNames[index])) {
    throw new Error('dsh-legion: ExplainViewV1 profiles must have unique names in canonical order')
  }
  const profileByName = new Map(view.profiles.map(profile => [String(profile.name), profile]))
  const allowedModeForms = new Set(['', 'foreground', 'continuable', 'foreground,continuable'])
  for (const profile of view.profiles) {
    profileName(profile.name)
    const modeForm = profile.allowedModes.join(',')
    if (!allowedModeForms.has(modeForm)) {
      throw new Error(`dsh-legion: profile "${profile.name}" has duplicate or non-canonical allowed modes`)
    }
    const defaultAllowed = profile.allowedModes.includes(profile.defaultMode)
    if ((profile.kind === 'active-profile') !== defaultAllowed) {
      throw new Error(`dsh-legion: profile "${profile.name}" state disagrees with its default mode eligibility`)
    }
    if (!view.tool.backgroundEnabled
      && (profile.defaultMode !== 'foreground' || profile.allowedModes.includes('continuable'))) {
      throw new Error(`dsh-legion: profile "${profile.name}" enables background while the tool disables it`)
    }
    if (profile.resultContract !== 'text' && profile.allowedModes.includes('continuable')) {
      throw new Error(`dsh-legion: structured profile "${profile.name}" cannot allow continuable execution`)
    }
    if (profile.route.maxTokens !== undefined
      && (!Number.isSafeInteger(profile.route.maxTokens) || profile.route.maxTokens < 1)) {
      throw new Error(`dsh-legion: profile "${profile.name}" has invalid maxTokens`)
    }
  }
  const warningCodes = new Set<string>(WARNING_DIAGNOSTIC_CODES)
  const errorCodes = new Set<string>(ERROR_DIAGNOSTIC_CODES)
  for (const diagnostic of view.diagnostics) {
    profileName(diagnostic.profile)
    if (!profileByName.has(diagnostic.profile)) {
      throw new Error(`dsh-legion: diagnostic ${diagnostic.code} references unknown profile "${diagnostic.profile}"`)
    }
    const compatible = diagnostic.severity === 'warning'
      ? warningCodes.has(diagnostic.code)
      : errorCodes.has(diagnostic.code)
    if (!compatible) {
      throw new Error(
        `dsh-legion: diagnostic ${diagnostic.code} has incompatible severity ${diagnostic.severity}`,
      )
    }
  }
  for (const profile of view.profiles) {
    const actualCodes = view.diagnostics
      .filter(diagnostic => diagnostic.profile === profile.name)
      .map(diagnostic => diagnostic.code)
    if (profile.kind === 'active-profile') {
      if (actualCodes.some(code => errorCodes.has(code) || code === 'PROFILE_PROVIDER_UNAVAILABLE')) {
        throw new Error(`dsh-legion: active profile "${profile.name}" carries a blocking diagnostic`)
      }
    } else if (profile.diagnosticCodes.length === 0
      || profile.diagnosticCodes.length !== actualCodes.length
      || profile.diagnosticCodes.some((code, index) => code !== actualCodes[index])) {
      throw new Error(`dsh-legion: inactive profile "${profile.name}" reasons disagree with diagnostics`)
    }
    if (actualCodes.includes('PROFILE_PROVIDER_UNAVAILABLE') && profile.allowedModes.length !== 0) {
      throw new Error(`dsh-legion: unavailable profile "${profile.name}" cannot allow execution`)
    }
  }
  const configuredDefault = view.tool.configuredDefaultProfile === undefined
    ? undefined
    : profileByName.get(view.tool.configuredDefaultProfile)
  if (view.tool.configuredDefaultProfile !== undefined && configuredDefault === undefined) {
    throw new Error('dsh-legion: configured default profile does not exist in ExplainViewV1')
  }
  if (view.tool.activeDefaultProfile !== undefined) {
    if (view.tool.activeDefaultProfile !== view.tool.configuredDefaultProfile
      || profileByName.get(view.tool.activeDefaultProfile)?.kind !== 'active-profile') {
      throw new Error('dsh-legion: active default profile is not the configured active profile')
    }
  }
  const defaultInactiveDiagnostics = view.diagnostics.filter(
    diagnostic => diagnostic.code === 'DEFAULT_PROFILE_INACTIVE',
  )
  const configuredInactive = configuredDefault?.kind === 'inactive-profile'
  if (configuredDefault?.kind === 'active-profile'
    && view.tool.activeDefaultProfile !== configuredDefault.name) {
    throw new Error('dsh-legion: active configured default is not exposed as activeDefaultProfile')
  }
  if ((configuredInactive ? 1 : 0) !== defaultInactiveDiagnostics.length
    || defaultInactiveDiagnostics.some(diagnostic => diagnostic.profile !== view.tool.configuredDefaultProfile)) {
    throw new Error('dsh-legion: DEFAULT_PROFILE_INACTIVE diagnostics disagree with default state')
  }
  const active = view.profiles.filter(profile => profile.kind === 'active-profile').length
  const errors = view.diagnostics.filter(item => item.severity === 'error').length
  const warnings = view.diagnostics.filter(item => item.severity === 'warning').length
  const status: ExplainStatus = errors > 0 ? 'errors' : warnings > 0 ? 'warnings' : 'ok'
  if (view.summary.configuredProfiles !== view.profiles.length
    || view.summary.activeProfiles !== active
    || view.summary.inactiveProfiles !== view.profiles.length - active
    || view.summary.errors !== errors
    || view.summary.warnings !== warnings
    || view.summary.status !== status) {
    throw new Error('dsh-legion: ExplainViewV1 summary does not match its profiles and diagnostics')
  }
}

/** Validate and detach an explain view crossing a JSON/plugin/process boundary. */
export function materializeExplainViewV1(value: unknown): ExplainViewV1 {
  assertExplainViewV1(value)
  const detached = copyJson(value as unknown as JsonValue)
  assertExplainViewV1(detached)
  return detached
}

/** Compile and explain one config/snapshot pair through the canonical compiler. */
export function compileExplainView(
  config: Config,
  snapshot: RuntimeSnapshot,
  options: ExplainOptions,
  resources?: ResourceSnapshot,
): ExplainViewV1 {
  return explainCatalog(compileCatalog(config, snapshot, resources), options)
}

function route(profile: EffectiveProfile): ProfileRouteView {
  const authored = profile.routes?.[0] ?? profile.agentOptions
  return {
    ...authored?.provider === undefined ? {} : { provider: authored.provider },
    ...authored?.model === undefined ? {} : { model: authored.model },
    ...authored?.maxTokens === undefined ? {} : { maxTokens: authored.maxTokens },
  }
}

function diagnosticCopy(diagnostic: Diagnostic): Diagnostic {
  return diagnostic.severity === 'warning'
    ? {
        code: diagnostic.code,
        severity: 'warning',
        message: diagnostic.message,
        profile: diagnostic.profile,
      }
    : {
        code: diagnostic.code,
        severity: 'error',
        message: diagnostic.message,
        profile: diagnostic.profile,
      }
}

/** Project a compiled catalog into one deterministic, versioned, JSON-safe explain view. */
export function explainCatalog(catalog: CompiledCatalog, options: ExplainOptions): ExplainViewV1 {
  const diagnostics = catalog.diagnostics.map(diagnosticCopy)
  const profiles = Object.keys(catalog.profiles).sort().map((key): ProfileExplainView => {
    const profile = catalog.profiles[key]!
    const base: ProfileExplainBase = {
      name: profile.name,
      subagentProvider: profile.subagentProvider,
      description: profile.description,
      defaultMode: profile.defaultMode,
      resultContract: profile.result,
      route: route(profile),
    }
    if (profile.active) {
      if (profile.allowedModes.length === 0) {
        throw new Error(`dsh-legion: active profile "${profile.name}" has no allowed execution mode`)
      }
      return {
        ...base,
        kind: 'active-profile',
        allowedModes: [profile.allowedModes[0]!, ...profile.allowedModes.slice(1)],
      }
    }
    return {
      ...base,
      kind: 'inactive-profile',
      allowedModes: [...profile.allowedModes],
      diagnosticCodes: diagnostics
        .filter(item => item.profile === profile.name)
        .map(item => item.code),
    }
  })
  const errors = diagnostics.filter(item => item.severity === 'error').length
  const warnings = diagnostics.filter(item => item.severity === 'warning').length
  const activeProfiles = profiles.filter(profile => profile.kind === 'active-profile').length

  const view: ExplainViewV1 = {
    version: 1,
    kind: 'legion-explain',
    source: { providerSnapshot: options.providerSnapshot },
    summary: {
      status: errors > 0 ? 'errors' : warnings > 0 ? 'warnings' : 'ok',
      configuredProfiles: profiles.length,
      activeProfiles,
      inactiveProfiles: profiles.length - activeProfiles,
      errors,
      warnings,
    },
    policyDigest: catalog.policyDigest,
    catalogDigest: catalog.catalogDigest,
    tool: {
      name: catalog.toolName,
      backgroundEnabled: catalog.enableRunInBackground,
      ...catalog.configuredDefaultProfile === undefined
        ? {}
        : { configuredDefaultProfile: catalog.configuredDefaultProfile },
      ...catalog.defaultProfile === undefined ? {} : { activeDefaultProfile: catalog.defaultProfile },
    },
    profiles,
    diagnostics,
  }
  assertExplainViewV1(view)
  return view
}

export interface RenderExplainOptions {
  readonly command?: 'doctor' | 'explain'
  readonly detail?: 'summary' | 'profiles'
}

function routeText(routeView: ProfileRouteView): string {
  if (routeView.provider !== undefined && routeView.model !== undefined) {
    return `${routeView.provider}/${routeView.model}`
  }
  if (routeView.provider !== undefined) return `${routeView.provider}/<inherited-model>`
  if (routeView.model !== undefined) return `<inherited-provider>/${routeView.model}`
  return '<parent-route>'
}

/** Render one stable, color-free human projection suitable for terminals and logs. */
export function renderExplainHuman(
  view: ExplainViewV1,
  options: RenderExplainOptions = {},
): string {
  const lines = [
    `dsh-legion ${options.command ?? 'doctor'}`,
    '',
    `Provider evidence: ${view.source.providerSnapshot}`,
    `Policy digest:  ${view.policyDigest}`,
    `Catalog digest: ${view.catalogDigest}`,
    '',
    `Profiles: ${String(view.summary.configuredProfiles)} configured, ${String(view.summary.activeProfiles)} active, ${String(view.summary.inactiveProfiles)} inactive`,
    `Default: ${view.tool.configuredDefaultProfile ?? '<none>'}`
      + (view.tool.activeDefaultProfile === undefined ? ' (inactive or absent)' : ' (active)'),
  ]

  if (options.detail === 'profiles') {
    for (const profile of view.profiles) {
      lines.push(
        '',
        `${profile.name}`,
        `  state: ${profile.kind === 'active-profile' ? 'active' : 'inactive'}`,
        `  provider: ${profile.subagentProvider}`,
        `  model route: ${routeText(profile.route)}`,
        `  default mode: ${profile.defaultMode}`,
        `  allowed modes: ${profile.allowedModes.length === 0 ? '<none>' : profile.allowedModes.join(', ')}`,
        `  result: ${profile.resultContract}`,
      )
      if (profile.kind === 'inactive-profile') {
        lines.push(`  reasons: ${profile.diagnosticCodes.join(', ') || '<none>'}`)
      }
    }
  }

  if (view.diagnostics.length > 0) {
    lines.push('', 'Diagnostics:')
    for (const diagnostic of view.diagnostics) {
      lines.push(
        `${diagnostic.severity === 'error' ? 'ERROR' : 'WARN '} ${diagnostic.code} [${diagnostic.profile}]`,
        `      ${diagnostic.message}`,
      )
    }
  }
  lines.push('', `Result: ${view.summary.status}`)
  return lines.join('\n') + '\n'
}
