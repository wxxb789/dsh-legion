import { createHash } from 'node:crypto'
export { deepFreeze } from '@deepseek-ai/dsh-util-values'

/** Clone detached plain JSON-like policy data without retaining authored references. */
export function deepCopy<Value>(value: Value): Value {
  if (Array.isArray(value)) return value.map(deepCopy) as Value
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, deepCopy(child)]),
  ) as Value
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
