import type { JsonValue } from '@deepseek-ai/dsh-tools'
import {
  ARTIFACT_CONTRACTS,
  STRATEGY_FANOUT_MAX,
  STRATEGY_LIMIT_MAXIMUMS,
  type ArtifactContract,
  type StrategyLimits,
} from '../orchestration-contract.ts'
import type { CompiledArtifact, CompiledStrategyPlan, DshPrimitive } from '../orchestration.ts'
import { ArtifactName, MemberSlotName, SpecialistName } from '../identity.ts'
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

export type PlanEdge =
  | {
      readonly from: TaskIdType
      readonly to: TaskIdType
      readonly reason: 'after'
      readonly artifact?: never
    }
  | {
      readonly from: TaskIdType
      readonly to: TaskIdType
      readonly reason: 'artifact'
      readonly artifact: string
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

function requiredText(value: unknown, at: string): string {
  if (typeof value !== 'string' || value.length === 0) {
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

function positiveAtMost(value: unknown, maximum: number, at: string): number {
  const output = positive(value, at)
  if (output > maximum) throw new Error(`dsh-legion: invalid ${at}`)
  return output
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  at: string,
): void {
  if (Object.keys(value).some(key => !allowed.includes(key))
    || required.some(key => !Object.hasOwn(value, key))) {
    throw new Error(`dsh-legion: invalid ${at} fields`)
  }
}

function boolean(value: unknown, at: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`dsh-legion: invalid ${at}`)
  return value
}

function artifactContract(value: unknown, at: string): ArtifactContract {
  if (typeof value !== 'string' || !ARTIFACT_CONTRACTS.includes(value as ArtifactContract)) {
    throw new Error(`dsh-legion: invalid ${at}`)
  }
  return value as ArtifactContract
}

function textList(value: unknown, at: string, unique = false): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`dsh-legion: invalid ${at}`)
  const output = value.map((item, index) => requiredText(item, `${at}[${String(index)}]`))
  if (unique && new Set(output).size !== output.length) {
    throw new Error(`dsh-legion: duplicate ${at}`)
  }
  return output
}

function materializeCompiledArtifact(value: unknown, at: string): CompiledArtifact {
  const source = plainRecord(value, at)
  exactKeys(
    source,
    ['name', 'contract', 'collection', 'availability', 'producer'],
    ['name', 'contract', 'collection', 'availability'],
    at,
  )
  const availability = source.availability
  if (availability !== 'required' && availability !== 'degraded' && availability !== 'optional') {
    throw new Error(`dsh-legion: invalid ${at}.availability`)
  }
  return {
    name: ArtifactName(requiredText(source.name, `${at}.name`)),
    contract: artifactContract(source.contract, `${at}.contract`),
    collection: boolean(source.collection, `${at}.collection`),
    availability,
    ...(source.producer === undefined
      ? {}
      : { producer: requiredText(source.producer, `${at}.producer`) }),
  }
}

