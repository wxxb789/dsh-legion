import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import {
  ToolCallId,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as SpawnProvider from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as legion from '../src/index.ts'
import { mountTestTokenAccounting } from './token-meter-test-service.ts'

class TextAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'real continuable result' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'real continuable result' } }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 3 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

describe('real DSH continuation manager integration', () => {
  it('creates a durable child with the compiled model route and manager-owned persona', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-legion-continuable-'))
    mkdirSync(join(root, 'resources'), { recursive: true })
    writeFileSync(join(root, 'resources', 'deep.md'), 'Use the loaded continuation instruction.')
    const ctx = new Context()
    ctx.baseUrl = pathToFileURL(root).href + '/'
    try {
      await mountAgentLoopTestDependencies(ctx)
      await mountTestTokenAccounting(ctx)
      await ctx.plugin(JsonlSessionPersistence, { root })
      await ctx.plugin(AgentLoop, { agents: [] })
      await ctx.plugin(SubagentRuntime)
      await ctx.plugin(SpawnProvider, { providerName: 'spawn' })
      await ctx.plugin(legion, {
        toolName: 'legion',
        enableRunInBackground: true,
        resourceRoots: { local: 'resources' },
        maxResourceBytes: 65536,
        profiles: {
          deep: {
            description: 'Real continuable work.',
            subagentProvider: 'spawn',
            routes: [{
              id: 'child',
              provider: 'mock',
              model: 'child-model',
              constraints: { minContextTokens: 4096 },
              instructions: 'Use the exact child route.',
            }],
            persona: 'You are the real Legion child.',
            maxDepth: 2,
            defaultRunInBackground: true,
            promptFiles: [{ root: 'local', path: 'deep.md' }],
          },
        },
        defaultProfile: 'deep',
      })
      ctx.llm.registerAdapter(['mock'], new TextAdapter())
      const parent = ctx.agentLoop.create(SessionId('legion-real-parent'), {
        provider: 'mock',
        model: 'parent-model',
      })

      const result = await ctx.tools.execute({
        signal: new AbortController().signal,
        callId: ToolCallId('legion-real-continuable'),
        name: 'legion',
        arguments: {
          description: 'real child',
          prompt: 'Complete the real integration task.',
        },
        agent: parent,
      })
      expect(result.isError).toBe(false)
      if (result.isError) throw new Error('expected continuable start success')
      const value = result.value as {
        kind: string
        subagentId: string
        policyDigest: string
        resourceDigest: string
        routePlan: { kind: string; selected: { id: string } }
      }
      expect(value.kind).toBe('continuable')
      expect(value.policyDigest).toMatch(/^sha256:/)
      expect(value.resourceDigest).toMatch(/^sha256:/)
      expect(value.routePlan).toMatchObject({
        kind: 'selected-route-plan',
        selected: { id: 'child' },
      })
      const childId = SessionId(value.subagentId)

      await vi.waitFor(() => expect(ctx.agents.get(childId)).toBeDefined())
      const child = ctx.agents.get(childId)
      if (child === undefined) throw new Error('expected live continuable child')
      await child.whenIdle()
      expect(child.options).toMatchObject({
        provider: 'mock',
        model: 'child-model',
        subagentDepth: 1,
      })
      expect(child.session.header.parentSession).toBe(parent.id)
      const prompt = await ctx.systemPrompt.assemble(assembleContextFor(child))
      const persona = prompt.sections.find(section => section.name === 'deployment:persona')?.text
      expect(persona).toContain('You are the real Legion child.')
      expect(persona).toContain('## Legion profile instruction: local:deep.md')
      expect(persona).toContain('Use the loaded continuation instruction.')
      expect(persona).toContain('Use the exact child route.')
      expect(child.session.events.some(event => event.type === 'assistant/message')).toBe(true)
    } finally {
      await ctx.fiber.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
