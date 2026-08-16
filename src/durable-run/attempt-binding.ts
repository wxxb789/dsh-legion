import { ProfileName, RoutePlanDigest } from '../identity.ts'
import type { SelectedRoutePlan } from '../route.ts'
import { deepCopy, deepFreeze, sha256Digest } from '../internal/value.ts'
import {
  AttemptId, ContextDigest, ContextGeneration, EnvironmentDigest,
  Fence, PlanVersion, RunId, TaskId,
  type AttemptId as AttemptIdType,
  type ContextDigest as ContextDigestType,
  type ContextGeneration as ContextGenerationType,
  type EnvironmentDigest as EnvironmentDigestType,
  type Fence as FenceType,
  type PlanVersion as PlanVersionType,
  type RunId as RunIdType,
  type TaskId as TaskIdType,
} from './contract.ts'
import type { EnvironmentSnapshot } from './environment.ts'

export type RouteReservation =
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'receipt'; readonly reservationId: string; readonly expiresAt?: number }
export interface AttemptBinding {
  readonly schemaVersion: 1
  readonly runId: RunIdType
  readonly planVersion: PlanVersionType
  readonly taskId: TaskIdType
  readonly attemptId: AttemptIdType
  readonly generation: number
  readonly fence: FenceType
  readonly memberSlot: string
  readonly profile: string
  readonly profileDigest: string
  readonly routePlan: SelectedRoutePlan
  readonly routePlanDigest: RoutePlanDigest
  readonly routeReservation: RouteReservation
  readonly environmentGeneration: number
  readonly environmentDigest: EnvironmentDigestType
  readonly contextGeneration: ContextGenerationType
  readonly contextManifestDigest: ContextDigestType
  readonly sharedPrefixDigest: ContextDigestType
  readonly toolsetDigest: string
  readonly bindingDigest: string
}
export type CreateAttemptBindingInput = Omit<
  AttemptBinding,
  'schemaVersion' | 'routePlanDigest' | 'environmentGeneration'
  | 'environmentDigest' | 'bindingDigest'
> & { readonly environment: EnvironmentSnapshot }
const DIGEST = /^sha256:[a-f0-9]{64}$/
function digestInput(input: Omit<AttemptBinding, 'bindingDigest'>): unknown {
  return { kind: 'legion-attempt-binding', ...input }
}
function boundedText(value: string, name: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw new Error('dsh-legion: invalid attempt ' + name)
  }
}
export function createAttemptBinding(input: CreateAttemptBindingInput): AttemptBinding {
  if (!Number.isSafeInteger(input.generation) || input.generation < 1) {
    throw new Error('dsh-legion: invalid attempt generation')
  }
  if (input.routePlan.kind !== 'selected-route-plan') {
    throw new Error('dsh-legion: attempt requires one selected Route Plan')
  }
  if (input.routePlan.profile !== input.profile) {
    throw new Error('dsh-legion: attempt Profile and Route Plan disagree')
  }
  boundedText(input.memberSlot, 'memberSlot')
  boundedText(input.profile, 'profile')
  if (!DIGEST.test(input.profileDigest) || !DIGEST.test(input.toolsetDigest)) {
    throw new Error('dsh-legion: invalid attempt policy digest')
  }
  if (input.routeReservation.kind === 'receipt') {
    boundedText(input.routeReservation.reservationId, 'route reservation')
    if (input.routeReservation.expiresAt !== undefined
      && (!Number.isSafeInteger(input.routeReservation.expiresAt)
        || input.routeReservation.expiresAt < 0)) {
      throw new Error('dsh-legion: invalid route reservation expiry')
    }
  }
  const identity: Omit<AttemptBinding, 'bindingDigest'> = {
    schemaVersion: 1,
    runId: input.runId,
    planVersion: input.planVersion,
    taskId: input.taskId,
    attemptId: input.attemptId,
    generation: input.generation,
    fence: input.fence,
    memberSlot: input.memberSlot,
    profile: input.profile,
    profileDigest: input.profileDigest,
    routePlan: deepCopy(input.routePlan),
    routePlanDigest: input.routePlan.planDigest,
    routeReservation: deepCopy(input.routeReservation),
    environmentGeneration: input.environment.generation,
    environmentDigest: input.environment.digest,
    contextGeneration: input.contextGeneration,
    contextManifestDigest: input.contextManifestDigest,
    sharedPrefixDigest: input.sharedPrefixDigest,
    toolsetDigest: input.toolsetDigest,
  }
  return deepFreeze({
    ...identity,
    bindingDigest: sha256Digest(digestInput(identity)),
  })
}
export interface AttemptStartState { readonly bindingDigest: string; readonly starts: number }
export function assertAttemptStart(
  binding: AttemptBinding,
  state: AttemptStartState,
): AttemptStartState {
  const { bindingDigest: _digest, ...identity } = binding
  const expected = sha256Digest(digestInput(identity))
  if (binding.bindingDigest !== expected || state.bindingDigest !== binding.bindingDigest) {
    throw new Error('dsh-legion: attempt binding digest mismatch')
  }
  if (state.starts !== 0) throw new Error('dsh-legion: one child may start per attempt')
  return deepFreeze({ bindingDigest: binding.bindingDigest, starts: 1 })
}
export type CrossRouteRecoveryDecision =
  | { readonly kind: 'settle-no-retry'; readonly diagnostic: 'LEGION_CROSS_ROUTE_SWITCH_FORBIDDEN' }
  | { readonly kind: 'retry-new-generation'; readonly oldAttemptId: AttemptIdType; readonly generation: number }