/** Strictly validate and reconstruct one closed DSH primitive union. */
export function materializeDshPrimitive(value: unknown, at: string): DshPrimitive {
  const source = plainRecord(value, at)
  const common = ['kind', 'stage', 'member', 'specialist', 'profile', 'inputs', 'output', 'prompt', 'after']
  const required = ['kind', 'stage', 'member', 'inputs', 'output', 'prompt', 'after']
  if (source.kind === 'dsh-delegate') {
    exactKeys(source, [...common, 'mode'], [...required, 'mode'], at)
  } else if (source.kind === 'dsh-subagent-fanout') {
    exactKeys(
      source,
      [...common, 'count', 'minSuccess', 'allowDegraded'],
      [...required, 'count', 'minSuccess', 'allowDegraded'],
      at,
    )
  } else {
    throw new Error(`dsh-legion: invalid ${at}.kind`)
  }
  const specialistEnumerable = Object.prototype.propertyIsEnumerable.call(source, 'specialist')
  const profileEnumerable = Object.prototype.propertyIsEnumerable.call(source, 'profile')
  const specialistValue = source.specialist ?? source.profile
  const specialist = SpecialistName(requiredText(specialistValue, `${at}.specialist`))
  if (source.specialist !== undefined && source.profile !== undefined
    && source.specialist !== source.profile) {
    throw new Error(`dsh-legion: ${at} specialist/profile mismatch`)
  }
  const base = {
    stage: requiredText(source.stage, `${at}.stage`),
    member: MemberSlotName(requiredText(source.member, `${at}.member`)),
    specialist,
    profile: specialist,
    inputs: textList(source.inputs, `${at}.inputs`).map(ArtifactName),
    output: materializeCompiledArtifact(source.output, `${at}.output`),
    prompt: requiredText(source.prompt, `${at}.prompt`),
    after: textList(source.after, `${at}.after`, true),
  }
  let primitive: DshPrimitive
  if (source.kind === 'dsh-delegate') {
    if (source.mode !== 'foreground' && source.mode !== 'continuable') {
      throw new Error(`dsh-legion: invalid ${at}.mode`)
    }
    primitive = { ...base, kind: 'dsh-delegate', mode: source.mode }
  } else {
    primitive = {
      ...base,
      kind: 'dsh-subagent-fanout',
      count: positiveAtMost(source.count, STRATEGY_FANOUT_MAX, `${at}.count`),
      minSuccess: positiveAtMost(source.minSuccess, STRATEGY_FANOUT_MAX, `${at}.minSuccess`),
      allowDegraded: boolean(source.allowDegraded, `${at}.allowDegraded`),
    }
  }
  if (primitive.kind === 'dsh-subagent-fanout'
    && (primitive.minSuccess > primitive.count
      || !primitive.allowDegraded && primitive.minSuccess !== primitive.count)) {
    throw new Error(`dsh-legion: invalid ${at}.minSuccess`)
  }
  if (primitive.output.collection !== (primitive.kind === 'dsh-subagent-fanout')) {
    throw new Error(`dsh-legion: invalid ${at}.output.collection`)
  }
  const expectedAvailability = primitive.kind === 'dsh-subagent-fanout'
    && primitive.allowDegraded
    && primitive.minSuccess < primitive.count
    ? 'degraded'
    : 'required'
  if (primitive.output.availability !== expectedAvailability) {
    throw new Error(`dsh-legion: invalid ${at}.output.availability`)
  }
  if (primitive.output.producer !== undefined
    && primitive.output.producer !== primitive.stage) {
    throw new Error(`dsh-legion: invalid ${at}.output.producer`)
  }
  Object.defineProperty(primitive, 'specialist', {
    value: specialist,
    enumerable: specialistEnumerable,
    configurable: false,
    writable: false,
  })
  Object.defineProperty(primitive, 'profile', {
    value: specialist,
    enumerable: profileEnumerable,
    configurable: false,
    writable: false,
  })
  return deepFreeze(primitive)
}

export type InvokeTaskSpecBody = Omit<InvokeTaskSpec, 'taskId'>

