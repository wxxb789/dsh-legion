import { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import {
  ArtifactDigest, ContextDigest, ContinuationId, EnvironmentDigest, Fence,
  GoalVersion, PlanVersion, RunId, type OwnerFingerprint,
} from '../src/durable-run/contract.ts'
import {
  consumeBeforeEffects, consumeContinuation, invalidateContinuation,
  issueContinuation, validateContinuation,
  type IssueContinuationInput, type ResumeContext,
} from '../src/durable-run/continuation.ts'
import { createAuthorityEnvelope } from '../src/durable-run/plan-delta.ts'

const digest = (character: string) => ArtifactDigest('sha256:' + character.repeat(64))
const owner: OwnerFingerprint = {
  hostInstanceId: 'host', processBootId: 'boot', pluginGeneration: 'plugin',
  anchorSessionId: 'session-one', activationId: 'activation',
}
const authority = createAuthorityEnvelope({
  profiles: { default: {
    members: ['worker'], tools: ['read', 'write'], providers: ['provider'],
    models: ['model'], routes: ['route'], effectClasses: ['read', 'idempotent-write'],
  } }, maxDepth: 2, allowGoalRevision: false,
})
const reducedAuthority = createAuthorityEnvelope({
  profiles: { default: {
    members: ['worker'], tools: ['read'], providers: ['provider'], models: ['model'],
    routes: ['route'], effectClasses: ['read'],
  } }, maxDepth: 1, allowGoalRevision: false,
})
const source: IssueContinuationInput = {
  continuationId: ContinuationId('continuation-one'), runId: RunId('run-one'),
  anchorSessionId: SessionId('session-one'), owner, fence: Fence(2),
  planVersion: PlanVersion(1), goalVersion: GoalVersion(1),
  contextDigest: ContextDigest(digest('b')),
  environmentDigest: EnvironmentDigest(digest('c')),
  expectedInputs: [digest('d')],
  limits: { activations: 3, attempts: 4, tokens: 100, cost: 10 },
  authority, issuedAt: 10, expiresAt: 20,
}
const issued = issueContinuation(source)
const current: ResumeContext = {
  runId: source.runId, anchorSessionId: source.anchorSessionId, owner,
  fence: source.fence, planVersion: source.planVersion, goalVersion: source.goalVersion,
  contextDigest: ContextDigest(digest('b')), environmentDigest: source.environmentDigest,
  availableInputs: [digest('d')],
  limits: { activations: 2, attempts: 3, tokens: 80, cost: 8 },
  authority: reducedAuthority, now: 15,
}

describe('durable continuation', () => {
  it('issues immutable deterministic data and ignores untrusted extra fields', () => {
    const again = issueContinuation({ ...source, rogue: 'ignored' } as never)
    expect(again.token.digest).toBe(issued.token.digest)
    expect(again.token).not.toHaveProperty('rogue')
    expect(Object.isFrozen(issued.token)).toBe(true)
    expect(validateContinuation(issued, current)).toMatchObject({
      kind: 'resumable', authority: reducedAuthority,
    })
  })

  it('detects tampering, expiry, and authority expansion', () => {
    const tampered = { ...issued, token: { ...issued.token, fence: Fence(3) } }
    expect(validateContinuation(tampered, current))
      .toEqual({ kind: 'reject', reason: 'digest-mismatch' })
    expect(validateContinuation(issued, { ...current, now: 20 }))
      .toEqual({ kind: 'reject', reason: 'expired' })
    const expanded = createAuthorityEnvelope({
      profiles: { ...authority.profiles, admin: {
        members: ['admin'], tools: ['admin'], providers: ['provider'],
        models: ['model'], routes: ['route'], effectClasses: ['non-idempotent-write'],
      } }, maxDepth: 3, allowGoalRevision: true,
    })
    expect(validateContinuation(issued, { ...current, authority: expanded }))
      .toEqual({ kind: 'reject', reason: 'authority-expansion' })
  })

  it('returns replan for incompatible environment and inputs', () => {
    expect(validateContinuation(issued, {
      ...current, environmentDigest: EnvironmentDigest(digest('e')),
    })).toEqual({ kind: 'replan', reason: 'environment-incompatible' })
    expect(validateContinuation(issued, { ...current, availableInputs: [] }))
      .toEqual({ kind: 'replan', reason: 'inputs-incompatible' })
  })

  it('consumes exactly once and supports explicit invalidation', () => {
    const consumed = consumeContinuation(issued, current)
    expect(validateContinuation(consumed, current))
      .toEqual({ kind: 'reject', reason: 'consumed' })
    const invalid = invalidateContinuation(issued, 'plan-changed', 16)
    expect(validateContinuation(invalid, current))
      .toEqual({ kind: 'reject', reason: 'invalidated' })
  })

  it('commits and flushes consumption before effects', async () => {
    const calls: string[] = []
    await consumeBeforeEffects({
      consume() { calls.push('consume') },
      flush() { calls.push('flush'); return true },
      effects() { calls.push('effect') },
    })
    expect(calls).toEqual(['consume', 'flush', 'effect'])
  })

  it('never starts effects when consumption durability fails', async () => {
    const calls: string[] = []
    await expect(consumeBeforeEffects({
      consume() { calls.push('consume') }, flush() { return false },
      effects() { calls.push('effect') },
    })).rejects.toThrow(/DURABILITY_UNAVAILABLE/)
    expect(calls).toEqual(['consume'])
  })
})
