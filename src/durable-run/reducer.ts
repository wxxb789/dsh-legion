import { deepFreeze, sha256Digest } from '../internal/value.ts'
import {
  ArtifactDigest, TaskId,
  type ArtifactDigest as Digest,
  type TaskId as Task,
} from './contract.ts'

export interface ReductionNode {
  readonly id: Task
  readonly level: number
  readonly sourceTaskIds: readonly Task[]
  readonly children: readonly Task[]
}
export interface ReductionTree {
  readonly levels: readonly (readonly ReductionNode[])[]
  readonly root: ReductionNode
}
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0 }
export function buildReductionTree(
  source: readonly Task[],
  bounds: { readonly maxInputs: number },
): ReductionTree {
  if (!Number.isSafeInteger(bounds.maxInputs) || bounds.maxInputs < 2) {
    throw new Error('dsh-legion: reducer maxInputs must be at least two')
  }
  const sources = [...new Set(source)].sort(compare)
  if (sources.length === 0) throw new Error('dsh-legion: reducer requires sources')
  let current: ReductionNode[] = sources.map(id => ({
    id, sourceTaskIds: [id], level: 0, children: [],
  }))
  const levels: ReductionNode[][] = []
  let level = 1
  while (current.length > 1) {
    const next: ReductionNode[] = []
    for (let index = 0; index < current.length; index += bounds.maxInputs) {
      const children = current.slice(index, index + bounds.maxInputs)
      const sourceTaskIds = [...new Set(children.flatMap(child => child.sourceTaskIds))]
        .sort(compare)
      next.push({
        id: TaskId('reducer-' + level + '-' + String(next.length + 1)),
        level,
        sourceTaskIds,
        children: children.map(child => child.id),
      })
    }
    levels.push(next)
    current = next
    level += 1
  }
  return deepFreeze({ levels, root: current[0]! })
}
export interface ReducerEnvelope {
  readonly schemaVersion: 1
  readonly reducerTaskId: Task
  readonly level: number
  readonly sourceTaskIds: readonly Task[]
  readonly sourceEnvelopeDigests: readonly Digest[]
  readonly summary: string
  readonly consensus: readonly Readonly<Record<string, unknown>>[]
  readonly conflicts: readonly {
    readonly claim: string
    readonly sources: readonly Task[]
    readonly evidence: readonly Digest[]
  }[]
  readonly missing: readonly {
    readonly taskId: Task
    readonly reason: 'failed' | 'cancelled' | 'not-received' | 'stale-rejected'
  }[]
  readonly evidence: readonly Digest[]
  readonly openRisks: readonly string[]
  readonly inputBytes: number
  readonly outputBytes: number
  readonly compressionRatio: number
  readonly digest: Digest
}
function containsRawOutput(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsRawOutput)
  if (typeof value !== 'object' || value === null) return false
  return Object.entries(value).some(([key, child]) =>
    ['transcript', 'rawOutput', 'messages'].includes(key) || containsRawOutput(child))
}
export function createReducerEnvelope(
  input: Omit<ReducerEnvelope, 'schemaVersion' | 'compressionRatio' | 'digest'>,
  bounds: { readonly maxInputBytes: number; readonly maxOutputBytes: number },
): ReducerEnvelope {
  if (input.sourceTaskIds.length === 0) throw new Error('dsh-legion: reducer lineage is empty')
  if (!Number.isSafeInteger(input.inputBytes) || input.inputBytes < 0
    || !Number.isSafeInteger(input.outputBytes) || input.outputBytes < 0
    || input.inputBytes > bounds.maxInputBytes || input.outputBytes > bounds.maxOutputBytes) {
    throw new Error('dsh-legion: invalid reducer byte bounds')
  }
  if (containsRawOutput(input.consensus)) {
    throw new Error('dsh-legion: reducer envelope cannot contain transcripts or raw output')
  }
  const identity = {
    schemaVersion: 1 as const,
    ...input,
    sourceTaskIds: [...new Set(input.sourceTaskIds)].sort(compare),
    sourceEnvelopeDigests: [...new Set(input.sourceEnvelopeDigests)].sort(compare),
    evidence: [...new Set(input.evidence)].sort(compare),
    openRisks: [...new Set(input.openRisks)].sort(compare),
    conflicts: [...input.conflicts].map(conflict => ({
      ...conflict,
      sources: [...new Set(conflict.sources)].sort(compare),
      evidence: [...new Set(conflict.evidence)].sort(compare),
    })).sort((left, right) => compare(left.claim, right.claim)),
    missing: [...input.missing].sort((left, right) => compare(left.taskId, right.taskId)),
  }
  const compressionRatio = input.outputBytes === 0 ? 0 : input.inputBytes / input.outputBytes
  return deepFreeze({
    ...identity,
    compressionRatio,
    digest: ArtifactDigest(sha256Digest({ kind: 'legion-reducer-envelope', ...identity })),
  })
}
