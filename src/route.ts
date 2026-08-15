import { createHash } from 'node:crypto'
import type { LlmResolvedModelInfo, LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { RouteCandidate } from './config.ts'
import type { DelegationPlan, EffectiveProfile } from './compiler.ts'
import {
  RoutePlanDigest,
  type PolicyDigest,
  type ProfileName,
  type RoutePlanDigest as RoutePlanDigestType,
} from './identity.ts'

export type ExactModelFact =
  | {
      readonly kind: 'adapter-missing'
      readonly routeId: string
      readonly provider: string
      readonly model: string
    }
  | {
      readonly kind: 'resolved'
      readonly routeId: string
      readonly provider: string
      readonly model: string
      readonly contextWindow?: number
      readonly defaultMaxTokens?: number
      readonly reasoningEfforts?: readonly string[]
    }
  | {
      readonly kind: 'rejected'
      readonly routeId: string
      readonly provider: string
      readonly model: string
      readonly errorCode: string
    }
  | {
      readonly kind: 'metadata-unknown'
      readonly routeId: string
      readonly provider: string
      readonly model: string
      readonly errorCode?: string
    }

export interface ModelFactsObservations {
  readonly facts: readonly ExactModelFact[]
}

export type RouteRejectCode =
  | 'ADAPTER_MISSING'
  | 'MODEL_RESOLUTION_REJECTED'
  | 'CONTEXT_CAPACITY_TOO_SMALL'
  | 'EFFECTIVE_OUTPUT_BUDGET_TOO_SMALL'

export type RouteUnknownCode =
  | 'MODEL_METADATA_UNAVAILABLE'
  | 'CONTEXT_CAPACITY_UNKNOWN'
  | 'EFFECTIVE_OUTPUT_BUDGET_UNKNOWN'

export type EffectiveOutputBudget =
  | { readonly kind: 'explicit'; readonly tokens: number }
  | { readonly kind: 'adapter-default'; readonly tokens: number }
  | { readonly kind: 'unknown' }

export type MetadataUnknownCause =
  | { readonly kind: 'error-code'; readonly code: string }
  | { readonly kind: 'unclassified' }

export interface RouteEvidence {
  readonly modelResolution: 'resolved' | 'unknown'
  readonly contextWindow?: number
  readonly outputBudget: EffectiveOutputBudget
  readonly reasoningEfforts?: readonly string[]
  readonly metadataUnknownCause?: MetadataUnknownCause
  readonly unknowns: readonly RouteUnknownCode[]
}

export type RouteDecision =
  | {
      readonly kind: 'rejected'
      readonly index: number
      readonly candidate: Readonly<RouteCandidate>
      readonly reasons: readonly RouteRejectCode[]
    }
  | {
      readonly kind: 'selected'
      readonly index: number
      readonly candidate: Readonly<RouteCandidate>
      readonly evidence: RouteEvidence
    }
  | {
      readonly kind: 'skipped'
      readonly index: number
      readonly candidate: Readonly<RouteCandidate>
      readonly reason: 'HIGHER_PRIORITY_SELECTED'
    }

interface RoutePlanBase {
  readonly version: 1
  readonly profile: ProfileName
  readonly policyDigest: PolicyDigest
  readonly planDigest: RoutePlanDigestType
  readonly liveAvailability: {
    readonly auth: 'unknown'
    readonly quota: 'unknown'
    readonly health: 'unknown'
  }
  readonly decisions: readonly RouteDecision[]
}

export interface SelectedRoutePlan extends RoutePlanBase {
  readonly kind: 'selected-route-plan'
  readonly selected: {
    readonly index: number
    readonly id: string
    readonly provider: string
    readonly model: string
    readonly maxTokens?: number
    readonly maxTokensSource?: 'explicit' | 'adapter-default'
    readonly maxTokensScope?: 'initial-activation'
    readonly instructions?: string
  }
}

export interface UnroutableRoutePlan extends RoutePlanBase {
  readonly kind: 'unroutable-route-plan'
}

export type RoutePlan = SelectedRoutePlan | UnroutableRoutePlan
export type RoutableProfile = EffectiveProfile & {
  readonly routes: NonNullable<EffectiveProfile['routes']>
}

export class RoutePlanError extends Error {
  readonly plan: UnroutableRoutePlan

  constructor(plan: UnroutableRoutePlan) {
    const rejected = plan.decisions
      .filter((decision): decision is Extract<RouteDecision, { kind: 'rejected' }> => decision.kind === 'rejected')
      .map(decision => `${decision.candidate.id}=[${decision.reasons.join(',')}]`)
      .join('; ')
    super(
      `dsh-legion: no exact model route passed static preflight for profile "${plan.profile}"`
      + `${rejected.length === 0 ? '' : `: ${rejected}`}`,
    )
    this.name = 'RoutePlanError'
    this.plan = plan
  }
}

function deepFreeze<Value>(value: Value): Value {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}

function candidateCopy(candidate: RouteCandidate): Readonly<RouteCandidate> {
  const constraints = candidate.constraints === undefined
    ? undefined
    : {
        ...candidate.constraints.minContextTokens === undefined
          ? {}
          : { minContextTokens: candidate.constraints.minContextTokens },
        ...candidate.constraints.minEffectiveOutputTokens === undefined
          ? {}
          : {
              minEffectiveOutputTokens:
                candidate.constraints.minEffectiveOutputTokens,
            },
      }
  return deepFreeze({
    id: candidate.id,
    provider: candidate.provider,
    model: candidate.model,
    ...candidate.maxTokens === undefined ? {} : { maxTokens: candidate.maxTokens },
    ...constraints === undefined ? {} : { constraints },
    ...candidate.instructions === undefined ? {} : { instructions: candidate.instructions },
  })
}

function planDigest(value: unknown): RoutePlanDigestType {
  return RoutePlanDigest(
    `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`,
  )
}

function resolvedFact(route: RouteCandidate, info: LlmResolvedModelInfo): ExactModelFact {
  return deepFreeze({
    kind: 'resolved' as const,
    routeId: route.id,
    provider: route.provider,
    model: route.model,
    ...info.context === undefined ? {} : { contextWindow: info.context.contextWindow },
    ...info.defaultMaxTokens === undefined ? {} : { defaultMaxTokens: info.defaultMaxTokens },
    ...info.reasoning === undefined
      ? {}
      : { reasoningEfforts: info.reasoning.efforts.map(effort => String(effort.id)) },
  })
}

const EXACT_MODEL_REJECTION_CODES = new Set(['UNKNOWN_MODEL'])
const INVALID_METADATA_CODES = new Set([
  'INVALID_MODEL_INFO',
  'INVALID_MODEL_CONTEXT',
  'INVALID_MODEL_MAX_TOKENS',
  'INVALID_MODEL_REASONING',
])
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_-]{0,63}$/

