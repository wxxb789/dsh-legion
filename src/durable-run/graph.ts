import type { JsonValue } from '@deepseek-ai/dsh-tools'
import type { ArtifactContract, StrategyLimits } from '../orchestration-contract.ts'
import type { CompiledArtifact, CompiledStrategyPlan, DshPrimitive } from '../orchestration.ts'
import { deepCopy, deepFreeze, sha256Digest } from '../internal/value.ts'
import {
  GoalVersion,
  PlanDigest,
  PlanVersion,
  TaskId,
  type EffectClass,
  type GoalVersion as GoalVersionType,
  type PlanDigest as PlanDigestType,
  type PlanVersion as PlanVersionType,
  type TaskId as TaskIdType,
} from './contract.ts'

export type PlanEdgeReason = 'after' | 'artifact'

export interface PlanEdge {
  readonly from: TaskIdType
  readonly to: TaskIdType
  readonly reason: PlanEdgeReason
  readonly artifact?: string
}

export interface TaskArtifactInput {
  readonly artifact: string
  readonly contract: ArtifactContract
  readonly collection: boolean
  readonly required: boolean
}

export interface TaskArtifactOutput {
  readonly artifact: string
  readonly contract: ArtifactContract
  readonly collection: boolean
}

export interface InvokeTaskSpec {
  readonly kind: 'invoke'
  readonly taskId: TaskIdType
  readonly label: string
  readonly primitive: DshPrimitive
  readonly member: string
  readonly profile: string
  readonly agentCount: number
  readonly inputs: readonly TaskArtifactInput[]
  readonly output: TaskArtifactOutput
  readonly effectClass: EffectClass
  readonly retryPolicy: { readonly kind: 'none' }
  readonly memberFailure: CompiledStrategyPlan['memberFailure']
}

export type TaskSpec = InvokeTaskSpec

export interface PlanGraph {
  readonly schemaVersion: 1
  readonly planVersion: PlanVersionType
  readonly goalVersion: GoalVersionType
  readonly strategy: string
  readonly team: string
  readonly generationId: string
  readonly catalogDigest: string
  readonly objectiveDigest: string
  readonly environmentDigest: string
  readonly nodes: Readonly<Record<string, TaskSpec>>
  readonly edges: readonly PlanEdge[]
  readonly completion: CompiledStrategyPlan['completion']
  readonly limits: Readonly<StrategyLimits>
  readonly digest: PlanDigestType
}

export interface FrontierTaskState {
  readonly status: 'pending' | 'ready' | 'leased' | 'running' | 'suspended' | 'succeeded' | 'failed' | 'cancelled' | 'superseded' | 'blocked'
  readonly generation: number
  readonly attempts: number
}

export interface FrontierArtifact {
  readonly name: string
  readonly contract: ArtifactContract
  readonly collection: boolean
  readonly value: JsonValue
  readonly bytes: number
}

export type TaskWaitingReason =
  | { readonly kind: 'dependency-pending'; readonly taskId: TaskIdType }
  | { readonly kind: 'artifact-missing'; readonly artifact: string }

export type TaskBlockedReason =
  | { readonly kind: 'task-not-pending'; readonly status: FrontierTaskState['status'] }
  | { readonly kind: 'dependency-failed'; readonly taskId: TaskIdType }
  | { readonly kind: 'artifact-mismatch'; readonly artifact: string }
  | { readonly kind: 'attempt-limit' }

export type TaskReadiness =
  | { readonly kind: 'ready' }
  | { readonly kind: 'waiting'; readonly reasons: readonly TaskWaitingReason[] }
  | { readonly kind: 'blocked'; readonly reasons: readonly TaskBlockedReason[] }

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function edgeOrder(left: PlanEdge, right: PlanEdge): number {
  return compareText(String(left.from), String(right.from))
    || compareText(String(left.to), String(right.to))
    || compareText(left.reason, right.reason)
    || compareText(left.artifact ?? '', right.artifact ?? '')
}


function planGraphIdentity(graph: Omit<PlanGraph, 'digest' | 'planVersion'>): unknown {
  return {
    version: 1,
    kind: 'legion-static-plan-graph',
    strategy: graph.strategy,
    team: graph.team,
    generationId: graph.generationId,
    catalogDigest: graph.catalogDigest,
    objectiveDigest: graph.objectiveDigest,
    environmentDigest: graph.environmentDigest,
    nodes: Object.keys(graph.nodes).sort().map(taskId => graph.nodes[taskId]),
    edges: [...graph.edges].sort(edgeOrder),
    completion: graph.completion,
    limits: graph.limits,
  }
}

