import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { deepCopy, deepFreeze, sha256Digest } from '../internal/value.ts'
import {
  ArtifactDigest,
  type AuthorityEnvelope,
  type ContextDigest,
  type EnvironmentDigest,
  type Fence,
  type GoalVersion,
  type OwnerFingerprint,
  type PlanVersion,
  type RunId,
  type ContinuationInvalidationReason,
  type ContinuationRecord,
  type ContinuationToken,
} from './contract.ts'
import { isAuthoritySubset } from './plan-delta.ts'

export type ContinuationLimits = Readonly<Record<string, number>>

export interface ResumeContext {
  readonly runId: RunId
  readonly anchorSessionId: SessionId
  readonly owner: OwnerFingerprint
  readonly fence: Fence
  readonly planVersion: PlanVersion
  readonly goalVersion: GoalVersion
  readonly contextDigest?: ContextDigest
  readonly environmentDigest: EnvironmentDigest
  readonly availableInputs: readonly ArtifactDigest[]
  readonly limits: ContinuationLimits
  readonly authority: AuthorityEnvelope
  readonly now: number
}

export type ContinuationDecision =
  | { readonly kind: 'resumable'; readonly token: ContinuationToken; readonly authority: AuthorityEnvelope; readonly limits: ContinuationLimits }
  | { readonly kind: 'replan'; readonly reason: 'environment-incompatible' | 'plan-incompatible' | 'goal-incompatible' | 'context-incompatible' | 'inputs-incompatible' }
  | { readonly kind: 'reject'; readonly reason: 'malformed' | 'digest-mismatch' | 'consumed' | 'invalidated' | 'expired' | 'identity-mismatch' | 'owner-mismatch' | 'stale-fence' | 'authority-expansion' | 'limits-expanded' }

function sameOwner(a: OwnerFingerprint, b: OwnerFingerprint): boolean {
  return a.hostInstanceId === b.hostInstanceId && a.processBootId === b.processBootId
    && a.pluginGeneration === b.pluginGeneration && a.anchorSessionId === b.anchorSessionId
    && a.activationId === b.activationId
}

function validLimits(value: Readonly<Record<string, number>>): boolean {
  return Object.values(value).every(item => Number.isFinite(item) && item >= 0)
}

function subset(candidate: readonly string[], granted: readonly string[]): boolean {
  const available = new Set(granted)
  return candidate.every(item => available.has(item))
}

function limitsNarrower(
  candidate: Readonly<Record<string, number>>,
  ceiling: Readonly<Record<string, number>>,
): boolean {
  return Object.entries(candidate).every(([key, value]) =>
    ceiling[key] !== undefined && value <= ceiling[key]!)
}

function identity(token: Omit<ContinuationToken, 'digest'>): Omit<ContinuationToken, 'digest'> {
  return token
}

export function continuationDigest(token: Omit<ContinuationToken, 'digest'>): ArtifactDigest {
  return ArtifactDigest(sha256Digest({ kind: 'legion-continuation', token: identity(token) }))
}

export type IssueContinuationInput = Omit<
  ContinuationToken,
  'schemaVersion' | 'digest' | 'authorityDigest'
>

/** Issue detached immutable continuation data; persistence and flush remain caller-owned. */
export function issueContinuation(input: IssueContinuationInput): ContinuationRecord {
  if (!validLimits(input.limits) || input.expiresAt !== undefined && input.expiresAt <= input.issuedAt) {
    throw new Error('dsh-legion: invalid continuation bounds')
  }
  const expectedInputs = [...new Set(input.expectedInputs)].sort()
  const unsigned: Omit<ContinuationToken, 'digest'> = deepCopy({
    schemaVersion: 1,
    continuationId: input.continuationId,
    runId: input.runId,
    anchorSessionId: input.anchorSessionId,
    owner: input.owner,
    fence: input.fence,
    planVersion: input.planVersion,
    goalVersion: input.goalVersion,
    ...(input.contextDigest === undefined ? {} : { contextDigest: input.contextDigest }),
    environmentDigest: input.environmentDigest,
    expectedInputs,
    limits: input.limits,
    authority: input.authority,
    authorityDigest: input.authority.digest,
    issuedAt: input.issuedAt,
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
  })
  const token = deepFreeze({ ...unsigned, digest: continuationDigest(unsigned) })
  return deepFreeze({ schemaVersion: 1 as const, continuationId: token.continuationId, token, status: 'available' as const, updatedAt: input.issuedAt })
}

