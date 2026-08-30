import { describe, expect, it } from 'vitest'
import {
  CANONICAL_CONFIG_VERSION,
  CURRENT_CONFIG_VERSION,
  Config as ConfigSchema,
  exportConfigDocument,
  exportCurrentConfigDocument,
  materializeCompiledConfig,
  materializeConfig,
  materializeConfigWithDiagnostics,
  materializeCurrentConfig,
  materializeCurrentConfigWithDiagnostics,
  type Config,
  type CurrentConfig,
} from '../src/config.ts'
import { compileCatalog } from '../src/compiler.ts'
import { compileOrchestrationCatalog, compileStrategy } from '../src/orchestration.ts'

const authored: Config = {
  toolName: 'legion',
  enableRunInBackground: true,
  defaultProfile: 'deep',
  profiles: {
    deep: {
      description: 'Deep work.',
      subagentProvider: 'spawn',
      routes: [{
        id: 'primary',
        provider: 'models',
        model: 'strong',
        constraints: { minContextTokens: 64_000 },
      }],
      maxDepth: 2,
      defaultRunInBackground: false,
    },
  },
}

const current: CurrentConfig = {
  configVersion: 3,
  toolName: 'legion',
  enableRunInBackground: true,
  defaultSpecialist: 'deep',
  specialists: authored.profiles,
  cohorts: {
    workers: {
      description: 'Workers.',
      members: { worker: { specialist: 'deep' } },
    },
  },
  strategies: {
    work: {
      description: 'Work.',
      cohort: 'workers',
      stages: [{
        kind: 'delegate',
        id: 'work',
        member: 'worker',
        inputs: [{ artifact: 'objective', contract: 'objective-v1' }],
        output: { artifact: 'result', contract: 'text' },
        prompt: 'Work.',
      }],
      completion: { artifact: 'result', contract: 'text' },
      limits: { maxAgents: 1, maxConcurrent: 1, deadlineMs: 60_000, maxOutputBytes: 64_000 },
      memberFailure: 'fail',
    },
  },
}

const runtime = {
  providers: {
    spawn: {
      continuable: true,
      capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    },
  },
}

