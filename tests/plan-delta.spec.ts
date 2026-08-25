import { describe, expect, it } from 'vitest'
import {
  GoalVersion,
  PlanDigest,
  PlanVersion,
  TaskId,
  type TaskRecord,
} from '../src/durable-run/contract.ts'
import type { PlanGraph, TaskSpec } from '../src/durable-run/graph.ts'
import { applyPlanDelta, createAuthorityEnvelope, materializePlanDeltaProposal } from '../src/durable-run/plan-delta.ts'

function node(id: string, profile = 'default', effectClass: TaskSpec['effectClass'] = 'read'): TaskSpec {
  return {
    kind: 'invoke', taskId: TaskId(id), label: id,
    primitive: {
      kind: 'dsh-delegate', stage: id, member: 'worker' as never,
      specialist: profile as never, profile: profile as never, inputs: [],
      output: { name: (id + '-out') as never, contract: 'text', collection: false, availability: 'required', producer: id },
      prompt: id, mode: 'foreground', after: [],
    },
    member: 'worker', profile, agentCount: 1, inputs: [],
    output: { artifact: id + '-out', contract: 'text', collection: false },
    effectClass, retryPolicy: { kind: 'none' }, memberFailure: 'fail',
  }
}
const root = node('root')
const base: PlanGraph = {
  schemaVersion: 1, planVersion: PlanVersion(1), goalVersion: GoalVersion(1),
  strategy: 'test', team: 'team', generationId: 'generation',
  catalogDigest: 'sha256:' + '1'.repeat(64),
  objectiveDigest: 'sha256:' + '2'.repeat(64),
  environmentDigest: 'sha256:' + '3'.repeat(64),
  nodes: { root }, edges: [],
  completion: { artifact: 'root-out' as never, contract: 'text' },
  limits: { maxAgents: 4, maxConcurrent: 2, deadlineMs: 1_000, maxOutputBytes: 1_000 },
  digest: PlanDigest('sha256:' + '0'.repeat(64)),
}
const authority = createAuthorityEnvelope({
  profiles: { default: {
    members: ['worker'], tools: ['read'], providers: ['provider'],
    models: ['model'], routes: ['route'],
    effectClasses: ['read', 'idempotent-write'],
  } },
  maxDepth: 2, allowGoalRevision: false,
})
function dynamic(id = 'new-task', profile = 'default', effectClass: TaskSpec['effectClass'] = 'read'): Omit<TaskSpec, 'taskId'> {
  const { taskId: _taskId, ...value } = node(id, profile, effectClass)
  return value
}
function proposal(operations: readonly unknown[] = [
  { kind: 'add-node', localId: 'new-task', node: dynamic() },
  { kind: 'add-edge', from: 'root', to: 'new-task', reason: 'after' },
]) {
  return {
    schemaVersion: 1, deltaId: 'delta-one', basePlanVersion: 1,
    reason: 'Add one bounded verification step.',
    evidence: [{ source: 'artifact:root-out', detail: 'The root completed.' }],
    operations,
  }
}
const bounds = { maxNodes: 8, maxPlanVersions: 8 }
const request = (
  candidate: unknown,
  tasks: Readonly<Record<string, Pick<TaskRecord, 'status'>>> = {
    root: { status: 'pending' },
  },
) => ({
  base, proposal: candidate, tasks, authority, deploymentAuthority: authority, bounds,
})

describe('PlanDelta compiler', () => {
  it('strictly materializes and assigns hygienic generated IDs', () => {
    expect(() => materializePlanDeltaProposal({ ...proposal(), typo: true })).toThrow(/fields/)
    expect(() => materializePlanDeltaProposal({ ...proposal(), operations: [
      { kind: 'add-node', localId: '@legion', node: dynamic() },
    ] })).toThrow(/localId/)
    const decision = applyPlanDelta(request(proposal()))
    expect(decision.kind).toBe('accepted')
    if (decision.kind === 'accepted') {
      expect(Object.keys(decision.graph.nodes)).toContain('@legion/delta/delta-one/new-task')
      expect(decision.graph.planVersion).toBe(2)
    }
  })

  it('rejects stale bases, cycles, and rewrites of started history', () => {
    expect(applyPlanDelta(request({ ...proposal(), basePlanVersion: 2 })))
      .toMatchObject({ kind: 'rejected', reason: 'stale-base' })
    expect(applyPlanDelta(request(proposal([
      { kind: 'add-node', localId: 'new-task', node: dynamic() },
      { kind: 'add-edge', from: 'root', to: 'new-task', reason: 'after' },
      { kind: 'add-edge', from: 'new-task', to: 'root', reason: 'after' },
    ])))).toMatchObject({ kind: 'rejected', reason: 'cycle' })
    expect(applyPlanDelta(request(proposal([
      { kind: 'supersede-pending', taskId: 'root' },
    ]), { root: { status: 'succeeded' as const } })))
      .toMatchObject({ kind: 'rejected', reason: 'history-rewrite' })
    expect(Object.keys(base.nodes)).toEqual(['root'])
  })

  it('rejects profile, effect, deployment, node, and limit widening', () => {
    expect(applyPlanDelta(request(proposal([
      { kind: 'add-node', localId: 'new-task', node: dynamic('new-task', 'admin') },
    ])))).toMatchObject({ kind: 'rejected', reason: 'authority-widening' })
    expect(applyPlanDelta(request(proposal([
      { kind: 'add-node', localId: 'new-task', node: dynamic('new-task', 'default', 'non-idempotent-write') },
    ])))).toMatchObject({ kind: 'rejected', reason: 'authority-widening' })
    expect(applyPlanDelta(request(proposal([
      { kind: 'narrow-limits', limits: { ...base.limits, maxConcurrent: 3 } },
    ])))).toMatchObject({ kind: 'rejected', reason: 'limits-widening' })
    expect(applyPlanDelta({ ...request(proposal([])), bounds: { maxNodes: 1, maxPlanVersions: 8 } }))
      .toMatchObject({ kind: 'accepted' })
    expect(applyPlanDelta({
      ...request(proposal([])),
      deploymentAuthority: createAuthorityEnvelope({ profiles: {}, maxDepth: 1, allowGoalRevision: false }),
    })).toMatchObject({ kind: 'rejected', reason: 'authority-widening' })
  })

  it('permits pending supersession and narrowing only', () => {
    const decision = applyPlanDelta(request(proposal([
      { kind: 'supersede-pending', taskId: 'root' },
      { kind: 'narrow-limits', limits: { ...base.limits, maxConcurrent: 1 } },
    ]), { root: { status: 'ready' as const } }))
    expect(decision).toMatchObject({
      kind: 'accepted', superseded: ['root'], graph: { limits: { maxConcurrent: 1 } },
    })
  })

  it('keeps proposal and graph digests invariant to semantic permutations', () => {
    const operations = [
      { kind: 'add-node', localId: 'new-task', node: dynamic() },
      { kind: 'add-node', localId: 'other', node: dynamic('other') },
      { kind: 'add-edge', from: 'root', to: 'new-task', reason: 'after' },
      { kind: 'add-edge', from: 'root', to: 'other', reason: 'after' },
    ]
    const first = applyPlanDelta(request(proposal(operations)))
    const second = applyPlanDelta(request(proposal([...operations].reverse())))
    expect(first.kind).toBe('accepted')
    expect(second.kind).toBe('accepted')
    if (first.kind === 'accepted' && second.kind === 'accepted') {
      expect(second.proposalDigest).toBe(first.proposalDigest)
      expect(second.graph).toEqual(first.graph)
    }
  })
})
