import type { RoutePlanDigest } from '../identity.ts'
import { deepCopy, deepFreeze, sha256Digest } from '../internal/value.ts'
import { ContextDigest } from './contract.ts'
import type {
  ArtifactDigest,
  ArtifactRef,
  ContextDigest as ContextDigestType,
  ContextGeneration,
  RunId,
  TaskId,
} from './contract.ts'

export const CONTEXT_SLOTS = [
  'profile-policy',
  'strategy-policy',
  'shared-run',
  'goal',
  'task',
  'evidence',
  'mail',
] as const
export type ContextSlot = typeof CONTEXT_SLOTS[number]
export type ContextTrust = 'system' | 'user' | 'tool' | 'agent' | 'untrusted-external'
export type ContextPin = 'required' | 'preferred' | 'evictable'

export type ContextFreshness =
  | { readonly kind: 'timeless' }
  | { readonly kind: 'fresh'; readonly observedAt: number; readonly expiresAt?: number }
  | { readonly kind: 'expired'; readonly observedAt: number; readonly expiredAt: number }
export interface ContextPage {
  readonly pageId: string
  readonly digest: ArtifactDigest
  readonly source: ArtifactRef
  readonly slot: ContextSlot
  readonly orderKey: string
  readonly trust: ContextTrust
  readonly freshness: ContextFreshness
  readonly pin: ContextPin
  readonly estimatedTokens: Readonly<Record<string, number | 'unknown'>>
  readonly lineage: readonly ArtifactDigest[]
}
export interface ContextManifest {
  readonly schemaVersion: 1
  readonly generation: ContextGeneration
  readonly runId: RunId
  readonly taskId: TaskId
  readonly profile: string
  readonly routePlanDigest: RoutePlanDigest
  readonly sharedPrefixDigest: ContextDigestType
  readonly sharedPrefixPageCount: number
  readonly pages: readonly ContextPage[]
  readonly totalBytes: number
  readonly totalEstimatedTokens: Readonly<Record<string, number | 'unknown'>>
  readonly digest: ContextDigestType
}
export interface ContextBounds { readonly maxPages: number; readonly maxBytes: number }
export interface CreateContextManifestInput {
  readonly generation: ContextGeneration
  readonly runId: RunId
  readonly taskId: TaskId
  readonly profile: string
  readonly routePlanDigest: RoutePlanDigest
  readonly pages: readonly ContextPage[]
  readonly bounds: ContextBounds
}
export interface EvidenceRevalidation {
  readonly required: boolean
  readonly pageIds: readonly string[]
  readonly reasons: Readonly<Record<string, readonly ('expired' | 'untrusted')[]>>
}

const slotRank = new Map(CONTEXT_SLOTS.map((slot, index) => [slot, index]))
const sharedSlots = new Set<ContextSlot>(['profile-policy', 'strategy-policy', 'shared-run'])

