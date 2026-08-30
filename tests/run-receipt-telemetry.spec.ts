import { Context, Service } from '@deepseek-ai/cordis'
import AgentRegistry, { emitAgentEvent, type Agent, type AgentStatus } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-compaction'
import { MessageId, type TokenUsage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm-retry'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SqliteSessionQuery from '@deepseek-ai/dsh-session-query-sqlite'
import SubagentRuntime, {
  type ResolvedSubagentStartRequest,
  type SubagentProvider,
  type SubagentResult,
} from '@deepseek-ai/dsh-subagent'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import {
  RECEIPT_FEED_LIMITS,
  RunReceiptFeed,
  RunReceiptSchema,
  type ReceiptFeedFrame,
  type ReceiptPublication,
  type ReceiptPublicationResult,
  type RunReceiptPublisher,
} from 'dsh-legion-receipts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileCatalog } from '../src/compiler.ts'
import { materializeConfig, type Config } from '../src/config.ts'
import { createStrategyExecutionSnapshot, executeStrategyPlan } from '../src/execution.ts'
import { DEFAULT_CATALOG_LAYER } from '../src/default-catalog.ts'
import { CohortRunId } from '../src/identity.ts'
import { compileOrchestrationCatalog, compileStrategy } from '../src/orchestration.ts'
import { createRunReceipt, finishRunReceipt } from '../src/run-receipt.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

class RecordingPublisher extends RunReceiptFeed implements RunReceiptPublisher {
  readonly publications: ReceiptPublication[] = []

  constructor(
    ctx: Context,
    private readonly forcedResult?: ReceiptPublicationResult,
  ) {
    super(ctx)
  }

  override publish(session: Parameters<RunReceiptPublisher['publish']>[0], publication: ReceiptPublication) {
    this.publications.push(publication)
    return this.forcedResult ?? super.publish(session, publication)
  }
}

class IncompatiblePublisher extends Service {
  constructor(ctx: Context) {
    super(ctx, 'legionReceipts')
  }

  publish(): unknown {
    return { ok: false, code: 'future-publication-result' }
  }
}

function latestReceipt(publisher: RecordingPublisher) {
  const publication = publisher.publications.findLast(item => item.type === 'replace')
  if (publication?.type !== 'replace') throw new Error('expected a Receipt replacement')
  return publication.receipt
}

function completed(text = 'done'): SubagentResult {
  return { output: [{ type: 'text', text }], stopReason: 'completed' }
}

function setStatus(agent: Agent, status: AgentStatus): void {
  ;(agent as { status: AgentStatus }).status = status
}

function assistantUsage(session: Session, turn: number, step: number, usage: TokenUsage): void {
  session.append('assistant/message', {
    turn,
    step,
    message: {
      id: MessageId(`message-${String(session.seq)}`),
      role: 'assistant',
      content: [{ type: 'text', text: 'done' }],
      source: { kind: 'model', provider: 'test-provider', model: 'test-model' },
    },
    usage,
  }, { surfaceOp: 'append' })
}

function appendUsageTurn(session: Session, usage: TokenUsage, turn = 1): void {
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  assistantUsage(session, turn, 1, usage)
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

function appendRetryTurn(session: Session): void {
  const turn = 1
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  session.append('assistant/chunk', {
    turn,
    step: 1,
    chunk: {
      type: 'usage',
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 15, cacheReadTokens: 3, cacheWriteTokens: 0 },
    },
  })
  session.append('assistant/chunk', {
    turn,
    step: 1,
    chunk: { type: 'finish', reason: { kind: 'error', failure: { code: 'TEST', message: 'retry' } } },
  })
  session.append('llm/retry', { turn, step: 1, failure: { code: 'TEST', message: 'retry' } } as never)
  session.append('llm/retry-started', { turn, step: 1, retry: 1 } as never)
  assistantUsage(session, turn, 1, {
    inputTokens: 4,
    outputTokens: 1,
    totalTokens: 7,
    cacheReadTokens: 2,
    cacheWriteTokens: 0,
  })
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

function executionPlan() {
  const authored: Config = {
    configVersion: 2,
    toolName: 'legion',
    enableRunInBackground: false,
    profiles: {
      worker: {
        description: 'Worker.',
        subagentProvider: 'remote',
        maxDepth: 2,
        defaultRunInBackground: false,
        result: 'text',
      },
    },
    teams: {
      solo: {
        description: 'Solo.',
        members: { worker: { profile: 'worker' } },
        limits: { maxMembers: 1, maxConcurrentMembers: 1 },
      },
    },
    strategies: {
      single: {
        description: 'Single.',
        team: 'solo',
        stages: [{
          kind: 'delegate',
          id: 'work',
          member: 'worker',
          inputs: [{ artifact: 'objective', contract: 'objective-v1' }],
          output: { artifact: 'result', contract: 'text' },
          prompt: 'Work.',
        }],
        completion: { artifact: 'result', contract: 'text' },
        limits: { maxAgents: 1, maxConcurrent: 1, deadlineMs: 60_000, maxOutputBytes: 64_000 },
        memberFailure: 'fail',
      },
    },
  }
  const catalog = compileCatalog(materializeConfig(authored), {
    providers: {
      remote: {
        continuable: false,
        capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
      },
    },
  })
  const orchestration = compileOrchestrationCatalog(catalog)
  const compiled = compileStrategy(orchestration, { strategy: 'single', objective: 'Do it.' })
  if (!compiled.ok) throw new Error('expected strategy plan')
  return { snapshot: createStrategyExecutionSnapshot(catalog, orchestration), plan: compiled.plan }
}

function independentReviewPlan() {
  const catalog = compileCatalog(materializeConfig({
    configVersion: 2,
    toolName: 'legion',
    enableRunInBackground: false,
    catalogLayers: [DEFAULT_CATALOG_LAYER],
    profiles: {
      deep: { description: 'Deep.', subagentProvider: 'remote', maxDepth: 2, defaultRunInBackground: false, result: 'text' },
      quick: { description: 'Quick.', subagentProvider: 'remote', maxDepth: 2, defaultRunInBackground: false, result: 'text' },
      review: { description: 'Review.', subagentProvider: 'remote', maxDepth: 2, defaultRunInBackground: false, result: 'review-v1' },
    },
  }), {
    providers: {
      remote: {
        continuable: false,
        capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
      },
    },
  })
  const orchestration = compileOrchestrationCatalog(catalog)
  const compiled = compileStrategy(orchestration, { strategy: 'independent-review', objective: 'Review it.' })
  if (!compiled.ok) throw new Error('expected independent-review plan')
  return { snapshot: createStrategyExecutionSnapshot(catalog, orchestration), plan: compiled.plan }
}

async function setup(provider: SubagentProvider, observation = false) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  if (observation) {
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(TokenMeter)
    await ctx.plugin(SqliteSessionQuery, { path: ':memory:', openAt: 'never' })
  }
  await ctx.plugin(SubagentRuntime)
  ctx.subagents.registerProvider(provider)
  const session = ctx.sessions.create(SessionId(`receipt-parent-${String(contexts.length)}`))
  const parent = { id: session.id, session } as unknown as Agent
  return { ctx, session, parent }
}

describe('Run Receipt public publication and degraded execution', () => {
  it('cancels unstarted stages when a multi-stage run fails', () => {
    const { plan } = independentReviewPlan()
    const running = createRunReceipt(
      plan,
      CohortRunId('team-run-00000000-0000-4000-8000-000000000099'),
      SessionId('failed-stage-parent'),
      1,
    )
    const failed = finishRunReceipt(running, 'failed', 2)
    expect(failed.stages.map(stage => stage.status)).toEqual(['cancelled', 'cancelled'])
    expect(RunReceiptSchema.safeParse(failed).success).toBe(true)
  })

  it('derives stage and outcome from the frozen plan and settlement rather than child narration', async () => {
    const narration = 'MODEL_NARRATION_SENTINEL_claims_failure_and_extra_stage'
    const runtime = await setup({
      name: 'remote',
      capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
      inheritsParentContext: false,
      async start() {
        return {
          id: SessionId('narrating-remote-child'),
          localAgent: undefined,
          result: Promise.resolve({
            output: [{ type: 'text', text: narration }],
            stopReason: 'completed',
            lastAssistantMessage: narration,
          }),
          async dispose() {},
        }
      },
    })
    const publisher = new RecordingPublisher(runtime.ctx)
    const { snapshot, plan } = executionPlan()

    const outcome = await executeStrategyPlan(
      runtime.ctx,
      snapshot,
      plan,
      runtime.parent,
      new AbortController().signal,
    )

    expect(outcome.kind).toBe('completed')
    const receipt = latestReceipt(publisher)
    expect(receipt.outcome).toBe('completed')
    expect(receipt.stages).toMatchObject([{ id: 'work', status: 'completed' }])
    expect(receipt.stages).toHaveLength(1)
    expect(JSON.stringify(receipt)).not.toContain(narration)
  })

  it('publishes the complete frozen graph before the first child starts without a Session event', async () => {
    const gate = Promise.withResolvers<SubagentResult>()
    const observed = Promise.withResolvers<void>()
    let preStart!: ReceiptFeedFrame
    let feed!: RunReceiptFeed
    const runtime = await setup({
      name: 'remote',
      capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
      inheritsParentContext: false,
      async start() {
        const abort = new AbortController()
        const iterator = feed.follow(String(runtime.session.id), abort.signal)[Symbol.asyncIterator]()
        const next = await iterator.next()
        abort.abort()
        await iterator.return?.()
        if (next.done) throw new Error('expected baseline')
        preStart = next.value
        observed.resolve()
        return {
          id: SessionId('accepted-remote-child'),
          localAgent: undefined,
          result: gate.promise,
          async dispose() {},
        }
      },
    })
    feed = new RunReceiptFeed(runtime.ctx)
    const { snapshot, plan } = executionPlan()

    const pending = executeStrategyPlan(
      runtime.ctx,
      snapshot,
      plan,
      runtime.parent,
      new AbortController().signal,
    )
    await observed.promise
    expect(preStart.type).toBe('baseline')
    if (preStart.type !== 'baseline') throw new Error('expected baseline')
    expect(preStart.value.receipts).toHaveLength(1)
    expect(preStart.value.receipts[0]).toMatchObject({
      outcome: 'running',
      stages: [{
        id: 'work',
        kind: 'dsh-delegate',
        member: 'worker',
        expectedChildren: 1,
        status: 'pending',
        after: [],
      }],
      participation: { rows: [] },
    })
    expect(Object.isFrozen(preStart.value.receipts[0])).toBe(true)
    gate.resolve(completed())
    const outcome = await pending

    if (outcome.kind === 'failed') throw new Error(outcome.failure.message)
    expect(outcome.kind).toBe('completed')
    expect(runtime.session.events.some(event => event.type === ('legion/run-receipt' as never))).toBe(false)
    expect(outcome.receipt.feed).toEqual({ status: 'available', failure: null })
  })

  it('keeps ordinary Strategy execution when the publisher and observation services are missing', async () => {
    const runtime = await setup({
      name: 'remote',
      capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
      inheritsParentContext: false,
      async start() {
        return {
          id: SessionId('missing-publisher-child'),
          localAgent: undefined,
          result: Promise.resolve(completed()),
          async dispose() {},
        }
      },
    })
    const { snapshot, plan } = executionPlan()

    const outcome = await executeStrategyPlan(
      runtime.ctx,
      snapshot,
      plan,
      runtime.parent,
      new AbortController().signal,
    )

    expect(outcome.kind).toBe('completed')
    expect(outcome.receipt).toMatchObject({
      participationCounts: { total: 1, local: 0, remote: 1, ended: 1 },
      coverage: { participation: 'partial', timing: 'partial', tokens: 'unavailable' },
      feed: { status: 'unavailable', failure: 'publisher-unavailable' },
    })
    expect(Object.values(outcome.receipt).some(Array.isArray)).toBe(false)
  })

  it('publishes later snapshots without hiding an earlier feed gap', async () => {
    const result = Promise.withResolvers<SubagentResult>()
    let started = false
    const runtime = await setup({
      name: 'remote',
      capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
      inheritsParentContext: false,
      async start() {
        started = true
        return {
          id: SessionId('late-publisher-child'),
          localAgent: undefined,
          result: result.promise,
          async dispose() {},
        }
      },
    })
    const { snapshot, plan } = executionPlan()

    const pending = executeStrategyPlan(
      runtime.ctx,
      snapshot,
      plan,
      runtime.parent,
      new AbortController().signal,
    )
    await expect.poll(() => started).toBe(true)
    const publisher = new RecordingPublisher(runtime.ctx)
    result.resolve(completed())
    const outcome = await pending

    expect(outcome.kind).toBe('completed')
    expect(outcome.receipt.feed).toEqual({ status: 'unavailable', failure: 'publisher-unavailable' })
    expect(publisher.publications.some(item => item.type === 'replace')).toBe(true)
  })

  it('records a rejected publication without changing the Strategy outcome', async () => {
    const runtime = await setup({
      name: 'remote',
      capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
      inheritsParentContext: false,
      async start() {
        return {
          id: SessionId('rejected-publisher-child'),
          localAgent: undefined,
          result: Promise.resolve(completed()),
          async dispose() {},
        }
      },
    })
    new RecordingPublisher(runtime.ctx, { ok: false, code: 'session-byte-cap' })
    const { snapshot, plan } = executionPlan()

    const outcome = await executeStrategyPlan(
      runtime.ctx,
      snapshot,
      plan,
      runtime.parent,
      new AbortController().signal,
    )

    expect(outcome.kind).toBe('completed')
    expect(outcome.receipt.feed).toEqual({ status: 'rejected', failure: 'session-byte-cap' })
  })

  it('classifies an unknown publication result as incompatible without changing execution', async () => {
    const runtime = await setup({
      name: 'remote',
      capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
      inheritsParentContext: false,
      async start() {
        return {
          id: SessionId('incompatible-publisher-child'),
          localAgent: undefined,
          result: Promise.resolve(completed()),
          async dispose() {},
        }
      },
    })
    new IncompatiblePublisher(runtime.ctx)
    const { snapshot, plan } = executionPlan()

    const outcome = await executeStrategyPlan(
      runtime.ctx,
      snapshot,
      plan,
      runtime.parent,
      new AbortController().signal,
    )

    expect(outcome.kind).toBe('completed')
    expect(outcome.receipt.feed).toEqual({ status: 'incompatible', failure: 'publisher-result' })
  })

  it('binds remote lifecycle start and end that both arrive before the returned run is observed', async () => {
    const runtime = await setup({
      name: 'remote',
      capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
      inheritsParentContext: false,
      async start() {
        return {
          id: SessionId('already-settled-remote'),
          localAgent: undefined,
          result: Promise.resolve(completed()),
          async dispose() {},
        }
      },
    })
    const publisher = new RecordingPublisher(runtime.ctx)
    const { snapshot, plan } = executionPlan()

    const outcome = await executeStrategyPlan(
      runtime.ctx,
      snapshot,
      plan,
      runtime.parent,
      new AbortController().signal,
    )

    expect(outcome.kind).toBe('completed')
    expect(latestReceipt(publisher).participation.rows).toEqual([expect.objectContaining({
      childId: 'already-settled-remote',
      runId: expect.any(String),
      provider: 'remote',
      source: 'remote',
      state: 'ended',
      stopReason: 'completed',
      timing: { status: 'reported', elapsedMs: expect.any(Number), source: 'host-lifecycle' },
    })])
  })

  it('keeps interleaved Strategy and direct starts isolated by returned child identity', async () => {
    const results = Array.from({ length: 3 }, () => Promise.withResolvers<SubagentResult>())
    let starts = 0
    const runtime = await setup({
      name: 'remote',
      capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
      inheritsParentContext: false,
      async start() {
        const index = starts++
        return {
          id: SessionId(`interleaved-${String(index)}`),
          localAgent: undefined,
          result: results[index]!.promise,
          async dispose() {},
        }
      },
    })
    const publisher = new RecordingPublisher(runtime.ctx)
    const { snapshot, plan } = executionPlan()
    const first = executeStrategyPlan(runtime.ctx, snapshot, plan, runtime.parent, new AbortController().signal)
    await expect.poll(() => starts).toBe(1)
    const second = executeStrategyPlan(runtime.ctx, snapshot, plan, runtime.parent, new AbortController().signal)
    await expect.poll(() => starts).toBe(2)
    const direct = await runtime.ctx.subagents.start('remote', {
      parent: runtime.parent,
      prompt: [{ type: 'text', text: 'direct' }],
      signal: new AbortController().signal,
    })
    await expect.poll(() => starts).toBe(3)

    results[2]!.resolve(completed('direct'))
    await direct.result
    await direct.dispose()
    results[1]!.resolve(completed('second'))
    results[0]!.resolve(completed('first'))
    const outcomes = await Promise.all([first, second])

    expect(outcomes.map(outcome => outcome.kind)).toEqual(['completed', 'completed'])
    const terminal = publisher.publications.flatMap(item =>
      item.type === 'replace' && item.receipt.outcome !== 'running' ? [item.receipt] : [])
    expect(terminal).toHaveLength(2)
    expect(terminal.map(receipt => receipt.participation.rows.map(row => row.childId)).sort()).toEqual([
      ['interleaved-0'],
      ['interleaved-1'],
    ])
  })

  it('uses Agent status while live and lifecycle end before local Agent disposal', async () => {
    const result = Promise.withResolvers<SubagentResult>()
    let runtime!: Awaited<ReturnType<typeof setup>>
    let child!: Agent
    let publisher!: RecordingPublisher
    runtime = await setup({
      name: 'remote',
      capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
      inheritsParentContext: false,
      async start(request: ResolvedSubagentStartRequest) {
        const session = runtime.ctx.sessions.create(SessionId('local-status-child'), {
          meta: {
            parentSession: request.parent.session.id,
            origin: 'subagent',
            delegationDepth: 1,
          },
        })
        session.append('turn/start', { turn: 0 })
        session.append('subagent/descriptor', request.descriptor)
        child = { id: session.id, session, status: 'running' } as unknown as Agent
        const remove = runtime.ctx.agents.register(child)
        return {
          id: child.id,
          localAgent: child,
          result: result.promise,
          async dispose() {
            expect(latestReceipt(publisher).participation.rows).toEqual([
              expect.objectContaining({
                childId: child.id,
                runId: expect.any(String),
                provider: 'remote',
                state: 'ended',
                stopReason: 'completed',
              }),
            ])
            expect(runtime.ctx.agents.get(child.id)).toBe(child)
            remove()
          },
        }
      },
    }, true)
    publisher = new RecordingPublisher(runtime.ctx)
    const { snapshot, plan } = executionPlan()

    const pending = executeStrategyPlan(
      runtime.ctx,
      snapshot,
      plan,
      runtime.parent,
      new AbortController().signal,
    )
    await expect.poll(() => latestReceipt(publisher).participation.rows[0]?.state).toBe('running')
    expect(latestReceipt(publisher).tokenAccount.sessions[0]?.totalTokens).toEqual({
      status: 'unavailable',
      reason: 'incomplete-turn',
    })
    setStatus(child, 'idle')
    emitAgentEvent(runtime.ctx, child, 'agent/status', { status: 'idle' })
    expect(latestReceipt(publisher).participation.rows).toEqual([
      expect.objectContaining({
        childId: child.id,
        state: 'idle',
        source: 'session',
        timing: { status: 'reported', elapsedMs: expect.any(Number), source: 'subagent-timing' },
      }),
    ])

    result.resolve(completed())
    const outcome = await pending

    expect(outcome.kind).toBe('completed')
    expect(outcome.receipt.participationCounts).toMatchObject({ local: 1, remote: 0, ended: 1 })
  })

  it('reports mixed local and remote facts with known local token subtotals', async () => {
    let starts = 0
    let runtime!: Awaited<ReturnType<typeof setup>>
    runtime = await setup({
      name: 'remote',
      capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
      inheritsParentContext: false,
      async start(request: ResolvedSubagentStartRequest) {
        const index = starts++
        if (index === 1) {
          return {
            id: SessionId('mixed-remote-child'),
            localAgent: undefined,
            result: Promise.resolve({
              output: [{ type: 'text', text: 'review' }],
              structured: { verdict: 'pass', summary: 'Good.', findings: [], verification: ['checked'] },
              stopReason: 'completed',
            }),
            async dispose() {},
          }
        }
        const session = runtime.ctx.sessions.create(SessionId('mixed-local-child'), {
          meta: {
            parentSession: request.parent.session.id,
            seedLength: 0,
            origin: 'subagent',
            delegationDepth: 1,
          },
        })
        session.append('subagent/descriptor', request.descriptor)
        appendUsageTurn(session, {
          inputTokens: 10,
          outputTokens: 2,
          totalTokens: 15,
          cacheReadTokens: 3,
          cacheWriteTokens: 0,
        })
        const child = { id: session.id, session, status: 'idle' } as unknown as Agent
        const remove = runtime.ctx.agents.register(child)
        return {
          id: child.id,
          localAgent: child,
          result: Promise.resolve(completed('evidence')),
          async dispose() { remove() },
        }
      },
    }, true)
    const publisher = new RecordingPublisher(runtime.ctx)
    const { snapshot, plan } = independentReviewPlan()

    const outcome = await executeStrategyPlan(
      runtime.ctx,
      snapshot,
      plan,
      runtime.parent,
      new AbortController().signal,
    )

    expect(outcome.kind).toBe('completed')
    expect(latestReceipt(publisher).participation.rows.map(row => row.source)).toEqual(['session', 'remote'])
    expect(outcome.receipt).toMatchObject({
      participationCounts: { total: 2, local: 1, remote: 1, ended: 2 },
      tokenTotals: { totalTokens: 15, uncachedInputTokens: 10, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 0 },
      unavailableCounts: { participation: 0, tokenDimensions: 5 },
      coverage: { participation: 'complete', timing: 'complete', tokens: 'partial' },
    })
  })

  it('buffers a pre-bind nested remote lifecycle and marks it unavailable', async () => {
    let runtime!: Awaited<ReturnType<typeof setup>>
    runtime = await setup({
      name: 'remote',
      capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
      inheritsParentContext: false,
      async start(request: ResolvedSubagentStartRequest) {
        const session = runtime.ctx.sessions.create(SessionId('nested-root-child'), {
          meta: {
            parentSession: request.parent.session.id,
            seedLength: 0,
            origin: 'subagent',
            delegationDepth: 1,
          },
        })
        session.append('subagent/descriptor', request.descriptor)
        const child = { id: session.id, session, status: 'running' } as unknown as Agent
        const remove = runtime.ctx.agents.register(child)
        const nestedResult = Promise.resolve().then(async () => {
          const nested = await runtime.ctx.subagents.start('nested', {
            parent: child,
            prompt: [{ type: 'text', text: 'nested remote' }],
            signal: new AbortController().signal,
          })
          const settled = await nested.result
          await nested.dispose()
          return settled
        })
        return {
          id: child.id,
          localAgent: child,
          result: nestedResult,
          async dispose() { remove() },
        }
      },
    }, true)
    runtime.ctx.subagents.registerProvider({
      name: 'nested',
      capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      inheritsParentContext: false,
      async start() {
        return {
          id: SessionId('nested-remote-child'),
          localAgent: undefined,
          result: Promise.resolve(completed()),
          async dispose() {},
        }
      },
    })
    const publisher = new RecordingPublisher(runtime.ctx)
    const { snapshot, plan } = executionPlan()

    const outcome = await executeStrategyPlan(
      runtime.ctx,
      snapshot,
      plan,
      runtime.parent,
      new AbortController().signal,
    )

    expect(outcome.kind).toBe('completed')
    expect(latestReceipt(publisher).participation.rows.map(row => row.childId)).toEqual(['nested-root-child'])
    expect(outcome.receipt).toMatchObject({
      participationCounts: { total: 1, local: 1, remote: 0 },
      unavailableCounts: { participation: 1 },
      coverage: { participation: 'partial' },
    })
  })

  it('disposes the official Session observation lease for an unbound descendant', async () => {
    let runtime!: Awaited<ReturnType<typeof setup>>
    runtime = await setup({
      name: 'remote',
      capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
      inheritsParentContext: false,
      async start(request: ResolvedSubagentStartRequest) {
        const session = runtime.ctx.sessions.create(SessionId('cold-root-child'), {
          meta: {
            parentSession: request.parent.session.id,
            seedLength: 0,
            origin: 'subagent',
            delegationDepth: 1,
          },
        })
        session.append('subagent/descriptor', request.descriptor)
        const nested = runtime.ctx.sessions.create(SessionId('cold-nested-child'), {
          meta: {
            parentSession: session.id,
            seedLength: 0,
            origin: 'subagent',
            delegationDepth: 2,
          },
        })
        nested.append('subagent/descriptor', request.descriptor)
        const child = { id: session.id, session, status: 'idle' } as unknown as Agent
        const remove = runtime.ctx.agents.register(child)
        return {
          id: child.id,
          localAgent: child,
          result: Promise.resolve(completed()),
          async dispose() { remove() },
        }
      },
    }, true)
    const publisher = new RecordingPublisher(runtime.ctx)
    const observe = runtime.ctx.sessionQuery.observeSession.bind(runtime.ctx.sessionQuery)
    let descendantLease: Awaited<ReturnType<typeof observe>> | undefined
    vi.spyOn(runtime.ctx.sessionQuery, 'observeSession').mockImplementation(async (id, options) => {
      const lease = await observe(id, options)
      if (id === SessionId('cold-nested-child')) descendantLease = lease
      return lease
    })
    const { snapshot, plan } = executionPlan()

    const outcome = await executeStrategyPlan(
      runtime.ctx,
      snapshot,
      plan,
      runtime.parent,
      new AbortController().signal,
    )

    expect(outcome.kind).toBe('completed')
    expect(latestReceipt(publisher).participation.rows).toEqual([
      expect.objectContaining({ childId: 'cold-root-child', runId: expect.any(String) }),
      expect.objectContaining({ childId: 'cold-nested-child', runId: null, provider: null, state: 'ended' }),
    ])
    expect(descendantLease).toBeDefined()
    expect(() => descendantLease?.retain()).toThrow(/disposed/)
  })

  it('reports exact participant truncation in the full Receipt and summary', async () => {
    let runtime!: Awaited<ReturnType<typeof setup>>
    runtime = await setup({
      name: 'remote',
      capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
      inheritsParentContext: false,
      async start(request: ResolvedSubagentStartRequest) {
        const session = runtime.ctx.sessions.create(SessionId('truncation-root-child'), {
          meta: {
            parentSession: request.parent.session.id,
            seedLength: 0,
            origin: 'subagent',
            delegationDepth: 1,
          },
        })
        session.append('subagent/descriptor', request.descriptor)
        for (let index = 0; index < RECEIPT_FEED_LIMITS.participantsPerReceipt + 1; index += 1) {
          const nested = runtime.ctx.sessions.create(SessionId(`truncation-nested-${String(index).padStart(3, '0')}`), {
            meta: {
              parentSession: session.id,
              seedLength: 0,
              origin: 'subagent',
              delegationDepth: 2,
            },
          })
          nested.append('subagent/descriptor', request.descriptor)
        }
        const child = { id: session.id, session, status: 'idle' } as unknown as Agent
        const remove = runtime.ctx.agents.register(child)
        return {
          id: child.id,
          localAgent: child,
          result: Promise.resolve(completed()),
          async dispose() { remove() },
        }
      },
    }, true)
    const publisher = new RecordingPublisher(runtime.ctx)
    const { snapshot, plan } = executionPlan()

    const outcome = await executeStrategyPlan(
      runtime.ctx,
      snapshot,
      plan,
      runtime.parent,
      new AbortController().signal,
    )
    const receipt = latestReceipt(publisher)

    expect(outcome.kind).toBe('completed')
    expect(receipt.participation).toMatchObject({
      coverage: {
        status: 'partial',
        total: RECEIPT_FEED_LIMITS.participantsPerReceipt + 2,
        reported: RECEIPT_FEED_LIMITS.participantsPerReceipt,
        truncated: 2,
      },
    })
    expect(receipt.participation.rows).toHaveLength(RECEIPT_FEED_LIMITS.participantsPerReceipt)
    expect(outcome.receipt).toMatchObject({
      participationCounts: { total: RECEIPT_FEED_LIMITS.participantsPerReceipt },
      truncatedCounts: { participation: 2, tokenSessions: 2 },
      coverage: { participation: 'partial', tokens: 'unavailable' },
    })
    expect(Object.values(outcome.receipt).some(Array.isArray)).toBe(false)
  })

  it('accounts only post-seed complete retry attempts plus reported compaction usage', async () => {
    const seed = Session.create(SessionId('seed-source'))
    appendUsageTurn(seed, {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 150,
      cacheReadTokens: 30,
      cacheWriteTokens: 0,
    })
    let runtime!: Awaited<ReturnType<typeof setup>>
    runtime = await setup({
      name: 'remote',
      capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
      inheritsParentContext: false,
      async start(request: ResolvedSubagentStartRequest) {
        const session = runtime.ctx.sessions.create(SessionId('settled-fork-child'), {
          seed: seed.events,
          meta: {
            parentSession: request.parent.session.id,
            seedLength: seed.events.length,
            origin: 'subagent',
            delegationDepth: 1,
          },
        })
        session.append('subagent/descriptor', request.descriptor)
        appendRetryTurn(session)
        session.append('compaction/summary', {
          compactionId: 'compaction-1',
          summary: [{ type: 'text', text: 'summary' }],
          shadowedRange: { start: 0, end: 1 },
          shadowedSeqs: [0, 1],
          shadowedTokenCount: 1,
          provider: 'test-provider',
          model: 'test-model',
          usage: {
            inputTokens: 6,
            outputTokens: 2,
            totalTokens: 10,
            cacheReadTokens: 2,
            cacheWriteTokens: 0,
          },
        } as never)
        const child = { id: session.id, session, status: 'idle' } as unknown as Agent
        const remove = runtime.ctx.agents.register(child)
        return {
          id: child.id,
          localAgent: child,
          result: Promise.resolve(completed()),
          async dispose() { remove() },
        }
      },
    }, true)
    const publisher = new RecordingPublisher(runtime.ctx)
    const { snapshot, plan } = executionPlan()

    const outcome = await executeStrategyPlan(
      runtime.ctx,
      snapshot,
      plan,
      runtime.parent,
      new AbortController().signal,
    )

    expect(outcome.kind).toBe('completed')
    expect(latestReceipt(publisher).tokenAccount.sessions).toEqual([expect.objectContaining({
      childId: 'settled-fork-child',
      totalTokens: { status: 'reported', value: 32, source: 'session-fold' },
      uncachedInputTokens: { status: 'reported', value: 20, source: 'session-fold' },
      outputTokens: { status: 'reported', value: 5, source: 'session-fold' },
      cacheReadTokens: { status: 'reported', value: 7, source: 'session-fold' },
      cacheWriteTokens: { status: 'reported', value: 0, source: 'session-fold' },
    })])
    expect(outcome.receipt.tokenTotals).toEqual({
      totalTokens: 32,
      uncachedInputTokens: 20,
      outputTokens: 5,
      cacheReadTokens: 7,
      cacheWriteTokens: 0,
    })
  })

  it('keeps absent provider cache buckets unavailable rather than reporting zero', async () => {
    let runtime!: Awaited<ReturnType<typeof setup>>
    runtime = await setup({
      name: 'remote',
      capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
      inheritsParentContext: false,
      async start(request: ResolvedSubagentStartRequest) {
        const session = runtime.ctx.sessions.create(SessionId('cache-absent-child'), {
          meta: {
            parentSession: request.parent.session.id,
            seedLength: 0,
            origin: 'subagent',
            delegationDepth: 1,
          },
        })
        session.append('subagent/descriptor', request.descriptor)
        appendUsageTurn(session, { inputTokens: 8, outputTokens: 2, totalTokens: 10 })
        const child = { id: session.id, session, status: 'idle' } as unknown as Agent
        const remove = runtime.ctx.agents.register(child)
        return {
          id: child.id,
          localAgent: child,
          result: Promise.resolve(completed()),
          async dispose() { remove() },
        }
      },
    }, true)
    const publisher = new RecordingPublisher(runtime.ctx)
    const { snapshot, plan } = executionPlan()

    const outcome = await executeStrategyPlan(
      runtime.ctx,
      snapshot,
      plan,
      runtime.parent,
      new AbortController().signal,
    )

    expect(outcome.kind).toBe('completed')
    expect(latestReceipt(publisher).tokenAccount.sessions[0]).toMatchObject({
      cacheReadTokens: { status: 'unavailable', reason: 'not-reported' },
      cacheWriteTokens: { status: 'unavailable', reason: 'not-reported' },
    })
    expect(outcome.receipt.tokenTotals).toMatchObject({ cacheReadTokens: null, cacheWriteTokens: null })
    expect(outcome.receipt.coverage.tokens).toBe('partial')
  })
})