/** Validate and detach one dynamic or persisted invoke-task body. */
export function materializeInvokeTaskSpecBody(value: unknown, at: string): InvokeTaskSpecBody {
  const source = plainRecord(value, at)
  const fields = [
    'kind', 'label', 'primitive', 'member', 'profile', 'agentCount',
    'inputs', 'output', 'effectClass', 'retryPolicy', 'memberFailure',
  ]
  exactKeys(source, fields, fields, at)
  if (source.kind !== 'invoke') throw new Error(`dsh-legion: invalid ${at}.kind`)
  const primitive = materializeDshPrimitive(source.primitive, `${at}.primitive`)
  if (primitive.kind === 'dsh-delegate' && primitive.mode !== 'foreground') {
    throw new Error(`dsh-legion: ${at}.primitive must be foreground in a durable PlanGraph`)
  }
  if (!Array.isArray(source.inputs)) throw new Error(`dsh-legion: invalid ${at}.inputs`)
  const inputs = source.inputs.map((value, index): TaskArtifactInput => {
    const inputAt = `${at}.inputs[${String(index)}]`
    const input = plainRecord(value, inputAt)
    exactKeys(input, ['artifact', 'contract', 'collection', 'required'], ['artifact', 'contract', 'collection', 'required'], inputAt)
    return {
      artifact: ArtifactName(requiredText(input.artifact, `${inputAt}.artifact`)),
      contract: artifactContract(input.contract, `${inputAt}.contract`),
      collection: boolean(input.collection, `${inputAt}.collection`),
      required: boolean(input.required, `${inputAt}.required`),
    }
  })
  for (const input of inputs) {
    if (input.artifact === 'objective'
      && (input.contract !== 'objective-v1' || input.collection || !input.required)) {
      throw new Error(`dsh-legion: invalid ${at}.inputs objective contract`)
    }
  }
  const outputSource = plainRecord(source.output, `${at}.output`)
  exactKeys(outputSource, ['artifact', 'contract', 'collection'], ['artifact', 'contract', 'collection'], `${at}.output`)
  const output: TaskArtifactOutput = {
    artifact: ArtifactName(requiredText(outputSource.artifact, `${at}.output.artifact`)),
    contract: artifactContract(outputSource.contract, `${at}.output.contract`),
    collection: boolean(outputSource.collection, `${at}.output.collection`),
  }
  if (output.artifact === 'objective' || output.contract === 'objective-v1') {
    throw new Error(`dsh-legion: invalid ${at}.output`)
  }
  const retryPolicy = plainRecord(source.retryPolicy, `${at}.retryPolicy`)
  exactKeys(retryPolicy, ['kind'], ['kind'], `${at}.retryPolicy`)
  if (retryPolicy.kind !== 'none') throw new Error(`dsh-legion: invalid ${at}.retryPolicy`)
  if (source.effectClass !== 'read'
    && source.effectClass !== 'idempotent-write'
    && source.effectClass !== 'non-idempotent-write') {
    throw new Error(`dsh-legion: invalid ${at}.effectClass`)
  }
  if (source.memberFailure !== 'fail' && source.memberFailure !== 'allow-partial') {
    throw new Error(`dsh-legion: invalid ${at}.memberFailure`)
  }
  const member = MemberSlotName(requiredText(source.member, `${at}.member`))
  const profile = SpecialistName(requiredText(source.profile, `${at}.profile`))
  const agentCount = positive(source.agentCount, `${at}.agentCount`)
  if (String(primitive.member) !== member
    || String(primitive.specialist) !== profile
    || primitive.output.name !== output.artifact
    || primitive.output.contract !== output.contract
    || primitive.output.collection !== output.collection
    || primitive.inputs.length !== inputs.length
    || primitive.inputs.some((name, index) => name !== inputs[index]?.artifact)
    || agentCount !== (primitive.kind === 'dsh-subagent-fanout' ? primitive.count : 1)) {
    throw new Error(`dsh-legion: ${at} primitive does not match its public task spec`)
  }
  return deepFreeze({
    kind: 'invoke',
    label: requiredText(source.label, `${at}.label`),
    primitive,
    member,
    profile,
    agentCount,
    inputs,
    output,
    effectClass: source.effectClass,
    retryPolicy: { kind: 'none' },
    memberFailure: source.memberFailure,
  })
}

export function materializeStrategyLimits(value: unknown, at = 'limits'): StrategyLimits {
  const source = plainRecord(value, at)
  const fields = ['maxAgents', 'maxConcurrent', 'deadlineMs', 'maxOutputBytes']
  exactKeys(source, fields, fields, at)
  const limits: StrategyLimits = {
    maxAgents: positiveAtMost(source.maxAgents, STRATEGY_LIMIT_MAXIMUMS.maxAgents, `${at}.maxAgents`),
    maxConcurrent: positiveAtMost(
      source.maxConcurrent,
      STRATEGY_LIMIT_MAXIMUMS.maxConcurrent,
      `${at}.maxConcurrent`,
    ),
    deadlineMs: positiveAtMost(source.deadlineMs, STRATEGY_LIMIT_MAXIMUMS.deadlineMs, `${at}.deadlineMs`),
    maxOutputBytes: positiveAtMost(
      source.maxOutputBytes,
      STRATEGY_LIMIT_MAXIMUMS.maxOutputBytes,
      `${at}.maxOutputBytes`,
    ),
  }
  if (limits.maxConcurrent > limits.maxAgents) {
    throw new Error(`dsh-legion: ${at}.maxConcurrent exceeds maxAgents`)
  }
  return limits
}

function materializeCompletion(value: unknown): CompiledStrategyPlan['completion'] {
  const source = plainRecord(value, 'PlanGraph.completion')
  exactKeys(source, ['artifact', 'contract'], ['artifact', 'contract'], 'PlanGraph.completion')
  return {
    artifact: ArtifactName(requiredText(source.artifact, 'PlanGraph.completion.artifact')),
    contract: artifactContract(source.contract, 'PlanGraph.completion.contract'),
  }
}