function fail(message: string): never {
  throw new Error(`dsh-legion: context ${message}`)
}
function safeNatural(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${name} must be a non-negative safe integer`)
  return value
}
function boundedText(value: string, name: string, max = 512): string {
  if (typeof value !== 'string' || value.length === 0 || [...value].length > max) fail(`invalid ${name}`)
  return value
}
function codePointCompare(left: string, right: string): number {
  const a = [...left]
  const b = [...right]
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const difference = a[i]!.codePointAt(0)! - b[i]!.codePointAt(0)!
    if (difference !== 0) return difference
  }
  return a.length - b.length
}
function pageOrder(left: ContextPage, right: ContextPage): number {
  return slotRank.get(left.slot)! - slotRank.get(right.slot)!
    || codePointCompare(left.orderKey, right.orderKey)
    || codePointCompare(left.pageId, right.pageId)
    || codePointCompare(left.digest, right.digest)
}
function validatePage(page: ContextPage): ContextPage {
  boundedText(page.pageId, 'pageId', 128)
  boundedText(page.orderKey, 'orderKey')
  if (!slotRank.has(page.slot)) fail('invalid slot')
  if (!['system', 'user', 'tool', 'agent', 'untrusted-external'].includes(page.trust)) fail('invalid trust')
  if (!['required', 'preferred', 'evictable'].includes(page.pin)) fail('invalid pin')
  safeNatural(page.source.byteLength, 'source byteLength')
  if (page.source.digest !== page.digest) fail('page digest must match source digest')
  if (page.freshness.kind !== 'timeless') {
    safeNatural(page.freshness.observedAt, 'observedAt')
    if (page.freshness.kind === 'fresh'
      && page.freshness.expiresAt !== undefined
      && safeNatural(page.freshness.expiresAt, 'expiresAt') < page.freshness.observedAt) {
      fail('expiresAt precedes observedAt')
    }
    if (page.freshness.kind === 'expired'
      && safeNatural(page.freshness.expiredAt, 'expiredAt') < page.freshness.observedAt) {
      fail('expiredAt precedes observedAt')
    }
  }
  if (sharedSlots.has(page.slot) && page.freshness.kind !== 'timeless') {
    fail('shared-prefix pages must be timeless')
  }
  for (const value of Object.values(page.estimatedTokens)) {
    if (value !== 'unknown') safeNatural(value, 'token estimate')
  }
  return deepFreeze(deepCopy(page))
}
function digestSharedPrefix(
  profile: string,
  routePlanDigest: RoutePlanDigest,
  pages: readonly ContextPage[],
): ContextDigestType {
  return ContextDigest(sha256Digest({
    schemaVersion: 1,
    profile,
    routePlanDigest,
    pages,
  }))
}
function freshnessRank(page: ContextPage): number {
  return page.freshness.kind === 'expired' ? 0 : page.freshness.kind === 'fresh' ? 1 : 2
}
function observationTime(page: ContextPage): number {
  return page.freshness.kind === 'timeless'
    ? Number.MAX_SAFE_INTEGER
    : page.freshness.observedAt
}
function optionalEvictionOrder(left: ContextPage, right: ContextPage): number {
  const pinRank = (page: ContextPage): number => page.pin === 'evictable' ? 0 : 1
  return pinRank(left) - pinRank(right)
    || freshnessRank(left) - freshnessRank(right)
    || observationTime(left) - observationTime(right)
    || right.source.byteLength - left.source.byteLength
    || codePointCompare(left.pageId, right.pageId)
}
function tokenTotals(pages: readonly ContextPage[]): Readonly<Record<string, number | 'unknown'>> {
  const keys = [...new Set(pages.flatMap(page => Object.keys(page.estimatedTokens)))]
    .sort(codePointCompare)
  return deepFreeze(Object.fromEntries(keys.map((key) => {
    const values = pages.map(page => page.estimatedTokens[key])
      .filter(value => value !== undefined)
    return [key, values.includes('unknown')
      ? 'unknown'
      : values.reduce<number>((total, value) => total + Number(value), 0)]
  })))
}

/** Build a detached, immutable, canonically ordered bounded context generation. */
export function createContextManifest(input: CreateContextManifestInput): ContextManifest {
  safeNatural(input.generation, 'generation')
  boundedText(input.profile, 'profile', 128)
  const maxPages = safeNatural(input.bounds.maxPages, 'maxPages')
  const maxBytes = safeNatural(input.bounds.maxBytes, 'maxBytes')
  const seen = new Set<string>()
  let pages = input.pages.map(validatePage).sort(pageOrder)
  for (const page of pages) {
    if (seen.has(page.pageId)) fail(`duplicate pageId "${page.pageId}"`)
    seen.add(page.pageId)
  }
  const required = pages.filter(page => page.pin === 'required')
  const requiredBytes = required.reduce((total, page) => total + page.source.byteLength, 0)
  if (required.length > maxPages || requiredBytes > maxBytes) fail('required pages exceed bounds')
  const evictions = pages.filter(page => page.pin !== 'required').sort(optionalEvictionOrder)
  let totalBytes = pages.reduce((total, page) => total + page.source.byteLength, 0)
  for (const page of evictions) {
    if (pages.length <= maxPages && totalBytes <= maxBytes) break
    pages = pages.filter(candidate => candidate.pageId !== page.pageId)
    totalBytes -= page.source.byteLength
  }
  if (pages.length > maxPages || totalBytes > maxBytes) fail('manifest exceeds bounds')
  pages.sort(pageOrder)
  const sharedPages = pages.filter(page => sharedSlots.has(page.slot))
  const sharedPrefixDigest = digestSharedPrefix(
    input.profile,
    input.routePlanDigest,
    sharedPages,
  )
  const totalEstimatedTokens = tokenTotals(pages)
  const identity = {
    schemaVersion: 1 as const,
    generation: input.generation,
    runId: input.runId,
    taskId: input.taskId,
    profile: input.profile,
    routePlanDigest: input.routePlanDigest,
    sharedPrefixDigest,
    sharedPrefixPageCount: sharedPages.length,
    pages,
    totalBytes,
    totalEstimatedTokens,
  }
  return deepFreeze({ ...identity, digest: ContextDigest(sha256Digest(identity)) })
}

/** Conservatively combine derived evidence metadata without losing taint or ancestry. */
export function propagateContextEvidence(
  pages: readonly ContextPage[],
): Pick<ContextPage, 'trust' | 'freshness' | 'lineage'> {
  if (pages.length === 0) fail('cannot propagate empty evidence')
  const trustRank: Record<ContextTrust, number> = {
    system: 0, user: 1, tool: 2, agent: 3, 'untrusted-external': 4,
  }
  const trust = pages.reduce((worst, page) =>
    trustRank[page.trust] > trustRank[worst] ? page.trust : worst,
  'system' as ContextTrust)
  const dynamic = pages.filter(page => page.freshness.kind !== 'timeless')
  const expired = pages.filter(page => page.freshness.kind === 'expired')
  const fresh = pages.filter(page => page.freshness.kind === 'fresh')
  const freshness: ContextFreshness = expired.length > 0
    ? {
        kind: 'expired',
        observedAt: Math.min(...dynamic.map(page =>
          page.freshness.kind === 'timeless' ? 0 : page.freshness.observedAt)),
        expiredAt: Math.min(...expired.map(page =>
          page.freshness.kind === 'expired'
            ? page.freshness.expiredAt
            : Number.MAX_SAFE_INTEGER)),
      }
    : fresh.length > 0
      ? {
          kind: 'fresh',
          observedAt: Math.min(...fresh.map(page =>
            page.freshness.kind === 'fresh' ? page.freshness.observedAt : 0)),
          ...fresh.some(page =>
            page.freshness.kind === 'fresh' && page.freshness.expiresAt !== undefined)
            ? {
                expiresAt: Math.min(...fresh.map(page =>
                  page.freshness.kind === 'fresh'
                    ? page.freshness.expiresAt ?? Number.MAX_SAFE_INTEGER
                    : Number.MAX_SAFE_INTEGER)),
              }
            : {},
        }
      : { kind: 'timeless' }
  const lineage = [...new Set(pages.flatMap(page => [page.digest, ...page.lineage]))]
    .sort(codePointCompare)
  return deepFreeze({ trust, freshness, lineage })
}

/** Identify evidence that must be revalidated before writes or irreversible work. */
export function requiredWriteRevalidation(pages: readonly ContextPage[], now: number): EvidenceRevalidation {
  safeNatural(now, 'revalidation time')
  const reasons: Record<string, readonly ('expired' | 'untrusted')[]> = {}
  for (const page of [...pages].sort(pageOrder)) {
    if (page.slot !== 'evidence' && page.slot !== 'mail') continue
    const pageReasons: ('expired' | 'untrusted')[] = []
    if (page.freshness.kind === 'expired'
      || page.freshness.kind === 'fresh'
      && page.freshness.expiresAt !== undefined
      && page.freshness.expiresAt <= now) {
      pageReasons.push('expired')
    }
    if (page.trust === 'untrusted-external') pageReasons.push('untrusted')
    if (pageReasons.length > 0) reasons[page.pageId] = Object.freeze(pageReasons)
  }
  const pageIds = Object.freeze(Object.keys(reasons).sort(codePointCompare))
  return deepFreeze({ required: pageIds.length > 0, pageIds, reasons })
}
