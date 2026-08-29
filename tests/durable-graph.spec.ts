import { describe, expect, it } from 'vitest'
import { materializeConfig } from '../src/config.ts'
import { compileCatalog } from '../src/compiler.ts'
import { compileOrchestrationCatalog, compileStrategy } from '../src/orchestration.ts'
import { PlanVersion, RunId, TaskId } from '../src/durable-run/contract.ts'
import { validateLegionEventData } from '../src/durable-run/validate.ts'
import {
  compileStaticPlanGraph,
  deriveReadyFrontier,
  deriveTaskReadiness,
  evolvePlanGraph,
  materializePlanGraph,
  type FrontierTaskState,
  type PlanEdge,
  type PlanGraph,
} from '../src/durable-run/graph.ts'

function compile(stages: readonly Record<string, unknown>[], planVersion = PlanVersion(1)) {
  const config = materializeConfig({
    configVersion: 2,
    toolName: 'legion',
    enableRunInBackground: false,
    profiles: {
      worker: { description: 'Worker.', subagentProvider: 'spawn', maxDepth: 1, defaultRunInBackground: false, result: 'text' },
    },
    teams: { team: { description: 'Team.', members: { worker: { profile: 'worker', maxParticipants: 4 } } } },
    strategies: {
      graph: {
        description: 'Graph.', team: 'team', stages,
        completion: { artifact: 'joined', contract: 'text' },
        limits: { maxAgents: 8, maxConcurrent: 4, deadlineMs: 60_000, maxOutputBytes: 64_000 },
        memberFailure: 'fail',
      },
    },
  })
  const profiles = compileCatalog(config, { providers: { spawn: { continuable: true, capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true } } } })
  const orchestration = compileOrchestrationCatalog(profiles)
  const catalogErrors = orchestration.diagnostics.filter(item => item.severity === 'error')
  if (catalogErrors.length > 0) throw new Error(catalogErrors.map(item => item.message).join('; '))
  const compiled = compileStrategy(orchestration, { strategy: 'graph', objective: 'Build it.' })
  if (!compiled.ok) throw new Error(compiled.diagnostics.map(item => item.message).join('; '))
  return compileStaticPlanGraph(compiled.plan, orchestration.digest, planVersion)
}

const stages = [
  { kind: 'delegate', id: 'alpha', member: 'worker', inputs: [{ artifact: 'objective', contract: 'objective-v1' }], output: { artifact: 'alpha-result', contract: 'text' }, prompt: 'Alpha.' },
  { kind: 'delegate', id: 'beta', member: 'worker', inputs: [{ artifact: 'objective', contract: 'objective-v1' }], output: { artifact: 'beta-result', contract: 'text' }, prompt: 'Beta.' },
  { kind: 'synthesize', id: 'join', member: 'worker', after: ['beta', 'alpha'], inputs: [{ artifact: 'alpha-result', contract: 'text' }, { artifact: 'beta-result', contract: 'text' }], output: { artifact: 'joined', contract: 'text' }, prompt: 'Join.' },
] as const

