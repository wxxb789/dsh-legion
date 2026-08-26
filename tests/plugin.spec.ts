import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  LlmAdapter,
  LlmError,
  LlmRuntime,
  MessageId,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry, { emitAgentEvent, type Agent, type AgentStatus } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type {
  ResolvedSubagentStartRequest,
  SubagentDescendantListEntry,
  SubagentProvider,
  SubagentResult,
  SubagentStartRequest,
} from '@deepseek-ai/dsh-subagent'
import * as legion from '../src/index.ts'
import {
  mountTestTokenAccounting,
  TestSessionProjections,
  TestTokenMeter,
} from './token-meter-test-service.ts'

const signal = new AbortController().signal
let callSequence = 0

class RouteAdapter extends LlmAdapter {
  constructor(
    private readonly models: Readonly<Record<string, LlmResolvedModelInfo | Error>>,
    private readonly onResolve?: () => void,
  ) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    this.onResolve?.()
    const value = this.models[model]
    return value instanceof Error
      ? Promise.reject(value)
      : Promise.resolve(value ?? { provider, id: model, name: model })
  }

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function parent(id = 'parent'): Agent {
  const session = Session.create(SessionId(id))
  return { id: session.id, session } as unknown as Agent
}

function registryAgent(id: string, status: AgentStatus, parentId?: SessionId): Agent {
  const initial = Session.create(SessionId(id))
  const session = parentId === undefined
    ? initial
    : Session.create(initial.id, [], {
        ...initial.header,
        parentSession: parentId,
        origin: 'subagent',
        delegationDepth: 1,
      })
  return { id: session.id, session, status } as unknown as Agent
}

function setAgentStatus(agent: Agent, status: AgentStatus): void {
  (agent as { status: AgentStatus }).status = status
}

function provider(
  name: string,
  options: {
    reply?: string
    stopReason?: 'completed' | 'error' | 'aborted' | 'max-tokens' | 'refusal'
    capabilities?: SubagentProvider['capabilities']
    continuable?: boolean
    resultError?: Error
    result?: (request: ResolvedSubagentStartRequest) => Promise<SubagentResult> | SubagentResult
    structured?: unknown
    disposeError?: Error
    onDispose?: () => void
    onStart?: (request: ResolvedSubagentStartRequest) => void
  } = {},
): SubagentProvider {
  const result: SubagentProvider = {
    name,
    capabilities: options.capabilities ?? {
      outputSchema: true,
      depthLimit: true,
      toolFilter: true,
      persona: true,
    },
    inheritsParentContext: false,
    async start(request) {
      options.onStart?.(request)
      return {
        id: SessionId(`${name}-child`),
        localAgent: undefined,
        result: options.resultError === undefined
          ? Promise.resolve(options.result?.(request) ?? {
              output: [{ type: 'text', text: options.reply ?? 'child result' }],
              ...options.structured === undefined ? {} : { structured: options.structured },
              stopReason: options.stopReason ?? 'completed',
            })
          : Promise.reject(options.resultError),
        async dispose() {
          options.onDispose?.()
          if (options.disposeError !== undefined) throw options.disposeError
        },
      }
    },
  }
  if (options.continuable !== false) {
    result.prepareContinuable = async () => ({})
  }
  return result
}

function projections(ctx: Context): TestSessionProjections {
  return (ctx as unknown as { get(name: string): unknown }).get('sessionProjections') as TestSessionProjections
}

function setTokenSample(
  ctx: Context,
  session: Session,
  usage: {
    readonly uncachedInputTokens: number
    readonly outputTokens: number
    readonly cacheReadTokens: number
    readonly cacheWriteTokens: number
  },
  measurement: { readonly totalTokens: number; readonly surfaceTokens: number },
): void {
  projections(ctx).setValue(session, 'tokenUsage', usage)
  ;((ctx as unknown as { get(name: string): unknown }).get('tokenMeter') as TestTokenMeter).set(session, measurement)
}

async function mountAccountingServices(ctx: Context): Promise<void> {
  await ctx.plugin(SessionStore)
  await mountTestTokenAccounting(ctx)
}

async function setup(
  config: unknown,
  providers: SubagentProvider[] = [provider('spawn')],
): Promise<Context> {
  const ctx = new Context()
  await mountAccountingServices(ctx)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SubagentRuntime)
  for (const item of providers) ctx.subagents.registerProvider(item)
  await ctx.plugin(legion, config as legion.LegionConfig)
  return ctx
}

function execute(
  ctx: Context,
  args: unknown,
  agent: Agent | null = parent(),
  callSignal: AbortSignal = signal,
) {
  return ctx.tools.execute({
    signal: callSignal,
    callId: CallId(`legion-${++callSequence}`),
    name: 'legion',
    arguments: args,
    ...agent === null ? {} : { agent },
  })
}

