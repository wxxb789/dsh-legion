import { describe, expect, it } from 'vitest'
import { compileCatalog } from '../src/compiler.ts'
import { materializeConfig, type Config } from '../src/config.ts'
import { DEFAULT_CATALOG_LAYER } from '../src/default-catalog.ts'
import {
  OrchestrationCompileError,
  assertOrchestrationCatalogUsable,
  compileOrchestrationCatalog,
  compileStrategy,
} from '../src/orchestration.ts'

const config: Config = {
  configVersion: 2,
  toolName: 'legion',
  enableRunInBackground: true,
  catalogLayers: [DEFAULT_CATALOG_LAYER],
  profiles: {
    deep: {
      description: 'Deep executor.',
      subagentProvider: 'spawn',
      maxDepth: 2,
      defaultRunInBackground: false,
      result: 'text',
    },
    quick: {
      description: 'Quick researcher.',
      subagentProvider: 'spawn',
      maxDepth: 2,
      defaultRunInBackground: false,
      result: 'text',
    },
    review: {
      description: 'Independent reviewer.',
      subagentProvider: 'spawn',
      maxDepth: 2,
      defaultRunInBackground: false,
      result: 'review-v1',
    },
  },
}

const runtime = {
  providers: {
    spawn: {
      continuable: true,
      capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    },
  },
}

function compiled() {
  const materialized = materializeConfig(config)
  const profiles = compileCatalog(materialized, runtime)
  return {
    materialized,
    profiles,
    orchestration: compileOrchestrationCatalog(profiles),
  }
}

