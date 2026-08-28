import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  LlmAdapter,
  LlmError,
  LlmRuntime,
  ReasoningEffortId,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { Config, RouteCandidate } from '../src/config.ts'
import { compileCatalog, compileDelegationPlan } from '../src/compiler.ts'
import {
  RoutePlanError,
  applyRoutePlan,
  compileRoutePlan,
  observeModelRoutes,
  type ModelFactsObservations,
} from '../src/route.ts'

class MetadataAdapter extends LlmAdapter {
  constructor(
    private readonly metadata: Readonly<Record<string, LlmResolvedModelInfo | Error>>,
  ) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const value = this.metadata[model]
    if (value instanceof Error) return Promise.reject(value)
    return Promise.resolve(value ?? { provider, id: model, name: model })
  }

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const routes: RouteCandidate[] = [
  {
    id: 'small',
    provider: 'missing',
    model: 'small-model',
    constraints: { minContextTokens: 64_000 },
  },
  {
    id: 'medium',
    provider: 'known',
    model: 'medium-model',
    constraints: { minContextTokens: 64_000, minEffectiveOutputTokens: 8_000 },
  },
  {
    id: 'strong',
    provider: 'known',
    model: 'strong-model',
    maxTokens: 16_000,
    constraints: { minContextTokens: 64_000, minEffectiveOutputTokens: 8_000 },
    instructions: 'Use the selected strong route.',
  },
]

function config(): Config {
  return {
    toolName: 'legion',
    enableRunInBackground: true,
    defaultProfile: 'deep',
    profiles: {
      deep: {
        description: 'Deep work.',
        subagentProvider: 'spawn',
        routes,
        persona: 'Base persona.',
        maxDepth: 2,
        defaultRunInBackground: false,
      },
    },
  }
}

function catalog() {
  return compileCatalog(config(), {
    providers: {
      spawn: {
        continuable: true,
        capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
      },
    },
  })
}

function routableProfile(compiled = catalog()) {
  const profile = compiled.activeSpecialists.deep
  if (profile?.routes === undefined) throw new Error('expected routable deep profile')
  return { ...profile, routes: profile.routes }
}

