import { PROFILE_NAME } from './config.ts'

declare const legionBrand: unique symbol
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/
// The serialized prefix remains stable for the public v1 result contract.
const COHORT_RUN_ID = /^team-run-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

type Brand<Value, Name extends string> = Value & { readonly [legionBrand]: Name }

export type SpecialistName = Brand<string, 'SpecialistName'>
export type PolicyDigest = Brand<`sha256:${string}`, 'PolicyDigest'>
export type CatalogDigest = Brand<`sha256:${string}`, 'CatalogDigest'>
export type ResourceDigest = Brand<`sha256:${string}`, 'ResourceDigest'>
export type RoutePlanDigest = Brand<`sha256:${string}`, 'RoutePlanDigest'>
export type CohortName = Brand<string, 'CohortName'>
export type StrategyName = Brand<string, 'StrategyName'>
export type MemberSlotName = Brand<string, 'MemberSlotName'>
export type ArtifactName = Brand<string, 'ArtifactName'>
export type StrategyPlanDigest = Brand<`sha256:${string}`, 'StrategyPlanDigest'>
export type StrategyGenerationId = Brand<`sha256:${string}`, 'StrategyGenerationId'>
export type CohortRunId = Brand<string, 'CohortRunId'>

/** Validate and brand one Specialist identity. */
export function SpecialistName(value: string): SpecialistName {
  if (!PROFILE_NAME.test(value)) {
    throw new Error(`dsh-legion: specialist name "${value}" must match ${String(PROFILE_NAME)}`)
  }
  return value as SpecialistName
}

/** Brand one internally computed policy digest. */
export function PolicyDigest(value: string): PolicyDigest {
  if (!SHA256_DIGEST.test(value)) throw new Error('dsh-legion: invalid policy digest')
  return value as PolicyDigest
}

/** Brand one internally computed runtime catalog digest. */
export function CatalogDigest(value: string): CatalogDigest {
  if (!SHA256_DIGEST.test(value)) throw new Error('dsh-legion: invalid catalog digest')
  return value as CatalogDigest
}

/** Brand one internally computed Specialist-resource digest. */
export function ResourceDigest(value: string): ResourceDigest {
  if (!SHA256_DIGEST.test(value)) throw new Error('dsh-legion: invalid resource digest')
  return value as ResourceDigest
}

/** Brand one internally computed exact route-plan digest. */
export function RoutePlanDigest(value: string): RoutePlanDigest {
  if (!SHA256_DIGEST.test(value)) throw new Error('dsh-legion: invalid route-plan digest')
  return value as RoutePlanDigest
}

function namedIdentity<Name extends string>(value: string, kind: Name): Brand<string, Name> {
  if (!PROFILE_NAME.test(value)) {
    throw new Error(`dsh-legion: invalid ${kind} "${value}"`)
  }
  return value as Brand<string, Name>
}

export function CohortName(value: string): CohortName {
  return namedIdentity(value, 'CohortName')
}

export function StrategyName(value: string): StrategyName {
  return namedIdentity(value, 'StrategyName')
}

export function MemberSlotName(value: string): MemberSlotName {
  return namedIdentity(value, 'MemberSlotName')
}

export function ArtifactName(value: string): ArtifactName {
  return namedIdentity(value, 'ArtifactName')
}

export function StrategyGenerationId(value: string): StrategyGenerationId {
  if (!SHA256_DIGEST.test(value)) throw new Error('dsh-legion: invalid Strategy generation identity')
  return value as StrategyGenerationId
}

export function CohortRunId(value: string): CohortRunId {
  if (!COHORT_RUN_ID.test(value)) throw new Error('dsh-legion: invalid Cohort Run identity')
  return value as CohortRunId
}

export function StrategyPlanDigest(value: string): StrategyPlanDigest {
  if (!SHA256_DIGEST.test(value)) throw new Error('dsh-legion: invalid strategy-plan digest')
  return value as StrategyPlanDigest
}

/** @deprecated Use SpecialistName internally. */
export type ProfileName = SpecialistName
/** @deprecated Use SpecialistName internally. */
export function ProfileName(value: string): ProfileName {
  if (!PROFILE_NAME.test(value)) {
    throw new Error(`dsh-legion: profile name "${value}" must match ${String(PROFILE_NAME)}`)
  }
  return value as ProfileName
}

/** @deprecated Use CohortName internally. */
export type TeamName = CohortName
/** @deprecated Use CohortName internally. */
export function TeamName(value: string): TeamName {
  if (!PROFILE_NAME.test(value)) throw new Error(`dsh-legion: invalid TeamName "${value}"`)
  return value as TeamName
}

/** @deprecated Use CohortRunId internally. */
export type TeamRunId = CohortRunId
/** @deprecated Use CohortRunId internally. */
export function TeamRunId(value: string): TeamRunId {
  if (!COHORT_RUN_ID.test(value)) throw new Error('dsh-legion: invalid Team Run identity')
  return value as TeamRunId
}
