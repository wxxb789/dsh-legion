import { deepFreeze } from '../internal/value.ts'

export interface MetricsInput {
  readonly nodes: readonly string[]
  readonly edges: readonly (readonly [string, string])[]
  readonly terminalTasks: number
  readonly admissions: readonly { readonly admittedAt: number; readonly releasedAt: number }[]
  readonly parallelismScope?: 'host-global-admitted' | 'per-run-observed'
  readonly coordinatorContextBytes?: number
  readonly reducerInputBytes?: number
  readonly reducerOutputBytes?: number
  readonly evidenceCount?: number
  readonly attemptsStarted?: number
  readonly recoveredAttempts?: number
  readonly rejectedStaleResults?: number
  readonly reclaimedMessages?: number
  readonly acceptedMilestones?: number
  readonly noProgressMilestones?: number
}
export interface RunMetrics {
  readonly totalTasks: number
  readonly terminalTasks: number
  readonly completionRate: number
  readonly criticalSteps: number
  readonly maxObservedParallel: number
  readonly parallelismScope: 'host-global-admitted' | 'per-run-observed'
  readonly coordinatorContextBytes: number
  readonly reducerCompressionRatio: number
  readonly evidenceYieldPerCompletedTask: number
  readonly attemptsStarted: number
  readonly recoveredAttempts: number
  readonly rejectedStaleResults: number
  readonly reclaimedMessages: number
  readonly acceptedMilestones: number
  readonly noProgressMilestones: number
}
function natural(value: number | undefined, name: string): number {
  const resolved = value ?? 0
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new Error('dsh-legion: invalid metric ' + name)
  }
  return resolved
}
function critical(nodes: readonly string[], edges: readonly (readonly [string, string])[]): number {
  const unique = [...new Set(nodes)]
  if (unique.length !== nodes.length) throw new Error('dsh-legion: duplicate metric task')
  const incoming = new Map(unique.map(node => [node, [] as string[]]))
  const outgoing = new Map(unique.map(node => [node, [] as string[]]))
  for (const [from, to] of edges) {
    if (!incoming.has(from) || !incoming.has(to)) {
      throw new Error('dsh-legion: metric edge references unknown task')
    }
    incoming.get(to)!.push(from)
    outgoing.get(from)!.push(to)
  }
  const indegree = new Map([...incoming].map(([node, predecessors]) => [node, predecessors.length]))
  const ready = unique.filter(node => indegree.get(node) === 0).sort()
  const distance = new Map<string, number>()
  let seen = 0
  while (ready.length > 0) {
    const node = ready.shift()!
    seen += 1
    distance.set(node, 1 + Math.max(0, ...incoming.get(node)!.map(parent => distance.get(parent)!)))
    for (const successor of outgoing.get(node)!) {
      indegree.set(successor, indegree.get(successor)! - 1)
      if (indegree.get(successor) === 0) {
        ready.push(successor)
        ready.sort()
      }
    }
  }
  if (seen !== unique.length) throw new Error('dsh-legion: metrics require an acyclic DAG')
  return Math.max(0, ...distance.values())
}
function peak(intervals: MetricsInput['admissions']): number {
  const points = intervals.flatMap((interval) => {
    if (!Number.isSafeInteger(interval.admittedAt)
      || !Number.isSafeInteger(interval.releasedAt)
      || interval.admittedAt < 0
      || interval.releasedAt < interval.admittedAt) {
      throw new Error('dsh-legion: invalid admission interval')
    }
    return [
      { at: interval.admittedAt, delta: 1 },
      { at: interval.releasedAt, delta: -1 },
    ]
  }).sort((left, right) => left.at - right.at || left.delta - right.delta)
  let active = 0
  let maximum = 0
  for (const point of points) {
    active += point.delta
    maximum = Math.max(maximum, active)
  }
  return maximum
}
export function deriveRunMetrics(input: MetricsInput): RunMetrics {
  const totalTasks = input.nodes.length
  const terminalTasks = Math.min(totalTasks, natural(input.terminalTasks, 'terminalTasks'))
  const reducerInputBytes = natural(input.reducerInputBytes, 'reducerInputBytes')
  const reducerOutputBytes = natural(input.reducerOutputBytes, 'reducerOutputBytes')
  return deepFreeze({
    totalTasks,
    terminalTasks,
    completionRate: totalTasks === 0 ? 0 : terminalTasks / totalTasks,
    criticalSteps: critical(input.nodes, input.edges),
    maxObservedParallel: peak(input.admissions),
    parallelismScope: input.parallelismScope ?? 'per-run-observed',
    coordinatorContextBytes: natural(input.coordinatorContextBytes, 'coordinatorContextBytes'),
    reducerCompressionRatio: reducerOutputBytes === 0 ? 0 : reducerInputBytes / reducerOutputBytes,
    evidenceYieldPerCompletedTask: terminalTasks === 0
      ? 0 : natural(input.evidenceCount, 'evidenceCount') / terminalTasks,
    attemptsStarted: natural(input.attemptsStarted, 'attemptsStarted'),
    recoveredAttempts: natural(input.recoveredAttempts, 'recoveredAttempts'),
    rejectedStaleResults: natural(input.rejectedStaleResults, 'rejectedStaleResults'),
    reclaimedMessages: natural(input.reclaimedMessages, 'reclaimedMessages'),
    acceptedMilestones: natural(input.acceptedMilestones, 'acceptedMilestones'),
    noProgressMilestones: natural(input.noProgressMilestones, 'noProgressMilestones'),
  })
}
