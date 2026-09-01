import { snapshotJsonValue } from '@deepseek-ai/dsh-util-values'
import type { StrategyLimits } from '../orchestration-contract.ts'
import { ArtifactName } from '../identity.ts'
import { canonicalValue, deepCopy, deepFreeze, sha256Digest } from '../internal/value.ts'
import {
  AuthorityDigest,
  DeltaId,
  PlanVersion,
  TaskId,
  type AuthorityEnvelope,
  type AuthorityProfileScope,
  type EffectClass,
  type PlanVersion as PlanVersionType,
  type TaskId as TaskIdType,
  type TaskRecord,
} from './contract.ts'
import {
  evolvePlanGraph,
  materializeDshPrimitive,
  materializeInvokeTaskSpecBody,
  materializeStrategyLimits,
  PlanGraphCycleError,
  type PlanEdge,
  type PlanGraph,
  type TaskSpec,
} from './graph.ts'

export interface PlanDeltaEvidence { readonly source: string; readonly detail: string }
export type PlanDeltaOperation =
  | { readonly kind: 'add-node'; readonly localId: string; readonly node: Omit<TaskSpec, 'taskId'> }
  | { readonly kind: 'add-edge'; readonly from: string; readonly to: string; readonly reason: PlanEdge['reason']; readonly artifact?: string }
  | { readonly kind: 'supersede-pending'; readonly taskId: string; readonly replacement?: string }
  | { readonly kind: 'narrow-limits'; readonly limits: Readonly<StrategyLimits> }
export interface PlanDeltaProposal {
  readonly schemaVersion: 1
  readonly deltaId: ReturnType<typeof DeltaId>
  readonly basePlanVersion: PlanVersionType
  readonly reason: string
  readonly evidence: readonly PlanDeltaEvidence[]
  readonly operations: readonly PlanDeltaOperation[]
}
export interface PlanDeltaBounds { readonly maxNodes: number; readonly maxPlanVersions: number }
export type PlanDeltaRejectionReason =
  | 'malformed' | 'stale-base' | 'identity-collision' | 'unknown-task'
  | 'history-rewrite' | 'authority-widening' | 'limits-widening'
  | 'cycle' | 'invalid-graph'
export type PlanDeltaDecision =
  | { readonly kind: 'accepted'; readonly proposalDigest: string; readonly graph: PlanGraph; readonly superseded: readonly TaskIdType[] }
  | { readonly kind: 'rejected'; readonly proposalDigest?: string; readonly reason: PlanDeltaRejectionReason; readonly message: string }

