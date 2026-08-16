import { describe, expect, it } from 'vitest'
import {
  GoalVersion,
  PlanDigest,
  PlanVersion,
  TaskId,
} from '../src/durable-run/contract.ts'
import {
  runStaticDagActivation,
  type StaticDagActivationInput,
  type StaticDagEffectPort,
} from '../src/durable-run/controller.ts'
import type { FrontierArtifact, PlanGraph, TaskSpec } from '../src/durable-run/graph.ts'

function task(id: 'alpha' | 'beta', agentCount = 1): TaskSpec {
  return {
    kind: 'invoke',
    taskId: TaskId(id),
    label: id,
    primitive: {
      kind: 'dsh-delegate',
      stage: id,
      member: 'worker',
      profile: 'worker',
      inputs: ['objective'],
      output: {
        name: `${id}-result`,
        contract: 'text',
        collection: false,
        availability: 'required',
        producer: id,
      },
      prompt: id,
      mode: 'foreground',
      after: [],
    } as never,
    member: 'worker',
    profile: 'worker',
    agentCount,
    inputs: [{
      artifact: 'objective',
      contract: 'objective-v1',
      collection: false,
      required: true,
    }],
    output: { artifact: `${id}-result`, contract: 'text', collection: false },
    effectClass: 'read',
    retryPolicy: { kind: 'none' },
    memberFailure: 'fail',
  }
}

function graph(options: {
  readonly alphaAgents?: number
  readonly betaAgents?: number
  readonly maxOutputBytes?: number
} = {}): PlanGraph {
  const alpha = task('alpha', options.alphaAgents)
  const beta = task('beta', options.betaAgents)
  return {
    schemaVersion: 1,
    planVersion: PlanVersion(1),
    goalVersion: GoalVersion(1),
    strategy: 'parallel',
    team: 'team',
    generationId: 'generation',
    catalogDigest: `sha256:${'1'.repeat(64)}`,
    objectiveDigest: `sha256:${'2'.repeat(64)}`,
    environmentDigest: `sha256:${'3'.repeat(64)}`,
    nodes: { beta, alpha },
    edges: [],
    completion: { artifact: 'alpha-result' as never, contract: 'text' },
    limits: {
      maxAgents: 4,
      maxConcurrent: 2,
      deadlineMs: 60_000,
      maxOutputBytes: options.maxOutputBytes ?? 64_000,
    },
    digest: PlanDigest(`sha256:${'4'.repeat(64)}`),
  }
}

const objective: FrontierArtifact = {
  name: 'objective',
  contract: 'objective-v1',
  collection: false,
  value: 'goal',
  bytes: 4,
}

function input(
  plan: PlanGraph,
  signal: AbortSignal = new AbortController().signal,
): StaticDagActivationInput {
  return {
    graph: plan,
    tasks: {
      alpha: { status: 'pending', generation: 1, attempts: 0 },
      beta: { status: 'pending', generation: 1, attempts: 0 },
    },
    artifacts: { objective },
    bounds: { maxStarts: 2, maxConcurrent: 2 },
    signal,
  }
}

function success(request: { readonly task: TaskSpec }, bytes = 6) {
  return {
    kind: 'succeeded' as const,
    taskId: request.task.taskId,
    artifact: {
      name: request.task.output.artifact,
      contract: request.task.output.contract,
      collection: request.task.output.collection,
      value: request.task.taskId,
      bytes,
    },
  }
}

describe('bounded static DAG activation', () => {
  it('overlaps independent roots and commits settlements in TaskId order', async () => {
    const entered: string[] = []
    const commits: string[][] = []
    const gate = Promise.withResolvers<void>()
    const port: StaticDagEffectPort = {
      async commit(batch, options) {
        expect(options).toEqual({ flush: true })
        commits.push(batch.map(item => item.taskId))
      },
      async execute(request) {
        entered.push(request.task.taskId)
        if (entered.length === 2) gate.resolve()
        await gate.promise
        return success(request)
      },
    }

    const result = await runStaticDagActivation(input(graph()), port)

    expect([...entered].sort()).toEqual(['alpha', 'beta'])
    expect(commits).toEqual([['alpha', 'beta'], ['alpha', 'beta']])
    expect(result.started).toEqual([TaskId('alpha'), TaskId('beta')])
    expect(result.outcomes.map(item => item.taskId))
      .toEqual([TaskId('alpha'), TaskId('beta')])
  })

  it('starts no work when the prepared durability commit fails', async () => {
    let starts = 0
    await expect(runStaticDagActivation(input(graph()), {
      async commit() { throw new Error('flush failed') },
      async execute(request) {
        starts += 1
        return { kind: 'cancelled', taskId: request.task.taskId, reason: 'unused' }
      },
    })).rejects.toThrow(/flush failed/)
    expect(starts).toBe(0)
  })

  it('counts physical fanout activations against concurrency', async () => {
    const started: string[] = []
    const result = await runStaticDagActivation(input(graph({ alphaAgents: 2 })), {
      async commit() {},
      async execute(request) {
        started.push(request.task.taskId)
        return success(request)
      },
    })
    expect(started).toEqual(['alpha'])
    expect(result.started).toEqual([TaskId('alpha')])
  })

  it('rejects mismatched and oversized successful outcomes before settlement', async () => {
    let commits = 0
    await expect(runStaticDagActivation(input(graph()), {
      async commit() { commits += 1 },
      async execute(request) {
        return request.task.taskId === TaskId('alpha')
          ? { ...success(request), taskId: TaskId('beta') }
          : success(request)
      },
    })).rejects.toThrow(/returned outcome/)
    expect(commits).toBe(1)

    await expect(runStaticDagActivation(input(graph({ maxOutputBytes: 5 })), {
      async commit() {},
      async execute(request) { return success(request, 3) },
    })).rejects.toThrow(/output limit/)
  })

  it('starts no child after cancellation wins at the prepared barrier', async () => {
    const controller = new AbortController()
    let starts = 0
    const result = await runStaticDagActivation(input(graph(), controller.signal), {
      async commit() { controller.abort('cancel after prepare') },
      async execute(request) {
        starts += 1
        return success(request)
      },
    })
    expect(result.kind).toBe('cancelled')
    expect(result.started).toEqual([])
    expect(starts).toBe(0)
  })
})
