import { createHash } from 'node:crypto'

/** Clone detached plain JSON-like policy data without retaining authored references. */
export function deepCopy<Value>(value: Value): Value {
  if (Array.isArray(value)) return value.map(deepCopy) as Value
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, deepCopy(child)]),
  ) as Value
}

/** Recursively freeze owned detached data. */
export function deepFreeze<Value>(value: Value): Value {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}

/** Canonicalize JSON-like data by sorting keys and dropping undefined fields. */
export function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (typeof value !== 'object' || value === null) return value
  const source = value as Record<string, unknown>
  return Object.fromEntries(Object.keys(source).sort().flatMap(key =>
    source[key] === undefined ? [] : [[key, canonicalValue(source[key])]]))
}

/** Hash one canonical owned value with the public sha256: prefix. */
export function sha256Digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalValue(value))).digest('hex')}`
}