const LOCAL_ID = /^[a-z][a-z0-9-]*$/
const PLAN_DELTA_MAX_BYTES = 256 * 1024
const PLAN_DELTA_MAX_EVIDENCE = 64
const EFFECTS: readonly EffectClass[] = ['read', 'idempotent-write', 'non-idempotent-write']
function record(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('dsh-legion: ' + at + ' must be a plain object')
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new Error('dsh-legion: ' + at + ' must be a plain object')
  return value as Record<string, unknown>
}
function exactKeys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[], at: string): void {
  if (Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) {
    throw new Error('dsh-legion: invalid ' + at + ' fields')
  }
}
function text(value: unknown, at: string, max = 512): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new Error('dsh-legion: invalid ' + at)
  return value
}
function localIdentity(value: unknown, at: string): string {
  const output = text(value, at, 128)
  if (!LOCAL_ID.test(output) || output.startsWith('@legion')) throw new Error('dsh-legion: invalid ' + at)
  return output
}
function positive(value: unknown, at: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error('dsh-legion: invalid ' + at)
  return value as number
}
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0 }
function strings(value: unknown, at: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error('dsh-legion: invalid ' + at)
  return [...new Set(value.map((item, index) => text(item, at + '[' + index + ']')))].sort(compare)
}
function scope(value: unknown, at: string): AuthorityProfileScope {
  const source = record(value, at)
  const fields = ['members', 'tools', 'providers', 'models', 'routes', 'effectClasses']
  exactKeys(source, fields, fields, at)
  const effectClasses = strings(source.effectClasses, at + '.effectClasses')
  if (effectClasses.some(value => !EFFECTS.includes(value as EffectClass))) throw new Error('dsh-legion: invalid effect authority')
  return { members: strings(source.members, at + '.members'), tools: strings(source.tools, at + '.tools'), providers: strings(source.providers, at + '.providers'), models: strings(source.models, at + '.models'), routes: strings(source.routes, at + '.routes'), effectClasses: effectClasses as readonly EffectClass[] }
}
function authorityIdentity(profiles: Readonly<Record<string, AuthorityProfileScope>>, maxDepth: number, allowGoalRevision: boolean): unknown {
  return { profiles: Object.fromEntries(Object.keys(profiles).sort(compare).map(name => [name, profiles[name]])), maxDepth, allowGoalRevision }
}
export function createAuthorityEnvelope(value: { readonly profiles: Readonly<Record<string, AuthorityProfileScope>>; readonly maxDepth: number; readonly allowGoalRevision: boolean }): AuthorityEnvelope {
  const profiles = Object.fromEntries(Object.keys(value.profiles).sort(compare).map(name => [name, scope(value.profiles[name], 'authority.' + name)]))
  const maxDepth = positive(value.maxDepth, 'authority.maxDepth')
  const identity = authorityIdentity(profiles, maxDepth, value.allowGoalRevision === true)
  return deepFreeze({ ...(identity as Omit<AuthorityEnvelope, 'digest'>), digest: AuthorityDigest(sha256Digest({ kind: 'legion-authority', identity })) })
}
function subset(values: readonly string[], ceiling: readonly string[]): boolean { const allowed = new Set(ceiling); return values.every(value => allowed.has(value)) }
export function isAuthoritySubset(candidate: AuthorityEnvelope, ceiling: AuthorityEnvelope): boolean {
  if (candidate.maxDepth > ceiling.maxDepth || candidate.allowGoalRevision && !ceiling.allowGoalRevision) return false
  return Object.entries(candidate.profiles).every(([name, item]) => {
    const allowed = Object.hasOwn(ceiling.profiles, name) ? ceiling.profiles[name] : undefined
    return allowed !== undefined && subset(item.members, allowed.members) && subset(item.tools, allowed.tools)
      && subset(item.providers, allowed.providers) && subset(item.models, allowed.models)
      && subset(item.routes, allowed.routes) && subset(item.effectClasses, allowed.effectClasses)
  })
}
function dynamicTask(value: unknown, at: string): Omit<TaskSpec, 'taskId'> {
  const task = materializeInvokeTaskSpecBody(value, at)
  if (task.primitive.kind === 'dsh-subagent-fanout') {
    throw new Error('dsh-legion: model-authored fanout requires unavailable Member Slot capacity evidence')
  }
  return deepFreeze({
    ...deepCopy(task),
    primitive: {
      ...deepCopy(task.primitive),
      specialist: task.primitive.specialist,
      profile: task.primitive.specialist,
    },
  })
}
function operation(value: unknown, index: number): PlanDeltaOperation {
  const source = record(value, 'operations[' + index + ']')
  if (source.kind === 'add-node') { exactKeys(source, ['kind', 'localId', 'node'], ['kind', 'localId', 'node'], 'add-node'); return { kind: 'add-node', localId: localIdentity(source.localId, 'localId'), node: dynamicTask(source.node, 'node') } }
  if (source.kind === 'add-edge') {
    exactKeys(source, ['kind', 'from', 'to', 'reason', 'artifact'], ['kind', 'from', 'to', 'reason'], 'add-edge')
    if (source.reason !== 'after' && source.reason !== 'artifact' || source.reason === 'artifact' && source.artifact === undefined || source.reason === 'after' && source.artifact !== undefined) throw new Error('dsh-legion: invalid edge')
    return { kind: 'add-edge', from: text(source.from, 'from'), to: text(source.to, 'to'), reason: source.reason, ...(source.artifact === undefined ? {} : { artifact: ArtifactName(text(source.artifact, 'artifact', Number.MAX_SAFE_INTEGER)) }) }
  }
  if (source.kind === 'supersede-pending') { exactKeys(source, ['kind', 'taskId', 'replacement'], ['kind', 'taskId'], 'supersede'); return { kind: 'supersede-pending', taskId: text(source.taskId, 'taskId'), ...(source.replacement === undefined ? {} : { replacement: localIdentity(source.replacement, 'replacement') }) } }
  if (source.kind === 'narrow-limits') { exactKeys(source, ['kind', 'limits'], ['kind', 'limits'], 'narrow-limits'); return { kind: 'narrow-limits', limits: materializeStrategyLimits(source.limits) } }
  throw new Error('dsh-legion: invalid PlanDelta operation kind')
}
export function materializePlanDeltaProposal(value: unknown): PlanDeltaProposal {
  const snapshot = snapshotJsonValue(value)
  if (snapshot === undefined
    || new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > PLAN_DELTA_MAX_BYTES) {
    throw new Error('dsh-legion: PlanDeltaProposal exceeds its JSON byte limit')
  }
  const source = record(snapshot, 'PlanDeltaProposal'); const fields = ['schemaVersion', 'deltaId', 'basePlanVersion', 'reason', 'evidence', 'operations']
  exactKeys(source, fields, fields, 'PlanDeltaProposal')
  if (source.schemaVersion !== 1 || !Array.isArray(source.evidence)
    || source.evidence.length > PLAN_DELTA_MAX_EVIDENCE
    || !Array.isArray(source.operations) || source.operations.length > 64) {
    throw new Error('dsh-legion: invalid PlanDeltaProposal')
  }
  const evidence = source.evidence.map((value, index) => { const item = record(value, 'evidence[' + index + ']'); exactKeys(item, ['source', 'detail'], ['source', 'detail'], 'evidence'); return { source: text(item.source, 'evidence.source'), detail: text(item.detail, 'evidence.detail') } })
  return deepFreeze({ schemaVersion: 1, deltaId: DeltaId(source.deltaId), basePlanVersion: PlanVersion(source.basePlanVersion), reason: text(source.reason, 'reason', 4096), evidence, operations: source.operations.map(operation) })
}
function proposalIdentity(proposal: PlanDeltaProposal): unknown {
  const key = (value: unknown) => JSON.stringify(canonicalValue(value))
  return { ...proposal, evidence: [...proposal.evidence].sort((a, b) => compare(key(a), key(b))), operations: [...proposal.operations].sort((a, b) => compare(key(a), key(b))) }
}

