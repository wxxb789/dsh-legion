import { describe, expect, it } from 'vitest'
import {
  CURRENT_CONFIG_VERSION,
  Config as ConfigSchema,
  exportConfigDocument,
  materializeCompiledConfig,
  materializeConfig,
  materializeConfigWithDiagnostics,
  type Config,
} from '../src/config.ts'
import { compileCatalog } from '../src/compiler.ts'

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

const runtime = {
  providers: {
    spawn: {
      continuable: true,
      capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    },
  },
}

describe('versioned config migration and rollback', () => {
  it('migrates legacy unversioned and explicit v1 documents to current v2 without semantic drift', () => {
    const migrated = materializeConfig(authored)
    const explicit = materializeConfig({ ...authored, configVersion: 1 })

    expect(migrated.configVersion).toBe(CURRENT_CONFIG_VERSION)
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
    expect(result.diagnostics).toEqual([{
      code: 'LEGION_CONFIG_KEY_DEPRECATED',
      severity: 'warning',
      path: 'config.profiles',
      replacement: 'config.specialists',
      message: 'dsh-legion: config.profiles is deprecated; use config.specialists instead',
    }])
    expect(materializeConfigWithDiagnostics({ ...authored, configVersion: 2, teams: {} }).diagnostics)
      .toContainEqual({
        code: 'LEGION_CONFIG_KEY_DEPRECATED',
        severity: 'warning',
        path: 'config.teams',
        replacement: 'config.cohorts',
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
    expect(() => materializeConfig({ ...authored, configVersion: 3 }))
      .toThrow(/unsupported configVersion 3/)
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
