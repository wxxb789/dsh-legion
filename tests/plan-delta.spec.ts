import { describe, expect, it } from 'vitest'
import {
  GoalVersion,
  PlanDigest,
  PlanVersion,
  TaskId,
  type TaskRecord,
} from '../src/durable-run/contract.ts'
import { materializePlanGraph, type PlanGraph, type TaskSpec } from '../src/durable-run/graph.ts'
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
function fanoutDynamic(id: string, count: number): Omit<TaskSpec, 'taskId'> {
  const value = dynamic(id)
  if (value.primitive.kind !== 'dsh-delegate') throw new Error('expected delegate fixture')
  const { mode: _mode, ...primitive } = value.primitive
  return {
    ...value,
    agentCount: count,
    output: { ...value.output, collection: true },
    primitive: {
      ...primitive,
      kind: 'dsh-subagent-fanout',
      output: { ...primitive.output, collection: true },
      count,
      minSuccess: count,
      allowDegraded: false,
    },
  }
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
    expect(() => materializePlanDeltaProposal({
      ...proposal(),
      evidence: Array.from({ length: 65 }, (_, index) => ({
        source: `artifact:${String(index)}`,
        detail: 'bounded',
      })),
    })).toThrow(/PlanDeltaProposal/)
    const materialized = materializePlanDeltaProposal(proposal())
    expect(materializePlanDeltaProposal(materialized)).toEqual(materialized)
    const decision = applyPlanDelta(request(materialized))
    expect(decision.kind).toBe('accepted')
    if (decision.kind === 'accepted') {
      const added = decision.graph.nodes['@legion/delta/delta-one/new-task']
      expect(added?.primitive.profile).toBe('default')
      expect(Object.keys(decision.graph.nodes)).toContain('@legion/delta/delta-one/new-task')
      expect(decision.graph.planVersion).toBe(2)
      expect(materializePlanGraph(JSON.parse(JSON.stringify(decision.graph)) as unknown))
        .toEqual(decision.graph)
    }
  })

  it('rejects malformed nested dynamic task contracts before graph compilation', () => {
    const valid = dynamic()
    if (valid.primitive.kind !== 'dsh-delegate') throw new Error('expected delegate fixture')
    const { mode: _mode, ...fanoutBase } = valid.primitive
    const malformed = [
      { ...valid, primitive: { ...valid.primitive, kind: 'unknown-primitive' } },
      { ...valid, primitive: { ...valid.primitive, typo: true } },
      { ...valid, inputs: [{ artifact: 'objective', contract: 'objective-v1', collection: false }] },
      { ...valid, output: { ...valid.output, contract: 'unknown-contract' } },
      {
        ...valid,
        primitive: {
          ...valid.primitive,
          output: { ...valid.primitive.output, name: 'objective' },
        },
        output: { ...valid.output, artifact: 'objective' },
      },
      { ...valid, primitive: { ...valid.primitive, mode: 'continuable' } },
      {
        ...valid,
        primitive: {
          ...valid.primitive,
          output: { ...valid.primitive.output, availability: 'optional' },
        },
      },
      {
        ...valid,
        output: { ...valid.output, collection: true },
        primitive: {
          ...valid.primitive,
          output: { ...valid.primitive.output, collection: true },
        },
      },
      {
        ...valid,
        agentCount: 2,
        primitive: {
          ...fanoutBase,
          kind: 'dsh-subagent-fanout',
          count: 2,
          minSuccess: 2,
          allowDegraded: false,
        },
      },
      {
        ...valid,
        agentCount: 17,
        primitive: {
          ...fanoutBase,
          kind: 'dsh-subagent-fanout',
          count: 17,
          minSuccess: 17,
          allowDegraded: false,
        },
      },
      {
        ...valid,
        primitive: { ...valid.primitive, inputs: ['objective'] },
        inputs: [{ artifact: 'objective', contract: 'text', collection: false, required: true }],
      },
    ]
    for (const [index, candidate] of malformed.entries()) {
      expect(() => materializePlanDeltaProposal(proposal([
        { kind: 'add-node', localId: `invalid-${String(index)}`, node: candidate },
      ])), String(index)).toThrow(/primitive|inputs|output/)
    }
  })

  it('materializes long valid artifact identities in edge proposals', () => {
    expect(() => materializePlanDeltaProposal(proposal([
      {
        kind: 'add-edge',
        from: 'root',
        to: 'root',
        reason: 'artifact',
        artifact: 'a'.repeat(513),
      },
    ]))).not.toThrow()
  })

  it('rejects a delta whose tasks exceed the compiled run agent budget', () => {
    const additions = ['one', 'two', 'three', 'four'].map(id => ({
      kind: 'add-node',
      localId: id,
      node: dynamic(id),
    }))
    expect(applyPlanDelta(request(proposal(additions)))).toMatchObject({
      kind: 'rejected',
      reason: 'invalid-graph',
      message: expect.stringMatching(/maxAgents/),
    })
  })

  it('rejects model-authored fanout without Member Slot capacity evidence', () => {
    expect(applyPlanDelta(request(proposal([
      { kind: 'add-node', localId: 'fanout', node: fanoutDynamic('fanout', 3) },
    ])))).toMatchObject({
      kind: 'rejected',
      reason: 'malformed',
      message: expect.stringMatching(/Member Slot capacity/),
    })
  })

  it('treats prototype-chain names as ordinary missing identifiers', () => {
    expect(applyPlanDelta(request(proposal([
      { kind: 'add-edge', from: 'constructor', to: 'root', reason: 'after' },
    ])))).toMatchObject({ kind: 'rejected', reason: 'unknown-task' })
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

  it('supersedes only pending tasks whose artifacts are no longer required', () => {
    expect(applyPlanDelta(request(proposal([
      { kind: 'supersede-pending', taskId: 'root' },
    ]), { root: { status: 'ready' as const } }))).toMatchObject({
      kind: 'rejected', reason: 'history-rewrite',
    })

    const sideBase: PlanGraph = {
      ...base,
      nodes: { ...base.nodes, side: node('side') },
    }
    const decision = applyPlanDelta({
      ...request(proposal([
        { kind: 'supersede-pending', taskId: 'side' },
        { kind: 'narrow-limits', limits: { ...base.limits, maxConcurrent: 1 } },
      ])),
      base: sideBase,
      tasks: { root: { status: 'pending' }, side: { status: 'ready' } },
    })
    expect(decision).toMatchObject({
      kind: 'accepted', superseded: ['side'], graph: { limits: { maxConcurrent: 1 } },
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