function plainRecord(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`dsh-legion: ${at} must be a plain object`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`dsh-legion: ${at} must be a plain object`)
  }
  return value as Record<string, unknown>
}

function boundedText(value: unknown, at: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    throw new Error(`dsh-legion: invalid ${at}`)
  }
  return value
}

function positive(value: unknown, at: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`dsh-legion: invalid ${at}`)
  }
  return value as number
}

function environmentDigest(plan: CompiledStrategyPlan, catalogDigest: string): string {
  return sha256Digest({
    version: 1,
    kind: 'legion-static-environment',
    generationId: plan.generationId,
    catalogDigest,
  })
}

function validateAcyclic(taskIds: readonly string[], edges: readonly PlanEdge[]): void {
  const indegree = new Map(taskIds.map(taskId => [taskId, 0]))
  const outgoing = new Map(taskIds.map(taskId => [taskId, [] as string[]]))
  for (const edge of edges) {
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1)
    outgoing.get(edge.from)?.push(edge.to)
  }
  const ready = taskIds.filter(taskId => indegree.get(taskId) === 0).sort()
  let visited = 0
  while (ready.length > 0) {
    const taskId = ready.shift()!
    visited += 1
    for (const successor of outgoing.get(taskId) ?? []) {
      const remaining = (indegree.get(successor) ?? 0) - 1
      indegree.set(successor, remaining)
      if (remaining === 0) {
        ready.push(successor)
        ready.sort()
      }
    }
  }
  if (visited !== taskIds.length) throw new Error('dsh-legion: static PlanGraph contains a cycle')
}

function artifactInput(artifact: CompiledArtifact): TaskArtifactInput {
  return {
    artifact: String(artifact.name),
    contract: artifact.contract,
    collection: artifact.collection,
    required: artifact.availability === 'required',
  }
}

/** Lower one trusted compiled Strategy Plan into a deterministic immutable static DAG. */
export function compileStaticPlanGraph(
  plan: CompiledStrategyPlan,
  catalogDigest: string,
  planVersion: PlanVersionType = PlanVersion(1),
): PlanGraph {
  const taskIds = plan.primitives.map(primitive => primitive.stage).sort()
  const knownTasks = new Set(taskIds)
  const producerByArtifact = new Map<string, string>()
  for (const artifact of Object.values(plan.artifacts)) {
    if (artifact.producer !== undefined) producerByArtifact.set(String(artifact.name), artifact.producer)
  }
  const nodes = Object.fromEntries([...plan.primitives]
    .sort((left, right) => compareText(left.stage, right.stage))
    .map((primitive) => {
      const inputs = primitive.inputs.map((name) => {
        const artifact = plan.artifacts[name]
        if (artifact === undefined) throw new Error(`dsh-legion: static PlanGraph input "${String(name)}" is unknown`)
        return artifactInput(artifact)
      })
      const node: InvokeTaskSpec = {
        kind: 'invoke',
        taskId: TaskId(primitive.stage),
        label: primitive.stage,
        primitive: { ...primitive, after: [...primitive.after].sort() },
        member: String(primitive.member),
        profile: String(primitive.profile),
        agentCount: primitive.kind === 'dsh-subagent-fanout' ? primitive.count : 1,
        inputs,
        output: {
          artifact: String(primitive.output.name),
          contract: primitive.output.contract,
          collection: primitive.output.collection,
        },
        effectClass: 'read',
        retryPolicy: { kind: 'none' },
        memberFailure: plan.memberFailure,
      }
      return [primitive.stage, node]
    }))
  const edgeMap = new Map<string, PlanEdge>()
  const addEdge = (edge: PlanEdge): void => {
    const key = `${String(edge.from)}\0${String(edge.to)}\0${edge.reason}\0${edge.artifact ?? ''}`
    edgeMap.set(key, edge)
  }
  for (const primitive of plan.primitives) {
    for (const input of primitive.inputs) {
      const producer = producerByArtifact.get(String(input))
      if (producer !== undefined) addEdge({ from: TaskId(producer), to: TaskId(primitive.stage), reason: 'artifact', artifact: String(input) })
    }
    for (const dependency of primitive.after) {
      if (!knownTasks.has(dependency)) throw new Error(`dsh-legion: stage "${primitive.stage}" has unknown stage dependency "${dependency}"`)
      if (dependency === primitive.stage) throw new Error(`dsh-legion: stage "${primitive.stage}" cannot depend on itself`)
      addEdge({ from: TaskId(dependency), to: TaskId(primitive.stage), reason: 'after' })
    }
  }
  const edges = [...edgeMap.values()].sort(edgeOrder)
  validateAcyclic(taskIds, edges)
  const envDigest = environmentDigest(plan, catalogDigest)
  const graph = {
    schemaVersion: 1 as const,
    goalVersion: GoalVersion(1),
    strategy: String(plan.strategy),
    team: String(plan.team),
    generationId: String(plan.generationId),
    catalogDigest,
    objectiveDigest: plan.objectiveDigest,
    environmentDigest: envDigest,
    nodes,
    edges,
    completion: plan.completion,
    limits: plan.limits,
  }
  return deepFreeze({
    ...graph,
    planVersion,
    digest: PlanDigest(sha256Digest(planGraphIdentity(graph))),
  })
}

