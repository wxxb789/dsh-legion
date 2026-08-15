import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentProvider, SubagentResult } from '@deepseek-ai/dsh-subagent'
import { compileCatalog } from '../src/compiler.ts'
import { materializeConfig, type Config } from '../src/config.ts'
import { DEFAULT_CATALOG_LAYER } from '../src/default-catalog.ts'
import { createStrategyExecutionSnapshot, executeStrategyPlan } from '../src/execution.ts'
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

function setup(
  reply: (prompt: string, index: number, signal: AbortSignal) => Promise<SubagentResult> | SubagentResult,
  onStart?: () => void,
  dispose?: () => Promise<void> | void,
) {
  const ctx = new Context()
  const starts: string[] = []
  const disposed: string[] = []
  let index = 0
  const provider: SubagentProvider = {
    name: 'spawn',
    capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    inheritsParentContext: false,
    async start(request) {
      onStart?.()
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
        async dispose() {
          disposed.push(prompt)
          await dispose?.()
        },
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
  const orchestration = compileOrchestrationCatalog(profiles)
  return {
    profiles,
    orchestration,
    snapshot: createStrategyExecutionSnapshot(profiles, orchestration),
  }
}

describe('bounded Strategy execution adapter', () => {
  it('executes independent-review through real one-shot subagent runs', async () => {
    const runtime = setup((_prompt, index) => index === 0
      ? completed('execution evidence')
      : completed('reviewed', review))
    await runtime.ctx.plugin(SubagentRuntime)
    runtime.ctx.subagents.registerProvider(runtime.provider)
    const { orchestration, snapshot } = catalogs()
    const compiled = compileStrategy(orchestration, {
      strategy: 'independent-review',
      objective: 'Implement the feature.',
    })
    if (!compiled.ok) throw new Error('expected strategy plan')

    const outcome = await executeStrategyPlan(
      runtime.ctx,
      snapshot,
      compiled.plan,
      parent,
      new AbortController().signal,
    )
    expect(outcome).toMatchObject({
      kind: 'completed',
      runId: expect.stringMatching(/^team-run-/),
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
    const { orchestration, snapshot } = catalogs()
    const compiled = compileStrategy(orchestration, {
      strategy: 'research-panel',
      objective: 'Research the design.',
    })
    if (!compiled.ok) throw new Error('expected strategy plan')

    const outcome = await executeStrategyPlan(
      runtime.ctx,
      snapshot,
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

  it('enforces maxConcurrent within one Team Run fanout admission scope', async () => {
    let active = 0
    let peak = 0
    let entered = 0
    const gate = Promise.withResolvers<void>()
    const runtime = setup(async (prompt) => {
      if (!prompt.includes('Panel member:')) return completed('synthesis')
      active += 1
      entered += 1
      peak = Math.max(peak, active)
      if (entered === 3) gate.resolve()
      await gate.promise
      active -= 1
      return completed(`finding-${String(entered)}`)
    })
    await runtime.ctx.plugin(SubagentRuntime)
    runtime.ctx.subagents.registerProvider(runtime.provider)
    const { orchestration, snapshot } = catalogs()
    const compiled = compileStrategy(orchestration, {
      strategy: 'research-panel',
      objective: 'Bound one Team Run.',
    })
    if (!compiled.ok) throw new Error('expected strategy plan')
    const outcome = await executeStrategyPlan(
      runtime.ctx,
      snapshot,
      compiled.plan,
      parent,
      new AbortController().signal,
    )
    expect(outcome.kind).toBe('completed')
    expect(peak).toBe(3)
    expect(peak).toBeLessThanOrEqual(compiled.plan.limits.maxConcurrent)
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
      const { orchestration, snapshot } = catalogs()
      const compiled = compileStrategy(orchestration, {
        strategy: 'research-panel',
        objective: `Seed ${String(seed)}.`,
      })
      if (!compiled.ok) throw new Error('expected strategy plan')
      const outcome = await executeStrategyPlan(
        runtime.ctx,
        snapshot,
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

  it('fails without replay and disposes published runs when a provider disappears during fanout admission', async () => {
    let removeProvider: () => void = () => undefined
    const runtime = setup(() => completed('only admitted result'), () => removeProvider())
    await runtime.ctx.plugin(SubagentRuntime)
    removeProvider = runtime.ctx.subagents.registerProvider(runtime.provider)
    const { orchestration, snapshot } = catalogs()
    const compiled = compileStrategy(orchestration, {
      strategy: 'research-panel',
      objective: 'Provider removal race.',
    })
    if (!compiled.ok) throw new Error('expected strategy plan')
    const outcome = await executeStrategyPlan(
      runtime.ctx,
      snapshot,
      compiled.plan,
      parent,
      new AbortController().signal,
    )
    expect(outcome).toMatchObject({
      kind: 'failed',
      failure: { code: 'MIN_SUCCESS_UNSATISFIED', stage: 'research' },
    })
    expect(runtime.starts).toHaveLength(1)
    expect(runtime.disposed).toHaveLength(1)
  })

  it('does not let cancellation overwrite a fanout failure once minSuccess is impossible', async () => {
    const runtime = setup((prompt, _index, signal) => {
      if (prompt.includes('Panel member: 3')) {
        return new Promise(resolve => {
          const settle = () => resolve({ output: [], stopReason: 'aborted' })
          if (signal.aborted) settle()
          else signal.addEventListener('abort', settle, { once: true })
        })
      }
      return Promise.reject(new Error('member failed'))
    })
    await runtime.ctx.plugin(SubagentRuntime)
    runtime.ctx.subagents.registerProvider(runtime.provider)
    const { orchestration, snapshot } = catalogs()
    const compiled = compileStrategy(orchestration, {
      strategy: 'research-panel',
      objective: 'Impossible fanout.',
    })
    if (!compiled.ok) throw new Error('expected strategy plan')
    const controller = new AbortController()
    const pending = executeStrategyPlan(runtime.ctx, snapshot, compiled.plan, parent, controller.signal)
    for (let step = 0; step < 30 && runtime.disposed.length < 2; step += 1) await Promise.resolve()
    expect(runtime.disposed).toHaveLength(2)
    for (let step = 0; step < 10; step += 1) await Promise.resolve()
    controller.abort('late cancellation')
    await expect(pending).resolves.toMatchObject({
      kind: 'failed',
      failure: { code: 'MIN_SUCCESS_UNSATISFIED' },
    })
    expect(runtime.disposed).toHaveLength(3)
  })

  it('fails when fanout misses minSuccess and never starts downstream synthesis', async () => {
    const runtime = setup((prompt) => prompt.includes('Panel member: 1')
      ? completed('only finding')
      : Promise.reject(new Error('failed')))
    await runtime.ctx.plugin(SubagentRuntime)
    runtime.ctx.subagents.registerProvider(runtime.provider)
    const { orchestration, snapshot } = catalogs()
    const compiled = compileStrategy(orchestration, {
      strategy: 'research-panel',
      objective: 'Research.',
    })
    if (!compiled.ok) throw new Error('expected strategy plan')
    const outcome = await executeStrategyPlan(
      runtime.ctx,
      snapshot,
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
    const { orchestration, snapshot } = catalogs()
    const compiled = compileStrategy(orchestration, {
      strategy: 'independent-review',
      objective: 'Deadline bound.',
      limits: { deadlineMs: 10 },
    })
    if (!compiled.ok) throw new Error('expected strategy plan')
    const outcome = await executeStrategyPlan(
      runtime.ctx,
      snapshot,
      compiled.plan,
      parent,
      new AbortController().signal,
    )
    expect(outcome).toMatchObject({ kind: 'cancelled', reason: 'strategy deadline exceeded' })
    expect(runtime.disposed).toHaveLength(1)
  })

  it('keeps the first terminal claim across seeded cancellation/failure orderings', async () => {
    for (let seed = 0; seed < 8; seed += 1) {
      let rejectChild: ((error: Error) => void) | undefined
      const runtime = setup(() => new Promise<SubagentResult>((_resolve, reject) => {
        rejectChild = reject
      }))
      await runtime.ctx.plugin(SubagentRuntime)
      runtime.ctx.subagents.registerProvider(runtime.provider)
      const { orchestration, snapshot } = catalogs()
      const compiled = compileStrategy(orchestration, {
        strategy: 'independent-review',
        objective: `Terminal seed ${String(seed)}.`,
      })
      if (!compiled.ok) throw new Error('expected strategy plan')
      const controller = new AbortController()
      const pending = executeStrategyPlan(runtime.ctx, snapshot, compiled.plan, parent, controller.signal)
      for (let step = 0; step < 20 && rejectChild === undefined; step += 1) await Promise.resolve()
      if (rejectChild === undefined) throw new Error('child was not admitted')
      if (seed % 2 === 0) {
        controller.abort(`cancel-${String(seed)}`)
        rejectChild(new Error('late failure'))
        await expect(pending).resolves.toMatchObject({ kind: 'cancelled' })
      } else {
        rejectChild(new Error('first failure'))
        const outcome = await pending
        controller.abort(`late-cancel-${String(seed)}`)
        expect(outcome).toMatchObject({ kind: 'failed', failure: { code: 'MEMBER_FAILED' } })
      }
      expect(runtime.disposed).toHaveLength(1)
      await runtime.ctx.fiber.dispose()
    }
  })

  it('does not let cancellation during disposal overwrite an earlier child failure', async () => {
    let releaseDispose: (() => void) | undefined
    const runtime = setup(
      () => Promise.reject(new Error('child failed first')),
      undefined,
      () => new Promise<void>(resolve => { releaseDispose = resolve }),
    )
    await runtime.ctx.plugin(SubagentRuntime)
    runtime.ctx.subagents.registerProvider(runtime.provider)
    const { orchestration, snapshot } = catalogs()
    const compiled = compileStrategy(orchestration, {
      strategy: 'independent-review',
      objective: 'Failure before cancellation.',
    })
    if (!compiled.ok) throw new Error('expected strategy plan')
    const controller = new AbortController()
    const pending = executeStrategyPlan(runtime.ctx, snapshot, compiled.plan, parent, controller.signal)
    for (let step = 0; step < 30 && releaseDispose === undefined; step += 1) await Promise.resolve()
    if (releaseDispose === undefined) throw new Error('disposal did not start')
    controller.abort('late cancellation')
    releaseDispose()
    await expect(pending).resolves.toMatchObject({
      kind: 'failed',
      failure: { code: 'MEMBER_FAILED' },
    })
    expect(runtime.disposed).toHaveLength(1)
  })

  it('rejects an oversized artifact before committing it to partial outcome state', async () => {
    const runtime = setup(() => completed('oversized'))
    await runtime.ctx.plugin(SubagentRuntime)
    runtime.ctx.subagents.registerProvider(runtime.provider)
    const { orchestration, snapshot } = catalogs()
    const compiled = compileStrategy(orchestration, {
      strategy: 'independent-review',
      objective: 'Bound output.',
      limits: { maxOutputBytes: 1 },
    })
    if (!compiled.ok) throw new Error('expected strategy plan')
    const outcome = await executeStrategyPlan(
      runtime.ctx,
      snapshot,
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
    const { orchestration, snapshot } = catalogs()
    const compiled = compileStrategy(orchestration, {
      strategy: 'independent-review',
      objective: 'Cancel me.',
    })
    if (!compiled.ok) throw new Error('expected strategy plan')
    const controller = new AbortController()
    const pending = executeStrategyPlan(runtime.ctx, snapshot, compiled.plan, parent, controller.signal)
    for (let step = 0; step < 30 && runtime.starts.length === 0; step += 1) await Promise.resolve()
    expect(runtime.starts).toHaveLength(1)
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
    expect(() => createStrategyExecutionSnapshot(changedProfiles, orchestration))
      .toThrow(/does not match Profile catalog generation/)
    expect(runtime.starts).toHaveLength(0)
  })

  it('rejects splicing the same policy across different runtime catalog generations', () => {
    const { profiles, orchestration } = catalogs()
    const materialized = materializeConfig(config())
    const changedRuntimeProfiles = compileCatalog(materialized, {
      providers: {
        spawn: {
          continuable: true,
          capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
        },
        unused: {
          continuable: false,
          capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
        },
      },
    })
    expect(changedRuntimeProfiles.policyDigest).toBe(profiles.policyDigest)
    expect(changedRuntimeProfiles.catalogDigest).not.toBe(profiles.catalogDigest)
    expect(() => createStrategyExecutionSnapshot(changedRuntimeProfiles, orchestration))
      .toThrow(/does not match Profile catalog generation/)
  })

  it('rejects a stale Strategy Plan generation before admitting a child', async () => {
    const runtime = setup(() => completed('unused'))
    await runtime.ctx.plugin(SubagentRuntime)
    runtime.ctx.subagents.registerProvider(runtime.provider)
    const { orchestration } = catalogs()
    const compiled = compileStrategy(orchestration, {
      strategy: 'independent-review',
      objective: 'Generation-bound.',
    })
    if (!compiled.ok) throw new Error('expected strategy plan')
    const changed = materializeConfig({
      ...config(),
      strategies: {
        'independent-review': {
          ...DEFAULT_CATALOG_LAYER.strategies?.['independent-review'],
          description: 'Changed Strategy generation.',
        },
      },
    })
    const changedProfiles = compileCatalog(changed, {
      providers: {
        spawn: {
          continuable: true,
          capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
        },
      },
    })
    const changedOrchestration = compileOrchestrationCatalog(changedProfiles)
    const changedSnapshot = createStrategyExecutionSnapshot(changedProfiles, changedOrchestration)
    await expect(executeStrategyPlan(
      runtime.ctx,
      changedSnapshot,
      compiled.plan,
      parent,
      new AbortController().signal,
    )).rejects.toThrow(/Plan generation does not match/)
    expect(runtime.starts).toHaveLength(0)
  })

  it('executes plan-execute-review as four bounded one-shot stages', async () => {
    const runtime = setup((prompt, index) => {
      if (index === 0) return completed('bounded plan')
      if (index === 1) return completed('execution evidence')
      if (index === 2) return completed('reviewed', review)
      expect(prompt).toContain('Plan it.')
      expect(prompt).toContain('bounded plan')
      expect(prompt).toContain('execution evidence')
      expect(prompt).toContain('needs-changes')
      return completed('repaired result')
    })
    await runtime.ctx.plugin(SubagentRuntime)
    runtime.ctx.subagents.registerProvider(runtime.provider)
    const { orchestration, snapshot } = catalogs()
    const compiled = compileStrategy(orchestration, {
      strategy: 'plan-execute-review',
      objective: 'Plan it.',
    })
    if (!compiled.ok) throw new Error('expected strategy plan')
    const outcome = await executeStrategyPlan(
      runtime.ctx,
      snapshot,
      compiled.plan,
      parent,
      new AbortController().signal,
    )
    expect(outcome).toMatchObject({
      kind: 'completed',
      final: { name: 'final', value: 'repaired result' },
    })
    expect(runtime.starts).toHaveLength(4)
    expect(runtime.disposed).toHaveLength(4)
  })
})
