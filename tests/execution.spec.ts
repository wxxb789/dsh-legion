import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentProvider, SubagentResult } from '@deepseek-ai/dsh-subagent'
import { compileCatalog } from '../src/compiler.ts'
import { materializeConfig, type Config } from '../src/config.ts'
import { DEFAULT_CATALOG_LAYER } from '../src/default-catalog.ts'
import { executeStrategyPlan } from '../src/execution.ts'
import { compileOrchestrationCatalog, compileStrategy } from '../src/orchestration.ts'

const parent = { id: SessionId('strategy-parent') } as unknown as Agent
const review = {
  verdict: 'needs-changes',
  summary: 'One issue.',
  findings: [{
    severity: 'high',
    title: 'Issue',
    detail: 'Fix the issue.',
    evidence: [{ source: 'artifact:execution', detail: 'Evidence.' }],
    recommendation: 'Repair it.',
  }],
  verification: ['reviewed'],
}

function config(): Config {
  return {
    configVersion: 2,
    toolName: 'legion',
    enableRunInBackground: true,
    catalogLayers: [DEFAULT_CATALOG_LAYER],
    profiles: {
      deep: {
        description: 'Deep.',
        subagentProvider: 'spawn',
        maxDepth: 2,
        defaultRunInBackground: false,
        result: 'text',
      },
      quick: {
        description: 'Quick.',
        subagentProvider: 'spawn',
        maxDepth: 2,
        defaultRunInBackground: false,
        result: 'text',
      },
      review: {
        description: 'Review.',
        subagentProvider: 'spawn',
        maxDepth: 2,
        defaultRunInBackground: false,
        result: 'review-v1',
      },
    },
  }
}

function completed(text: string, structured?: unknown): SubagentResult {
  return {
    output: [{ type: 'text', text }],
    stopReason: 'completed',
    ...structured === undefined ? {} : { structured },
  }
}

function setup(reply: (prompt: string, index: number, signal: AbortSignal) => Promise<SubagentResult> | SubagentResult) {
  const ctx = new Context()
  const starts: string[] = []
  const disposed: string[] = []
  let index = 0
  const provider: SubagentProvider = {
    name: 'spawn',
    capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    inheritsParentContext: false,
    async start(request) {
      const current = index++
      const prompt = request.prompt
        .filter((block): block is Extract<(typeof request.prompt)[number], { type: 'text' }> => block.type === 'text')
        .map(block => block.text)
        .join('')
      starts.push(prompt)
      return {
        id: SessionId(`strategy-child-${String(current)}`),
        localAgent: undefined,
        result: Promise.resolve().then(() => reply(prompt, current, request.signal!)),
        async dispose() { disposed.push(prompt) },
      }
    },
  }
  return { ctx, provider, starts, disposed }
}

function catalogs() {
  const materialized = materializeConfig(config())
  const profiles = compileCatalog(materialized, {
    providers: {
      spawn: {
        continuable: true,
        capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
      },
    },
  })
  return { profiles, orchestration: compileOrchestrationCatalog(profiles) }
}