/** Construct one immutable next PlanGraph through the same canonical digest path. */
export function evolvePlanGraph(
  base: PlanGraph,
  changes: {
    readonly planVersion: PlanVersionType
    readonly nodes: Readonly<Record<string, TaskSpec>>
    readonly edges: readonly PlanEdge[]
    readonly limits?: Readonly<StrategyLimits>
  },
): PlanGraph {
  const nodes = Object.fromEntries(Object.keys(changes.nodes).sort().map((id) => {
    const taskId = TaskId(id)
    const node = changes.nodes[id]
    if (node === undefined || node.taskId !== taskId) {
      throw new Error(`dsh-legion: PlanGraph node identity mismatch for "${id}"`)
    }
    return [id, deepCopy(node)]
  }))
  const edges = [...changes.edges].sort(edgeOrder)
  validateAcyclic(Object.keys(nodes), edges)
  const limits = changes.limits ?? base.limits
  const graph = {
    schemaVersion: 1 as const,
    goalVersion: base.goalVersion,
    strategy: base.strategy,
    team: base.team,
    generationId: base.generationId,
    catalogDigest: base.catalogDigest,
    objectiveDigest: base.objectiveDigest,
    environmentDigest: base.environmentDigest,
    nodes,
    edges,
    completion: base.completion,
    limits: deepCopy(limits),
  }
  return deepFreeze({
    ...graph,
    planVersion: changes.planVersion,
    digest: PlanDigest(sha256Digest(planGraphIdentity(graph))),
  })
}

/** Validate, detach, and freeze one PlanGraph from a journal/process boundary. */
export function materializePlanGraph(value: unknown): PlanGraph {
  const source = plainRecord(value, 'PlanGraph')
  const allowed = new Set([
    'schemaVersion', 'planVersion', 'goalVersion', 'strategy', 'team',
    'generationId', 'catalogDigest', 'objectiveDigest', 'environmentDigest',
    'nodes', 'edges', 'completion', 'limits', 'digest',
  ])
  if (Object.keys(source).some(key => !allowed.has(key))) {
    throw new Error('dsh-legion: PlanGraph contains unknown fields')
  }
  if (source.schemaVersion !== 1) {
    throw new Error('dsh-legion: unsupported PlanGraph schemaVersion')
  }
  const nodesSource = plainRecord(source.nodes, 'PlanGraph.nodes')
  const taskIds = Object.keys(nodesSource).sort()
  const nodes: Record<string, TaskSpec> = {}
  for (const taskId of taskIds) {
    const identity = TaskId(taskId)
    const node = plainRecord(nodesSource[taskId], `PlanGraph.nodes.${taskId}`)
    if (node.kind !== 'invoke' || node.taskId !== identity) {
      throw new Error(`dsh-legion: invalid PlanGraph node "${taskId}"`)
    }
    positive(node.agentCount, `PlanGraph.nodes.${taskId}.agentCount`)
    nodes[taskId] = deepCopy(node) as unknown as TaskSpec
  }
  if (!Array.isArray(source.edges)) throw new Error('dsh-legion: PlanGraph.edges must be an array')
  const known = new Set(taskIds)
  const edges = source.edges.map((value, index): PlanEdge => {
    const edge = plainRecord(value, `PlanGraph.edges[${index}]`)
    const from = TaskId(edge.from)
    const to = TaskId(edge.to)
    if (!known.has(from) || !known.has(to)) {
      throw new Error('dsh-legion: PlanGraph edge references an unknown task')
    }
    if (edge.reason !== 'after' && edge.reason !== 'artifact') {
      throw new Error('dsh-legion: invalid PlanGraph edge reason')
    }
    if (edge.reason === 'after' && edge.artifact !== undefined) {
      throw new Error('dsh-legion: after edge cannot carry an artifact')
    }
    return {
      from,
      to,
      reason: edge.reason,
      ...(edge.artifact === undefined
        ? {}
        : { artifact: boundedText(edge.artifact, 'PlanGraph edge artifact') }),
    }
  }).sort(edgeOrder)
  validateAcyclic(taskIds, edges)
  const limitsSource = plainRecord(source.limits, 'PlanGraph.limits')
  const limits: StrategyLimits = {
    maxAgents: positive(limitsSource.maxAgents, 'PlanGraph.limits.maxAgents'),
    maxConcurrent: positive(limitsSource.maxConcurrent, 'PlanGraph.limits.maxConcurrent'),
    deadlineMs: positive(limitsSource.deadlineMs, 'PlanGraph.limits.deadlineMs'),
    maxOutputBytes: positive(limitsSource.maxOutputBytes, 'PlanGraph.limits.maxOutputBytes'),
  }
  if (limits.maxConcurrent > limits.maxAgents) {
    throw new Error('dsh-legion: PlanGraph maxConcurrent exceeds maxAgents')
  }
  const completion = plainRecord(source.completion, 'PlanGraph.completion')
  const graph = {
    schemaVersion: 1 as const,
    planVersion: PlanVersion(source.planVersion),
    goalVersion: GoalVersion(source.goalVersion),
    strategy: boundedText(source.strategy, 'PlanGraph.strategy'),
    team: boundedText(source.team, 'PlanGraph.team'),
    generationId: boundedText(source.generationId, 'PlanGraph.generationId'),
    catalogDigest: boundedText(source.catalogDigest, 'PlanGraph.catalogDigest'),
    objectiveDigest: boundedText(source.objectiveDigest, 'PlanGraph.objectiveDigest'),
    environmentDigest: boundedText(source.environmentDigest, 'PlanGraph.environmentDigest'),
    nodes,
    edges,
    completion: deepCopy(completion) as unknown as CompiledStrategyPlan['completion'],
    limits,
  }
  const digest = PlanDigest(source.digest)
  const expected = PlanDigest(sha256Digest(planGraphIdentity(graph)))
  if (digest !== expected) throw new Error('dsh-legion: PlanGraph digest does not match its contents')
  return deepFreeze({ ...graph, digest })
}

