import { PROFILE_NAME } from './config.ts'

declare const legionBrand: unique symbol
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/

type Brand<Value, Name extends string> = Value & { readonly [legionBrand]: Name }

export type ProfileName = Brand<string, 'ProfileName'>
export type PolicyDigest = Brand<`sha256:${string}`, 'PolicyDigest'>
export type CatalogDigest = Brand<`sha256:${string}`, 'CatalogDigest'>
export type ResourceDigest = Brand<`sha256:${string}`, 'ResourceDigest'>

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