/** Snapshot exact-route metadata without treating catalog absence as rejection or probing live health. */
export async function observeModelRoutes(
  llm: LlmRuntime | undefined,
  routes: readonly RouteCandidate[],
  signal?: AbortSignal,
): Promise<ModelFactsObservations> {
  const registered = new Set(llm?.listProviders().map(provider => provider.id) ?? [])
  const facts = await Promise.all(routes.map(async (route): Promise<ExactModelFact> => {
    signal?.throwIfAborted()
    if (llm === undefined || !registered.has(route.provider)) {
      return deepFreeze({
        kind: 'adapter-missing',
        routeId: route.id,
        provider: route.provider,
        model: route.model,
      })
    }
    try {
      const info = await llm.resolveModelInfo(route.provider, route.model, signal)
      signal?.throwIfAborted()
      return resolvedFact(route, info)
    } catch (error: unknown) {
      signal?.throwIfAborted()
      const code = typeof (error as { code?: unknown } | null)?.code === 'string'
        ? (error as { code: string }).code
        : undefined
      if (code === 'NO_ADAPTER') {
        return deepFreeze({
          kind: 'adapter-missing',
          routeId: route.id,
          provider: route.provider,
          model: route.model,
        })
      }
      if (code !== undefined && INVALID_METADATA_CODES.has(code)) throw error
      if (code !== undefined && EXACT_MODEL_REJECTION_CODES.has(code)) {
        return deepFreeze({
          kind: 'rejected',
          routeId: route.id,
          provider: route.provider,
          model: route.model,
          errorCode: code,
        })
      }
      return deepFreeze({
        kind: 'metadata-unknown',
        routeId: route.id,
        provider: route.provider,
        model: route.model,
        ...code !== undefined && SAFE_ERROR_CODE.test(code) ? { errorCode: code } : {},
      })
    }
  }))
  return deepFreeze({ facts })
}

function plainRecord(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== 'object'
    || value === null
    || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error(`dsh-legion: ${at} must be a plain object`)
  }
  return value as Record<string, unknown>
}

function assertKeys(record: Record<string, unknown>, allowed: readonly string[], at: string): void {
  const known = new Set(allowed)
  const unknown = Object.keys(record).filter(key => !known.has(key))
  if (unknown.length > 0) {
    throw new Error(`dsh-legion: ${at} contains unknown field(s): ${unknown.sort().join(', ')}`)
  }
}