function rendered(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

function legionParameterProperties(ctx: Context): Record<string, { enum?: string[]; required?: boolean }> {
  const schema = ctx.tools.schemas().find(item => item.name === 'legion')
  if (schema === undefined) throw new Error('expected Legion tool schema')
  const parameters = schema.parameters as {
    properties?: Record<string, { enum?: string[]; required?: boolean }>
    oneOf?: Array<{ properties?: Record<string, { enum?: string[]; required?: boolean }> }>
  }
  if (parameters.properties !== undefined) return parameters.properties
  return Object.assign({}, ...parameters.oneOf?.map(branch => branch.properties ?? {}) ?? [])
}

const baseConfig = {
  profiles: {
    quick: {
      description: 'Cheap exploration and summaries.',
      subagentProvider: 'spawn',
      agentOptions: { provider: 'fast-route', model: 'fast-model', maxTokens: 2048 },
      persona: 'Work quickly and return concise evidence.',
      toolFilter: { allow: ['read', 'grep'] },
      maxDepth: 2,
      defaultRunInBackground: false,
    },
    deep: {
      description: 'Complex implementation and architecture.',
      subagentProvider: 'spawn',
      agentOptions: { provider: 'sota-route', model: 'sota-model' },
      maxDepth: 3,
      defaultRunInBackground: true,
    },
  },
  defaultProfile: 'quick',
}

async function capturedForeground(): Promise<{
  request: SubagentStartRequest | undefined
  ctx: Context
  result: Awaited<ReturnType<typeof execute>>
}> {
  let request: SubagentStartRequest | undefined
  const capture = provider('spawn', { onStart: value => { request = value } })
  const ctx = await setup(baseConfig, [capture])
  const result = await execute(ctx, {
    description: 'scan repository',
    prompt: 'Find the relevant modules.',
    run_in_background: false,
  })
  return { request, ctx, result }
}

describe('dsh-legion', () => {
  it('rejects self-contained string constraints in the Schemastery Config', () => {
    const profile = { description: 'Focused work.' }
    expect(() => legion.Config({ toolName: '', profiles: { quick: profile } } as never)).toThrow()
    expect(() => legion.Config({ profiles: { quick: { description: '' } } } as never)).toThrow()
    expect(() => legion.Config({ profiles: { quick: profile }, defaultProfile: '../escape' } as never)).toThrow()
    expect(() => legion.Config({
      profiles: { quick: { ...profile, agentOptions: { provider: '', model: 'model' } } },
    } as never)).toThrow()
    expect(() => legion.Config({
      profiles: { quick: { ...profile, toolFilter: { allow: [''] } } },
    } as never)).toThrow()
  })

  it('publishes one semantic-profile tool and generated routing guidance', async () => {
    const ctx = await setup(baseConfig)
    const schema = ctx.tools.schemas().find(item => item.name === 'legion')
    expect(schema).toBeDefined()
    if (schema === undefined) throw new Error('expected Legion tool schema')
    const properties = (schema.parameters as {
      properties: Record<string, { description?: string; enum?: string[]; required?: boolean }>
    }).properties
    expect(schema.description).toContain('configured Legion Specialist')
    expect(schema.description).not.toMatch(/\b(?:profile|team)s?\b/iu)
    expect(properties.specialist?.enum).toEqual(['deep', 'quick'])
    expect(properties.specialist?.required).not.toBe(true)
    expect(properties.specialist?.description).toContain('Configured Specialist')
    expect(Object.keys(properties).sort()).toEqual([
      'description', 'prompt', 'run_in_background', 'specialist',
    ])

    const prompt = await ctx.systemPrompt.assemble()
    const guidance = prompt.sections.find(section => section.name === 'tool:legion')?.text
    expect(guidance).toContain('`quick`: Cheap exploration and summaries.')
    expect(guidance).toContain('fast-route/fast-model')
    expect(guidance).toContain('Omitting specialist selects `quick`.')
    expect(guidance).not.toMatch(/\b(?:profile|team)s?\b/iu)
  })

  it('keeps Strategy authority fully absent unless explicitly enabled', async () => {
    let starts = 0
    const ctx = await setup(baseConfig, [provider('spawn', { onStart: () => { starts += 1 } })])
    const properties = legionParameterProperties(ctx)
    expect(properties).not.toHaveProperty('kind')
    expect(properties).not.toHaveProperty('strategy')
    expect((await ctx.systemPrompt.assemble()).sections.find(section => section.name === 'tool:legion')?.text)
      .not.toContain('Cohort Strategies')
    const result = await execute(ctx, {
      kind: 'strategy',
      strategy: 'independent-review',
      objective: 'Do not start.',
    })
    expect(result.isError).toBe(true)
    expect(rendered(result)).toContain('invalid arguments')
    expect(starts).toBe(0)
  })

  it('executes explicitly enabled Strategies through the single Legion tool and keeps legacy Profile calls', async () => {
    const starts: ResolvedSubagentStartRequest[] = []
    const review = {
      verdict: 'pass',
      summary: 'Looks good.',
      findings: [],
      verification: ['checked'],
    }
    const ctx = await setup({
      configVersion: 2,
      enableStrategies: true,
      enableRunInBackground: true,
      catalogLayers: [legion.DEFAULT_CATALOG_LAYER],
      profiles: {
        deep: {
          description: 'Deep.', subagentProvider: 'spawn', maxDepth: 2,
          defaultRunInBackground: false, result: 'text',
        },
        quick: {
          description: 'Quick.', subagentProvider: 'spawn', maxDepth: 2,
          defaultRunInBackground: false, result: 'text',
        },
        review: {
          description: 'Review.', subagentProvider: 'spawn', maxDepth: 2,
          defaultRunInBackground: false, result: 'review-v1',
        },
      },
      defaultProfile: 'quick',
    }, [provider('spawn', {
      onStart: request => starts.push(request),
      result: request => request.outputSchema === undefined
        ? { output: [{ type: 'text', text: 'execution evidence' }], stopReason: 'completed' }
        : { output: [{ type: 'text', text: 'reviewed' }], structured: review, stopReason: 'completed' },
    })])
    const rawParameters = ctx.tools.schemas().find(item => item.name === 'legion')?.parameters as {
      oneOf?: Array<{ additionalProperties?: boolean; required?: string[] }>
    }
    expect(rawParameters.oneOf).toMatchObject([
      { additionalProperties: false, required: ['description', 'prompt'] },
      { additionalProperties: false, required: ['kind', 'strategy', 'objective'] },
    ])
    const properties = legionParameterProperties(ctx)
    expect(properties.kind).toBeDefined()
    expect(properties).not.toHaveProperty('profile')
    expect(properties.specialist?.enum).toEqual(['deep', 'quick', 'review'])
    expect(properties.strategy?.enum).toEqual([
      'independent-review', 'plan-execute-review', 'research-panel',
    ])
    expect(properties.description?.required).not.toBe(true)
    const guidance = (await ctx.systemPrompt.assemble()).sections
      .find(section => section.name === 'tool:legion')?.text
    expect(guidance).toContain('Configured bounded Cohort Strategies')
    expect(guidance).toContain('(cohort:')
    expect(guidance).not.toMatch(/\b(?:profile|team)s?\b/iu)
    expect(guidance).toContain('`independent-review`')

    const strategyResult = await execute(ctx, {
      kind: 'strategy',
      strategy: 'independent-review',
      objective: 'Implement and review the change.',
      limits: { deadlineMs: 60_000 },
    })
    expect(strategyResult.isError).toBe(false)
    if (strategyResult.isError) throw new Error(rendered(strategyResult))
    expect(strategyResult.value).toMatchObject({
      kind: 'strategy',
      strategy: 'independent-review',
      outcome: {
        kind: 'completed',
        final: { name: 'review', contract: 'review-v1', value: review },
      },
    })
    expect(starts).toHaveLength(2)

    const specialistResult = await execute(ctx, {
      specialist: 'quick',
      description: 'canonical specialist call',
      prompt: 'Use the model-facing vocabulary.',
      run_in_background: false,
    })
    expect(specialistResult.isError).toBe(false)
    expect(starts).toHaveLength(3)

    const legacyProfileResult = await execute(ctx, {
      profile: 'quick',
      description: 'legacy profile call',
      prompt: 'Remain compatible.',
      run_in_background: false,
    })
    expect(legacyProfileResult.isError).toBe(false)
    expect(starts).toHaveLength(4)

    const ambiguousSpecialist = await execute(ctx, {
      specialist: 'quick',
      profile: 'quick',
      description: 'ambiguous specialist call',
      prompt: 'Reject both names together.',
      run_in_background: false,
    })
    expect(ambiguousSpecialist.isError).toBe(true)
    expect(rendered(ambiguousSpecialist)).toContain('specialist and deprecated profile cannot be combined')
    expect(starts).toHaveLength(4)

    const mixed = await execute(ctx, {
      kind: 'strategy',
      strategy: 'independent-review',
      objective: 'Reject mixed fields.',
      prompt: 'Not allowed.',
    })
    expect(mixed.isError).toBe(true)
    expect(rendered(mixed)).toContain('unknown field(s): prompt')
    const widened = await execute(ctx, {
      kind: 'strategy',
      strategy: 'independent-review',
      objective: 'Reject widening.',
      limits: { maxAgents: 99 },
    })
    expect(widened.isError).toBe(true)
    expect(rendered(widened)).toContain('STRATEGY_LIMIT_WIDENING')
    expect(starts).toHaveLength(4)
  })

  it('publishes a settlement-driven Run Receipt and bounded tool summary', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    try {
      const first = Promise.withResolvers<SubagentResult>()
      const second = Promise.withResolvers<SubagentResult>()
      const starts: Array<Record<string, unknown>> = []
      let ctx!: Context
      let session!: Session
      let index = 0
      const capture = provider('spawn', {
        onStart: () => {
          starts.push(structuredClone(
            projections(ctx).snapshot(session).values['legion/run-receipts'] as Record<string, unknown>,
          ))
        },
        result: () => index++ === 0 ? first.promise : second.promise,
      })
      ctx = new Context()
      await mountAccountingServices(ctx)
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(SubagentRuntime)
      ctx.subagents.registerProvider(capture)
      await ctx.plugin(legion, {
        configVersion: 2,
        toolName: 'legion',
        enableRunInBackground: true,
        enableStrategies: true,
        catalogLayers: [legion.DEFAULT_CATALOG_LAYER],
        profiles: {
          deep: {
            description: 'Deep.', subagentProvider: 'spawn', maxDepth: 2,
            defaultRunInBackground: false, result: 'text',
          },
          quick: {
            description: 'Quick.', subagentProvider: 'spawn', maxDepth: 2,
            defaultRunInBackground: false, result: 'text',
          },
          review: {
            description: 'Review.', subagentProvider: 'spawn', maxDepth: 2,
            defaultRunInBackground: false, result: 'review-v1',
          },
        },
        defaultProfile: 'quick',
      })
      session = ctx.sessions.create(SessionId('receipt-parent'))
      const agent = { id: session.id, session } as unknown as Agent

      const pending = execute(ctx, {
        kind: 'strategy',
        strategy: 'independent-review',
        objective: 'Publish the graph before execution.',
      }, agent)
      for (let step = 0; step < 30 && starts.length < 1; step += 1) await Promise.resolve()

      const beforeFirstStart = starts[0] as { receipts: Record<string, { stages: unknown[] }> }
      const runId = Object.keys(beforeFirstStart.receipts)[0]!
      expect(beforeFirstStart.receipts[runId]).toMatchObject({
        runId,
        strategy: 'independent-review',
        cohort: 'independent-review',
        outcome: 'running',
        elapsedMs: 0,
        stages: [
          { id: 'execute', after: [], status: 'pending' },
          { id: 'review', after: ['execute'], status: 'pending' },
        ],
      })

      vi.setSystemTime(1_700_000_000_100)
      first.resolve({ output: [{ type: 'text', text: 'execution evidence' }], stopReason: 'completed' })
      for (let step = 0; step < 30 && starts.length < 2; step += 1) await Promise.resolve()
      const beforeSecondStart = starts[1] as typeof beforeFirstStart
      expect(beforeSecondStart.receipts[runId]?.stages).toMatchObject([
        { id: 'execute', status: 'completed' },
        { id: 'review', status: 'pending' },
      ])

      vi.setSystemTime(1_700_000_000_250)
      second.resolve({
        output: [{ type: 'text', text: 'reviewed' }],
        structured: { verdict: 'pass', summary: 'Good.', findings: [], verification: ['checked'] },
        stopReason: 'completed',
      })
      const result = await pending
      expect(result.isError).toBe(false)
      if (result.isError) throw new Error(rendered(result))

      const projection = projections(ctx).snapshot(session).values['legion/run-receipts'] as {
        receipts: Record<string, Record<string, unknown>>
      }
      expect(projection.receipts[runId]).toMatchObject({
        outcome: 'completed',
        elapsedMs: 250,
        stages: [
          { id: 'execute', status: 'completed' },
          { id: 'review', status: 'completed' },
        ],
      })
      expect(JSON.stringify(projection.receipts[runId])).not.toMatch(/money|cost|price|currency/iu)
      expect(result.value).toMatchObject({
        kind: 'strategy',
        strategy: 'independent-review',
        receipt: {
          runId,
          outcome: 'completed',
          elapsedMs: 250,
          stageCounts: { total: 2, pending: 0, completed: 2, degraded: 0, cancelled: 0, failed: 0 },
        },
      })
      expect(Object.values((result.value as { receipt: Record<string, unknown> }).receipt).some(Array.isArray)).toBe(false)
      expect(rendered(result)).toContain('Run receipt: completed in 250ms; stages 2/2 settled')
    } finally {
      vi.useRealTimers()
    }
  })

  it('samples per-session tokens on status and settlement and explicitly sums the child tree', async () => {
    const results = [Promise.withResolvers<SubagentResult>(), Promise.withResolvers<SubagentResult>()]
    const first = registryAgent('receipt-live-first', 'running')
    const nested = registryAgent('receipt-cold-grandchild', 'running', first.id)
    const unrelated = registryAgent('receipt-unrelated', 'running')
    const second = registryAgent('receipt-live-second', 'running')
    const removers: Array<() => void> = []
    let starts = 0
    const ctx = new Context()
    await mountAccountingServices(ctx)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    // These Agents predate the run observer, so their sessions can only come from backfill.
    removers.push(ctx.agents.register(first), ctx.agents.register(nested), ctx.agents.register(unrelated))
    const zeroUsage = {
      uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    }
    setTokenSample(ctx, first.session, zeroUsage, { totalTokens: 0, surfaceTokens: 0 })
    setTokenSample(ctx, nested.session, zeroUsage, { totalTokens: 0, surfaceTokens: 0 })
    setTokenSample(ctx, second.session, zeroUsage, { totalTokens: 0, surfaceTokens: 0 })
    setTokenSample(ctx, unrelated.session, {
      uncachedInputTokens: 100, outputTokens: 100, cacheReadTokens: 100, cacheWriteTokens: 100,
    }, { totalTokens: 400, surfaceTokens: 400 })
    ctx.subagents.registerProvider({
      name: 'spawn',
      capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
      inheritsParentContext: false,
      async start() {
        const index = starts++
        const child = index === 0 ? first : second
        const remove = index === 0 ? removers[0]! : ctx.agents.register(child)
        if (index !== 0) removers.push(remove)
        return {
          id: child.id,
          localAgent: child,
          result: results[index]!.promise,
          async dispose() { remove() },
        }
      },
    })
    const coldChildren: SubagentDescendantListEntry[] = [
      { kind: 'child', id: first.id, parentId: SessionId('receipt-registry-parent'), depth: 1, activity: 'inactive', hasChildren: true, mode: 'one-shot', label: 'execute executor' },
      { kind: 'child', id: nested.id, parentId: first.id, depth: 2, activity: 'inactive', hasChildren: false, mode: 'one-shot', label: 'nested child' },
      { kind: 'child', id: second.id, parentId: SessionId('receipt-registry-parent'), depth: 1, activity: 'inactive', hasChildren: false, mode: 'one-shot', label: 'review reviewer' },
    ]
    vi.spyOn(ctx.subagents, 'listDescendants').mockImplementation(async () => {
      // Reusing an ended id must not let live registry state contaminate the cold tree.
      removers.push(ctx.agents.register(registryAgent(String(first.id), 'running')))
      return coldChildren
    })
    await ctx.plugin(legion, {
      configVersion: 2,
      toolName: 'legion',
      enableRunInBackground: true,
      enableStrategies: true,
      catalogLayers: [legion.DEFAULT_CATALOG_LAYER],
      profiles: {
        deep: { description: 'Deep.', subagentProvider: 'spawn', maxDepth: 2, defaultRunInBackground: false, result: 'text' },
        quick: { description: 'Quick.', subagentProvider: 'spawn', maxDepth: 2, defaultRunInBackground: false, result: 'text' },
        review: { description: 'Review.', subagentProvider: 'spawn', maxDepth: 2, defaultRunInBackground: false, result: 'review-v1' },
      },
      defaultProfile: 'quick',
    })
    const session = ctx.sessions.create(SessionId('receipt-registry-parent'))
    const agent = { id: session.id, session } as unknown as Agent
    const snapshot = () => projections(ctx).snapshot(session).values['legion/run-receipts'] as {
      receipts: Record<string, {
        participation: Array<Record<string, unknown>>
        tokenAccount: {
          totals: Record<string, number>
          sessions: Array<Record<string, unknown>>
        }
      }>
    }

    try {
      const pending = execute(ctx, {
        kind: 'strategy',
        strategy: 'independent-review',
        objective: 'Observe registry participation without model narration.',
      }, agent)
      await vi.waitFor(() => expect(starts).toBe(1))
      const runId = Object.keys(snapshot().receipts)[0]!
      expect(snapshot().receipts[runId]?.participation).toEqual([{
        childId: first.id,
        parentId: session.id,
        depth: 1,
        stage: 'execute',
        member: 'executor',
        childIndex: 0,
        state: 'live',
        registryStatus: 'running',
      }, {
        childId: nested.id,
        parentId: first.id,
        depth: 2,
        stage: 'execute',
        member: 'executor',
        childIndex: 0,
        state: 'live',
        registryStatus: 'running',
      }])

      setTokenSample(ctx, first.session, {
        uncachedInputTokens: 10, outputTokens: 4, cacheReadTokens: 7, cacheWriteTokens: 2,
      }, { totalTokens: 30, surfaceTokens: 11 })
      // Reading the projection does not sample the O(surface) Host meter.
      expect(snapshot().receipts[runId]?.tokenAccount.totals.totalTokens).toBe(0)
      setAgentStatus(first, 'idle')
      emitAgentEvent(ctx, first, 'agent/status', { status: 'idle' })
      expect(snapshot().receipts[runId]?.participation).toMatchObject([
        { childId: first.id, state: 'live', registryStatus: 'idle' },
        { childId: nested.id, state: 'live', registryStatus: 'running' },
      ])
      expect(snapshot().receipts[runId]?.tokenAccount).toMatchObject({
        totals: {
          totalTokens: 23,
          uncachedInputTokens: 10,
          outputTokens: 4,
          cacheReadTokens: 7,
          cacheWriteTokens: 2,
        },
        sessions: [
          { childId: first.id, stage: 'execute', member: 'executor', totalTokens: 23 },
          { childId: nested.id, stage: 'execute', member: 'executor', totalTokens: 0 },
        ],
      })
      setTokenSample(ctx, nested.session, {
        uncachedInputTokens: 3, outputTokens: 1, cacheReadTokens: 5, cacheWriteTokens: 0,
      }, { totalTokens: 12, surfaceTokens: 5 })
      expect(snapshot().receipts[runId]?.tokenAccount.totals.totalTokens).toBe(23)
      setAgentStatus(nested, 'idle')
      emitAgentEvent(ctx, nested, 'agent/status', { status: 'idle' })
      expect(snapshot().receipts[runId]?.tokenAccount.totals).toMatchObject({
        totalTokens: 32,
        uncachedInputTokens: 13,
        outputTokens: 5,
        cacheReadTokens: 12,
        cacheWriteTokens: 2,
      })

      results[0]!.resolve({ output: [], stopReason: 'completed' })
      await vi.waitFor(() => expect(starts).toBe(2))
      expect(snapshot().receipts[runId]?.participation).toMatchObject([
        { childId: first.id, state: 'ended' },
        { childId: nested.id, state: 'live', registryStatus: 'idle' },
        { childId: second.id, state: 'live', registryStatus: 'running' },
      ])
      setTokenSample(ctx, second.session, {
        uncachedInputTokens: 6, outputTokens: 2, cacheReadTokens: 8, cacheWriteTokens: 1,
      }, { totalTokens: 20, surfaceTokens: 8 })

      results[1]!.resolve({
        output: [],
        structured: { verdict: 'pass', summary: 'No narration needed.', findings: [], verification: ['registry'] },
        stopReason: 'completed',
      })
      const result = await pending
      expect(result.isError).toBe(false)
      if (result.isError) throw new Error(rendered(result))
      expect(snapshot().receipts[runId]?.participation).toEqual([
        { childId: first.id, parentId: session.id, depth: 1, stage: 'execute', member: 'executor', childIndex: 0, state: 'ended' },
        { childId: nested.id, parentId: first.id, depth: 2, stage: 'execute', member: 'executor', childIndex: 0, state: 'ended' },
        { childId: second.id, parentId: session.id, depth: 1, stage: 'review', member: 'reviewer', childIndex: 0, state: 'ended' },
      ])
      expect(snapshot().receipts[runId]?.tokenAccount).toMatchObject({
        totals: {
          totalTokens: 49,
          uncachedInputTokens: 19,
          outputTokens: 7,
          cacheReadTokens: 20,
          cacheWriteTokens: 3,
        },
        sessions: [
          { childId: first.id, parentId: session.id, depth: 1, stage: 'execute', member: 'executor', totalTokens: 23 },
          { childId: nested.id, parentId: first.id, depth: 2, stage: 'execute', member: 'executor', totalTokens: 9 },
          { childId: second.id, parentId: session.id, depth: 1, stage: 'review', member: 'reviewer', totalTokens: 17 },
        ],
      })
      expect(result.value).toMatchObject({
        receipt: {
          participationCounts: { total: 3, running: 0, idle: 0, ended: 3 },
          tokenTotals: {
            totalTokens: 49,
            uncachedInputTokens: 19,
            outputTokens: 7,
            cacheReadTokens: 20,
            cacheWriteTokens: 3,
          },
        },
      })
      expect(Object.values((result.value as { receipt: Record<string, unknown> }).receipt).some(Array.isArray)).toBe(false)
      expect(rendered(result)).toContain('participation 0 running, 0 idle, 3 ended')
      expect(rendered(result)).toContain('tokens 49 total; 19 uncached input, 20 cache-read')

      const terminal = snapshot().receipts[runId]!
      session.append('legion/run-receipt', {
        ...terminal,
        participation: [{
          childId: first.id, parentId: session.id, depth: 1, stage: 'execute', member: 'executor', childIndex: 0,
          state: 'live', registryStatus: 'ready',
        }],
      } as never)
      expect(snapshot().receipts[runId]).toEqual(terminal)
      session.append('legion/run-receipt', {
        ...terminal,
        tokenAccount: {
          ...terminal.tokenAccount,
          totals: { ...terminal.tokenAccount.totals, totalTokens: 50 },
        },
      } as never)
      expect(snapshot().receipts[runId]).toEqual(terminal)
      expect(JSON.stringify(terminal)).not.toContain('receipt-unrelated')

      const { tokenAccount: _v2TokenAccount, ...versionTwo } = terminal
      const versionTwoRunId = 'team-run-00000000-0000-4000-8000-000000000002'
      session.append('legion/run-receipt', {
        ...versionTwo, schemaVersion: 2, runId: versionTwoRunId,
      } as never)
      expect(snapshot().receipts[versionTwoRunId]).toMatchObject({
        schemaVersion: 3,
        participation: terminal.participation,
        tokenAccount: { totals: { totalTokens: 0 }, sessions: [] },
      })

      const {
        participation: _legacyParticipation,
        tokenAccount: _legacyTokenAccount,
        ...legacy
      } = terminal as Record<string, unknown> & { participation: unknown; tokenAccount: unknown }
      const legacyRunId = 'team-run-00000000-0000-4000-8000-000000000001'
      session.append('legion/run-receipt', { ...legacy, schemaVersion: 1, runId: legacyRunId } as never)
      expect(snapshot().receipts[legacyRunId]).toMatchObject({
        schemaVersion: 3,
        participation: [],
        tokenAccount: { totals: { totalTokens: 0 }, sessions: [] },
      })
    } finally {
      for (const remove of removers) remove()
    }
  })

  it('fails closed when the Host cannot enumerate the complete token tree', async () => {
    const ctx = await setup({
      configVersion: 2,
      enableStrategies: true,
      catalogLayers: [legion.DEFAULT_CATALOG_LAYER],
      profiles: {
        deep: { description: 'Deep.', subagentProvider: 'spawn', maxDepth: 2, defaultRunInBackground: false, result: 'text' },
        quick: { description: 'Quick.', subagentProvider: 'spawn', maxDepth: 2, defaultRunInBackground: false, result: 'text' },
        review: { description: 'Review.', subagentProvider: 'spawn', maxDepth: 2, defaultRunInBackground: false, result: 'review-v1' },
      },
      defaultProfile: 'quick',
    }, [provider('spawn', {
      result: request => request.outputSchema === undefined
        ? { output: [], stopReason: 'completed' }
        : {
            output: [],
            structured: { verdict: 'pass', summary: 'Done.', findings: [], verification: [] },
            stopReason: 'completed',
          },
    })])
    vi.spyOn(ctx.subagents, 'listDescendants').mockRejectedValue(new Error('tree unavailable'))

    const result = await execute(ctx, {
      kind: 'strategy',
      strategy: 'independent-review',
      objective: 'Require a complete account.',
    })
    expect(result.isError).toBe(true)
    expect(rendered(result)).toContain('incomplete Run Receipt child tree')
  })

  it('publishes Strategy schema, guidance, and snapshot from one provider lifecycle generation', async () => {
    const config = {
      configVersion: 2 as const,
      enableStrategies: true,
      catalogLayers: [legion.DEFAULT_CATALOG_LAYER],
      profiles: {
        deep: {
          description: 'Deep.', subagentProvider: 'deep-provider', maxDepth: 2,
          defaultRunInBackground: false, result: 'text' as const,
        },
        quick: {
          description: 'Quick.', subagentProvider: 'spawn', maxDepth: 2,
          defaultRunInBackground: false, result: 'text' as const,
        },
        review: {
          description: 'Review.', subagentProvider: 'review-provider', maxDepth: 2,
          defaultRunInBackground: false, result: 'review-v1' as const,
        },
      },
      defaultProfile: 'quick',
    }
    const ctx = await setup(config)
    const register = vi.spyOn(ctx.tools, 'register')
    const properties = () => legionParameterProperties(ctx)
    expect(properties()).not.toHaveProperty('strategy')
    expect((await ctx.systemPrompt.assemble()).sections.find(section => section.name === 'tool:legion')?.text)
      .not.toContain('Cohort Strategies')

    const removeDeep = ctx.subagents.registerProvider(provider('deep-provider'))
    expect(properties().strategy?.enum).toEqual(['research-panel'])
    const removeReview = ctx.subagents.registerProvider(provider('review-provider'))
    expect(properties().strategy?.enum).toEqual([
      'independent-review', 'plan-execute-review', 'research-panel',
    ])
    expect((await ctx.systemPrompt.assemble()).sections.find(section => section.name === 'tool:legion')?.text)
      .toContain('`plan-execute-review`')

    removeReview()
    expect(properties().strategy?.enum).toEqual(['research-panel'])
    removeDeep()
    expect(properties()).not.toHaveProperty('strategy')
    expect((await ctx.systemPrompt.assemble()).sections.find(section => section.name === 'tool:legion')?.text)
      .not.toContain('Cohort Strategies')
    expect(register).not.toHaveBeenCalled()
  })

  it('rejects unknown model tool arguments at the trust boundary', async () => {
    const ctx = await setup(baseConfig)
    const result = await execute(ctx, {
      description: 'bad args',
      prompt: 'Work.',
      typo: true,
    })
    expect(result.isError).toBe(true)
    expect(rendered(result)).toContain('unknown field(s): typo')
  })

  it('maps a foreground profile to the existing SubagentStartRequest seam', async () => {
    const { request, result } = await capturedForeground()
    expect(result.isError).toBe(false)
    expect(request?.agentOptions).toEqual({
      provider: 'fast-route', model: 'fast-model', maxTokens: 2048,
    })
    expect(request?.persona).toBe('Work quickly and return concise evidence.')
    expect(request?.toolFilter).toEqual({ allow: ['read', 'grep'] })
    expect(request?.maxDepth).toBe(2)
    expect(rendered(result)).toBe('child result')
    if (result.isError) throw new Error('expected foreground success')
    expect(result.value).toMatchObject({
      kind: 'foreground',
      profile: 'quick',
      resultContract: 'text',
      policyDigest: expect.stringMatching(/^sha256:/),
      catalogDigest: expect.stringMatching(/^sha256:/),
      resourceDigest: expect.stringMatching(/^sha256:/),
    })
  })

  it('freezes one exact route before start and never replays another route', async () => {
    const ctx = new Context()
    await mountAccountingServices(ctx)
    await ctx.plugin(AgentRegistry)
    let starts = 0
    let request: ResolvedSubagentStartRequest | undefined
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['models'], new RouteAdapter({
      small: {
        provider: 'models', id: 'small', name: 'Small',
        context: { contextWindow: 16_000 }, defaultMaxTokens: 2_000,
      },
      strong: {
        provider: 'models', id: 'strong', name: 'Strong',
        context: { contextWindow: 128_000 }, defaultMaxTokens: 32_000,
      },
    }))
    ctx.subagents.registerProvider(provider('spawn', {
      onStart: (value) => {
        starts += 1
        request = value
      },
    }))
    await ctx.plugin(legion, {
      toolName: 'legion',
      enableRunInBackground: true,
      profiles: {
        deep: {
          description: 'Route-planned work.',
          subagentProvider: 'spawn',
          routes: [
            {
              id: 'small', provider: 'models', model: 'small',
              constraints: { minContextTokens: 64_000, minEffectiveOutputTokens: 8_000 },
            },
            {
              id: 'strong', provider: 'models', model: 'strong', maxTokens: 16_000,
              constraints: { minContextTokens: 64_000, minEffectiveOutputTokens: 8_000 },
              instructions: 'Use strong-route evidence.',
            },
          ],
          persona: 'Base route persona.',
          maxDepth: 2,
          defaultRunInBackground: false,
        },
      },
      defaultProfile: 'deep',
    })

    const guidance = (await ctx.systemPrompt.assemble()).sections
      .find(section => section.name === 'tool:legion')?.text
    expect(guidance).toContain('small=models/small -> strong=models/strong')
    const result = await execute(ctx, { description: 'route work', prompt: 'Work.' })
    if (result.isError) throw new Error(rendered(result))
    expect(result.isError).toBe(false)
    expect(starts).toBe(1)
    expect(rendered(result)).toContain('selected Legion route strong')
    expect(request?.agentOptions).toEqual({ provider: 'models', model: 'strong', maxTokens: 16_000 })
    expect(request?.persona).toBe('Base route persona.\n\nUse strong-route evidence.')
    if (result.isError) throw new Error('expected route success')
    expect(result.value).toMatchObject({
      routePlan: {
        kind: 'selected-route-plan',
        selected: { id: 'strong', provider: 'models', model: 'strong' },
        decisions: [
          { kind: 'rejected', reasons: ['CONTEXT_CAPACITY_TOO_SMALL', 'EFFECTIVE_OUTPUT_BUDGET_TOO_SMALL'] },
          { kind: 'selected' },
        ],
        liveAvailability: { auth: 'unknown', quota: 'unknown', health: 'unknown' },
      },
    })
  })

  it('rechecks the selected LLM adapter at the child start edge', async () => {
    const ctx = new Context()
    await mountAccountingServices(ctx)
    await ctx.plugin(AgentRegistry)
    let starts = 0
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(LlmRuntime)
    let disposeAdapter: (() => void) | undefined
    const adapter = new RouteAdapter({}, () => disposeAdapter?.())
    disposeAdapter = ctx.llm.registerAdapter(['models'], adapter)
    ctx.subagents.registerProvider(provider('spawn', { onStart: () => { starts += 1 } }))
    await ctx.plugin(legion, {
      toolName: 'legion',
      enableRunInBackground: true,
      profiles: {
        deep: {
          description: 'Drifting route work.',
          subagentProvider: 'spawn',
          routes: [{ id: 'exact', provider: 'models', model: 'model' }],
          maxDepth: 2,
          defaultRunInBackground: false,
        },
      },
      defaultProfile: 'deep',
    })

    const result = await execute(ctx, { description: 'drift check', prompt: 'Work.' })
    expect(result.isError).toBe(true)
    expect(rendered(result)).toContain('disappeared before child start')
    expect(starts).toBe(0)
  })

  it('fails before child start when every exact route has a known static rejection', async () => {
    let starts = 0
    const ctx = new Context()
    await mountAccountingServices(ctx)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['models'], new RouteAdapter({
      model: new LlmError('unknown model', 'UNKNOWN_MODEL'),
    }))
    ctx.subagents.registerProvider(provider('spawn', { onStart: () => { starts += 1 } }))
    await ctx.plugin(legion, {
      toolName: 'legion',
      enableRunInBackground: true,
      profiles: {
        deep: {
          description: 'Unroutable work.',
          subagentProvider: 'spawn',
          routes: [{ id: 'missing', provider: 'models', model: 'model' }],
          maxDepth: 2,
          defaultRunInBackground: false,
        },
      },
      defaultProfile: 'deep',
    })

    const result = await execute(ctx, { description: 'unroutable', prompt: 'Work.' })
    expect(result.isError).toBe(true)
    expect(rendered(result)).toContain('no exact model route passed static preflight')
    expect(starts).toBe(0)
  })

  it('does not replay another route after a selected child fails', async () => {
    const ctx = new Context()
    await mountAccountingServices(ctx)
    await ctx.plugin(AgentRegistry)
    let starts = 0
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['models'], new RouteAdapter({}))
    ctx.subagents.registerProvider(provider('spawn', {
      stopReason: 'error',
      onStart: () => { starts += 1 },
    }))
    await ctx.plugin(legion, {
      toolName: 'legion',
      enableRunInBackground: true,
      profiles: {
        deep: {
          description: 'No replay work.',
          subagentProvider: 'spawn',
          routes: [
            { id: 'first', provider: 'models', model: 'first' },
            { id: 'second', provider: 'models', model: 'second' },
          ],
          maxDepth: 2,
          defaultRunInBackground: false,
        },
      },
      defaultProfile: 'deep',
    })

    const result = await execute(ctx, { description: 'no replay', prompt: 'Work.' })
    expect(result.isError).toBe(true)
    expect(starts).toBe(1)
    expect(rendered(result)).toContain('Legion child run failed')
  })

  it('surfaces the provider diagnostic beside the stop reason when the Host supplies one', async () => {
    const ctx = new Context()
    await mountAccountingServices(ctx)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['models'], new RouteAdapter({}))
    ctx.subagents.registerProvider(provider('spawn', {
      // `diagnostic` arrived in DSH 0.1.0-rc.8 and is absent below the declared
      // floor, so the literal is asserted rather than declared — the same
      // validated read settlement.ts performs on an untyped member.
      result: () => ({
        output: [],
        stopReason: 'error',
        diagnostic: 'provider gateway returned 502 after 3 attempts',
      } as SubagentResult),
    }))
    await ctx.plugin(legion, {
      toolName: 'legion',
      enableRunInBackground: false,
      profiles: {
        deep: {
          description: 'Diagnostic carrier.',
          subagentProvider: 'spawn',
          routes: [{ id: 'first', provider: 'models', model: 'first' }],
          maxDepth: 2,
          defaultRunInBackground: false,
        },
      },
      defaultProfile: 'deep',
    })

    const result = await execute(ctx, { description: 'diagnostic', prompt: 'Work.' })
    expect(result.isError).toBe(true)
    const text = rendered(result)
    // The stable stop-reason phrasing survives; the provider account is appended.
    expect(text).toContain('Legion child run failed')
    expect(text).toContain('provider gateway returned 502 after 3 attempts')
  })

  it('keeps the stop reason alone when the provider supplies no diagnostic', async () => {
    const ctx = new Context()
    await mountAccountingServices(ctx)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['models'], new RouteAdapter({}))
    ctx.subagents.registerProvider(provider('spawn', { stopReason: 'refusal' }))
    await ctx.plugin(legion, {
      toolName: 'legion',
      enableRunInBackground: false,
      profiles: {
        deep: {
          description: 'No diagnostic.',
          subagentProvider: 'spawn',
          routes: [{ id: 'first', provider: 'models', model: 'first' }],
          maxDepth: 2,
          defaultRunInBackground: false,
        },
      },
      defaultProfile: 'deep',
    })

    const result = await execute(ctx, { description: 'no diagnostic', prompt: 'Work.' })
    expect(result.isError).toBe(true)
    expect(rendered(result)).toContain('Legion child declined the task')
    expect(rendered(result)).not.toContain('provider diagnostic')
  })

  it('loads confined prompt fragments before registration and installs them as child persona', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-legion-plugin-resources-'))
    mkdirSync(join(root, 'resources', 'prompts'), { recursive: true })
    writeFileSync(join(root, 'resources', 'prompts', 'review.md'), 'Follow the resource instruction.')
    const ctx = new Context()
    await mountAccountingServices(ctx)
    await ctx.plugin(AgentRegistry)
    let request: SubagentStartRequest | undefined
    try {
      ctx.baseUrl = pathToFileURL(root).href + '/'
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(SubagentRuntime)
      ctx.subagents.registerProvider(provider('spawn', { onStart: value => { request = value } }))
      await ctx.plugin(legion, {
        toolName: 'legion',
        enableRunInBackground: true,
        resourceRoots: { local: 'resources' },
        maxResourceBytes: 65536,
        profiles: {
          review: {
            description: 'Resource review.',
            subagentProvider: 'spawn',
            maxDepth: 2,
            defaultRunInBackground: false,
            promptFiles: [{ root: 'local', path: 'prompts/review.md' }],
          },
        },
        defaultProfile: 'review',
      })
      const guidance = (await ctx.systemPrompt.assemble()).sections
        .find(section => section.name === 'tool:legion')?.text
      expect(guidance).toContain('instructions: 1 fragment(s)')
      const result = await execute(ctx, {
        description: 'resource review',
        prompt: 'Review the change.',
      })
      expect(result.isError).toBe(false)
      expect(request?.persona).toContain('## Legion profile instruction: local:prompts/review.md')
      expect(request?.persona).toContain('Follow the resource instruction.')
      if (result.isError) throw new Error('expected resource profile success')
      expect(result.value).toMatchObject({ resourceDigest: expect.stringMatching(/^sha256:/) })
    } finally {
      await ctx.fiber.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('passes a versioned output schema and returns detached structured review data', async () => {
    let request: SubagentStartRequest | undefined
    const structured = {
      verdict: 'needs-changes',
      summary: 'One issue.',
      findings: [{
        severity: 'high',
        title: 'Unsafe retry',
        detail: 'Replay may repeat mutation.',
        evidence: [{ source: 'src/retry.ts:9', detail: 'Starts another child.' }],
        recommendation: 'Use one recovery owner.',
      }],
      verification: ['reproduction test'],
    }
    const ctx = await setup({
      profiles: {
        review: {
          description: 'Structured review.',
          subagentProvider: 'spawn',
          maxDepth: 2,
          defaultRunInBackground: false,
          result: 'review-v1',
        },
      },
      defaultProfile: 'review',
    }, [provider('spawn', {
      structured,
      onStart: value => { request = value },
    })])

    const result = await execute(ctx, {
      description: 'review change',
      prompt: 'Review the change.',
    })

    expect(result.isError).toBe(false)
    expect(request?.outputSchema).toMatchObject({
      type: 'object',
      required: ['verdict', 'summary', 'findings', 'verification'],
    })
    if (result.isError) throw new Error('expected structured foreground success')
    expect(result.value).toMatchObject({
      kind: 'foreground',
      profile: 'review',
      resultContract: 'review-v1',
      structured,
    })
    expect((result.value as { structured: unknown }).structured).not.toBe(structured)
    expect(rendered(result)).toContain('"verdict": "needs-changes"')
  })

  it('rejects malformed provider-owned structured data and still disposes', async () => {
    let disposed = false
    const ctx = await setup({
      profiles: {
        review: {
          description: 'Structured review.',
          subagentProvider: 'spawn',
          maxDepth: 2,
          defaultRunInBackground: false,
          result: 'review-v1',
        },
      },
      defaultProfile: 'review',
    }, [provider('spawn', {
      structured: { verdict: 'maybe' },
      onDispose: () => { disposed = true },
    })])

    const result = await execute(ctx, {
      description: 'review change',
      prompt: 'Review the change.',
    })
    expect(result.isError).toBe(true)
    expect(rendered(result)).toContain('violated review-v1')
    expect(disposed).toBe(true)
  })

  it('starts the selected profile as a continuable child by default', async () => {
    const ctx = await setup(baseConfig)
    const start = vi.spyOn(ctx.subagents, 'startContinuable').mockResolvedValue({
      childId: SessionId('durable-child'),
      messageId: MessageId('initial-message'),
    })

    const result = await execute(ctx, {
      profile: 'deep',
      description: 'design architecture',
      prompt: 'Design the migration.',
    })

    expect(result.isError).toBe(false)
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'spawn',
      request: expect.objectContaining({
        agentOptions: { provider: 'sota-route', model: 'sota-model' },
        maxDepth: 3,
      }),
    }))
    expect(rendered(result)).toContain('started Legion Specialist deep as subagent durable-child')
  })

  it('lets the continuation manager own depth, persona, and tool filtering', async () => {
    const continuable = provider('continuable-only', {
      capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      continuable: true,
    })
    const ctx = await setup({
      profiles: {
        managed: {
          description: 'Continuable manager-owned composition.',
          subagentProvider: 'continuable-only',
          persona: 'Use the child-scoped persona.',
          toolFilter: { deny: ['write'] },
          maxDepth: 2,
          defaultRunInBackground: true,
        },
      },
      defaultProfile: 'managed',
    }, [continuable])
    const start = vi.spyOn(ctx.subagents, 'startContinuable').mockResolvedValue({
      childId: SessionId('managed-child'),
      messageId: MessageId('managed-message'),
    })

    const result = await execute(ctx, {
      description: 'managed composition',
      prompt: 'Complete the delegated task.',
    })

    expect(result.isError).toBe(false)
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'continuable-only',
      request: expect.objectContaining({
        persona: 'Use the child-scoped persona.',
        toolFilter: { deny: ['write'] },
        maxDepth: 2,
      }),
    }))
  })

  it('fails loud when a foreground profile requests a capability its provider lacks', async () => {
    const external = provider('external', {
      capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      continuable: false,
    })
    await expect(setup({
      profiles: {
        product: {
          description: 'External product worker.',
          subagentProvider: 'external',
          maxDepth: 3,
          defaultRunInBackground: false,
        },
      },
      defaultProfile: 'product',
    }, [external])).rejects.toThrow(/PROFILE_DEPTH_UNSUPPORTED/)
  })

  it('treats abnormal child settlement as an error and preserves partial output', async () => {
    const ctx = await setup(baseConfig, [provider('spawn', {
      reply: 'partial evidence',
      stopReason: 'max-tokens',
    })])
    const result = await execute(ctx, {
      description: 'bounded work',
      prompt: 'Try until the limit.',
      run_in_background: false,
    })
    expect(result.isError).toBe(true)
    expect(rendered(result)).toContain('token limit')
    expect(rendered(result)).toContain('partial evidence')
  })

  it('preserves a result rejection and still disposes the foreground run', async () => {
    let disposed = false
    const ctx = await setup(baseConfig, [provider('spawn', {
      resultError: new Error('result channel failed'),
      onDispose: () => { disposed = true },
    })])
    const result = await execute(ctx, {
      description: 'failing result',
      prompt: 'Return a result.',
      run_in_background: false,
    })
    expect(result.isError).toBe(true)
    expect(rendered(result)).toContain('result channel failed')
    expect(disposed).toBe(true)
  })

  it('propagates foreground cancellation and still disposes the run', async () => {
    let started = false
    let observedAbort = false
    let disposed = false
    const cancelProvider: SubagentProvider = {
      name: 'cancel-aware',
      capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
      inheritsParentContext: false,
      async start(request) {
        started = true
        const result = Promise.withResolvers<{
          output: Array<{ type: 'text'; text: string }>
          stopReason: 'aborted'
        }>()
        request.signal.addEventListener('abort', () => {
          observedAbort = true
          result.resolve({ output: [], stopReason: 'aborted' })
        }, { once: true })
        return {
          id: SessionId('cancelled-child'),
          localAgent: undefined,
          result: result.promise,
          async dispose() { disposed = true },
        }
      },
    }
    const ctx = await setup({
      profiles: {
        cancellable: {
          description: 'Cancellation-aware worker.',
          subagentProvider: 'cancel-aware',
          maxDepth: 2,
          defaultRunInBackground: false,
        },
      },
      defaultProfile: 'cancellable',
    }, [cancelProvider])
    const controller = new AbortController()
    const pending = execute(ctx, {
      description: 'cancel work',
      prompt: 'Wait for cancellation.',
    }, parent(), controller.signal)
    await vi.waitFor(() => { expect(started).toBe(true) })
    controller.abort('test cancellation')
    const result = await pending
    expect(result.isError).toBe(true)
    expect(observedAbort).toBe(true)
    expect(disposed).toBe(true)
  })

  it('bounds foreground cancellation even when child result ignores AbortSignal', async () => {
    let started = false
    let disposed = false
    const ctx = await setup(baseConfig, [provider('spawn', {
      onStart: () => { started = true },
      result: () => ({
        output: [],
        stopReason: 'completed',
      }),
      onDispose: () => { disposed = true },
    })])
    const original = ctx.subagents.getProvider('spawn')
    if (original === undefined) throw new Error('missing provider')
    const start = original.start.bind(original)
    vi.spyOn(original, 'start').mockImplementation(async request => {
      const child = await start(request)
      return { ...child, result: new Promise(() => {}) }
    })
    const controller = new AbortController()
    const pending = execute(ctx, {
      description: 'ignored cancellation',
      prompt: 'Never settle voluntarily.',
      run_in_background: false,
    }, parent(), controller.signal)
    await vi.waitFor(() => { expect(started).toBe(true) })
    controller.abort('bounded cancellation')
    await expect(pending).resolves.toMatchObject({ isError: true })
    expect(disposed).toBe(true)
  })

  it('reports a foreground disposal rejection after successful execution', async () => {
    const ctx = await setup(baseConfig, [provider('spawn', {
      disposeError: new Error('dispose channel failed'),
    })])
    const result = await execute(ctx, {
      description: 'failing dispose',
      prompt: 'Return a result.',
      run_in_background: false,
    })
    expect(result.isError).toBe(true)
    expect(rendered(result)).toContain('dispose channel failed')
  })

  it('retains both foreground execution and disposal failures', async () => {
    const ctx = await setup(baseConfig, [provider('spawn', {
      resultError: new Error('execution exploded'),
      disposeError: new Error('cleanup exploded'),
    })])
    const result = await execute(ctx, {
      description: 'double failure',
      prompt: 'Return a result.',
      run_in_background: false,
    })
    expect(result.isError).toBe(true)
    expect(rendered(result)).toContain('execution exploded')
    expect(rendered(result)).toContain('cleanup exploded')
  })

  it('exposes only profiles whose subagent provider is currently registered', async () => {
    const ctx = await setup({
      profiles: {
        local: {
          description: 'Available local worker.',
          subagentProvider: 'spawn',
          maxDepth: 2,
          defaultRunInBackground: false,
        },
        remote: {
          description: 'Unavailable remote worker.',
          subagentProvider: 'remote-provider',
          maxDepth: 'provider-managed',
          defaultRunInBackground: false,
        },
      },
      defaultProfile: 'remote',
    })
    const schema = ctx.tools.schemas().find(item => item.name === 'legion')
    const parameters = schema?.parameters as {
      properties: Record<string, { enum?: string[] }>
      required?: string[]
    }
    expect(parameters.properties.specialist?.enum).toEqual(['local'])
    expect(parameters.required).toContain('specialist')
    const guidance = (await ctx.systemPrompt.assemble()).sections
      .find(section => section.name === 'tool:legion')?.text
    expect(guidance).toContain('`local`')
    expect(guidance).not.toContain('`remote`')
  })

  it('tracks provider lifecycle and hides dead profiles from tool and prompt surfaces', async () => {
    const ctx = await setup({
      profiles: {
        delayed: {
          description: 'Late provider worker.',
          subagentProvider: 'delayed-provider',
          maxDepth: 2,
          defaultRunInBackground: false,
        },
      },
      defaultProfile: 'delayed',
    }, [])
    expect(ctx.tools.schemas().some(schema => schema.name === 'legion')).toBe(false)
    expect((await ctx.systemPrompt.assemble()).sections
      .find(section => section.name === 'tool:legion')?.text).toBe('')

    const remove = ctx.subagents.registerProvider(provider('delayed-provider'))
    expect(ctx.tools.schemas().some(schema => schema.name === 'legion')).toBe(true)
    expect((await ctx.systemPrompt.assemble()).sections
      .find(section => section.name === 'tool:legion')?.text).toContain('`delayed`')

    remove()
    expect(ctx.tools.schemas().some(schema => schema.name === 'legion')).toBe(false)
    expect((await ctx.systemPrompt.assemble()).sections
      .find(section => section.name === 'tool:legion')?.text).toBe('')
  })

  it('tracks LLM adapter lifecycle for routed profile activation', async () => {
    const ctx = new Context()
    await mountAccountingServices(ctx)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(LlmRuntime)
    ctx.subagents.registerProvider(provider('spawn'))
    await ctx.plugin(legion, {
      toolName: 'legion',
      enableRunInBackground: true,
      profiles: {
        deep: {
          description: 'Routed lifecycle work.',
          subagentProvider: 'spawn',
          routes: [{ id: 'exact', provider: 'models', model: 'model' }],
          maxDepth: 2,
          defaultRunInBackground: false,
        },
      },
      defaultProfile: 'deep',
    })
    expect(ctx.tools.schemas().some(schema => schema.name === 'legion')).toBe(false)

    const dispose = ctx.llm.registerAdapter(['models'], new RouteAdapter({}))
    expect(ctx.tools.schemas().some(schema => schema.name === 'legion')).toBe(true)
    await dispose()
    expect(ctx.tools.schemas().some(schema => schema.name === 'legion')).toBe(false)
  })

  it('recovers routed tool registration after a transient same-name conflict', async () => {
    const ctx = new Context()
    await mountAccountingServices(ctx)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(LlmRuntime)
    ctx.subagents.registerProvider(provider('spawn'))
    await ctx.plugin(legion, {
      toolName: 'legion',
      enableRunInBackground: true,
      profiles: {
        deep: {
          description: 'Conflict recovery work.',
          subagentProvider: 'spawn',
          routes: [{ id: 'exact', provider: 'models', model: 'model' }],
          maxDepth: 2,
          defaultRunInBackground: false,
        },
      },
      defaultProfile: 'deep',
    })
    const disposeConflict = ctx.tools.register(defineTool({
      name: 'legion',
      description: 'conflicting tool',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { conflict: { type: 'boolean', required: true } },
        },
        render: () => [{ type: 'text', text: 'conflict' }],
      },
      execute: async () => ({ conflict: true }),
    }))
    ctx.llm.registerAdapter(['models'], new RouteAdapter({}))
    expect(ctx.tools.schemas().find(schema => schema.name === 'legion')?.description)
      .toBe('conflicting tool')

    disposeConflict()
    expect(ctx.tools.schemas().find(schema => schema.name === 'legion')?.description)
      .toContain('configured Legion Specialist')
  })

  it('omits and enforces run_in_background when disabled', async () => {
    const ctx = await setup({ ...baseConfig, enableRunInBackground: false })
    const schema = ctx.tools.schemas().find(item => item.name === 'legion')
    if (schema === undefined) throw new Error('expected Legion tool schema')
    const properties = (schema.parameters as { properties: Record<string, unknown> }).properties
    expect(properties).not.toHaveProperty('run_in_background')

    const forced = await execute(ctx, {
      description: 'force background',
      prompt: 'Work.',
      run_in_background: true,
    })
    expect(forced.isError).toBe(true)
    expect(rendered(forced)).toContain('run_in_background is disabled')
  })

  it('rejects unknown config fields before publishing tool or prompt effects', async () => {
    const ctx = new Context()
    await mountAccountingServices(ctx)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    ctx.subagents.registerProvider(provider('spawn'))
    await expect(ctx.plugin(legion, {
      toolName: 'legion',
      enableRunInBackground: true,
      profiles: {
        quick: {
          description: 'Quick work.',
          subagentProvider: 'spawn',
          maxDepth: 1,
          defaultRunInBackground: false,
          typo: true,
        },
      },
    } as never)).rejects.toThrow(/unknown field.*typo/)
    expect(ctx.tools.schemas().some(schema => schema.name === 'legion')).toBe(false)
    expect((await ctx.systemPrompt.assemble()).sections
      .find(section => section.name === 'tool:legion')).toBeUndefined()
  })

  it('fails closed on a missing prompt fragment before publishing effects', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-legion-missing-resource-'))
    mkdirSync(join(root, 'resources'))
    const ctx = new Context()
    await mountAccountingServices(ctx)
    await ctx.plugin(AgentRegistry)
    ctx.baseUrl = pathToFileURL(root).href + '/'
    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(SubagentRuntime)
      ctx.subagents.registerProvider(provider('spawn'))
      await expect(ctx.plugin(legion, {
        toolName: 'legion',
        enableRunInBackground: true,
        resourceRoots: { local: 'resources' },
        profiles: {
          quick: {
            description: 'Quick work.',
            subagentProvider: 'spawn',
            maxDepth: 1,
            defaultRunInBackground: false,
            promptFiles: [{ root: 'local', path: 'missing.md' }],
          },
        },
      })).rejects.toThrow(/does not exist/)
      expect(ctx.tools.schemas().some(schema => schema.name === 'legion')).toBe(false)
    } finally {
      await ctx.fiber.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects invalid cross-field configuration during activation', async () => {
    await expect(setup({
      profiles: {
        quick: {
          description: 'Quick work.',
          subagentProvider: 'spawn',
          maxDepth: 1,
          defaultRunInBackground: false,
        },
      },
      defaultProfile: 'unknown',
    })).rejects.toThrow('defaultProfile "unknown" does not exist')
  })

  it('fails closed durable mutation while preserving the ephemeral path on rc.6', async () => {
    let starts = 0
    const ctx = await setup({
      ...baseConfig,
      configVersion: 2,
      enableStrategies: true,
      enableDurableRuns: true,
      teams: {
        fallback: {
          description: 'Ephemeral fallback team.',
          members: { worker: { profile: 'quick' } },
        },
      },
      strategies: {
        fallback: {
          description: 'One-stage fallback.',
          team: 'fallback',
          stages: [{
            kind: 'delegate',
            id: 'execute',
            member: 'worker',
            inputs: [{ artifact: 'objective', contract: 'objective-v1' }],
            output: { artifact: 'result', contract: 'text' },
            prompt: 'Execute once.',
          }],
          completion: { artifact: 'result', contract: 'text' },
          limits: {
            maxAgents: 1, maxConcurrent: 1, deadlineMs: 60_000,
            maxOutputBytes: 65_536,
          },
          memberFailure: 'fail',
        },
      },
    }, [provider('spawn', { onStart() { starts += 1 } })])
    try {
      expect(legion.durableActivationAvailable(
        legion.detectDurableCapabilities(ctx as never),
      )).toBe(false)
      expect(Object.keys(legionParameterProperties(ctx))).not.toContain('execution')
      const result = await execute(ctx, {
        profile: 'quick',
        description: 'Ephemeral fallback.',
        prompt: 'Run through the existing ephemeral path.',
      })
      if (result.isError) throw new Error(rendered(result))
      expect(result.isError).toBe(false)
      expect(starts).toBe(1)
      const durable = await execute(ctx, {
        kind: 'strategy',
        strategy: 'fallback',
        objective: 'Must not start without Host coordination.',
        execution: { durability: 'journal', advancement: 'checkpoint' },
      })
      expect(durable.isError).toBe(true)
      expect(rendered(durable)).toContain('LEGION_DURABLE_COORDINATION_UNAVAILABLE')
      expect(starts).toBe(1)
      expect(legion.detectDurableCapabilities(ctx as never).durableMutation).toBe(false)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('requires a calling Agent', async () => {
    const ctx = await setup(baseConfig)
    const result = await execute(ctx, {
      description: 'orphan call',
      prompt: 'Work.',
    }, null)
    expect(result.isError).toBe(true)
    expect(rendered(result)).toContain('requires a calling agent')
  })
})
