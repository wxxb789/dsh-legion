import { describe, expect, it } from 'vitest'
import { compileCatalog } from '../src/compiler.ts'
import { materializeConfig, type Config } from '../src/config.ts'
import { DEFAULT_CATALOG_LAYER } from '../src/default-catalog.ts'
import {
  OrchestrationCompileError,
  assertCompiledStrategyPlan,
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
      primitives: [
        { kind: 'dsh-delegate', stage: 'execute', profile: 'deep' },
        { kind: 'dsh-delegate', stage: 'review', profile: 'review' },
      ],
    })
    expect(orchestration.strategies['research-panel']).toMatchObject({
      artifacts: {
        findings: { contract: 'text', collection: true, availability: 'degraded' },
        synthesis: { contract: 'text', collection: false, availability: 'required' },
      },
      primitives: [
        { kind: 'dsh-subagent-fanout', count: 3, minSuccess: 2 },
        { kind: 'dsh-delegate', stage: 'synthesis' },
      ],
    })
    expect(orchestration.strategies['plan-execute-review']).toMatchObject({
      primitives: [
        { kind: 'dsh-delegate', stage: 'plan' },
        { kind: 'dsh-delegate', stage: 'execute' },
        { kind: 'dsh-delegate', stage: 'review' },
        { kind: 'dsh-delegate', stage: 'repair' },
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
    expect(() => assertCompiledStrategyPlan(first.plan)).not.toThrow()
    expect(() => assertCompiledStrategyPlan({
      ...first.plan,
      objective: 'tampered objective',
    })).toThrow(/not produced by this compiler generation/)
    const forged = JSON.parse(JSON.stringify(first.plan))
    expect(() => assertCompiledStrategyPlan(forged)).toThrow(/not produced by this compiler generation/)
    const reflectiveCopy = { ...first.plan } as Record<PropertyKey, unknown>
    for (const symbol of Object.getOwnPropertySymbols(first.plan)) {
      reflectiveCopy[symbol] = (first.plan as unknown as Record<PropertyKey, unknown>)[symbol]
    }
    expect(() => assertCompiledStrategyPlan(reflectiveCopy as never))
      .toThrow(/not produced by this compiler generation/)
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
          members: { single: { profile: 'deep' } },
          limits: { maxMembers: 4, maxConcurrentMembers: 1 },
        },
        multi: {
          description: 'Required multi-participant slot.',
          members: { workers: { profile: 'deep', minParticipants: 2, maxParticipants: 2 } },
          limits: { maxMembers: 2, maxConcurrentMembers: 2 },
        },
      },
      strategies: {
        invalid: {
          description: 'Single delegate cannot satisfy two participants.',
          team: 'multi',
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

  it('requires positive-minimum Member Slots while permitting omitted zero-minimum slots', () => {
    const materialized = materializeConfig({
      configVersion: 2,
      profiles: config.profiles,
      teams: {
        participation: {
          description: 'Participation constraints.',
          members: {
            executor: { profile: 'deep', minParticipants: 1 },
            'required-reviewer': { profile: 'review', minParticipants: 1 },
            'optional-observer': { profile: 'quick', minParticipants: 0 },
          },
        },
      },
      strategies: {
        incomplete: {
          description: 'Omits required reviewer.',
          team: 'participation',
          stages: [{
            kind: 'delegate', id: 'run', member: 'executor',
            inputs: [{ artifact: 'objective', contract: 'objective-v1' }],
            output: { artifact: 'result', contract: 'text' }, prompt: 'Run.',
          }],
          completion: { artifact: 'result', contract: 'text' },
          limits: { maxAgents: 1, maxConcurrent: 1, deadlineMs: 60_000, maxOutputBytes: 64_000 },
          memberFailure: 'fail',
        },
      },
    })
    const profiles = compileCatalog(materialized, runtime)
    const orchestration = compileOrchestrationCatalog(profiles)
    expect(orchestration.strategies.incomplete).toBeUndefined()
    expect(orchestration.diagnostics).toContainEqual(expect.objectContaining({
      code: 'STRATEGY_MEMBER_CARDINALITY_UNSATISFIED',
      strategy: 'incomplete',
    }))
    expect(orchestration.diagnostics.some(item => item.message.includes('optional-observer'))).toBe(false)
  })

  it('enforces Team maxMembers across maximum per-slot participation demand', () => {
    const materialized = materializeConfig({
      configVersion: 2,
      profiles: config.profiles,
      teams: {
        bounded: {
          description: 'Bounded Team.',
          members: {
            first: { profile: 'deep', maxParticipants: 2 },
            second: { profile: 'deep', maxParticipants: 2 },
          },
          limits: { maxMembers: 2, maxConcurrentMembers: 2 },
        },
      },
      strategies: {
        overbooked: {
          description: 'Overbooks two slots.', team: 'bounded',
          stages: [
            {
              kind: 'fanout', id: 'first', member: 'first', count: 2, minSuccess: 2,
              allowDegraded: false,
              inputs: [{ artifact: 'objective', contract: 'objective-v1' }],
              output: { artifact: 'first-result', contract: 'text' }, prompt: 'First.',
            },
            {
              kind: 'fanout', id: 'second', member: 'second', count: 2, minSuccess: 2,
              allowDegraded: false,
              inputs: [{ artifact: 'first-result', contract: 'text', collection: true }],
              output: { artifact: 'second-result', contract: 'text' }, prompt: 'Second.',
            },
          ],
          completion: { artifact: 'second-result', contract: 'text' },
          limits: { maxAgents: 4, maxConcurrent: 2, deadlineMs: 60_000, maxOutputBytes: 64_000 },
          memberFailure: 'fail',
        },
      },
    })
    const profiles = compileCatalog(materialized, runtime)
    const orchestration = compileOrchestrationCatalog(profiles)
    expect(orchestration.strategies.overbooked).toBeUndefined()
    expect(orchestration.diagnostics).toContainEqual(expect.objectContaining({
      code: 'STRATEGY_MEMBER_CARDINALITY_UNSATISFIED',
      message: expect.stringContaining('maxMembers'),
    }))
  })

  it('rejects inherited properties and cross-variant stage fields at the external boundary', () => {
    expect(() => materializeConfig({
      configVersion: 2,
      profiles: config.profiles,
      teams: {
        invalid: {
          description: 'Invalid slot.',
          members: { 'Bad Slot': { profile: 'deep' } },
        },
      },
    })).toThrow(/invalid slot name/)

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
            deadlineMs: 60_000,
            maxOutputBytes: 64_000,
          },
          memberFailure: 'fail',
        },
      },
    })).toThrow(/unknown field.*count/)
  })

  it('rejects duplicate artifact producers before accepted-byte accounting', () => {
    const materialized = materializeConfig({
      configVersion: 2,
      profiles: config.profiles,
      teams: {
        coding: { description: 'Coding.', members: { executor: { profile: 'deep' } } },
      },
      strategies: {
        duplicate: {
          description: 'Duplicate artifact producer.',
          team: 'coding',
          stages: [
            {
              kind: 'delegate', id: 'first', member: 'executor',
              inputs: [{ artifact: 'objective', contract: 'objective-v1' }],
              output: { artifact: 'result', contract: 'text' }, prompt: 'First.',
            },
            {
              kind: 'delegate', id: 'second', member: 'executor',
              inputs: [{ artifact: 'result', contract: 'text' }],
              output: { artifact: 'result', contract: 'text' }, prompt: 'Second.',
            },
          ],
          completion: { artifact: 'result', contract: 'text' },
          limits: { maxAgents: 2, maxConcurrent: 1, deadlineMs: 60_000, maxOutputBytes: 64_000 },
          memberFailure: 'fail',
        },
      },
    })
    const profiles = compileCatalog(materialized, runtime)
    const orchestration = compileOrchestrationCatalog(profiles)
    expect(orchestration.strategies.duplicate).toBeUndefined()
    expect(orchestration.diagnostics).toContainEqual(expect.objectContaining({
      code: 'STRATEGY_ARTIFACT_DUPLICATE',
      stage: 'second',
    }))
  })

  it('rejects the non-portable session Goal lifecycle as a Strategy stage', () => {
    const base = DEFAULT_CATALOG_LAYER.strategies?.['independent-review']
    if (base === undefined) throw new Error('missing default Strategy')
    expect(() => materializeConfig({
      configVersion: 2,
      profiles: config.profiles,
      catalogLayers: [DEFAULT_CATALOG_LAYER],
      strategies: {
        'legacy-goal': {
          ...base,
          stages: [{
            kind: 'goal',
            id: 'repair',
            member: 'executor',
            maxRounds: 1,
            inputs: [{ artifact: 'objective', contract: 'objective-v1' }],
            output: { artifact: 'result', contract: 'text' },
            prompt: 'Repair.',
          }],
          completion: { artifact: 'result', contract: 'text' },
        },
      },
    })).toThrow(/unknown field.*maxRounds/)
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
