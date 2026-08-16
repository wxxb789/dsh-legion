import { describe, expect, it } from 'vitest'
import { createEnvironmentSnapshot } from '../src/durable-run/environment.ts'

const digest = (letter: string) => `sha256:${letter.repeat(64)}`

describe('EnvironmentSnapshot', () => {
  it('sanitizes, canonicalizes, freezes, and excludes capture time from the digest', () => {
    const input = {
      generation: 3,
      capturedAt: 100,
      cwdIdentity: digest('a'),
      availableSubagentProviders: ['zeta', 'alpha', 'alpha'],
      profileCapabilityFacts: {
        deep: { structuredOutput: { kind: 'known-supported', evidence: 'provider-contract' } },
      },
      routeFacts: {
        primary: { provider: 'p', model: 'm', adapter: { kind: 'unknown', reason: 'NOT_OBSERVED' } },
      },
      toolsetDigests: { deep: digest('b') },
      hostLimits: { concurrentActivations: { kind: 'unknown', reason: 'NOT_EXPOSED' } },
      hostCapabilities: {
        coordination: { kind: 'known-supported', evidence: 'host-service' },
        globalAdmission: { kind: 'known-unsupported', reason: 'SERVICE_ABSENT' },
        atomicRouteReservation: { kind: 'unknown', reason: 'NOT_EXPOSED' },
      },
    } as const
    const first = createEnvironmentSnapshot(input)
    const second = createEnvironmentSnapshot({ ...input, capturedAt: 999, availableSubagentProviders: ['alpha', 'zeta'] })
    expect(first.availableSubagentProviders).toEqual(['alpha', 'zeta'])
    expect(first.digest).toBe(second.digest)
    expect(Object.isFrozen(first)).toBe(true)
    expect(JSON.stringify(first)).not.toMatch(/credential|secret|Q:\\|repos/i)
  })

  it('rejects absolute path identities and non-three-valued capability facts', () => {
    expect(() => createEnvironmentSnapshot({
      generation: 1, capturedAt: 1, cwdIdentity: 'Q:\\repos\\private',
      availableSubagentProviders: [], profileCapabilityFacts: {}, routeFacts: {},
      toolsetDigests: {}, hostLimits: {}, hostCapabilities: {},
    })).toThrow(/cwdIdentity/)
    expect(() => createEnvironmentSnapshot({
      generation: 1, capturedAt: 1, cwdIdentity: digest('a'),
      availableSubagentProviders: [], profileCapabilityFacts: { x: { y: true } }, routeFacts: {},
      toolsetDigests: {}, hostLimits: {}, hostCapabilities: {},
    })).toThrow(/capability/i)
  })
})
