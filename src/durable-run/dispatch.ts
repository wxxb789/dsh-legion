import { deepFreeze, sha256Digest } from '../internal/value.ts'
import type { AttemptId, TaskId } from './contract.ts'

export interface DispatchItem {
  readonly taskId: TaskId
  readonly attemptId: AttemptId
  readonly provider: string
  readonly model: string
  readonly toolsetDigest: string
  readonly profileDigest: string
  readonly sharedPrefixDigest: string
}
export interface DispatchCompatibility {
  readonly provider: string
  readonly model: string
  readonly toolsetDigest: string
  readonly profileDigest: string
  readonly sharedPrefixDigest: string
}
export interface DispatchGroup {
  readonly key: string
  readonly compatibility: DispatchCompatibility
  readonly items: readonly DispatchItem[]
}
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0 }
function compatibility(item: DispatchItem): DispatchCompatibility {
  return {
    provider: item.provider,
    model: item.model,
    toolsetDigest: item.toolsetDigest,
    profileDigest: item.profileDigest,
    sharedPrefixDigest: item.sharedPrefixDigest,
  }
}
export function dispatchKeyOf(item: DispatchItem): string {
  return sha256Digest({ kind: 'legion-dispatch-prefix', ...compatibility(item) })
}
export function groupDispatches(items: readonly DispatchItem[]): readonly DispatchGroup[] {
  const grouped = new Map<string, DispatchItem[]>()
  for (const item of items) {
    const key = dispatchKeyOf(item)
    grouped.set(key, [...(grouped.get(key) ?? []), item])
  }
  return deepFreeze([...grouped].map(([key, members]) => ({
    key,
    compatibility: compatibility(members[0]!),
    items: [...members].sort((left, right) =>
      compare(left.taskId, right.taskId) || compare(left.attemptId, right.attemptId)),
  })).sort((left, right) => compare(left.key, right.key)))
}
