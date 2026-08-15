import { PROFILE_NAME } from './config.ts'

declare const legionBrand: unique symbol
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/

type Brand<Value, Name extends string> = Value & { readonly [legionBrand]: Name }

export type ProfileName = Brand<string, 'ProfileName'>
export type PolicyDigest = Brand<`sha256:${string}`, 'PolicyDigest'>
export type CatalogDigest = Brand<`sha256:${string}`, 'CatalogDigest'>
export type ResourceDigest = Brand<`sha256:${string}`, 'ResourceDigest'>
export type RoutePlanDigest = Brand<`sha256:${string}`, 'RoutePlanDigest'>
export type TeamName = Brand<string, 'TeamName'>
export type StrategyName = Brand<string, 'StrategyName'>
export type MemberSlotName = Brand<string, 'MemberSlotName'>
export type ArtifactName = Brand<string, 'ArtifactName'>
export type StrategyPlanDigest = Brand<`sha256:${string}`, 'StrategyPlanDigest'>

/** Validate and brand one public profile identity. */
export function ProfileName(value: string): ProfileName {
  if (!PROFILE_NAME.test(value)) {
    throw new Error(`dsh-legion: profile name "${value}" must match ${String(PROFILE_NAME)}`)
  }
  return value as ProfileName
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

/** Brand one internally computed profile-resource digest. */
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

export function TeamName(value: string): TeamName {
  return namedIdentity(value, 'TeamName')
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

export function StrategyPlanDigest(value: string): StrategyPlanDigest {
  if (!SHA256_DIGEST.test(value)) throw new Error('dsh-legion: invalid strategy-plan digest')
  return value as StrategyPlanDigest
}