function validatePlanGraphSemantics(
  nodes: Readonly<Record<string, TaskSpec>>,
  edges: readonly PlanEdge[],
  completion: CompiledStrategyPlan['completion'],
  limits: StrategyLimits,
): void {
  const producers = new Map<string, TaskSpec>()
  let agentCount = 0
  for (const node of Object.values(nodes)) {
    if (node.agentCount > limits.maxConcurrent) {
      throw new Error(`dsh-legion: PlanGraph task "${node.taskId}" exceeds maxConcurrent`)
    }
    agentCount += node.agentCount
    if (producers.has(node.output.artifact)) {
      throw new Error(`dsh-legion: PlanGraph repeats output artifact "${node.output.artifact}"`)
    }
    producers.set(node.output.artifact, node)
  }
  if (agentCount > limits.maxAgents) {
    throw new Error('dsh-legion: PlanGraph task agents exceed maxAgents')
  }

  const expectedEdges = new Set<string>()
  for (const node of Object.values(nodes)) {
    for (const dependency of node.primitive.after) {
      if (!Object.hasOwn(nodes, dependency) || dependency === node.taskId) {
        throw new Error(`dsh-legion: PlanGraph node "${node.taskId}" has an invalid after dependency`)
      }
      expectedEdges.add(`${dependency}\0${node.taskId}\0after\0`)
    }
    for (const input of node.inputs) {
      if (input.artifact === 'objective') continue
      const producer = producers.get(input.artifact)
      if (producer === undefined
        || producer.output.contract !== input.contract
        || producer.output.collection !== input.collection
        || input.required !== (producer.primitive.output.availability === 'required')) {
        throw new Error(`dsh-legion: PlanGraph input "${input.artifact}" has no compatible producer`)
      }
      expectedEdges.add(`${producer.taskId}\0${node.taskId}\0artifact\0${input.artifact}`)
    }
  }
  const actualEdges = edges.map(edge =>
    `${edge.from}\0${edge.to}\0${edge.reason}\0${edge.artifact ?? ''}`)
  const actualSet = new Set(actualEdges)
  if (actualSet.size !== actualEdges.length
    || [...expectedEdges].some(edge => !actualSet.has(edge))
    || edges.some(edge => edge.reason === 'artifact'
      && !expectedEdges.has(`${edge.from}\0${edge.to}\0artifact\0${edge.artifact ?? ''}`))) {
    throw new Error('dsh-legion: PlanGraph edges do not match task dependencies')
  }

  if (completion.artifact === 'objective') {
    if (completion.contract !== 'objective-v1') {
      throw new Error('dsh-legion: PlanGraph objective completion contract is invalid')
    }
    return
  }
  const producer = producers.get(completion.artifact)
  if (producer === undefined
    || producer.output.contract !== completion.contract
    || producer.output.collection) {
    throw new Error('dsh-legion: PlanGraph completion has no compatible producer')
  }
}

function environmentDigest(plan: CompiledStrategyPlan, catalogDigest: string): string {
  return sha256Digest({
    version: 1,
    kind: 'legion-static-environment',
    generationId: plan.generationId,
    catalogDigest,
  })
}