/** Revalidate all durable bindings without mutating continuation state. */
export function validateContinuation(state: ContinuationRecord, current: ResumeContext): ContinuationDecision {
  const token = state.token
  if (token.schemaVersion !== 1 || !validLimits(token.limits)) return { kind: 'reject', reason: 'malformed' }
  const { digest: _digest, ...unsigned } = token
  if (continuationDigest(unsigned) !== token.digest) return { kind: 'reject', reason: 'digest-mismatch' }
  if (state.status === 'consumed') return { kind: 'reject', reason: 'consumed' }
  if (state.status === 'invalidated') return { kind: 'reject', reason: 'invalidated' }
  if (token.expiresAt !== undefined && current.now >= token.expiresAt) return { kind: 'reject', reason: 'expired' }
  if (token.runId !== current.runId || token.anchorSessionId !== current.anchorSessionId) return { kind: 'reject', reason: 'identity-mismatch' }
  if (!sameOwner(token.owner, current.owner)) return { kind: 'reject', reason: 'owner-mismatch' }
  if (token.fence !== current.fence) return { kind: 'reject', reason: 'stale-fence' }
  if (token.planVersion !== current.planVersion) return { kind: 'replan', reason: 'plan-incompatible' }
  if (token.goalVersion !== current.goalVersion) return { kind: 'replan', reason: 'goal-incompatible' }
  if (token.contextDigest !== current.contextDigest) return { kind: 'replan', reason: 'context-incompatible' }
  if (token.environmentDigest !== current.environmentDigest) return { kind: 'replan', reason: 'environment-incompatible' }
  if (!subset(token.expectedInputs, current.availableInputs)) return { kind: 'replan', reason: 'inputs-incompatible' }
  if (token.authority.digest !== token.authorityDigest
    || !isAuthoritySubset(current.authority, token.authority)) {
    return { kind: 'reject', reason: 'authority-expansion' }
  }
  if (!limitsNarrower(current.limits, token.limits)) return { kind: 'reject', reason: 'limits-expanded' }
  return deepFreeze({
    kind: 'resumable' as const,
    token,
    authority: deepCopy(current.authority),
    limits: deepCopy(current.limits),
  })
}

export function consumeContinuation(state: ContinuationRecord, current: ResumeContext): ContinuationRecord {
  const decision = validateContinuation(state, current)
  if (decision.kind !== 'resumable') throw new Error(`dsh-legion: continuation not resumable (${decision.reason})`)
  return deepFreeze({ schemaVersion: 1 as const, continuationId: state.token.continuationId, token: state.token, status: 'consumed' as const, consumedAt: current.now, consumingFence: current.fence, updatedAt: current.now })
}

export function invalidateContinuation(state: ContinuationRecord, reason: ContinuationInvalidationReason, now: number): ContinuationRecord {
  if (state.status !== 'available') throw new Error('dsh-legion: only available continuations can be invalidated')
  if (!reason || !Number.isSafeInteger(now) || now < state.updatedAt) throw new Error('dsh-legion: invalid continuation invalidation')
  return deepFreeze({ schemaVersion: 1 as const, continuationId: state.token.continuationId, token: state.token, status: 'invalidated' as const, invalidatedAt: now, reason, updatedAt: now })
}

/** Enforce consume append and authoritative flush before any resumed effect. */
export async function consumeBeforeEffects<Value>(steps: {
  readonly consume: () => void | Promise<void>
  readonly flush: () => boolean | Promise<boolean>
  readonly effects: () => Value | Promise<Value>
}): Promise<Value> {
  await steps.consume()
  if (!await steps.flush()) throw new Error('dsh-legion: DURABILITY_UNAVAILABLE')
  return steps.effects()
}