function boundedErrorCode(value: unknown, at: string, optional = false): string | undefined {
  if (value === undefined && optional) return undefined
  if (typeof value !== 'string' || !SAFE_ERROR_CODE.test(value)) {
    throw new Error(`dsh-legion: ${at} must be a bounded machine error code`)
  }
  return value
}

/** Runtime-validate, leaf-project, and freeze exact-model observations. */
export function materializeModelFactsObservations(
  value: unknown,
  routes: readonly RouteCandidate[],
): ModelFactsObservations {
  const envelope = plainRecord(value, 'model facts snapshot')
  assertKeys(envelope, ['facts'], 'model facts snapshot')
  if (!Array.isArray(envelope.facts) || envelope.facts.length !== routes.length) {
    throw new Error('dsh-legion: model facts must contain exactly one observation per route')
  }
  const seen = new Set<string>()
  const facts = envelope.facts.map((input, index): ExactModelFact => {
    const route = routes[index]!
    const source = plainRecord(input, `model facts[${String(index)}]`)
    const kind = source.kind
    if (typeof source.routeId !== 'string'
      || source.routeId !== route.id
      || typeof source.provider !== 'string'
      || source.provider !== route.provider
      || typeof source.model !== 'string'
      || source.model !== route.model
      || seen.has(source.routeId)) {
      throw new Error(`dsh-legion: model facts do not match route "${route.id}" at index ${String(index)}`)
    }
    seen.add(source.routeId)
    const identity = { routeId: route.id, provider: route.provider, model: route.model }
    switch (kind) {
      case 'adapter-missing':
        assertKeys(source, ['kind', 'routeId', 'provider', 'model'], `model facts[${String(index)}]`)
        return deepFreeze({ kind, ...identity })
      case 'rejected': {
        assertKeys(
          source,
          ['kind', 'routeId', 'provider', 'model', 'errorCode'],
          `model facts[${String(index)}]`,
        )
        const errorCode = boundedErrorCode(
          source.errorCode,
          `model facts[${String(index)}].errorCode`,
        )
        if (errorCode === undefined || !EXACT_MODEL_REJECTION_CODES.has(errorCode)) {
          throw new Error(`dsh-legion: unsupported exact-model rejection code "${errorCode}"`)
        }
        return deepFreeze({ kind, ...identity, errorCode })
      }
      case 'metadata-unknown': {
        assertKeys(
          source,
          ['kind', 'routeId', 'provider', 'model', 'errorCode'],
          `model facts[${String(index)}]`,
        )
        const errorCode = boundedErrorCode(
          source.errorCode,
          `model facts[${String(index)}].errorCode`,
          true,
        )
        return deepFreeze({ kind, ...identity, ...errorCode === undefined ? {} : { errorCode } })
      }
      case 'resolved': {
        assertKeys(
          source,
          [
            'kind', 'routeId', 'provider', 'model', 'contextWindow', 'defaultMaxTokens',
            'reasoningEfforts',
          ],
          `model facts[${String(index)}]`,
        )
        const contextWindow = source.contextWindow
        if (contextWindow !== undefined
          && (!Number.isSafeInteger(contextWindow) || (contextWindow as number) < 1)) {
          throw new Error(`dsh-legion: invalid context metadata for route "${route.id}"`)
        }
        const defaultMaxTokens = source.defaultMaxTokens
        if (defaultMaxTokens !== undefined
          && (!Number.isSafeInteger(defaultMaxTokens) || (defaultMaxTokens as number) < 1)) {
          throw new Error(`dsh-legion: invalid output metadata for route "${route.id}"`)
        }
        const reasoningEfforts = source.reasoningEfforts
        if (reasoningEfforts !== undefined
          && (!Array.isArray(reasoningEfforts)
            || reasoningEfforts.length === 0
            || reasoningEfforts.some(effort => typeof effort !== 'string' || effort.length === 0 || effort.length > 128)
            || new Set(reasoningEfforts).size !== reasoningEfforts.length)) {
          throw new Error(`dsh-legion: invalid reasoning metadata for route "${route.id}"`)
        }
        return deepFreeze({
          kind,
          ...identity,
          ...contextWindow === undefined ? {} : { contextWindow: contextWindow as number },
          ...defaultMaxTokens === undefined ? {} : { defaultMaxTokens: defaultMaxTokens as number },
          ...reasoningEfforts === undefined
            ? {}
            : { reasoningEfforts: (reasoningEfforts as string[]).map(String) },
        })
      }
      default:
        throw new Error(`dsh-legion: unknown model fact kind at index ${String(index)}`)
    }
  })
  return deepFreeze({ facts })
}