describe('static durable PlanGraph', () => {
  it('lowers typed artifact and control dependencies canonically', () => {
    const graph = compile(stages)
    expect(Object.keys(graph.nodes)).toEqual(['alpha', 'beta', 'join'])
    expect(graph.edges).toEqual([
      { from: 'alpha', to: 'join', reason: 'after' },
      { from: 'alpha', to: 'join', reason: 'artifact', artifact: 'alpha-result' },
      { from: 'beta', to: 'join', reason: 'after' },
      { from: 'beta', to: 'join', reason: 'artifact', artifact: 'beta-result' },
    ])
    expect(graph.digest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(graph.nodes.alpha?.inputs[0]).toMatchObject({ artifact: 'objective', contract: 'objective-v1', required: true })
    expect(graph.nodes.alpha?.primitive.profile).toBe('worker')
    expect(Object.prototype.propertyIsEnumerable.call(graph.nodes.alpha?.primitive, 'profile')).toBe(false)
  })

  it('keeps the digest independent of authored after ordering and plan version', () => {
    const first = compile(stages)
    expect(first.nodes.join?.primitive.after).toEqual(['alpha', 'beta'])
    expect(compile(stages, PlanVersion(2)).digest).toBe(first.digest)
  })

  it('accepts forward control dependencies and keeps fanout as one node', () => {
    const forward = compile(stages.map(stage =>
      stage.id === 'alpha' ? { ...stage, after: ['beta'] } : stage))
    expect(forward.edges).toContainEqual({ from: 'beta', to: 'alpha', reason: 'after' })

    const fanout = compile(stages.map((stage) => {
      if (stage.id === 'alpha') {
        return { ...stage, kind: 'fanout', count: 3, minSuccess: 3, allowDegraded: false }
      }
      if (stage.id === 'join') {
        return {
          ...stage,
          inputs: stage.inputs.map(input => input.artifact === 'alpha-result'
            ? { ...input, collection: true }
            : input),
        }
      }
      return stage
    }))
    expect(fanout.nodes.alpha).toMatchObject({ agentCount: 3 })
    expect(Object.keys(fanout.nodes)).toEqual(['alpha', 'beta', 'join'])
  })

  it('rejects duplicate, self, unknown, and cyclic control dependencies', () => {
    expect(() => compile(stages.map(stage =>
      stage.id === 'alpha' ? { ...stage, after: ['beta', 'beta'] } : stage)))
      .toThrow(/repeats an after dependency/)
    expect(() => compile(stages.map(stage =>
      stage.id === 'alpha' ? { ...stage, after: ['alpha'] } : stage)))
      .toThrow(/depend on itself/)
    expect(() => compile(stages.map(stage =>
      stage.id === 'alpha' ? { ...stage, after: ['missing'] } : stage)))
      .toThrow(/unknown stage/)
    expect(() => compile(stages.map(stage =>
      stage.id === 'alpha' ? { ...stage, after: ['join'] } : stage)))
      .toThrow(/cycle/)
  })

  it('materializes only an untampered canonical graph', () => {
    const graph = compile(stages)
    const detached = JSON.parse(JSON.stringify(graph)) as unknown
    expect(materializePlanGraph(detached)).toEqual(graph)
    const legacyNodes = structuredClone(graph.nodes) as unknown as Record<string, {
      primitive: Record<string, unknown>
    }>
    for (const node of Object.values(legacyNodes)) {
      node.primitive.profile = node.primitive.specialist
      delete node.primitive.specialist
    }
    const legacy = evolvePlanGraph(graph, {
      planVersion: PlanVersion(2),
      nodes: legacyNodes as unknown as PlanGraph['nodes'],
      edges: graph.edges,
    })
    expect(materializePlanGraph(JSON.parse(JSON.stringify(legacy)) as unknown)).toEqual(legacy)
    const longPrompt = compile(stages.map(stage => stage.id === 'alpha'
      ? { ...stage, prompt: 'x'.repeat(1_024) }
      : stage))
    expect(materializePlanGraph(JSON.parse(JSON.stringify(longPrompt)) as unknown)).toEqual(longPrompt)
    const duplicateInput = compile(stages.map(stage => stage.id === 'alpha'
      ? { ...stage, inputs: [...stage.inputs, ...stage.inputs] }
      : stage))
    expect(materializePlanGraph(JSON.parse(JSON.stringify(duplicateInput)) as unknown))
      .toEqual(duplicateInput)
    const longArtifact = 'a'.repeat(513)
    const longIdentity = compile(stages.map(stage => stage.id === 'alpha'
      ? { ...stage, output: { ...stage.output, artifact: longArtifact } }
      : stage.id === 'join'
        ? {
            ...stage,
            inputs: stage.inputs.map(input => input.artifact === 'alpha-result'
              ? { ...input, artifact: longArtifact }
              : input),
          }
        : stage))
    expect(materializePlanGraph(JSON.parse(JSON.stringify(longIdentity)) as unknown))
      .toEqual(longIdentity)
    const malformed = structuredClone(detached) as {
      nodes: Record<string, { primitive: Record<string, unknown> }>
    }
    const alpha = malformed.nodes.alpha
    if (alpha === undefined) throw new Error('expected alpha fixture')
    alpha.primitive.kind = 'unknown-primitive'
    expect(() => materializePlanGraph(malformed)).toThrow(/primitive/)

    const excessive = structuredClone(detached) as { limits: { maxAgents: number } }
    excessive.limits.maxAgents = 33
    expect(() => materializePlanGraph(excessive)).toThrow(/maxAgents/)

    const invalidCompletion = structuredClone(detached) as {
      completion: Record<string, unknown>
    }
    invalidCompletion.completion.extra = true
    expect(() => materializePlanGraph(invalidCompletion)).toThrow(/completion/)

    const invalidEdge = structuredClone(detached) as {
      edges: Array<Record<string, unknown>>
    }
    const artifactEdge = invalidEdge.edges.find(edge => edge.reason === 'artifact')
    if (artifactEdge === undefined) throw new Error('expected artifact edge fixture')
    delete artifactEdge.artifact
    expect(() => materializePlanGraph(invalidEdge)).toThrow(/artifact edge/)
    expect(() => evolvePlanGraph(graph, {
      planVersion: PlanVersion(2),
      nodes: graph.nodes,
      edges: [{
        from: TaskId('alpha'), to: TaskId('beta'), reason: 'after', artifact: 'alpha-result',
      } as unknown as PlanEdge],
    })).toThrow(/fields|after edge/)
    expect(() => evolvePlanGraph(graph, {
      planVersion: PlanVersion(2),
      nodes: graph.nodes,
      edges: [{
        from: TaskId('alpha'), to: TaskId('beta'), reason: 'after', extra: true,
      } as unknown as PlanEdge],
    })).toThrow(/fields/)

    const invalidWiring = structuredClone(detached) as {
      nodes: Record<string, { inputs: Array<{ artifact: string; required: boolean }> }>
    }
    const join = invalidWiring.nodes.join
    const alphaInput = join?.inputs.find(input => input.artifact === 'alpha-result')
    if (alphaInput === undefined) throw new Error('expected alpha input fixture')
    alphaInput.required = false
    expect(() => materializePlanGraph(invalidWiring)).toThrow(/compatible producer/)

    const collectionCompletion = structuredClone(detached) as {
      nodes: Record<string, {
        output: { collection: boolean }
        primitive: { output: { collection: boolean } }
      }>
    }
    const completionNode = collectionCompletion.nodes.join
    if (completionNode === undefined) throw new Error('expected completion fixture')
    completionNode.output.collection = true
    completionNode.primitive.output.collection = true
    expect(() => materializePlanGraph(collectionCompletion)).toThrow(/collection|completion/)

    expect(() => materializePlanGraph({
      ...(detached as Record<string, unknown>),
      strategy: 'tampered',
    })).toThrow(/digest/)
  })

  it('carries and validates the complete graph in a plan-state record', () => {
    const graph = compile(stages)
    const runId = RunId('graph-run')
    const event = {
      schemaVersion: 1,
      runId,
      planVersion: graph.planVersion,
      correlationId: 'graph-plan',
      record: {
        schemaVersion: 1,
        runId,
        version: graph.planVersion,
        goalVersion: graph.goalVersion,
        digest: graph.digest,
        nodeCount: Object.keys(graph.nodes).length,
        environmentDigest: graph.environmentDigest,
        graph,
      },
    }
    expect(validateLegionEventData('legion/plan-state', event).record.graph).toEqual(graph)
    expect(() => validateLegionEventData('legion/plan-state', {
      ...event,
      record: {
        ...event.record,
        graph: { ...graph, strategy: 'tampered' },
      },
    })).toThrow(/digest/)
  })

  it('derives a deterministic ready frontier and typed blocking reasons', () => {
    const graph = compile(stages)
    const pending: Record<string, FrontierTaskState> = Object.fromEntries(Object.keys(graph.nodes).map(id => [id, { status: 'pending', generation: 1, attempts: 0 }]))
    expect(deriveReadyFrontier(graph, pending, {})).toEqual([TaskId('alpha'), TaskId('beta')])
    expect(deriveTaskReadiness(graph, TaskId('join'), pending, {})).toMatchObject({ kind: 'waiting' })
    const succeeded: Record<string, FrontierTaskState> = { ...pending, alpha: { status: 'succeeded', generation: 1, attempts: 1 }, beta: { status: 'succeeded', generation: 1, attempts: 1 } }
    expect(deriveTaskReadiness(graph, TaskId('join'), succeeded, {})).toMatchObject({ kind: 'waiting', reasons: expect.arrayContaining([{ kind: 'artifact-missing', artifact: 'alpha-result' }]) })
  })
})
