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
  materializePlanGraph,
  type FrontierTaskState,
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