describe('bounded Strategy execution adapter', () => {
  it('executes independent-review through real one-shot subagent runs', async () => {
    const runtime = setup((_prompt, index) => index === 0
      ? completed('execution evidence')
      : completed('reviewed', review))
    await runtime.ctx.plugin(SubagentRuntime)
    runtime.ctx.subagents.registerProvider(runtime.provider)
    const { profiles, orchestration } = catalogs()
    const compiled = compileStrategy(orchestration, {
      strategy: 'independent-review',
      objective: 'Implement the feature.',
    })
    if (!compiled.ok) throw new Error('expected strategy plan')

    const outcome = await executeStrategyPlan(
      runtime.ctx,
      profiles,
      compiled.plan,
      parent,
      new AbortController().signal,
    )
    expect(outcome).toMatchObject({
      kind: 'completed',
      final: { name: 'review', contract: 'review-v1', value: review },
      artifacts: [
        { name: 'execution', value: 'execution evidence' },
        { name: 'review', value: review },
      ],
    })
    expect(runtime.starts).toHaveLength(2)
    expect(runtime.starts[1]).toContain('execution evidence')
    expect(runtime.disposed).toHaveLength(2)
  })

  it('executes research fanout concurrently and returns an explicit degraded outcome', async () => {
    const runtime = setup(async (prompt) => {
      if (prompt.includes('Panel member: 2')) throw new Error('researcher failed')
      if (prompt.includes('Panel member:')) {
        await new Promise(resolve => setTimeout(resolve, 5))
        return completed(prompt.includes('Panel member: 1') ? 'finding one' : 'finding three')
      }
      return completed('panel synthesis')
    })
    await runtime.ctx.plugin(SubagentRuntime)
    runtime.ctx.subagents.registerProvider(runtime.provider)
    const { profiles, orchestration } = catalogs()
    const compiled = compileStrategy(orchestration, {
      strategy: 'research-panel',
      objective: 'Research the design.',
    })
    if (!compiled.ok) throw new Error('expected strategy plan')

    const outcome = await executeStrategyPlan(
      runtime.ctx,
      profiles,
      compiled.plan,
      parent,
      new AbortController().signal,
    )
    expect(outcome).toMatchObject({
      kind: 'degraded',
      final: { name: 'synthesis', value: 'panel synthesis' },
      failures: [{ stage: 'research', index: 1, code: 'MEMBER_FAILED' }],
    })
    expect(runtime.starts).toHaveLength(4)
    expect(runtime.starts[3]).toContain('finding one')
    expect(runtime.starts[3]).toContain('finding three')
    expect(runtime.disposed).toHaveLength(4)
  })

  it('keeps fanout artifacts canonical across seeded settlement interleavings', async () => {
    for (let seed = 1; seed <= 8; seed += 1) {
      const runtime = setup(async (prompt) => {
        const panel = prompt.match(/Panel member: (\d)/)?.[1]
        if (panel !== undefined) {
          const index = Number(panel)
          await new Promise(resolve => setTimeout(resolve, seed * (4 - index) % 7))
          return completed(`finding-${panel}`)
        }
        return completed('synthesis')
      })
      await runtime.ctx.plugin(SubagentRuntime)
      runtime.ctx.subagents.registerProvider(runtime.provider)
      const { profiles, orchestration } = catalogs()
      const compiled = compileStrategy(orchestration, {
        strategy: 'research-panel',
        objective: `Seed ${String(seed)}.`,
      })
      if (!compiled.ok) throw new Error('expected strategy plan')
      const outcome = await executeStrategyPlan(
        runtime.ctx,
        profiles,
        compiled.plan,
        parent,
        new AbortController().signal,
      )
      expect(outcome.kind).toBe('completed')
      expect(outcome.artifacts.find(artifact => artifact.name === 'findings')?.value)
        .toEqual(['finding-1', 'finding-2', 'finding-3'])
      expect(runtime.disposed).toHaveLength(4)
      await runtime.ctx.fiber.dispose()
    }
  })

  it('fails when fanout misses minSuccess and never starts downstream synthesis', async () => {
    const runtime = setup((prompt) => prompt.includes('Panel member: 1')
      ? completed('only finding')
      : Promise.reject(new Error('failed')))
    await runtime.ctx.plugin(SubagentRuntime)
    runtime.ctx.subagents.registerProvider(runtime.provider)
    const { profiles, orchestration } = catalogs()
    const compiled = compileStrategy(orchestration, {
      strategy: 'research-panel',
      objective: 'Research.',
    })
    if (!compiled.ok) throw new Error('expected strategy plan')
    const outcome = await executeStrategyPlan(
      runtime.ctx,
      profiles,
      compiled.plan,
      parent,
      new AbortController().signal,
    )
    expect(outcome).toMatchObject({
      kind: 'failed',
      failure: { code: 'MIN_SUCCESS_UNSATISFIED', stage: 'research' },
    })
    expect(runtime.starts).toHaveLength(3)
    expect(runtime.disposed).toHaveLength(3)
  })

  it('settles at the deadline even when a child ignores AbortSignal', async () => {
    const runtime = setup(() => new Promise<SubagentResult>(() => {}))
    await runtime.ctx.plugin(SubagentRuntime)
    runtime.ctx.subagents.registerProvider(runtime.provider)
    const { profiles, orchestration } = catalogs()
    const compiled = compileStrategy(orchestration, {
      strategy: 'independent-review',
      objective: 'Deadline bound.',
      limits: { deadlineMs: 10 },
    })
    if (!compiled.ok) throw new Error('expected strategy plan')
    const outcome = await executeStrategyPlan(
      runtime.ctx,
      profiles,
      compiled.plan,
      parent,
      new AbortController().signal,
    )
    expect(outcome).toMatchObject({ kind: 'cancelled', reason: 'strategy deadline exceeded' })
    expect(runtime.disposed).toHaveLength(1)
  })

  it('rejects an oversized artifact before committing it to partial outcome state', async () => {
    const runtime = setup(() => completed('oversized'))
    await runtime.ctx.plugin(SubagentRuntime)
    runtime.ctx.subagents.registerProvider(runtime.provider)
    const { profiles, orchestration } = catalogs()
    const compiled = compileStrategy(orchestration, {
      strategy: 'independent-review',
      objective: 'Bound output.',
      limits: { maxOutputBytes: 1 },
    })
    if (!compiled.ok) throw new Error('expected strategy plan')
    const outcome = await executeStrategyPlan(
      runtime.ctx,
      profiles,
      compiled.plan,
      parent,
      new AbortController().signal,
    )
    expect(outcome).toMatchObject({
      kind: 'failed',
      artifacts: [],
      failure: { code: 'OUTPUT_LIMIT_EXCEEDED' },
    })
  })

  it('returns cancelled and disposes a pending child when the parent aborts', async () => {
    const runtime = setup((_prompt, _index, signal) => new Promise(resolve => {
      const settle = () => resolve({ output: [], stopReason: 'aborted' })
      if (signal.aborted) settle()
      else signal.addEventListener('abort', settle, { once: true })
    }))
    await runtime.ctx.plugin(SubagentRuntime)
    runtime.ctx.subagents.registerProvider(runtime.provider)
    const { profiles, orchestration } = catalogs()
    const compiled = compileStrategy(orchestration, {
      strategy: 'independent-review',
      objective: 'Cancel me.',
    })
    if (!compiled.ok) throw new Error('expected strategy plan')
    const controller = new AbortController()
    const pending = executeStrategyPlan(runtime.ctx, profiles, compiled.plan, parent, controller.signal)
    controller.abort('human cancelled')
    await expect(pending).resolves.toMatchObject({ kind: 'cancelled', reason: 'human cancelled' })
    expect(runtime.disposed).toHaveLength(1)
  })

  it('rejects a plan when execution Profile policy has drifted', async () => {
    const runtime = setup(() => completed('unused'))
    await runtime.ctx.plugin(SubagentRuntime)
    runtime.ctx.subagents.registerProvider(runtime.provider)
    const { orchestration } = catalogs()
    const compiled = compileStrategy(orchestration, {
      strategy: 'independent-review',
      objective: 'Policy-bound.',
    })
    if (!compiled.ok) throw new Error('expected strategy plan')
    const changed = materializeConfig({ ...config(), guidance: 'changed policy' })
    const changedProfiles = compileCatalog(changed, {
      providers: {
        spawn: {
          continuable: true,
          capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
        },
      },
    })
    await expect(executeStrategyPlan(
      runtime.ctx,
      changedProfiles,
      compiled.plan,
      parent,
      new AbortController().signal,
    )).rejects.toThrow(/Profile policy does not match/)
    expect(runtime.starts).toHaveLength(0)
  })

  it('fails unsupported goal/hybrid plans before starting any child', async () => {
    const runtime = setup(() => completed('unused'))
    await runtime.ctx.plugin(SubagentRuntime)
    runtime.ctx.subagents.registerProvider(runtime.provider)
    const { profiles, orchestration } = catalogs()
    const compiled = compileStrategy(orchestration, {
      strategy: 'plan-execute-review',
      objective: 'Plan it.',
    })
    if (!compiled.ok) throw new Error('expected strategy plan')
    const outcome = await executeStrategyPlan(
      runtime.ctx,
      profiles,
      compiled.plan,
      parent,
      new AbortController().signal,
    )
    expect(outcome).toMatchObject({
      kind: 'failed',
      failure: { code: 'EXECUTION_CLASS_UNSUPPORTED' },
    })
    expect(runtime.starts).toHaveLength(0)
  })
})