function factFor(route: RouteCandidate, facts: ModelFactsObservations): ExactModelFact {
  const fact = facts.facts.find(item => item.routeId === route.id)
  if (fact === undefined || fact.provider !== route.provider || fact.model !== route.model) {
    throw new Error(`dsh-legion: model facts do not match route "${route.id}"`)
  }
  return fact
}

function effectiveOutputBudget(route: RouteCandidate, fact: ExactModelFact): EffectiveOutputBudget {
  if (route.maxTokens !== undefined) return { kind: 'explicit', tokens: route.maxTokens }
  if (fact.kind === 'resolved' && fact.defaultMaxTokens !== undefined) {
    return { kind: 'adapter-default', tokens: fact.defaultMaxTokens }
  }
  return { kind: 'unknown' }
}

function rejectReasons(route: RouteCandidate, fact: ExactModelFact): RouteRejectCode[] {
  if (fact.kind === 'adapter-missing') return ['ADAPTER_MISSING']
  if (fact.kind === 'rejected') return ['MODEL_RESOLUTION_REJECTED']
  if (fact.kind === 'metadata-unknown') return []
  const reasons: RouteRejectCode[] = []
  if (route.constraints?.minContextTokens !== undefined
    && fact.contextWindow !== undefined
    && fact.contextWindow < route.constraints.minContextTokens) {
    reasons.push('CONTEXT_CAPACITY_TOO_SMALL')
  }
  const outputBudget = effectiveOutputBudget(route, fact)
  if (route.constraints?.minEffectiveOutputTokens !== undefined
    && outputBudget.kind !== 'unknown'
    && outputBudget.tokens < route.constraints.minEffectiveOutputTokens) {
    reasons.push('EFFECTIVE_OUTPUT_BUDGET_TOO_SMALL')
  }
  return reasons
}

function evidence(route: RouteCandidate, fact: ExactModelFact): RouteEvidence {
  const unknowns: RouteUnknownCode[] = []
  if (fact.kind === 'metadata-unknown') unknowns.push('MODEL_METADATA_UNAVAILABLE')
  if (route.constraints?.minContextTokens !== undefined
    && (fact.kind !== 'resolved' || fact.contextWindow === undefined)) {
    unknowns.push('CONTEXT_CAPACITY_UNKNOWN')
  }
  const outputBudget = effectiveOutputBudget(route, fact)
  if (route.constraints?.minEffectiveOutputTokens !== undefined && outputBudget.kind === 'unknown') {
    unknowns.push('EFFECTIVE_OUTPUT_BUDGET_UNKNOWN')
  }
  const metadataUnknownCause: MetadataUnknownCause | undefined = fact.kind !== 'metadata-unknown'
    ? undefined
    : fact.errorCode === undefined
      ? { kind: 'unclassified' }
      : { kind: 'error-code', code: fact.errorCode }
  return deepFreeze({
    modelResolution: fact.kind === 'resolved' ? 'resolved' as const : 'unknown' as const,
    ...fact.kind !== 'resolved' || fact.contextWindow === undefined
      ? {}
      : { contextWindow: fact.contextWindow },
    outputBudget,
    ...fact.kind !== 'resolved' || fact.reasoningEfforts === undefined
      ? {}
      : { reasoningEfforts: [...fact.reasoningEfforts] },
    ...metadataUnknownCause === undefined ? {} : { metadataUnknownCause },
    unknowns,
  })
}

