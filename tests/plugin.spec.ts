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
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type {
  ResolvedSubagentStartRequest,
  SubagentProvider,
  SubagentResult,
  SubagentStartRequest,
} from '@deepseek-ai/dsh-subagent'
import * as legion from '../src/index.ts'

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
  return { id: SessionId(id) } as unknown as Agent
}

function provider(
  name: string,
  options: {
    reply?: string
    stopReason?: 'completed' | 'error' | 'aborted' | 'max-tokens' | 'refusal'
    capabilities?: SubagentProvider['capabilities']
    continuable?: boolean
    resultError?: Error
    result?: (request: ResolvedSubagentStartRequest) => SubagentResult
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

async function setup(
  config: unknown,
  providers: SubagentProvider[] = [provider('spawn')],
): Promise<Context> {
  const ctx = new Context()
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
    const properties = (schema.parameters as { properties: Record<string, { enum?: string[]; required?: boolean }> }).properties
    expect(properties.profile?.enum).toEqual(['deep', 'quick'])
    expect(properties.profile?.required).not.toBe(true)
    expect(Object.keys(properties).sort()).toEqual([
      'description', 'profile', 'prompt', 'run_in_background',
    ])

    const prompt = await ctx.systemPrompt.assemble()
    const guidance = prompt.sections.find(section => section.name === 'tool:legion')?.text
    expect(guidance).toContain('`quick`: Cheap exploration and summaries.')
    expect(guidance).toContain('fast-route/fast-model')
    expect(guidance).toContain('Omitting profile selects `quick`.')
  })

  it('keeps Strategy authority fully absent unless explicitly enabled', async () => {
    let starts = 0
    const ctx = await setup(baseConfig, [provider('spawn', { onStart: () => { starts += 1 } })])
    const properties = legionParameterProperties(ctx)
    expect(properties).not.toHaveProperty('kind')
    expect(properties).not.toHaveProperty('strategy')
    expect((await ctx.systemPrompt.assemble()).sections.find(section => section.name === 'tool:legion')?.text)
      .not.toContain('Team Strategies')
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
    expect(properties.strategy?.enum).toEqual([
      'independent-review', 'plan-execute-review', 'research-panel',
    ])
    expect(properties.description?.required).not.toBe(true)
    const guidance = (await ctx.systemPrompt.assemble()).sections
      .find(section => section.name === 'tool:legion')?.text
    expect(guidance).toContain('Configured bounded Team Strategies')
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

    const legacyProfileResult = await execute(ctx, {
      profile: 'quick',
      description: 'legacy profile call',
      prompt: 'Remain compatible.',
      run_in_background: false,
    })
    expect(legacyProfileResult.isError).toBe(false)
    expect(starts).toHaveLength(3)

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
    expect(starts).toHaveLength(3)
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
      .not.toContain('Team Strategies')

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
      .not.toContain('Team Strategies')
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

  it('loads confined prompt fragments before registration and installs them as child persona', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-legion-plugin-resources-'))
    mkdirSync(join(root, 'resources', 'prompts'), { recursive: true })
    writeFileSync(join(root, 'resources', 'prompts', 'review.md'), 'Follow the resource instruction.')
    const ctx = new Context()
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
    expect(rendered(result)).toContain('started Legion profile deep as subagent durable-child')
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
    expect(parameters.properties.profile?.enum).toEqual(['local'])
    expect(parameters.required).toContain('profile')
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
      .toContain('configured Legion profile')
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
      expect(rendered(durable)).toContain('LEGION_DURABLE_FLUSH_UNAVAILABLE')
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