describe('versioned config migration and rollback', () => {
  it('migrates legacy unversioned and explicit v1 documents to current v2 without semantic drift', () => {
    const migrated = materializeConfig(authored)
    const explicit = materializeConfig({ ...authored, configVersion: 1 })

    expect(migrated.configVersion).toBe(2)
    expect(migrated.enableStrategies).toBe(false)
    expect(migrated.enableDurableRuns).toBe(false)
    expect(migrated.durableRunPolicy).toEqual({ maxStartsPerActivation: 16, maxConcurrentTasks: 4 })
    expect(Object.isFrozen(migrated)).toBe(true)
    expect(Object.isFrozen(migrated.profiles.deep?.routes)).toBe(true)
    expect(migrated).toEqual(explicit)
    expect(materializeConfig(ConfigSchema({ ...authored, configVersion: 1 }))).toEqual(explicit)
    expect(compileCatalog(authored, runtime).policyDigest)
      .toBe(compileCatalog(explicit, runtime).policyDigest)
    expect(compileCatalog({ ...authored, configVersion: 2, enableStrategies: true }, runtime).policyDigest)
      .not.toBe(compileCatalog(explicit, runtime).policyDigest)
    expect(compileCatalog({
      ...authored,
      configVersion: 2,
      enableDurableRuns: true,
      durableRunPolicy: { maxStartsPerActivation: 3 },
    }, runtime).policyDigest).not.toBe(compileCatalog(explicit, runtime).policyDigest)
  })

  it('pins published v2 policy, catalog, orchestration, and plan digests', () => {
    const legacyV2 = {
      ...authored,
      configVersion: 2 as const,
      teams: {
        workers: {
          description: 'Workers.',
          members: { worker: { profile: 'deep' } },
        },
      },
      strategies: {
        work: {
          description: 'Work.',
          team: 'workers',
          stages: [{
            kind: 'delegate' as const,
            id: 'work',
            member: 'worker',
            inputs: [{ artifact: 'objective', contract: 'objective-v1' as const }],
            output: { artifact: 'result', contract: 'text' as const },
            prompt: 'Work.',
          }],
          completion: { artifact: 'result', contract: 'text' as const },
          limits: { maxAgents: 1, maxConcurrent: 1, deadlineMs: 60_000, maxOutputBytes: 64_000 },
          memberFailure: 'fail' as const,
        },
      },
    }
    const catalog = compileCatalog(legacyV2, runtime)
    const orchestration = compileOrchestrationCatalog(catalog)
    const plan = compileStrategy(orchestration, { strategy: 'work', objective: 'Ship it.' })
    if (!plan.ok) throw new Error('expected digest fixture to compile')

    const expected = [
      'sha256:4fc70015b90b92ccb432e8c2999d14ae5591963806d2ae2d3437526794fa1aed',
      'sha256:df74e012856fc844d1533cac42c6b0f3f73500360d81a90d4e86df76a169511b',
      'sha256:6b5f0edf10b1f8d27e180d8de1f8f4d6f40b5e268dca51005450746688d8fcee',
      'sha256:beb62a7d032dbc352d9dbd558b0498528ab6e126473e9920ae61d1f0bd54f0ca',
    ]
    expect([
      catalog.policyDigest,
      catalog.catalogDigest,
      orchestration.digest,
      plan.plan.planDigest,
    ]).toEqual(expected)

    const currentCatalog = compileCatalog(current, runtime)
    const currentOrchestration = compileOrchestrationCatalog(currentCatalog)
    const currentPlan = compileStrategy(currentOrchestration, { strategy: 'work', objective: 'Ship it.' })
    if (!currentPlan.ok) throw new Error('expected current digest fixture to compile')
    expect([
      currentCatalog.policyDigest,
      currentCatalog.catalogDigest,
      currentOrchestration.digest,
      currentPlan.plan.planDigest,
    ]).toEqual(expected)
  })

  it('materializes the current v3 top-level and nested dialect without warnings', () => {
    const result = materializeCurrentConfigWithDiagnostics({
      ...current,
      catalogLayers: [{
        id: 'extension',
        specialists: {
          quick: {
            description: 'Quick work.',
            subagentProvider: 'spawn',
            maxDepth: 1,
            defaultRunInBackground: false,
          },
        },
        cohorts: {
          reviewers: {
            description: 'Reviewers.',
            members: { reviewer: { specialist: 'quick' } },
          },
        },
        strategies: {
          review: { ...current.strategies!.work!, cohort: 'reviewers' },
        },
        disable: { specialists: ['unused'], cohorts: ['unused'], strategies: ['unused'] },
      }],
    })

    expect(result.diagnostics).toEqual([])
    expect(result.config).toMatchObject({
      configVersion: 3,
      defaultSpecialist: 'deep',
      specialists: { deep: authored.profiles.deep, quick: { description: 'Quick work.' } },
      cohorts: {
        workers: { members: { worker: { specialist: 'deep' } } },
        reviewers: { members: { reviewer: { specialist: 'quick' } } },
      },
      strategies: { work: { cohort: 'workers' }, review: { cohort: 'reviewers' } },
    })
    expect(JSON.stringify(result.config)).not.toMatch(/"(?:profiles|defaultProfile|teams|profile|team)"/)
  })

  it('reports every retired top-level and nested authored path with its removal version', () => {
    const result = materializeCurrentConfigWithDiagnostics({
      configVersion: 2,
      toolName: 'legion',
      enableRunInBackground: true,
      defaultProfile: 'deep',
      profiles: authored.profiles,
      teams: {
        workers: {
          description: 'Workers.',
          members: { worker: { profile: 'deep' } },
        },
      },
      strategies: {
        work: { ...current.strategies!.work!, team: 'workers', cohort: undefined },
      },
      catalogLayers: [{
        id: 'extension',
        profiles: {
          quick: {
            description: 'Quick work.',
            subagentProvider: 'spawn',
            maxDepth: 1,
            defaultRunInBackground: false,
          },
        },
        teams: {
          reviewers: {
            description: 'Reviewers.',
            members: { reviewer: { profile: 'quick' } },
          },
        },
        strategies: {
          review: { ...current.strategies!.work!, team: 'reviewers', cohort: undefined },
        },
        disable: { profiles: ['unused-profile'], teams: ['unused-team'] },
      }],
    })

    expect(result.diagnostics.map(({ path, replacement, removalVersion }) => ({
      path, replacement, removalVersion,
    }))).toEqual([
      { path: 'config.profiles', replacement: 'config.specialists', removalVersion: '2.0.0' },
      { path: 'config.defaultProfile', replacement: 'config.defaultSpecialist', removalVersion: '2.0.0' },
      { path: 'config.teams', replacement: 'config.cohorts', removalVersion: '2.0.0' },
      {
        path: 'config.teams.workers.members.worker.profile',
        replacement: 'config.teams.workers.members.worker.specialist',
        removalVersion: '2.0.0',
      },
      {
        path: 'config.strategies.work.team',
        replacement: 'config.strategies.work.cohort',
        removalVersion: '2.0.0',
      },
      {
        path: 'config.catalogLayers[0].profiles',
        replacement: 'config.catalogLayers[0].specialists',
        removalVersion: '2.0.0',
      },
      {
        path: 'config.catalogLayers[0].teams',
        replacement: 'config.catalogLayers[0].cohorts',
        removalVersion: '2.0.0',
      },
      {
        path: 'config.catalogLayers[0].teams.reviewers.members.reviewer.profile',
        replacement: 'config.catalogLayers[0].teams.reviewers.members.reviewer.specialist',
        removalVersion: '2.0.0',
      },
      {
        path: 'config.catalogLayers[0].strategies.review.team',
        replacement: 'config.catalogLayers[0].strategies.review.cohort',
        removalVersion: '2.0.0',
      },
      {
        path: 'config.catalogLayers[0].disable.profiles',
        replacement: 'config.catalogLayers[0].disable.specialists',
        removalVersion: '2.0.0',
      },
      {
        path: 'config.catalogLayers[0].disable.teams',
        replacement: 'config.catalogLayers[0].disable.cohorts',
        removalVersion: '2.0.0',
      },
    ])
  })

  it('merges disjoint current and retired maps and disable lists in deterministic order', () => {
    const quick = {
      description: 'Quick work.', subagentProvider: 'spawn', maxDepth: 1,
      defaultRunInBackground: false,
    }
    const result = materializeCurrentConfig({
      ...current,
      profiles: { legacy: quick },
      specialists: { current: quick, deep: authored.profiles.deep! },
      teams: {
        legacy: { description: 'Legacy.', members: { worker: { profile: 'legacy' } } },
      },
      cohorts: {
        current: { description: 'Current.', members: { worker: { specialist: 'current' } } },
        workers: current.cohorts!.workers!,
      },
      catalogLayers: [{
        id: 'extension',
        profiles: { 'layer-legacy': quick },
        specialists: { 'layer-current': quick },
        teams: { 'layer-legacy': { description: 'Legacy.', members: { worker: { profile: 'layer-legacy' } } } },
        cohorts: { 'layer-current': { description: 'Current.', members: { worker: { specialist: 'layer-current' } } } },
        disable: {
          profiles: ['disabled-legacy'], specialists: ['disabled-current'],
          teams: ['cohort-legacy'], cohorts: ['cohort-current'],
        },
      }],
    })

    expect(Object.keys(result.specialists)).toEqual([
      'current', 'deep', 'layer-current', 'layer-legacy', 'legacy',
    ])
    expect(Object.keys(result.cohorts)).toEqual([
      'current', 'layer-current', 'layer-legacy', 'legacy', 'workers',
    ])
  })

  it('applies disjoint current and retired disable lists without dropping either side', () => {
    const extra = {
      description: 'Extra.', subagentProvider: 'spawn', maxDepth: 1,
      defaultRunInBackground: false,
    }
    const cohort = { description: 'Extra.', members: { worker: { specialist: 'deep' } } }
    const result = materializeCurrentConfig({
      ...current,
      catalogLayers: [
        {
          id: 'definitions',
          specialists: { 'retired-specialist': extra, 'current-specialist': extra },
          cohorts: { 'retired-cohort': cohort, 'current-cohort': cohort },
        },
        {
          id: 'disable',
          disable: {
            profiles: ['retired-specialist'],
            specialists: ['current-specialist'],
            teams: ['retired-cohort'],
            cohorts: ['current-cohort'],
          },
        },
      ],
    })

    expect(result.specialists).not.toHaveProperty('retired-specialist')
    expect(result.specialists).not.toHaveProperty('current-specialist')
    expect(result.cohorts).not.toHaveProperty('retired-cohort')
    expect(result.cohorts).not.toHaveProperty('current-cohort')
  })

  it.each([
    ['default selection', { ...current, defaultProfile: 'deep' }, /defaultSpecialist.*defaultProfile/],
    ['top Specialist entry', {
      ...current, profiles: { deep: authored.profiles.deep! },
    }, /entry "deep" cannot use both "specialists" and retired "profiles"/],
    ['top Cohort entry', {
      ...current, teams: { workers: { description: 'Workers.', members: { worker: { profile: 'deep' } } } },
    }, /entry "workers" cannot use both "cohorts" and retired "teams"/],
    ['Member Slot', {
      ...current,
      cohorts: { workers: { description: 'Workers.', members: { worker: { specialist: 'deep', profile: 'deep' } } } },
    }, /specialist.*profile/],
    ['Strategy', {
      ...current,
      strategies: { work: { ...current.strategies!.work!, team: 'workers' } },
    }, /cohort.*team/],
    ['Layer Specialist entry', {
      ...current,
      catalogLayers: [{ id: 'extension', specialists: { deep: authored.profiles.deep! }, profiles: { deep: authored.profiles.deep! } }],
    }, /entry "deep" cannot use both "specialists" and retired "profiles"/],
    ['Layer Cohort entry', {
      ...current,
      catalogLayers: [{
        id: 'extension',
        cohorts: { workers: current.cohorts!.workers! },
        teams: { workers: { description: 'Workers.', members: { worker: { profile: 'deep' } } } },
      }],
    }, /entry "workers" cannot use both "cohorts" and retired "teams"/],
    ['Layer Member Slot', {
      ...current,
      catalogLayers: [{
        id: 'extension',
        cohorts: {
          review: {
            description: 'Review.',
            members: { reviewer: { specialist: 'deep', profile: 'deep' } },
          },
        },
      }],
    }, /specialist.*profile/],
    ['Layer Strategy', {
      ...current,
      catalogLayers: [{
        id: 'extension',
        strategies: { review: { ...current.strategies!.work!, team: 'workers' } },
      }],
    }, /cohort.*team/],
    ['disabled Specialist entry', {
      ...current,
      catalogLayers: [{ id: 'extension', disable: { specialists: ['deep'], profiles: ['deep'] } }],
    }, /entry "deep" cannot use both "specialists" and retired "profiles"/],
    ['disabled Cohort entry', {
      ...current,
      catalogLayers: [{ id: 'extension', disable: { cohorts: ['workers'], teams: ['workers'] } }],
    }, /entry "workers" cannot use both "cohorts" and retired "teams"/],
  ])('rejects ambiguous dual spelling for %s', (_label, input, error) => {
    expect(() => materializeCurrentConfig(input)).toThrow(error)
  })

  it('keeps v2 no-target behavior while exposing current and explicit target-3 exports', () => {
    const legacy = materializeConfig(current)
    const canonical = materializeCurrentConfig(legacy)
    const noTarget = exportConfigDocument(current)
    const explicitV2 = exportConfigDocument(current, 2)
    const explicitV3 = exportConfigDocument(legacy, 3)
    const currentExport = exportCurrentConfigDocument(legacy)

    expect(legacy.configVersion).toBe(2)
    expect(legacy).toHaveProperty('profiles.deep')
    expect(legacy).toHaveProperty('defaultProfile', 'deep')
    expect(legacy).toHaveProperty('teams.workers.members.worker.profile', 'deep')
    expect(legacy).toHaveProperty('strategies.work.team', 'workers')
    expect(noTarget).toEqual(explicitV2)
    expect(noTarget.configVersion).toBe(2)
    expect(CURRENT_CONFIG_VERSION).toBe(2)
    expect(canonical.configVersion).toBe(CANONICAL_CONFIG_VERSION)
    expect(explicitV3).toEqual(currentExport)
    expect(explicitV3).toEqual(canonical)
    expect(JSON.stringify(explicitV3)).not.toMatch(/"(?:profiles|defaultProfile|teams|profile|team)"/)
  })

  it('does not mutate or alias nested authored values across v3 materialization and export', () => {
    const input = structuredClone(current)
    const before = structuredClone(input)
    const materialized = materializeCurrentConfig(input)
    const exported = exportCurrentConfigDocument(input)

    expect(input).toEqual(before)
    expect(materialized.cohorts.workers).not.toBe(input.cohorts?.workers)
    expect(materialized.cohorts.workers?.members.worker).not.toBe(input.cohorts?.workers?.members.worker)
    expect(exported.strategies.work).not.toBe(input.strategies?.work)
    ;(exported.cohorts.workers!.members.worker as { specialist: string }).specialist = 'mutated'
    expect(input.cohorts!.workers!.members.worker!.specialist).toBe('deep')
  })

  it('accepts Specialist and Cohort namespace spellings without changing behavior', () => {
    const cohort = {
      description: 'Reviewers.',
      members: { reviewer: { profile: 'deep' } },
      limits: { maxMembers: 1, maxConcurrentMembers: 1 },
    }
    const { profiles, ...base } = authored

    expect(materializeConfig({
      ...base,
      configVersion: 2,
      specialists: profiles,
      cohorts: { reviewers: cohort },
    })).toEqual(materializeConfig({
      ...authored,
      configVersion: 2,
      teams: { reviewers: cohort },
    }))
  })

  it('normalizes authored aliases into canonical internal namespaces', () => {
    const compiled = materializeCompiledConfig(authored)

    expect(compiled.specialists.deep).toMatchObject(authored.profiles.deep!)
    expect(compiled.defaultSpecialist).toBe('deep')
    expect(compiled.cohorts).toEqual({})
    expect(compiled).not.toHaveProperty('profiles')
    expect(compiled).not.toHaveProperty('defaultProfile')
    expect(compiled).not.toHaveProperty('teams')
  })

  it('merges disjoint spellings but rejects the same entry under both', () => {
    const quick = {
      description: 'Quick work.',
      subagentProvider: 'spawn',
      maxDepth: 1,
      defaultRunInBackground: false,
    }
    const cohort = {
      description: 'Reviewers.',
      members: { reviewer: { profile: 'deep' } },
    }

    expect(materializeConfig({
      ...authored,
      configVersion: 2,
      specialists: { quick },
      teams: { reviewers: cohort },
      cohorts: { auditors: cohort },
    })).toMatchObject({
      profiles: { deep: authored.profiles.deep, quick },
      teams: { reviewers: cohort, auditors: cohort },
    })
    expect(() => materializeConfig({
      ...authored,
      specialists: { deep: authored.profiles.deep! },
    })).toThrow(/entry "deep" cannot use both "specialists" and retired "profiles"/)
    expect(() => materializeConfig({
      ...authored,
      configVersion: 2,
      teams: { reviewers: cohort },
      cohorts: { reviewers: cohort },
    })).toThrow(/entry "reviewers" cannot use both "cohorts" and retired "teams"/)
  })

  it('accepts current namespace spellings inside catalog layers', () => {
    const extra = {
      description: 'Quick work.',
      subagentProvider: 'spawn',
      maxDepth: 1,
      defaultRunInBackground: false,
    }

    expect(materializeConfig({
      ...authored,
      configVersion: 2,
      catalogLayers: [{
        id: 'extension',
        specialists: { quick: extra },
        cohorts: {
          reviewers: {
            description: 'Reviewers.',
            members: { reviewer: { profile: 'quick' } },
          },
        },
      }],
    })).toMatchObject({
      profiles: { deep: authored.profiles.deep, quick: extra },
      teams: { reviewers: { members: { reviewer: { profile: 'quick' } } } },
    })
  })

  it('returns a pure deprecation diagnostic that names the replacement spelling', () => {
    const before = structuredClone(authored)
    const result = materializeConfigWithDiagnostics(authored)

    expect(result.config).toEqual(materializeConfig(authored))
    expect(result.diagnostics).toEqual([
      {
        code: 'LEGION_CONFIG_KEY_DEPRECATED',
        severity: 'warning',
        path: 'config.profiles',
        replacement: 'config.specialists',
        removalVersion: '2.0.0',
        message: 'dsh-legion: config.profiles is deprecated; use config.specialists instead',
      },
      {
        code: 'LEGION_CONFIG_KEY_DEPRECATED',
        severity: 'warning',
        path: 'config.defaultProfile',
        replacement: 'config.defaultSpecialist',
        removalVersion: '2.0.0',
        message: 'dsh-legion: config.defaultProfile is deprecated; use config.defaultSpecialist instead',
      },
    ])
    expect(materializeConfigWithDiagnostics({ ...authored, configVersion: 2, teams: {} }).diagnostics)
      .toContainEqual({
        code: 'LEGION_CONFIG_KEY_DEPRECATED',
        severity: 'warning',
        path: 'config.teams',
        replacement: 'config.cohorts',
        removalVersion: '2.0.0',
        message: 'dsh-legion: config.teams is deprecated; use config.cohorts instead',
      })
    expect(authored).toEqual(before)
  })

  it('validates bounded opt-in durable activation policy without exposing execution', () => {
    expect(materializeConfig({
      ...authored,
      configVersion: 2,
      enableDurableRuns: true,
      durableRunPolicy: { maxStartsPerActivation: 3, maxConcurrentTasks: 2 },
    })).toMatchObject({
      enableDurableRuns: true,
      durableRunPolicy: { maxStartsPerActivation: 3, maxConcurrentTasks: 2 },
    })
    expect(() => materializeConfig({
      ...authored,
      configVersion: 2,
      durableRunPolicy: { maxStartsPerActivation: 33 },
    })).toThrow()
    expect(() => materializeConfig({
      ...authored,
      configVersion: 2,
      durableRunPolicy: { maxStartsPerActivation: 1, maxConcurrentTasks: 2 },
    })).toThrow(/cannot exceed/)
  })

  it('exports normalized current and rollback-compatible unversioned documents', () => {
    const current = exportConfigDocument(authored)
    const rollback = exportConfigDocument(current, 'legacy-unversioned')

    expect(current.configVersion).toBe(2)
    expect(exportConfigDocument(current, 1).configVersion).toBe(1)
    expect(rollback.configVersion).toBeUndefined()
    expect(materializeConfig(rollback)).toEqual(materializeConfig(current))
    expect(rollback.profiles.deep?.routes?.[0]).toMatchObject({
      id: 'primary', provider: 'models', model: 'strong',
    })
  })

  it('rejects invalid runtime export targets instead of treating them as legacy', () => {
    expect(() => exportConfigDocument(authored, 99 as never))
      .toThrow(/unsupported config export target 99/)
  })

  it('rejects accessors and circular references without executing authored code', () => {
    let reads = 0
    const accessor = { ...authored } as Record<string, unknown>
    Object.defineProperty(accessor, 'profiles', {
      enumerable: true,
      get() { reads += 1; return authored.profiles },
    })
    expect(() => materializeConfig(accessor)).toThrow(/plain data, not an accessor/)
    expect(reads).toBe(0)

    const circular: Record<string, unknown> = { ...authored }
    circular.self = circular
    expect(() => materializeConfig(circular)).toThrow(/circular references/)
  })

  it('rejects null for optional authored fields instead of treating it as omission', () => {
    expect(() => materializeConfig({
      configVersion: 2,
      profiles: authored.profiles,
      teams: {
        reviewers: {
          description: 'Reviewers.',
          members: { reviewer: { profile: 'deep', minParticipants: null } },
          limits: { maxMembers: 1, maxConcurrentMembers: 1 },
        },
      },
    })).toThrow(/config\.teams\.reviewers\.members\.reviewer\.minParticipants must not be null/)

    expect(() => materializeConfig({
      configVersion: 2,
      profiles: authored.profiles,
      teams: {
        reviewers: {
          description: 'Reviewers.',
          members: { reviewer: { profile: 'deep' } },
          limits: { maxMembers: 1, maxConcurrentMembers: 1 },
        },
      },
      strategies: {
        review: {
          description: 'Review.',
          team: 'reviewers',
          stages: [{
            kind: 'delegate', id: 'review', member: 'reviewer',
            inputs: [{ artifact: 'objective', contract: 'objective-v1', optional: null }],
            output: { artifact: 'result', contract: 'text' }, prompt: 'Review.',
          }],
          completion: { artifact: 'result', contract: 'text' },
          limits: { maxAgents: 1, maxConcurrent: 1, deadlineMs: 60_000, maxOutputBytes: 64_000 },
          memberFailure: 'fail',
        },
      },
    })).toThrow(/config\.strategies\.review\.stages\[0\]\.inputs\[0\]\.optional must not be null/)
  })

  it('rejects null and unknown future versions instead of guessing or partially migrating', () => {
    expect(() => materializeConfig({ ...authored, configVersion: null }))
      .toThrow(/config\.configVersion must not be null/)
    expect(() => materializeConfig({ ...authored, configVersion: 4 }))
      .toThrow(/unsupported configVersion 4/)
  })

  it('tolerates schema-normalized empty namespaces but requires v2 for non-empty data', () => {
    expect(() => materializeConfig({ ...authored, teams: {}, strategies: {}, catalogLayers: [] }))
      .not.toThrow()
    expect(() => materializeConfig({ ...authored, enableStrategies: true }))
      .toThrow(/configVersion 2 is required/)
    expect(() => materializeConfig(ConfigSchema({ ...authored, enableStrategies: true })))
      .toThrow(/configVersion 2 is required/)
    expect(() => materializeConfig({
      ...authored,
      teams: {
        coding: {
          description: 'Coding.',
          members: { executor: { profile: 'deep' } },
        },
      },
    })).toThrow(/configVersion 2 is required/)
  })

  it('refuses lossy rollback when v2 Team or Strategy data is present', () => {
    const v2 = {
      ...authored,
      configVersion: 2 as const,
      teams: {
        coding: {
          description: 'Coding.',
          members: { executor: { profile: 'deep' } },
        },
      },
    }
    expect(() => exportConfigDocument({
      ...authored,
      configVersion: 2,
      enableStrategies: true,
    }, 1)).toThrow(/cannot be rolled back/)
    expect(() => exportConfigDocument(v2, 1)).toThrow(/cannot be rolled back/)
    expect(() => exportConfigDocument(v2, 'legacy-unversioned')).toThrow(/cannot be rolled back/)
  })

  it('returns detached exports that cannot mutate authored input', () => {
    const current = exportConfigDocument(authored)
    ;(current.profiles.deep!.routes![0] as { model: string }).model = 'mutated'
    expect(authored.profiles.deep?.routes?.[0]?.model).toBe('strong')
  })
})
