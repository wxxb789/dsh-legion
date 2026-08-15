import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { CallId, LlmAdapter } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as SpawnProvider from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as legion from 'dsh-legion'

const consumerManifest = JSON.parse(readFileSync('package.json', 'utf8'))
if (process.env.DSH_LEGION_PACKED_CONSUMER !== '1'
  || consumerManifest.name !== 'dsh-legion-packed-delegation-consumer') {
  throw new Error('refusing to run packed consumer fixture outside its isolated sandbox')
}

class PackedAdapter extends LlmAdapter {
  calls = []

  resolveModel(provider, model) {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      context: { contextWindow: 128_000 },
      defaultMaxTokens: 16_000,
    })
  }

  async * stream(options) {
    this.calls.push({
      provider: options.provider,
      model: options.model,
      maxTokens: options.maxTokens,
      system: options.system,
    })
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'packed delegation ok' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'packed delegation ok' } }
    yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 3 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const sessionRoot = mkdtempSync(join(tmpdir(), 'dsh-legion-packed-e2e-'))
const resourceRoot = mkdtempSync(join(process.cwd(), '.packed-resources-'))
const resourceRootName = basename(resourceRoot)
const ctx = new Context()
try {
  ctx.baseUrl = pathToFileURL(process.cwd()).href + '/'
  writeFileSync(join(resourceRoot, 'packed.md'), 'Use the packed artifact instruction.\n')

  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root: sessionRoot })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SpawnProvider, { providerName: 'spawn' })
  const adapter = new PackedAdapter()
  ctx.llm.registerAdapter(['packed-mock'], adapter)
  await ctx.plugin(legion, {
    configVersion: 1,
    toolName: 'legion',
    enableRunInBackground: true,
    resourceRoots: { local: resourceRootName },
    profiles: {
      packed: {
        description: 'Packed harmless delegation.',
        subagentProvider: 'spawn',
        routes: [{
          id: 'exact',
          provider: 'packed-mock',
          model: 'packed-model',
          constraints: {
            minContextTokens: 64_000,
            minEffectiveOutputTokens: 8_000,
          },
          instructions: 'Use the exact packed route.',
        }],
        persona: 'You are the packed child.',
        promptFiles: [{ root: 'local', path: 'packed.md' }],
        maxDepth: 2,
        defaultRunInBackground: false,
      },
    },
    defaultProfile: 'packed',
  })

  const parent = ctx.agentLoop.create(SessionId('packed-parent'), {
    provider: 'packed-mock',
    model: 'parent-model',
  })
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('packed-legion-call'),
    name: 'legion',
    arguments: {
      description: 'packed real delegation',
      prompt: 'Return the harmless packed result.',
    },
    agent: parent,
  })
  if (result.isError) throw new Error(result.content.map(block => block.type === 'text' ? block.text : '').join(''))
  if (adapter.calls.length !== 1) throw new Error(`expected one model call, got ${String(adapter.calls.length)}`)
  const call = adapter.calls[0]
  if (call.provider !== 'packed-mock' || call.model !== 'packed-model' || call.maxTokens !== 16_000) {
    throw new Error(`packed route mismatch: ${JSON.stringify(call)}`)
  }
  if (!call.system?.includes('You are the packed child.')
    || !call.system.includes('Use the packed artifact instruction.')
    || !call.system.includes('Use the exact packed route.')) {
    throw new Error('packed child system composition is incomplete')
  }
  const value = result.value
  if (value.kind !== 'foreground'
    || value.routePlan?.selected?.id !== 'exact'
    || !value.output.some(block => block.type === 'text' && block.text === 'packed delegation ok')) {
    throw new Error('packed delegation returned an unexpected Legion result')
  }
  process.stdout.write('packed tarball completed one harmless real DSH delegation successfully\n')
} finally {
  await ctx.fiber.dispose()
  rmSync(sessionRoot, { recursive: true, force: true })
  rmSync(resourceRoot, { recursive: true, force: true })
}