function bindDynamicTask(
  node: Omit<TaskSpec, 'taskId'>,
  taskId: TaskIdType,
): TaskSpec {
  const primitive = node.primitive
  if (String(primitive.member) !== node.member
    || String(primitive.profile) !== node.profile
    || primitive.output.name !== node.output.artifact
    || primitive.output.contract !== node.output.contract
    || primitive.output.collection !== node.output.collection
    || primitive.inputs.length !== node.inputs.length
    || primitive.inputs.some((name, index) => name !== node.inputs[index]?.artifact)) {
    throw new Error('dsh-legion: dynamic task primitive does not match its public task spec')
  }
  const expectedAgents = primitive.kind === 'dsh-subagent-fanout' ? primitive.count : 1
  if (node.agentCount !== expectedAgents) {
    throw new Error('dsh-legion: dynamic task agent count does not match its primitive')
  }
  return deepFreeze({
    ...deepCopy(node),
    taskId,
    primitive: materializeDshPrimitive({
      ...deepCopy(primitive),
      stage: taskId,
      output: { ...deepCopy(primitive.output), producer: taskId },
    }, 'bound dynamic task primitive'),
  })
}

function resolve(reference: string, locals: ReadonlyMap<string, TaskIdType>, nodes: Readonly<Record<string, TaskSpec>>): TaskIdType | undefined {
  const generated = locals.get(reference); if (generated !== undefined) return generated
  try { const id = TaskId(reference); return Object.hasOwn(nodes, id) ? id : undefined } catch { return undefined }
}
function limitsNarrower(next: StrategyLimits, base: StrategyLimits): boolean { return next.maxAgents <= base.maxAgents && next.maxConcurrent <= base.maxConcurrent && next.deadlineMs <= base.deadlineMs && next.maxOutputBytes <= base.maxOutputBytes }
function edgeKey(edge: PlanEdge): string { return [edge.from, edge.to, edge.reason, edge.artifact ?? ''].join('\0') }
function validateWiring(nodes: Readonly<Record<string, TaskSpec>>, edges: readonly PlanEdge[]): void {
  const producers = new Map<string, TaskSpec>()
  for (const node of Object.values(nodes)) { if (producers.has(node.output.artifact)) throw new Error('duplicate artifact producer'); producers.set(node.output.artifact, node) }
  for (const node of Object.values(nodes)) for (const input of node.inputs) {
    if (input.artifact === 'objective') continue
    const producer = producers.get(input.artifact)
    if (producer === undefined || producer.output.contract !== input.contract || producer.output.collection !== input.collection
      || !edges.some(edge => edge.from === producer.taskId && edge.to === node.taskId && edge.reason === 'artifact' && edge.artifact === input.artifact)) throw new Error('invalid artifact wiring for ' + input.artifact)
  }
}
export function applyPlanDelta(input: { readonly base: PlanGraph; readonly proposal: unknown; readonly tasks: Readonly<Record<string, Pick<TaskRecord, 'status'>>>; readonly authority: AuthorityEnvelope; readonly deploymentAuthority?: AuthorityEnvelope; readonly bounds: PlanDeltaBounds }): PlanDeltaDecision {
  let proposal: PlanDeltaProposal
  try { proposal = materializePlanDeltaProposal(input.proposal) } catch (error) { return deepFreeze({ kind: 'rejected', reason: 'malformed', message: error instanceof Error ? error.message : 'malformed proposal' }) }
  const proposalDigest = sha256Digest(proposalIdentity(proposal))
  const reject = (reason: PlanDeltaRejectionReason, message: string): PlanDeltaDecision => deepFreeze({ kind: 'rejected', proposalDigest, reason, message })
  if (proposal.basePlanVersion !== input.base.planVersion) return reject('stale-base', 'base plan version mismatch')
  if (!Number.isSafeInteger(input.bounds.maxNodes) || input.bounds.maxNodes < 1 || !Number.isSafeInteger(input.bounds.maxPlanVersions) || input.bounds.maxPlanVersions < 1 || Number(input.base.planVersion) >= input.bounds.maxPlanVersions) return reject('limits-widening', 'plan evolution bounds exhausted')
  if (input.deploymentAuthority !== undefined && !isAuthoritySubset(input.authority, input.deploymentAuthority)) return reject('authority-widening', 'authority exceeds deployment')
  const adds = proposal.operations.filter((item): item is Extract<PlanDeltaOperation, { kind: 'add-node' }> => item.kind === 'add-node')
  const locals = new Map<string, TaskIdType>()
  for (const item of adds) { if (locals.has(item.localId)) return reject('identity-collision', 'duplicate local identity'); locals.set(item.localId, TaskId('@legion/delta/' + proposal.deltaId + '/' + item.localId)) }
  const nodes: Record<string, TaskSpec> = { ...input.base.nodes }
  for (const item of adds) {
    const id = locals.get(item.localId)!; if (Object.hasOwn(nodes, id)) return reject('identity-collision', 'generated identity collides')
    const allowed = Object.hasOwn(input.authority.profiles, item.node.profile)
      ? input.authority.profiles[item.node.profile]
      : undefined
    if (allowed === undefined || !allowed.members.includes(item.node.member) || !allowed.effectClasses.includes(item.node.effectClass)) return reject('authority-widening', 'task exceeds authority')
    try {
      nodes[id] = bindDynamicTask(item.node, id)
    } catch (error) {
      return reject(
        'invalid-graph',
        error instanceof Error ? error.message : 'invalid dynamic task',
      )
    }
  }
  if (Object.keys(nodes).length > input.bounds.maxNodes) return reject('limits-widening', 'maxNodes exceeded')
  const superseded: TaskIdType[] = []
  for (const item of proposal.operations) if (item.kind === 'supersede-pending') {
    const id = resolve(item.taskId, locals, nodes); if (id === undefined) return reject('unknown-task', 'unknown superseded task')
    const status = Object.hasOwn(input.tasks, id) ? input.tasks[id]?.status : undefined; if (status !== 'pending' && status !== 'ready') return reject('history-rewrite', 'only pending tasks may be superseded')
    if (item.replacement !== undefined && !locals.has(item.replacement)) return reject('unknown-task', 'unknown replacement')
    superseded.push(id)
  }
  const supersededSet = new Set(superseded)
  for (const taskId of superseded) {
    const task = Object.hasOwn(nodes, taskId) ? nodes[taskId] : undefined
    if (task === undefined) return reject('unknown-task', 'unknown superseded task')
    const artifact = task.output.artifact
    if (input.base.completion.artifact === artifact
      || Object.values(nodes).some(node => !supersededSet.has(node.taskId)
        && node.inputs.some(input => input.artifact === artifact))) {
      return reject('history-rewrite', 'cannot supersede a task whose artifact remains required')
    }
  }
  const narrow = proposal.operations.filter((item): item is Extract<PlanDeltaOperation, { kind: 'narrow-limits' }> => item.kind === 'narrow-limits')
  if (narrow.length > 1) return reject('malformed', 'multiple limit operations')
  const nextLimits = narrow[0]?.limits ?? input.base.limits
  if (!limitsNarrower(nextLimits, input.base.limits)) return reject('limits-widening', 'limits may only narrow')
  const edges = [...input.base.edges]
  for (const item of proposal.operations) if (item.kind === 'add-edge') {
    const from = resolve(item.from, locals, nodes); const to = resolve(item.to, locals, nodes)
    if (from === undefined || to === undefined) return reject('unknown-task', 'edge references unknown task')
    const status = Object.hasOwn(input.tasks, to) ? input.tasks[to]?.status : undefined
    if (Object.hasOwn(input.base.nodes, to) && status !== undefined && status !== 'pending' && status !== 'ready') return reject('history-rewrite', 'cannot change started history')
    if (item.reason === 'after') edges.push({ from, to, reason: 'after' })
    else if (item.artifact !== undefined) {
      edges.push({ from, to, reason: 'artifact', artifact: item.artifact })
    } else return reject('malformed', 'artifact edge requires an artifact')
  }
  const canonicalEdges = [...new Map(edges.map(edge => [edgeKey(edge), edge])).values()]
  try {
    validateWiring(nodes, canonicalEdges)
    const graph = evolvePlanGraph(input.base, { planVersion: PlanVersion(Number(input.base.planVersion) + 1), nodes, edges: canonicalEdges, limits: nextLimits })
    return deepFreeze({ kind: 'accepted', proposalDigest, graph, superseded: [...new Set(superseded)].sort(compare) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid graph'
    return reject(error instanceof PlanGraphCycleError ? 'cycle' : 'invalid-graph', message)
  }
}