describe('Team and Strategy compiler', () => {
  it('compiles the public default catalog to bounded DSH primitive IR', () => {
    const { orchestration } = compiled()
    expect(() => assertOrchestrationCatalogUsable(orchestration)).not.toThrow()
    expect(Object.keys(orchestration.teams)).toEqual([
      'independent-review', 'plan-execute-review', 'research-panel',
    ])
    expect(Object.keys(orchestration.strategies)).toEqual([
      'independent-review', 'plan-execute-review', 'research-panel',
    ])
    expect(orchestration.strategies['independent-review']).toMatchObject({
      executionClass: 'subagents',
      primitives: [
        { kind: 'dsh-delegate', stage: 'execute', profile: 'deep' },
        { kind: 'dsh-delegate', stage: 'review', profile: 'review' },
      ],
    })
    expect(orchestration.strategies['research-panel']).toMatchObject({
      executionClass: 'hybrid',
      artifacts: {
        findings: { contract: 'text', collection: true, availability: 'degraded' },
        synthesis: { contract: 'text', collection: false, availability: 'required' },
      },
      primitives: [
        { kind: 'dsh-workflow-fanout', count: 3, minSuccess: 2 },
        { kind: 'dsh-delegate', stage: 'synthesis' },
      ],
    })
    expect(orchestration.strategies['plan-execute-review']).toMatchObject({
      executionClass: 'hybrid',
      primitives: [
        { kind: 'dsh-delegate', stage: 'plan' },
        { kind: 'dsh-delegate', stage: 'execute' },
        { kind: 'dsh-delegate', stage: 'review' },
        { kind: 'dsh-goal', stage: 'repair', maxRounds: 1 },
      ],
    })
    expect(orchestration.digest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(Object.isFrozen(orchestration)).toBe(true)
  })

  it('recreates every default entirely through ordinary public deployment data', () => {
    const layered = compiled().orchestration
    const recreatedConfig = materializeConfig({
      ...config,
      catalogLayers: [],
      teams: DEFAULT_CATALOG_LAYER.teams,
      strategies: DEFAULT_CATALOG_LAYER.strategies,
    })
    const profileCatalog = compileCatalog(recreatedConfig, runtime)
    const recreated = compileOrchestrationCatalog(profileCatalog)

    expect(recreated.digest).toBe(layered.digest)
    expect(recreated.teams).toEqual(layered.teams)
    expect(recreated.strategies).toEqual(layered.strategies)
  })

  it('binds objectives and only permits invocation limits to narrow', () => {
    const { orchestration } = compiled()
    const first = compileStrategy(orchestration, {
      strategy: 'independent-review',
      objective: 'Implement and verify the change.',
      limits: { deadlineMs: 60_000, maxOutputBytes: 128_000 },
    })
    expect(first).toMatchObject({
      ok: true,
      plan: {
        kind: 'compiled-strategy-plan',
        strategy: 'independent-review',
        team: 'independent-review',
        limits: { deadlineMs: 60_000, maxOutputBytes: 128_000 },
      },
    })
    if (!first.ok) throw new Error('expected compiled strategy')
    expect(first.plan.planDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(compileStrategy(orchestration, {
      strategy: 'independent-review',
      objective: 'Implement and verify the change.',
      limits: { deadlineMs: 60_000, maxOutputBytes: 128_000 },
    })).toEqual(first)
    expect(compileStrategy(orchestration, {
      strategy: 'independent-review',
      objective: 'Work.',
      limits: { hiddenBudget: 1 },
    })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'STRATEGY_REQUEST_INVALID' }],
    })
    expect(compileStrategy(orchestration, {
      strategy: 'independent-review',
      objective: 'Work.',
      limits: { maxAgents: 1 },
    })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'STRATEGY_LIMIT_UNSATISFIABLE' }],
    })
    const widened = compileStrategy(orchestration, {
      strategy: 'independent-review',
      objective: 'Work.',
      limits: { maxAgents: 99 },
    })
    expect(widened).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'STRATEGY_LIMIT_WIDENING', severity: 'error' }],
    })
  })

  it('treats Team/Strategy limits as ceilings while enforcing stage participant demand', () => {
    const materialized = materializeConfig({
      configVersion: 2,
      profiles: config.profiles,
      teams: {
        roomy: {
          description: 'Roomy ceiling.',
          members: {
            workers: { profile: 'deep', minParticipants: 2, maxParticipants: 2 },
            single: { profile: 'deep' },
          },
          limits: { maxMembers: 4, maxConcurrentMembers: 1 },
        },
      },
      strategies: {
        invalid: {
          description: 'Single delegate cannot satisfy two participants.',
          team: 'roomy',
          stages: [{
            kind: 'delegate',
            id: 'run',
            member: 'workers',
            inputs: [{ artifact: 'objective', contract: 'objective-v1' }],
            output: { artifact: 'result', contract: 'text' },
            prompt: 'Run.',
          }],
          completion: { artifact: 'result', contract: 'text' },
          limits: {
            maxAgents: 4,
            maxConcurrent: 4,
            maxRounds: 1,
            deadlineMs: 60_000,
            maxOutputBytes: 64_000,
          },
          memberFailure: 'fail',
        },
        clamped: {
          description: 'Team concurrency narrows the Strategy ceiling.',
          team: 'roomy',
          stages: [{
            kind: 'delegate',
            id: 'run',
            member: 'single',
            inputs: [{ artifact: 'objective', contract: 'objective-v1' }],
            output: { artifact: 'result', contract: 'text' },
            prompt: 'Run.',
          }],
          completion: { artifact: 'result', contract: 'text' },
          limits: {
            maxAgents: 4,
            maxConcurrent: 4,
            maxRounds: 1,
            deadlineMs: 60_000,
            maxOutputBytes: 64_000,
          },
          memberFailure: 'fail',
        },
      },
    })
    const profileCatalog = compileCatalog(materialized, runtime)
    const orchestration = compileOrchestrationCatalog(profileCatalog)
    expect(orchestration.teams.roomy).toMatchObject({
      maxMembers: 4,
      maxConcurrentMembers: 1,
    })
    expect(orchestration.strategies.invalid).toBeUndefined()
    expect(orchestration.strategies.clamped?.limits.maxConcurrent).toBe(1)
    expect(orchestration.diagnostics).toContainEqual(expect.objectContaining({
      code: 'STRATEGY_MEMBER_CARDINALITY_UNSATISFIED',
      strategy: 'invalid',
    }))
  })

  it('rejects inherited properties and cross-variant stage fields at the external boundary', () => {
    const inheritedTeam = Object.assign(Object.create({ hidden: true }), {
      description: 'Inherited.',
      members: { executor: { profile: 'deep' } },
    })
    expect(() => materializeConfig({
      configVersion: 2,
      profiles: config.profiles,
      teams: { inherited: inheritedTeam },
    })).toThrow(/must be a plain object/)

    expect(() => materializeConfig({
      configVersion: 2,
      profiles: config.profiles,
      teams: {
        coding: { description: 'Coding.', members: { executor: { profile: 'deep' } } },
      },
      strategies: {
        bad: {
          description: 'Bad.',
          team: 'coding',
          stages: [{
            kind: 'delegate',
            id: 'run',
            member: 'executor',
            inputs: [{ artifact: 'objective', contract: 'objective-v1' }],
            output: { artifact: 'result', contract: 'text' },
            prompt: 'Run.',
            count: 2,
          }],
          completion: { artifact: 'result', contract: 'text' },
          limits: {
            maxAgents: 1,
            maxConcurrent: 1,
            maxRounds: 1,
            deadlineMs: 60_000,
            maxOutputBytes: 64_000,
          },
          memberFailure: 'fail',
        },
      },
    })).toThrow(/unknown field.*count/)
  })

  it('rejects forward references, contract mismatches, and invalid fanout cardinality', () => {
    const materialized = materializeConfig({
      ...config,
      catalogLayers: [],
      teams: {
        broken: {
          description: 'Broken.',
          members: { researchers: { profile: 'quick', minParticipants: 1, maxParticipants: 2 } },
        },
      },
      strategies: {
        broken: {
          description: 'Broken.',
          team: 'broken',
          stages: [
            {
              kind: 'fanout',
              id: 'first',
              member: 'researchers',
              count: 3,
              minSuccess: 4,
              allowDegraded: true,
              inputs: [{ artifact: 'later', contract: 'review-v1' }],
              output: { artifact: 'findings', contract: 'review-v1' },
              prompt: 'Break.',
            },
            {
              kind: 'delegate',
              id: 'later',
              member: 'researchers',
              inputs: [{ artifact: 'objective', contract: 'objective-v1', optional: true }],
              output: { artifact: 'later', contract: 'text' },
              prompt: 'Later.',
            },
          ],
          completion: { artifact: 'missing', contract: 'text' },
          limits: {
            maxAgents: 2,
            maxConcurrent: 1,
            maxRounds: 1,
            deadlineMs: 60_000,
            maxOutputBytes: 64_000,
          },
          memberFailure: 'allow-partial',
        },
      },
    })
    const profiles = compileCatalog(materialized, runtime)
    const orchestration = compileOrchestrationCatalog(profiles)
    expect(orchestration.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'STRATEGY_ARTIFACT_FORWARD_REFERENCE' }),
      expect.objectContaining({ code: 'STRATEGY_MEMBER_CARDINALITY_UNSATISFIED' }),
      expect.objectContaining({ code: 'STRATEGY_PROFILE_RESULT_MISMATCH' }),
      expect.objectContaining({ code: 'STRATEGY_ARTIFACT_AVAILABILITY_MISMATCH' }),
      expect.objectContaining({ code: 'STRATEGY_COMPLETION_UNKNOWN_ARTIFACT' }),
      expect.objectContaining({ code: 'STRATEGY_CONCURRENCY_LIMIT_EXCEEDED' }),
    ]))
    expect(() => assertOrchestrationCatalogUsable(orchestration))
      .toThrow(OrchestrationCompileError)
  })

  it('keeps runtime-inactive Profile references diagnostic-only until Strategy invocation', () => {
    const materialized = materializeConfig({
      configVersion: 2,
      profiles: {
        unavailable: {
          description: 'Unavailable.',
          subagentProvider: 'missing',
          maxDepth: 2,
          defaultRunInBackground: false,
        },
      },
      teams: {
        required: {
          description: 'Required.',
          members: { member: { profile: 'unavailable' } },
        },
        optional: {
          description: 'Optional.',
          members: {
            member: { profile: 'unavailable', minParticipants: 0, maxParticipants: 1 },
          },
        },
      },
      strategies: {
        required: {
          description: 'Required inactive.',
          team: 'required',
          stages: [{
            kind: 'delegate',
            id: 'run',
            member: 'member',
            inputs: [{ artifact: 'objective', contract: 'objective-v1' }],
            output: { artifact: 'result', contract: 'text' },
            prompt: 'Run.',
          }],
          completion: { artifact: 'result', contract: 'text' },
          limits: {
            maxAgents: 1,
            maxConcurrent: 1,
            maxRounds: 1,
            deadlineMs: 60_000,
            maxOutputBytes: 64_000,
          },
          memberFailure: 'fail',
        },
      },
    })
    const profiles = compileCatalog(materialized, { providers: {} })
    const orchestration = compileOrchestrationCatalog(profiles)
    expect(orchestration.teams.required).toMatchObject({
      members: { member: { active: false } },
    })
    expect(orchestration.teams.optional).toMatchObject({
      members: { member: { active: false } },
    })
    expect(orchestration.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'TEAM_PROFILE_INACTIVE', severity: 'warning', team: 'required' }),
      expect.objectContaining({ code: 'TEAM_PROFILE_INACTIVE', severity: 'warning', team: 'optional' }),
    ]))
    expect(orchestration.strategies.required?.active).toBe(false)
    expect(compileStrategy(orchestration, { strategy: 'required', objective: 'Work.' }))
      .toMatchObject({
        ok: false,
        diagnostics: [{ code: 'TEAM_PROFILE_INACTIVE', severity: 'error' }],
      })
  })
})
