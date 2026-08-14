import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId, MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type {
  ResolvedSubagentStartRequest,
  SubagentProvider,
  SubagentStartRequest,
} from '@deepseek-ai/dsh-subagent'
import * as legion from '../src/index.ts'

const signal = new AbortController().signal
let callSequence = 0

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
        result: Promise.resolve({
          output: [{ type: 'text', text: options.reply ?? 'child result' }],
          stopReason: options.stopReason ?? 'completed',
        }),
        async dispose() {},
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

function execute(ctx: Context, args: unknown, agent: Agent | null = parent()) {
  return ctx.tools.execute({
    signal,
    callId: CallId(`legion-${++callSequence}`),
    name: 'legion',
    arguments: args,
    ...agent === null ? {} : { agent },
  })
}

function rendered(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
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
  it('publishes one semantic-profile tool and generated routing guidance', async () => {
    const ctx = await setup(baseConfig)
    const schema = ctx.tools.schemas().find(item => item.name === 'legion')
    expect(schema).toBeDefined()
    if (schema === undefined) throw new Error('expected Legion tool schema')
    const properties = (schema.parameters as { properties: Record<string, { enum?: string[]; required?: boolean }> }).properties
    expect(properties.profile?.enum).toEqual(['quick', 'deep'])
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
    expect(result.value).toMatchObject({ kind: 'foreground', profile: 'quick' })
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

  it('fails loud when a profile requests a capability its provider lacks', async () => {
    const external = provider('external', {
      capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      continuable: false,
    })
    const ctx = await setup({
      profiles: {
        product: {
          description: 'External product worker.',
          subagentProvider: 'external',
          maxDepth: 3,
          defaultRunInBackground: false,
        },
      },
      defaultProfile: 'product',
    }, [external])

    const result = await execute(ctx, {
      description: 'run product',
      prompt: 'Do the work.',
    })
    expect(result.isError).toBe(true)
    expect(rendered(result)).toContain('cannot enforce it; use provider-managed')
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