export class PlanGraphCycleError extends Error {}

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
  if (visited !== taskIds.length) {
    throw new PlanGraphCycleError('dsh-legion: static PlanGraph contains a cycle')
  }
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
        primitive: materializeDshPrimitive({
          ...primitive,
          after: [...primitive.after].sort(),
        }, `static PlanGraph primitive ${primitive.stage}`),
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
  validatePlanGraphSemantics(nodes, edges, plan.completion, plan.limits)
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
    const { taskId: _taskId, ...body } = node
    const materialized = materializeInvokeTaskSpecBody(deepCopy(body), `PlanGraph node ${id}`)
    if (materialized.primitive.stage !== id
      || materialized.primitive.output.producer !== id) {
      throw new Error(`dsh-legion: PlanGraph node primitive identity mismatch for "${id}"`)
    }
    return [id, { taskId, ...materialized }]
  }))
  const edges = changes.edges.map((edge, index): PlanEdge => {
    const at = `PlanGraph edge ${String(index)}`
    const source = plainRecord(edge, at)
    if (source.reason === 'after') {
      exactKeys(source, ['from', 'to', 'reason'], ['from', 'to', 'reason'], at)
    } else if (source.reason === 'artifact') {
      exactKeys(source, ['from', 'to', 'reason', 'artifact'], ['from', 'to', 'reason', 'artifact'], at)
    } else {
      throw new Error(`${at} is invalid`)
    }
    const from = TaskId(source.from)
    const to = TaskId(source.to)
    if (!Object.hasOwn(nodes, from) || !Object.hasOwn(nodes, to)) {
      throw new Error(`${at} references an unknown task`)
    }
    return source.reason === 'after'
      ? { from, to, reason: 'after' }
      : { from, to, reason: 'artifact', artifact: ArtifactName(requiredText(source.artifact, `${at}.artifact`)) }
  }).sort(edgeOrder)
  validateAcyclic(Object.keys(nodes), edges)
  const limits = changes.limits ?? base.limits
  validatePlanGraphSemantics(nodes, edges, base.completion, limits)
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
    const nodeAt = `PlanGraph.nodes.${taskId}`
    const node = plainRecord(nodesSource[taskId], nodeAt)
    exactKeys(
      node,
      [
        'kind', 'taskId', 'label', 'primitive', 'member', 'profile', 'agentCount',
        'inputs', 'output', 'effectClass', 'retryPolicy', 'memberFailure',
      ],
      [
        'kind', 'taskId', 'label', 'primitive', 'member', 'profile', 'agentCount',
        'inputs', 'output', 'effectClass', 'retryPolicy', 'memberFailure',
      ],
      nodeAt,
    )
    if (node.taskId !== identity) throw new Error(`dsh-legion: invalid PlanGraph node "${taskId}"`)
    const { taskId: _taskId, ...body } = node
    const materialized = materializeInvokeTaskSpecBody(body, nodeAt)
    if (materialized.primitive.stage !== taskId
      || materialized.primitive.output.producer !== taskId) {
      throw new Error(`dsh-legion: PlanGraph node primitive identity mismatch for "${taskId}"`)
    }
    nodes[taskId] = { taskId: identity, ...materialized }
  }
  if (!Array.isArray(source.edges)) throw new Error('dsh-legion: PlanGraph.edges must be an array')
  const known = new Set(taskIds)
  const edges = source.edges.map((value, index): PlanEdge => {
    const edgeAt = `PlanGraph.edges[${String(index)}]`
    const edge = plainRecord(value, edgeAt)
    exactKeys(edge, ['from', 'to', 'reason', 'artifact'], ['from', 'to', 'reason'], edgeAt)
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
    if (edge.reason === 'artifact' && edge.artifact === undefined) {
      throw new Error('dsh-legion: artifact edge requires an artifact')
    }
    return edge.reason === 'after'
      ? { from, to, reason: 'after' }
      : {
          from,
          to,
          reason: 'artifact',
          artifact: ArtifactName(requiredText(edge.artifact, 'PlanGraph edge artifact')),
        }
  }).sort(edgeOrder)
  validateAcyclic(taskIds, edges)
  const limits = materializeStrategyLimits(source.limits, 'PlanGraph.limits')
  const completion = materializeCompletion(source.completion)
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
    completion,
    limits,
  }
  validatePlanGraphSemantics(nodes, edges, completion, limits)
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
  const node = Object.hasOwn(graph.nodes, taskId) ? graph.nodes[taskId] : undefined
  if (node === undefined) throw new Error(`dsh-legion: unknown PlanGraph task "${String(taskId)}"`)
  const state = Object.hasOwn(tasks, taskId) ? tasks[taskId] : undefined
  if (state === undefined) return deepFreeze({ kind: 'waiting', reasons: [{ kind: 'dependency-pending', taskId }] })
  if (state.status !== 'pending') return deepFreeze({ kind: 'blocked', reasons: [{ kind: 'task-not-pending', status: state.status }] })
  if (state.attempts >= 1) return deepFreeze({ kind: 'blocked', reasons: [{ kind: 'attempt-limit' }] })
  const waiting: TaskWaitingReason[] = []
  const blocked: TaskBlockedReason[] = []
  for (const edge of graph.edges.filter(candidate => candidate.to === taskId)) {
    const dependency = Object.hasOwn(tasks, edge.from) ? tasks[edge.from] : undefined
    if (dependency?.status === 'failed' || dependency?.status === 'cancelled' || dependency?.status === 'blocked') {
      blocked.push({ kind: 'dependency-failed', taskId: edge.from })
    } else if (dependency?.status !== 'succeeded') {
      waiting.push({ kind: 'dependency-pending', taskId: edge.from })
    }
  }
  for (const input of node.inputs) {
    if (input.artifact === 'objective') continue
    const artifact = Object.hasOwn(artifacts, input.artifact)
      ? artifacts[input.artifact]
      : undefined
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
