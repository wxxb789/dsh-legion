import { deepCopy, deepFreeze, sha256Digest } from '../internal/value.ts'
import { EnvironmentDigest, type EnvironmentDigest as EnvironmentDigestType } from './contract.ts'

export type CapabilityObservation =
  | { readonly kind: 'known-supported'; readonly evidence: 'host-service' | 'provider-contract' }
  | { readonly kind: 'known-unsupported'; readonly reason: string }
  | { readonly kind: 'unknown'; readonly reason?: string }
export interface SanitizedRouteObservation {
  readonly provider: string
  readonly model: string
  readonly adapter: CapabilityObservation
  readonly contextTokens?: number | 'unknown'
  readonly outputTokens?: number | 'unknown'
}
export interface EnvironmentSnapshot {
  readonly schemaVersion: 1
  readonly generation: number
  readonly capturedAt: number
  readonly cwdIdentity: string
  readonly availableSubagentProviders: readonly string[]
  readonly profileCapabilityFacts: Readonly<Record<string, Readonly<Record<string, CapabilityObservation>>>>
  readonly routeFacts: Readonly<Record<string, SanitizedRouteObservation>>
  readonly toolsetDigests: Readonly<Record<string, string>>
  readonly hostLimits: Readonly<Record<string, number | 'unknown' | CapabilityObservation>>
  readonly hostCapabilities: Readonly<Record<string, CapabilityObservation>>
  readonly digest: EnvironmentDigestType
}
export interface CreateEnvironmentSnapshotInput {
  readonly generation: number
  readonly capturedAt: number
  readonly cwdIdentity: string
  readonly availableSubagentProviders: readonly string[]
  readonly profileCapabilityFacts: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  readonly routeFacts: Readonly<Record<string, unknown>>
  readonly toolsetDigests: Readonly<Record<string, string>>
  readonly hostLimits: Readonly<Record<string, unknown>>
  readonly hostCapabilities: Readonly<Record<string, unknown>>
}
const DIGEST = /^sha256:[a-f0-9]{64}$/
const SAFE = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/
function natural(value: unknown, name: string, positive = false): number {
  if (!Number.isSafeInteger(value) || (value as number) < (positive ? 1 : 0)) {
    throw new Error('dsh-legion: invalid environment ' + name)
  }
  return value as number
}
function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || !SAFE.test(value)) {
    throw new Error('dsh-legion: invalid environment ' + name)
  }
  return value
}
function plain(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error('dsh-legion: invalid environment ' + name)
  }
  return value as Record<string, unknown>
}
function exact(source: Record<string, unknown>, fields: readonly string[], name: string): void {
  if (Object.keys(source).some(key => !fields.includes(key))) {
    throw new Error('dsh-legion: invalid environment ' + name + ' fields')
  }
}
function capability(value: unknown, name: string): CapabilityObservation {
  let source: Record<string, unknown>
  try {
    source = plain(value, name)
  } catch {
    throw new Error('dsh-legion: invalid environment capability ' + name)
  }
  if (source.kind === 'known-supported'
    && (source.evidence === 'host-service' || source.evidence === 'provider-contract')) {
    exact(source, ['kind', 'evidence'], name)
    return { kind: source.kind, evidence: source.evidence }
  }
  if (source.kind === 'known-unsupported' && typeof source.reason === 'string') {
    exact(source, ['kind', 'reason'], name)
    return { kind: source.kind, reason: text(source.reason, name + '.reason') }
  }
  if (source.kind === 'unknown'
    && (source.reason === undefined || typeof source.reason === 'string')) {
    exact(source, ['kind', 'reason'], name)
    return {
      kind: source.kind,
      ...(source.reason === undefined ? {} : { reason: text(source.reason, name + '.reason') }),
    }
  }
  throw new Error('dsh-legion: invalid environment capability ' + name)
}
function sortedRecord<Value>(
  source: Readonly<Record<string, unknown>>,
  map: (value: unknown, key: string) => Value,
): Readonly<Record<string, Value>> {
  return Object.fromEntries(Object.keys(source).sort().map(key => [
    text(key, 'key'), map(source[key], key),
  ]))
}
export function createEnvironmentSnapshot(input: CreateEnvironmentSnapshotInput): EnvironmentSnapshot {
  natural(input.generation, 'generation', true)
  natural(input.capturedAt, 'capturedAt')
  if (!DIGEST.test(input.cwdIdentity)) {
    throw new Error('dsh-legion: invalid environment cwdIdentity; use an opaque digest')
  }
  const profileCapabilityFacts = sortedRecord(input.profileCapabilityFacts, (facts, profile) =>
    sortedRecord(plain(facts, profile), (value, key) => capability(value, profile + '.' + key)))
  const routeFacts: Readonly<Record<string, SanitizedRouteObservation>> = sortedRecord(
    input.routeFacts,
    (fact, key) => {
      const source = plain(fact, key)
      exact(source, ['provider', 'model', 'adapter', 'contextTokens', 'outputTokens'], key)
      const contextTokens = source.contextTokens === undefined
        ? undefined : source.contextTokens === 'unknown'
          ? 'unknown' as const : natural(source.contextTokens, key + '.contextTokens')
      const outputTokens = source.outputTokens === undefined
        ? undefined : source.outputTokens === 'unknown'
          ? 'unknown' as const : natural(source.outputTokens, key + '.outputTokens')
      return {
        provider: text(source.provider, key + '.provider'),
        model: text(source.model, key + '.model'),
        adapter: capability(source.adapter, key + '.adapter'),
        ...(contextTokens === undefined ? {} : { contextTokens }),
        ...(outputTokens === undefined ? {} : { outputTokens }),
      }
    },
  )
  const toolsetDigests = sortedRecord(input.toolsetDigests, (value, key) => {
    if (typeof value !== 'string' || !DIGEST.test(value)) {
      throw new Error('dsh-legion: invalid toolset digest ' + key)
    }
    return value
  })
  const hostLimits = sortedRecord(input.hostLimits, (value, key) => {
    if (value === 'unknown') return value
    if (typeof value === 'number') return natural(value, key)
    return capability(value, key)
  })
  const hostCapabilities = sortedRecord(input.hostCapabilities, (value, key) =>
    capability(value, key))
  const identity = {
    schemaVersion: 1 as const,
    generation: input.generation,
    cwdIdentity: input.cwdIdentity,
    availableSubagentProviders: [...new Set(input.availableSubagentProviders.map((value, index) =>
      text(value, 'provider[' + index + ']')))].sort(),
    profileCapabilityFacts,
    routeFacts,
    toolsetDigests,
    hostLimits,
    hostCapabilities,
  }
  return deepFreeze({
    ...deepCopy(identity),
    capturedAt: input.capturedAt,
    digest: EnvironmentDigest(sha256Digest({ kind: 'legion-environment', ...identity })),
  })
}