describe('exact route planning', () => {
  it('observes registered exact metadata without consulting advisory catalogs', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['known'], new MetadataAdapter({
      'medium-model': {
        provider: 'known', id: 'medium-model', name: 'Medium',
        context: { contextWindow: 32_000 }, defaultMaxTokens: 4_000,
      },
      'strong-model': {
        provider: 'known', id: 'strong-model', name: 'Strong',
        context: { contextWindow: 128_000 }, defaultMaxTokens: 32_000,
        reasoning: { efforts: [{ id: ReasoningEffortId('high'), name: 'High' }] },
      },
    }))

    const facts = await observeModelRoutes(ctx.llm, routes)
    expect(facts.facts).toMatchObject([
      { kind: 'adapter-missing', routeId: 'small' },
      { kind: 'resolved', routeId: 'medium', contextWindow: 32_000, defaultMaxTokens: 4_000 },
      { kind: 'resolved', routeId: 'strong', contextWindow: 128_000, reasoningEfforts: ['high'] },
    ])
    const compiled = catalog()
    const plan = compileRoutePlan(routableProfile(compiled), compiled.policyDigest, facts)
    expect(plan).toMatchObject({
      kind: 'selected-route-plan',
      selected: {
        id: 'strong', provider: 'known', model: 'strong-model', maxTokens: 16_000,
        maxTokensSource: 'explicit',
        maxTokensScope: 'initial-activation',
      },
      decisions: [
        { kind: 'rejected', reasons: ['ADAPTER_MISSING'] },
        { kind: 'rejected', reasons: ['CONTEXT_CAPACITY_TOO_SMALL', 'EFFECTIVE_OUTPUT_BUDGET_TOO_SMALL'] },
        {
          kind: 'selected',
          evidence: {
            modelResolution: 'resolved',
            outputBudget: { kind: 'explicit', tokens: 16_000 },
            unknowns: [],
          },
        },
      ],
      liveAvailability: { auth: 'unknown', quota: 'unknown', health: 'unknown' },
    })
    expect(plan.planDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(compileRoutePlan(routableProfile(compiled), compiled.policyDigest, facts).planDigest)
      .toBe(plan.planDigest)
    expect(Object.isFrozen(plan)).toBe(true)
  })

  it('keeps unavailable metadata unknown and selects it instead of inventing failure', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['known'], new MetadataAdapter({
      'medium-model': new LlmError('metadata unavailable', 'AUTH'),
      'strong-model': { provider: 'known', id: 'strong-model', name: 'Strong' },
    }))

    const facts = await observeModelRoutes(ctx.llm, routes)
    const compiled = catalog()
    const plan = compileRoutePlan(routableProfile(compiled), compiled.policyDigest, facts)
    expect(plan).toMatchObject({
      kind: 'selected-route-plan',
      selected: { id: 'medium' },
      decisions: [
        { kind: 'rejected' },
        {
          kind: 'selected',
          evidence: {
            modelResolution: 'unknown',
            outputBudget: { kind: 'unknown' },
            metadataUnknownCause: { kind: 'error-code', code: 'AUTH' },
            unknowns: [
              'MODEL_METADATA_UNAVAILABLE',
              'CONTEXT_CAPACITY_UNKNOWN',
              'EFFECTIVE_OUTPUT_BUDGET_UNKNOWN',
            ],
          },
        },
        { kind: 'skipped', reason: 'HIGHER_PRIORITY_SELECTED' },
      ],
    })
  })

  it('binds bounded metadata-unknown causes into route evidence and digest', () => {
    const compiled = catalog()
    const profile = routableProfile(compiled)
    const facts = (errorCode: string): ModelFactsObservations => ({
      facts: routes.map((route, index) => index === 1
        ? {
            kind: 'metadata-unknown',
            routeId: route.id,
            provider: route.provider,
            model: route.model,
            errorCode,
          }
        : {
            kind: 'adapter-missing',
            routeId: route.id,
            provider: route.provider,
            model: route.model,
          }),
    })
    const auth = compileRoutePlan(profile, compiled.policyDigest, facts('AUTH'))
    const quota = compileRoutePlan(profile, compiled.policyDigest, facts('RATE_LIMIT'))
    expect(auth.planDigest).not.toBe(quota.planDigest)
    expect(auth.decisions[1]).toMatchObject({
      kind: 'selected',
      evidence: { metadataUnknownCause: { kind: 'error-code', code: 'AUTH' } },
    })
  })

  it('fails loud on invalid adapter metadata instead of switching candidates', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['known'], new MetadataAdapter({
      'medium-model': new LlmError('invalid context', 'INVALID_MODEL_CONTEXT'),
    }))
    await expect(observeModelRoutes(ctx.llm, routes)).rejects.toMatchObject({
      code: 'INVALID_MODEL_CONTEXT',
    })
  })

  it('treats exact adapter rejection as known, but not unlisted catalog absence', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['known'], new MetadataAdapter({
      'medium-model': new LlmError('unknown model', 'UNKNOWN_MODEL'),
    }))
    const facts = await observeModelRoutes(ctx.llm, routes.slice(1, 2))
    expect(facts.facts[0]).toMatchObject({ kind: 'rejected', errorCode: 'UNKNOWN_MODEL' })

    const passThrough = await observeModelRoutes(ctx.llm, [{
      id: 'unlisted', provider: 'known', model: 'not-in-list',
    }])
    expect(passThrough.facts[0]).toMatchObject({
      kind: 'resolved', routeId: 'unlisted', provider: 'known', model: 'not-in-list',
    })
  })

  it('freezes an adapter default into the selected effective output budget and start projection', () => {
    const compiled = compileCatalog({
      ...config(),
      profiles: {
        deep: {
          ...config().profiles.deep!,
          routes: [routes[1]!],
        },
      },
    }, {
      providers: {
        spawn: {
          continuable: true,
          capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
        },
      },
    })
    const profile = compiled.activeSpecialists.deep
    if (profile?.routes === undefined) throw new Error('expected routable profile')
    const facts: ModelFactsObservations = {
      facts: [{
        kind: 'resolved',
        routeId: 'medium',
        provider: 'known',
        model: 'medium-model',
        contextWindow: 128_000,
        defaultMaxTokens: 32_000,
      }],
    }
    const routePlan = compileRoutePlan({ ...profile, routes: profile.routes }, compiled.policyDigest, facts)
    expect(routePlan).toMatchObject({
      kind: 'selected-route-plan',
      selected: {
        maxTokens: 32_000,
        maxTokensSource: 'adapter-default',
        maxTokensScope: 'initial-activation',
      },
      decisions: [{
        kind: 'selected',
        evidence: { outputBudget: { kind: 'adapter-default', tokens: 32_000 } },
      }],
    })
    if (routePlan.kind !== 'selected-route-plan') throw new Error('expected selected plan')
    const base = compileDelegationPlan(compiled, { description: 'budget', prompt: 'Work.' })
    expect(applyRoutePlan(base, routePlan).agentOptions?.maxTokens).toBe(32_000)
  })

  it('returns a frozen unroutable plan when every adapter is missing', () => {
    const compiled = catalog()
    const facts: ModelFactsObservations = {
      facts: routes.map(route => ({
        kind: 'adapter-missing',
        routeId: route.id,
        provider: route.provider,
        model: route.model,
      })),
    }
    const plan = compileRoutePlan(routableProfile(compiled), compiled.policyDigest, facts)
    expect(plan.kind).toBe('unroutable-route-plan')
    if (plan.kind !== 'unroutable-route-plan') throw new Error('expected unroutable plan')
    expect(() => { throw new RoutePlanError(plan) }).toThrow(/no exact model route/)
  })

  it('rejects incomplete or forged model fact snapshots', () => {
    const compiled = catalog()
    expect(() => compileRoutePlan(routableProfile(compiled), compiled.policyDigest, { facts: [] }))
      .toThrow(/exactly one observation per route/)
    expect(() => compileRoutePlan(routableProfile(compiled), compiled.policyDigest, {
      facts: routes.map((route, index) => ({
        kind: 'resolved' as const,
        routeId: index === 0 ? 'wrong' : route.id,
        provider: route.provider,
        model: route.model,
      })),
    })).toThrow(/do not match route/)
  })

  it('runtime-rejects forged model fact variants and fields', () => {
    const compiled = catalog()
    const profile = routableProfile(compiled)
    const valid = routes.map(route => ({
      kind: 'adapter-missing' as const,
      routeId: route.id,
      provider: route.provider,
      model: route.model,
    }))
    expect(() => compileRoutePlan(profile, compiled.policyDigest, {
      facts: [{ ...valid[0]!, kind: 'future' }, ...valid.slice(1)],
    } as never)).toThrow(/unknown model fact kind/)
    expect(() => compileRoutePlan(profile, compiled.policyDigest, {
      facts: [{ ...valid[0]!, extra: true }, ...valid.slice(1)],
    } as never)).toThrow(/unknown field.*extra/)
    expect(() => compileRoutePlan(profile, compiled.policyDigest, {
      facts: [
        valid[0]!,
        { ...valid[1]!, kind: 'rejected', errorCode: '' },
        valid[2]!,
      ],
    } as never)).toThrow(/bounded machine error code/)
    expect(() => compileRoutePlan(profile, compiled.policyDigest, {
      facts: [
        valid[0]!,
        { ...valid[1]!, kind: 'rejected', errorCode: 'AUTH' },
        valid[2]!,
      ],
    } as never)).toThrow(/unsupported exact-model rejection code/)
  })

  it('applies exactly one selected route and additive instructions to a delegation plan', () => {
    const compiled = catalog()
    const facts: ModelFactsObservations = {
      facts: [
        { kind: 'adapter-missing', routeId: 'small', provider: 'missing', model: 'small-model' },
        {
          kind: 'rejected', routeId: 'medium', provider: 'known', model: 'medium-model',
          errorCode: 'UNKNOWN_MODEL',
        },
        {
          kind: 'resolved', routeId: 'strong', provider: 'known', model: 'strong-model',
          contextWindow: 128_000, defaultMaxTokens: 32_000, reasoningEfforts: ['high'],
        },
      ],
    }
    const routePlan = compileRoutePlan(routableProfile(compiled), compiled.policyDigest, facts)
    if (routePlan.kind !== 'selected-route-plan') throw new Error('expected selected plan')
    const base = compileDelegationPlan(compiled, {
      description: 'deep task',
      prompt: 'Complete the task.',
    })
    const routed = applyRoutePlan(base, routePlan)
    expect(routed.agentOptions).toEqual({ provider: 'known', model: 'strong-model', maxTokens: 16_000 })
    expect(routed.routePlan).toBe(routePlan)
    expect(routed.persona).toBe('Base persona.\n\nUse the selected strong route.')
    expect(Object.isFrozen(routed)).toBe(true)
    expect(Object.isFrozen(routed.agentOptions)).toBe(true)

    const forged = {
      ...routePlan,
      selected: { ...routePlan.selected, model: 'tampered-model' },
    }
    expect(() => applyRoutePlan(base, forged)).toThrow(/digest does not match/)
  })
})
