import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as legion from '../lib/index.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const thresholds = JSON.parse(await readFile(join(root, 'benchmarks', 'protocol-thresholds.json'), 'utf8'))
const parent = { id: SessionId('benchmark-parent') }
const calls = []

const review = {
  verdict: 'needs-changes',
  summary: 'The independent reviewer found the seeded race.',
  findings: [{
    severity: 'high',
    title: 'Seeded race condition',
    detail: 'The implementation lacks the required generation fence.',
    evidence: [{ source: 'fixture:implementation', detail: 'No generation check.' }],
    recommendation: 'Add a generation fence before commit.',
  }],
  verification: ['fixture reviewed'],
}

function textResult(text) {
  return { output: [{ type: 'text', text }], stopReason: 'completed' }
}

const provider = {
  name: 'spawn',
  capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
  inheritsParentContext: false,
  async start(request) {
    const prompt = request.prompt.filter(block => block.type === 'text').map(block => block.text).join('')
    const index = calls.length
    calls.push(prompt)
    let result
    if (prompt.includes('DIRECT_IMPLEMENTATION')) {
      result = textResult('Implementation completed without an independent review.')
    } else if (prompt.includes('DIRECT_RESEARCH')) {
      result = textResult('source-a')
    } else if (request.outputSchema !== undefined) {
      result = { ...textResult('reviewed'), structured: review }
    } else if (prompt.includes('Panel member: 1')) {
      result = textResult('source-a')
    } else if (prompt.includes('Panel member: 2')) {
      result = textResult('source-b')
    } else if (prompt.includes('Panel member: 3')) {
      result = textResult('source-c')
    } else if (prompt.includes('Synthesize the panel')) {
      result = textResult('source-a source-b source-c')
    } else {
      result = textResult('execution evidence')
    }
    return {
      id: SessionId(`benchmark-child-${String(index)}`),
      localAgent: undefined,
      result: Promise.resolve(result),
      async dispose() {},
    }
  },
}

const authored = {
  configVersion: 2,
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
  catalogLayers: [legion.DEFAULT_CATALOG_LAYER],
}

async function direct(ctx, prompt) {
  const run = await ctx.subagents.start('spawn', {
    parent,
    signal: new AbortController().signal,
    prompt: [{ type: 'text', text: prompt }],
  })
  try {
    return await run.result
  } finally {
    await run.dispose()
  }
}

const ctx = new Context()
try {
  await ctx.plugin(SubagentRuntime)
  ctx.subagents.registerProvider(provider)
  const config = legion.materializeConfig(authored)
  const profiles = legion.compileCatalog(config, {
    providers: {
      spawn: {
        continuable: true,
        capabilities: provider.capabilities,
      },
    },
  })
  const orchestration = legion.compileOrchestrationCatalog(profiles)
  legion.assertOrchestrationCatalogUsable(orchestration)

  const started = performance.now()
  const directImplementation = await direct(ctx, 'DIRECT_IMPLEMENTATION')
  const directResearch = await direct(ctx, 'DIRECT_RESEARCH')
  const directAgents = calls.length

  const independent = legion.compileStrategy(orchestration, {
    strategy: 'independent-review',
    objective: 'Implement the generation-safe change.',
  })
  const panel = legion.compileStrategy(orchestration, {
    strategy: 'research-panel',
    objective: 'Research all three sources.',
  })
  if (!independent.ok || !panel.ok) throw new Error('default protocol failed compilation')
  const independentOutcome = await legion.executeStrategyPlan(
    ctx,
    profiles,
    independent.plan,
    parent,
    new AbortController().signal,
  )
  const panelOutcome = await legion.executeStrategyPlan(
    ctx,
    profiles,
    panel.plan,
    parent,
    new AbortController().signal,
  )
  const strategyAgents = calls.length - directAgents

  const directImplementationText = directImplementation.output.map(block => block.type === 'text' ? block.text : '').join('')
  const directResearchText = directResearch.output.map(block => block.type === 'text' ? block.text : '').join('')
  const reviewArtifact = independentOutcome.artifacts.find(artifact => artifact.name === 'review')
  const synthesisArtifact = panelOutcome.artifacts.find(artifact => artifact.name === 'synthesis')
  const defectBaseline = directImplementationText.includes('race condition') ? 1 : 0
  const defectStrategy = JSON.stringify(reviewArtifact?.value).includes('Seeded race condition') ? 1 : 0
  const sourceNames = ['source-a', 'source-b', 'source-c']
  const directCoverage = sourceNames.filter(source => directResearchText.includes(source)).length / sourceNames.length
  const strategyCoverage = sourceNames.filter(source => String(synthesisArtifact?.value).includes(source)).length / sourceNames.length
  const directStructuralScore = (defectBaseline + directCoverage) / 2
  const strategyStructuralScore = (defectStrategy + strategyCoverage) / 2
  const result = {
    version: 1,
    kind: 'legion-protocol-benchmark',
    scenarios: 2,
    gateClass: 'deterministic-protocol',
    direct: { structuralScore: directStructuralScore, agents: directAgents },
    strategy: {
      structuralScore: strategyStructuralScore,
      agents: strategyAgents,
      outcomes: [independentOutcome.kind, panelOutcome.kind],
    },
    structuralDelta: strategyStructuralScore - directStructuralScore,
    agentRatio: strategyAgents / directAgents,
    elapsedMs: Math.round((performance.now() - started) * 100) / 100,
  }
  if (result.structuralDelta < thresholds.minimumStructuralDelta) {
    throw new Error(`protocol structural delta ${String(result.structuralDelta)} missed threshold`)
  }
  if (result.agentRatio > thresholds.maximumAgentRatio) {
    throw new Error(`protocol agent ratio ${String(result.agentRatio)} exceeded threshold`)
  }
  if (result.strategy.outcomes.some(outcome => !thresholds.requiredStrategyOutcomes.includes(outcome))) {
    throw new Error(`protocol outcome gate failed: ${result.strategy.outcomes.join(', ')}`)
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
} finally {
  await ctx.fiber.dispose()
}
