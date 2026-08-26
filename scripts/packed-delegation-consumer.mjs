import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
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
const require = createRequire(import.meta.url)
const publicContract = require('dsh-legion/contracts/v1.json')
if (JSON.stringify(Object.keys(legion).sort()) !== JSON.stringify(publicContract.runtimeExports)) {
  throw new Error('packed runtime exports drifted from the public contract')
}

const journalContract = require('dsh-legion/contracts/journal-v1.json')
if (journalContract.projection.key !== legion.LEGION_RUN_PROJECTION_KEY
  || journalContract.projection.stateVersion !== legion.LEGION_RUN_PROJECTION_STATE_VERSION) {
  throw new Error('packed journal contract drifted from runtime projection metadata')
}
const capabilities = legion.detectDurableCapabilities({ get: () => undefined })
if (capabilities.durableMutation !== false
  || capabilities.diagnostics.length !== 5) {
  throw new Error('packed rc.6 capability detection did not fail closed')
}
const packedDigest = (character) => `sha256:${character.repeat(64)}`
const runId = legion.RunId('packed-durable-run')
const packedRunEvent = {
  type: 'legion/run-state',
  seq: 0,
  time: 1,
  data: {
    schemaVersion: 1,
    runId,
    planVersion: 1,
    correlationId: 'packed-replay',
    record: {
      schemaVersion: 1,
      runId,
      anchorSessionId: 'packed-parent',
      strategyName: 'packed-strategy',
      strategyPlanDigest: packedDigest('1'),
      catalogDigest: packedDigest('2'),
      goalVersion: 1,
      goal: {
        version: 1,
        statement: 'Verify packed durable replay.',
        acceptance: ['Replay succeeds.'],
        constraints: [],
        nonGoals: [],
        authorityDigest: packedDigest('3'),
      },
      currentPlanVersion: 1,
      status: 'created',
      environmentDigest: packedDigest('4'),
      createdAt: 1,
      updatedAt: 1,
    },
  },
}
const packedJsonl = JSON.stringify(packedRunEvent)
if (legion.replayExportedSessionEvents(packedJsonl, runId).found !== true) {
  throw new Error('packed fresh-process JSONL replay did not find the run')
}
try {
  legion.parseExportedSessionEvents(JSON.stringify({
    ...packedRunEvent,
    data: { ...packedRunEvent.data, unknownField: true },
  }))
  throw new Error('packed replay accepted an unknown Legion field')
} catch (error) {
  if (!String(error).includes('unknown field')) throw error
}
const owner = {
  hostInstanceId: 'packed-host',
  processBootId: 'packed-boot',
  pluginGeneration: 'packed-plugin',
  anchorSessionId: 'packed-parent',
  activationId: 'packed-activation',
}
const recoveryInput = {
  tasks: [
    {
      taskId: legion.TaskId('packed-read'),
      generation: 1,
      terminal: false,
      effectClass: 'read',
    },
    {
      taskId: legion.TaskId('packed-write'),
      generation: 1,
      terminal: false,
      effectClass: 'non-idempotent-write',
    },
  ],
  receipts: {},
  baseJournalSeq: 1,
  fence: legion.Fence(1),
  owner,
}
const firstRecovery = legion.planRecovery(recoveryInput)
const secondRecovery = legion.planRecovery(recoveryInput)
if (JSON.stringify(firstRecovery) !== JSON.stringify(secondRecovery)
  || !firstRecovery.actions.some(action => action.kind === 'retry')
  || !firstRecovery.actions.some(action => action.kind === 'needs-attention')) {
  throw new Error('packed deterministic recovery contract failed')
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

const configuredTempRoot = process.env.DSH_LEGION_TEMP_ROOT
if (configuredTempRoot === undefined) throw new Error('packed consumer requires DSH_LEGION_TEMP_ROOT')
const trustedTempRoot = realpathSync(configuredTempRoot)
const sessionRoot = mkdtempSync(join(trustedTempRoot, 'dsh-legion-packed-e2e-'))
const resourceRoot = mkdtempSync(join(trustedTempRoot, 'dsh-legion-packed-resources-'))
const resourceRootName = basename(resourceRoot)
const ctx = new Context()
try {
  ctx.baseUrl = pathToFileURL(trustedTempRoot).href + '/'
  writeFileSync(join(resourceRoot, 'packed.md'), 'Use the packed artifact instruction.\n')

  await mountAgentLoopTestDependencies(ctx)
  if (ctx.get('sessionProjections') === undefined) {
    ctx.provide('sessionProjections', {
      register() { return () => undefined },
      snapshot(session) {
        const byStep = new Map()
        for (const event of session.events) {
          const usage = event.type === 'assistant/chunk' && event.data.chunk.type === 'usage'
            ? event.data.chunk.usage
            : event.type === 'assistant/message'
              ? event.data.usage
              : undefined
          if (usage !== undefined) byStep.set(`${String(event.data.turn)}:${String(event.data.step)}`, usage)
        }
        const tokenUsage = [...byStep.values()].reduce((total, usage) => ({
          uncachedInputTokens: total.uncachedInputTokens + usage.inputTokens,
          outputTokens: total.outputTokens + usage.outputTokens,
          cacheReadTokens: total.cacheReadTokens + (usage.cacheReadTokens ?? 0),
          cacheWriteTokens: total.cacheWriteTokens + (usage.cacheWriteTokens ?? 0),
        }), { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
        return { asOfSeq: session.seq - 1, values: { tokenUsage } }
      },
    })
  }
  ctx.provide('tokenMeter', {
    measure(session) {
      return { logRevision: session.events.length, totalTokens: 0, surfaceTokens: 0 }
    },
  })
  await ctx.plugin(JsonlSessionPersistence, { root: sessionRoot })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SpawnProvider, { providerName: 'spawn' })
  const adapter = new PackedAdapter()
  ctx.llm.registerAdapter(['packed-mock'], adapter)
  await ctx.plugin(legion, {
    configVersion: 2,
    toolName: 'legion',
    enableRunInBackground: true,
    enableStrategies: true,
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
    teams: {
      'packed-team': {
        description: 'Packed two-stage Team.',
        members: { worker: { profile: 'packed' } },
        limits: { maxMembers: 1, maxConcurrentMembers: 1 },
      },
    },
    strategies: {
      'packed-strategy': {
        description: 'Packed draft and verification Strategy.',
        team: 'packed-team',
        stages: [
          {
            kind: 'delegate',
            id: 'draft',
            member: 'worker',
            inputs: [{ artifact: 'objective', contract: 'objective-v1' }],
            output: { artifact: 'draft', contract: 'text' },
            prompt: 'Produce the harmless packed draft.',
          },
          {
            kind: 'delegate',
            id: 'verify',
            member: 'worker',
            inputs: [{ artifact: 'draft', contract: 'text' }],
            output: { artifact: 'final', contract: 'text' },
            prompt: 'Verify the harmless packed draft.',
          },
        ],
        completion: { artifact: 'final', contract: 'text' },
        limits: {
          maxAgents: 2,
          maxConcurrent: 1,
          deadlineMs: 60000,
          maxOutputBytes: 65536,
        },
        memberFailure: 'fail',
      },
    },
  })

  const schema = ctx.tools.schemas().find(item => item.name === 'legion')
  const parameterBranches = schema?.parameters?.oneOf ?? [schema?.parameters]
  const strategyNames = parameterBranches
    .flatMap(branch => branch?.properties?.strategy?.enum ?? [])
  if (!Array.isArray(strategyNames) || !strategyNames.includes('packed-strategy')) {
    throw new Error('packed Config v2 Strategy is absent from the Legion tool schema')
  }
  const parent = ctx.agentLoop.create(SessionId('packed-parent'), {
    provider: 'packed-mock',
    model: 'parent-model',
  })
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('packed-legion-call'),
    name: 'legion',
    arguments: {
      kind: 'strategy',
      strategy: 'packed-strategy',
      objective: 'Return and verify the harmless packed result.',
    },
    agent: parent,
  })
  if (result.isError) throw new Error(result.content.map(block => block.type === 'text' ? block.text : '').join(''))
  if (adapter.calls.length !== 2) throw new Error(`expected two model calls, got ${String(adapter.calls.length)}`)
  for (const call of adapter.calls) {
    if (call.provider !== 'packed-mock' || call.model !== 'packed-model' || call.maxTokens !== 16_000) {
      throw new Error(`packed route mismatch: ${JSON.stringify(call)}`)
    }
    if (!call.system?.includes('You are the packed child.')
      || !call.system.includes('Use the packed artifact instruction.')
      || !call.system.includes('Use the exact packed route.')) {
      throw new Error('packed child system composition is incomplete')
    }
  }
  const value = result.value
  if (value.kind !== 'strategy'
    || value.strategy !== 'packed-strategy'
    || !/^sha256:[a-f0-9]{64}$/.test(value.planDigest)
    || value.outcome?.kind !== 'completed'
    || value.outcome.final?.name !== 'final'
    || value.outcome.final?.value !== 'packed delegation ok') {
    throw new Error('packed Strategy returned an unexpected Legion result')
  }
  process.stdout.write('packed tarball completed one harmless real Config v2 Team Strategy successfully\n')
} finally {
  await ctx.fiber.dispose()
  rmSync(sessionRoot, { recursive: true, force: true })
  rmSync(resourceRoot, { recursive: true, force: true })
}