/** Select the first candidate without a known static contradiction; unknown metadata remains admissible. */
export function compileRoutePlan(
  profile: RoutableProfile,
  policyDigest: PolicyDigest,
  facts: ModelFactsObservations,
): RoutePlan {
  const routes = profile.routes
  if (routes.length === 0 || routes.length > 8) {
    throw new Error('dsh-legion: route planner requires between 1 and 8 candidates')
  }
  const observed = materializeModelFactsObservations(facts, routes)
  let selected: { index: number; candidate: Readonly<RouteCandidate>; evidence: RouteEvidence } | undefined
  const decisions: RouteDecision[] = routes.map((route, index) => {
    const candidate = candidateCopy(route)
    if (selected !== undefined) {
      return deepFreeze({ kind: 'skipped', index, candidate, reason: 'HIGHER_PRIORITY_SELECTED' as const })
    }
    const fact = factFor(route, observed)
    const reasons = rejectReasons(route, fact)
    if (reasons.length > 0) return deepFreeze({ kind: 'rejected', index, candidate, reasons })
    const routeEvidence = evidence(route, fact)
    selected = { index, candidate, evidence: routeEvidence }
    return deepFreeze({ kind: 'selected', index, candidate, evidence: routeEvidence })
  })
  const selectedRoute = selected === undefined
    ? undefined
    : {
        index: selected.index,
        id: selected.candidate.id,
        provider: selected.candidate.provider,
        model: selected.candidate.model,
        ...selected.evidence.outputBudget.kind === 'unknown'
          ? {}
          : {
              maxTokens: selected.evidence.outputBudget.tokens,
              maxTokensSource: selected.evidence.outputBudget.kind,
              maxTokensScope: 'initial-activation' as const,
            },
        ...selected.candidate.instructions === undefined ? {} : { instructions: selected.candidate.instructions },
      }
  const liveAvailability = {
    auth: 'unknown' as const,
    quota: 'unknown' as const,
    health: 'unknown' as const,
  }
  const identity = {
    version: 1,
    kind: selectedRoute === undefined ? 'unroutable-route-plan' : 'selected-route-plan',
    profile: profile.name,
    policyDigest,
    liveAvailability,
    decisions,
    ...selectedRoute === undefined ? {} : { selected: selectedRoute },
  }
  const base = {
    version: 1 as const,
    profile: profile.name,
    policyDigest,
    planDigest: planDigest(identity),
    liveAvailability,
    decisions,
  }
  if (selectedRoute === undefined) return deepFreeze({ ...base, kind: 'unroutable-route-plan' as const })
  return deepFreeze({
    ...base,
    kind: 'selected-route-plan' as const,
    selected: selectedRoute,
  })
}

function assertSelectedRoutePlan(routePlan: SelectedRoutePlan): void {
  RoutePlanDigest(routePlan.planDigest)
  const identity = {
    version: routePlan.version,
    kind: routePlan.kind,
    profile: routePlan.profile,
    policyDigest: routePlan.policyDigest,
    liveAvailability: routePlan.liveAvailability,
    decisions: routePlan.decisions,
    selected: routePlan.selected,
  }
  if (routePlan.liveAvailability.auth !== 'unknown'
    || routePlan.liveAvailability.quota !== 'unknown'
    || routePlan.liveAvailability.health !== 'unknown'
    || planDigest(identity) !== routePlan.planDigest) {
    throw new Error('dsh-legion: selected Route Plan digest does not match its decision')
  }
  const selectedDecisions = routePlan.decisions.filter(
    (decision): decision is Extract<RouteDecision, { kind: 'selected' }> => decision.kind === 'selected',
  )
  const selectedDecision = selectedDecisions[0]
  if (selectedDecisions.length !== 1
    || selectedDecision === undefined
    || routePlan.decisions.some((decision, index) => decision.index !== index)
    || selectedDecision.index !== routePlan.selected.index
    || selectedDecision.candidate.id !== routePlan.selected.id
    || selectedDecision.candidate.provider !== routePlan.selected.provider
    || selectedDecision.candidate.model !== routePlan.selected.model
    || selectedDecision.candidate.instructions !== routePlan.selected.instructions) {
    throw new Error('dsh-legion: selected Route Plan disagrees with its candidate decision')
  }
  const budget = selectedDecision.evidence.outputBudget
  if (budget.kind === 'unknown') {
    if (routePlan.selected.maxTokens !== undefined
      || routePlan.selected.maxTokensSource !== undefined
      || routePlan.selected.maxTokensScope !== undefined) {
      throw new Error('dsh-legion: selected Route Plan invents an unknown output budget')
    }
  } else if (routePlan.selected.maxTokens !== budget.tokens
    || routePlan.selected.maxTokensSource !== budget.kind
    || routePlan.selected.maxTokensScope !== 'initial-activation') {
    throw new Error('dsh-legion: selected Route Plan output budget disagrees with its evidence')
  }
}

/** Apply one already-frozen selected route to a detached delegation plan. */
export function applyRoutePlan(plan: DelegationPlan, routePlan: SelectedRoutePlan): DelegationPlan {
  assertSelectedRoutePlan(routePlan)
  if (plan.profile !== routePlan.profile || plan.policyDigest !== routePlan.policyDigest) {
    throw new Error('dsh-legion: route plan does not match delegation plan identity')
  }
  const persona = [plan.persona, routePlan.selected.instructions]
    .filter((value): value is string => value !== undefined && value.length > 0)
    .join('\n\n') || undefined
  return deepFreeze({
    ...plan,
    agentOptions: {
      provider: routePlan.selected.provider,
      model: routePlan.selected.model,
      ...routePlan.selected.maxTokens === undefined ? {} : { maxTokens: routePlan.selected.maxTokens },
    },
    ...persona === undefined ? {} : { persona },
    routePlan,
  })
}