const BINDING_FIELDS = [
  'schemaVersion', 'runId', 'planVersion', 'taskId', 'attemptId', 'generation',
  'fence', 'memberSlot', 'profile', 'profileDigest', 'routePlan', 'routePlanDigest',
  'routeReservation', 'environmentGeneration', 'environmentDigest',
  'contextGeneration', 'contextManifestDigest', 'sharedPrefixDigest',
  'toolsetDigest', 'bindingDigest',
] as const
function plain(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error('dsh-legion: invalid ' + name)
  }
  return value as Record<string, unknown>
}
export function materializeAttemptBinding(value: unknown): AttemptBinding {
  const source = plain(value, 'attempt binding')
  if (Object.keys(source).some(key => !BINDING_FIELDS.includes(key as never))
    || BINDING_FIELDS.some(key => !Object.hasOwn(source, key))) {
    throw new Error('dsh-legion: invalid attempt binding fields')
  }
  const binding = deepCopy(value) as AttemptBinding
  RunId(binding.runId)
  PlanVersion(binding.planVersion)
  TaskId(binding.taskId)
  AttemptId(binding.attemptId)
  Fence(binding.fence)
  ProfileName(binding.profile)
  RoutePlanDigest(binding.routePlanDigest)
  EnvironmentDigest(binding.environmentDigest)
  ContextGeneration(binding.contextGeneration)
  ContextDigest(binding.contextManifestDigest)
  ContextDigest(binding.sharedPrefixDigest)
  if (!Number.isSafeInteger(binding.generation) || binding.generation < 1
    || !Number.isSafeInteger(binding.environmentGeneration)
    || binding.environmentGeneration < 1) {
    throw new Error('dsh-legion: invalid attempt binding generation')
  }
  boundedText(binding.memberSlot, 'memberSlot')
  if (!DIGEST.test(binding.profileDigest) || !DIGEST.test(binding.toolsetDigest)) {
    throw new Error('dsh-legion: invalid attempt binding digest field')
  }
  const reservation = plain(binding.routeReservation, 'route reservation')
  const reservationFields = binding.routeReservation.kind === 'receipt'
    ? ['kind', 'reservationId', 'expiresAt']
    : ['kind']
  if (Object.keys(reservation).some(key => !reservationFields.includes(key))
    || binding.schemaVersion !== 1
    || binding.routePlan.kind !== 'selected-route-plan'
    || binding.routePlan.profile !== binding.profile
    || binding.routePlan.planDigest !== binding.routePlanDigest) {
    throw new Error('dsh-legion: invalid attempt binding')
  }
  const { bindingDigest, ...identity } = binding
  if (bindingDigest !== sha256Digest(digestInput(identity))) {
    throw new Error('dsh-legion: attempt binding digest mismatch')
  }
  return deepFreeze(binding)
}

export function planCrossRouteRecovery(input: {
  readonly oldAttemptId: AttemptIdType
  readonly oldGeneration: number
  readonly unifiedRecoveryAvailable: boolean
}): CrossRouteRecoveryDecision {
  if (!Number.isSafeInteger(input.oldGeneration) || input.oldGeneration < 1) {
    throw new Error('dsh-legion: invalid recovery generation')
  }
  return input.unifiedRecoveryAvailable
    ? deepFreeze({
        kind: 'retry-new-generation',
        oldAttemptId: input.oldAttemptId,
        generation: input.oldGeneration + 1,
      })
    : deepFreeze({
        kind: 'settle-no-retry',
        diagnostic: 'LEGION_CROSS_ROUTE_SWITCH_FORBIDDEN',
      })
}
