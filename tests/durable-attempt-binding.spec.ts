import { describe, expect, it } from 'vitest'
import { PolicyDigest, ProfileName } from '../src/identity.ts'
import { compileRoutePlan } from '../src/route.ts'
import {
  AttemptId, ContextDigest, ContextGeneration, Fence,
  PlanVersion, RunId, TaskId,
} from '../src/durable-run/contract.ts'
import {
  assertAttemptStart, createAttemptBinding, planCrossRouteRecovery,
} from '../src/durable-run/attempt-binding.ts'
import { createEnvironmentSnapshot } from '../src/durable-run/environment.ts'

const digest = (value: string) => 'sha256:' + value.repeat(64)
const profile = {
  name: ProfileName('deep'),
  routes: [{ id: 'route-one', provider: 'provider', model: 'model' }],
} as never
const route = compileRoutePlan(profile, PolicyDigest(digest('a')), {
  facts: [{ kind: 'resolved', routeId: 'route-one', provider: 'provider', model: 'model' }],
})
if (route.kind !== 'selected-route-plan') throw new Error('invalid route fixture')
const environment = createEnvironmentSnapshot({
  generation: 2, capturedAt: 1, cwdIdentity: digest('b'),
  availableSubagentProviders: ['subagent'], profileCapabilityFacts: {}, routeFacts: {},
  toolsetDigests: { deep: digest('c') }, hostLimits: {}, hostCapabilities: {},
})
const binding = createAttemptBinding({
  runId: RunId('run-one'), planVersion: PlanVersion(1), taskId: TaskId('task-one'),
  attemptId: AttemptId('attempt-one'), generation: 1, fence: Fence(2),
  memberSlot: 'worker', profile: 'deep', profileDigest: digest('d'), routePlan: route,
  environment, contextGeneration: ContextGeneration(4),
  contextManifestDigest: ContextDigest(digest('e')),
  sharedPrefixDigest: ContextDigest(digest('f')), toolsetDigest: digest('c'),
  routeReservation: { kind: 'unavailable' },
})

describe('attempt binding', () => {
  it('freezes one exact route/context/environment identity and allows one start', () => {
    expect(binding.routeReservation.kind).toBe('unavailable')
    expect(binding.environmentDigest).toBe(environment.digest)
    const started = assertAttemptStart(binding, { bindingDigest: binding.bindingDigest, starts: 0 })
    expect(started.starts).toBe(1)
    expect(() => assertAttemptStart(binding, started)).toThrow(/one child/i)
    expect(() => assertAttemptStart(
      { ...binding, profile: 'tampered' },
      { bindingDigest: binding.bindingDigest, starts: 0 },
    )).toThrow(/binding digest/i)
  })
  it('rejects Profile/Route mismatch before publication', () => {
    expect(() => createAttemptBinding({
      ...binding, profile: 'other', environment, routeReservation: { kind: 'unavailable' },
    })).toThrow(/disagree/)
  })
  it('forbids same-attempt cross-route switching without a unified seam', () => {
    expect(planCrossRouteRecovery({
      oldAttemptId: AttemptId('attempt-one'), oldGeneration: 1,
      unifiedRecoveryAvailable: false,
    })).toEqual({ kind: 'settle-no-retry', diagnostic: 'LEGION_CROSS_ROUTE_SWITCH_FORBIDDEN' })
    expect(planCrossRouteRecovery({
      oldAttemptId: AttemptId('attempt-one'), oldGeneration: 1,
      unifiedRecoveryAvailable: true,
    })).toEqual({
      kind: 'retry-new-generation', oldAttemptId: AttemptId('attempt-one'), generation: 2,
    })
  })
})