/** Explain whether one static task can be admitted from projected facts. */
export function deriveTaskReadiness(
  graph: PlanGraph,
  taskId: TaskIdType,
  tasks: Readonly<Record<string, FrontierTaskState>>,
  artifacts: Readonly<Record<string, FrontierArtifact>>,
): TaskReadiness {
  const node = graph.nodes[taskId]
  if (node === undefined) throw new Error(`dsh-legion: unknown PlanGraph task "${String(taskId)}"`)
  const state = tasks[taskId]
  if (state === undefined) return deepFreeze({ kind: 'waiting', reasons: [{ kind: 'dependency-pending', taskId }] })
  if (state.status !== 'pending') return deepFreeze({ kind: 'blocked', reasons: [{ kind: 'task-not-pending', status: state.status }] })
  if (state.attempts >= 1) return deepFreeze({ kind: 'blocked', reasons: [{ kind: 'attempt-limit' }] })
  const waiting: TaskWaitingReason[] = []
  const blocked: TaskBlockedReason[] = []
  for (const edge of graph.edges.filter(candidate => candidate.to === taskId)) {
    const dependency = tasks[edge.from]
    if (dependency?.status === 'failed' || dependency?.status === 'cancelled' || dependency?.status === 'blocked') {
      blocked.push({ kind: 'dependency-failed', taskId: edge.from })
    } else if (dependency?.status !== 'succeeded') {
      waiting.push({ kind: 'dependency-pending', taskId: edge.from })
    }
  }
  for (const input of node.inputs) {
    if (input.artifact === 'objective') continue
    const artifact = artifacts[input.artifact]
    if (artifact === undefined) {
      if (input.required) waiting.push({ kind: 'artifact-missing', artifact: input.artifact })
    } else if (artifact.contract !== input.contract || artifact.collection !== input.collection) {
      blocked.push({ kind: 'artifact-mismatch', artifact: input.artifact })
    }
  }
  if (blocked.length > 0) return deepFreeze({ kind: 'blocked', reasons: blocked })
  if (waiting.length > 0) return deepFreeze({ kind: 'waiting', reasons: waiting })
  return deepFreeze({ kind: 'ready' })
}

/** Return the canonical TaskId-ordered frontier for one static graph. */
export function deriveReadyFrontier(
  graph: PlanGraph,
  tasks: Readonly<Record<string, FrontierTaskState>>,
  artifacts: Readonly<Record<string, FrontierArtifact>>,
): readonly TaskIdType[] {
  return deepFreeze(Object.keys(graph.nodes)
    .sort()
    .map(TaskId)
    .filter(taskId => deriveTaskReadiness(graph, taskId, tasks, artifacts).kind === 'ready'))
}
