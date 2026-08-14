import { describe, expect, it } from 'vitest'
import type { Config } from '../src/config.ts'
import { compileCatalog, compileDelegationPlan, type RuntimeSnapshot } from '../src/compiler.ts'

const base: Config = {
  toolName: 'legion',
  enableRunInBackground: true,
  defaultProfile: 'quick',
  profiles: {
    quick: {
      description: 'Fast focused work.',
      subagentProvider: 'spawn',
      maxDepth: 2,
      defaultRunInBackground: true,
      result: 'text',
    },
    review: {
      description: 'Independent review.',
      subagentProvider: 'spawn',
      maxDepth: 2,
      defaultRunInBackground: false,
      result: 'review-v1',
      toolFilter: { deny: ['write'] },
    },
  },
}

const spawn: RuntimeSnapshot = {
  providers: {
    spawn: {
      capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
      continuable: true,
    },
  },
}

describe('compileCatalog', () => {
  it('materializes detached effective profiles and stable digests', () => {
    const first = compileCatalog(base, spawn)
    const reordered = compileCatalog({
      ...base,
      profiles: { review: base.profiles.review!, quick: base.profiles.quick! },
    }, spawn)

    expect(Object.keys(first.activeProfiles)).toEqual(['quick', 'review'])
    expect(first.profiles.quick).toMatchObject({
      name: 'quick', active: true, defaultMode: 'continuable',
      allowedModes: ['foreground', 'continuable'], result: 'text',
    })
    expect(first.profiles.review).toMatchObject({
      name: 'review', active: true, defaultMode: 'foreground',
      allowedModes: ['foreground'], result: 'review-v1',
    })
    expect(first.policyDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(first.catalogDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(reordered.policyDigest).toBe(first.policyDigest)
    expect(reordered.catalogDigest).toBe(first.catalogDigest)
    expect(first.diagnostics).toEqual([])

    first.profiles.review!.toolFilter!.deny!.push('edit')
    expect(base.profiles.review?.toolFilter?.deny).toEqual(['write'])
  })

  it('materializes omitted result defaults before hashing', () => {
    const explicit = compileCatalog(base, spawn)
    const legacyQuick = { ...base.profiles.quick! }
    delete legacyQuick.result
    const legacy = compileCatalog({
      ...base,
      profiles: { ...base.profiles, quick: legacyQuick },
    }, spawn)

    expect(legacy.profiles.quick?.result).toBe('text')
    expect(legacy.policyDigest).toBe(explicit.policyDigest)
  })

  it('keeps an unavailable provider as an inactive warning without failing the catalog', () => {
    const catalog = compileCatalog(base, { providers: {} })

    expect(catalog.activeProfiles).toEqual({})
    expect(catalog.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PROFILE_PROVIDER_UNAVAILABLE', severity: 'warning', profile: 'quick',
      }),
      expect.objectContaining({
        code: 'PROFILE_PROVIDER_UNAVAILABLE', severity: 'warning', profile: 'review',
      }),
      expect.objectContaining({
        code: 'DEFAULT_PROFILE_INACTIVE', severity: 'warning', profile: 'quick',
      }),
    ])
  })

  it('reports stable foreground capability errors', () => {
    const catalog = compileCatalog(base, {
      providers: {
        spawn: {
          capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
          continuable: true,
        },
      },
    })

    expect(catalog.profiles.quick?.active).toBe(true)
    expect(catalog.profiles.review?.active).toBe(false)
    expect(catalog.diagnostics.map(item => item.code)).toEqual([
      'PROFILE_DEPTH_UNSUPPORTED',
      'PROFILE_TOOL_FILTER_UNSUPPORTED',
      'PROFILE_OUTPUT_SCHEMA_UNSUPPORTED',
    ])
  })

  it('rejects an invocation mode not supported by the provider snapshot', () => {
    const catalog = compileCatalog({
      ...base,
      profiles: { quick: base.profiles.quick! },
      defaultProfile: 'quick',
    }, {
      providers: {
        spawn: {
          capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
          continuable: true,
        },
      },
    })

    expect(catalog.activeProfiles.quick?.allowedModes).toEqual(['continuable'])
    expect(() => compileDelegationPlan(catalog, {
      description: 'force foreground',
      prompt: 'Work.',
      runInBackground: false,
    })).toThrow(/does not support foreground execution/)
  })

  it('rejects structured result contracts on the continuable default path', () => {
    const catalog = compileCatalog({
      ...base,
      profiles: {
        review: { ...base.profiles.review!, defaultRunInBackground: true },
      },
      defaultProfile: 'review',
    }, spawn)

    expect(catalog.activeProfiles).toEqual({})
    expect(catalog.diagnostics.map(item => item.code)).toEqual([
      'PROFILE_STRUCTURED_BACKGROUND_UNSUPPORTED',
      'DEFAULT_PROFILE_INACTIVE',
    ])
  })

  it('compiles one invocation to detached plan data and a structured schema', () => {
    const catalog = compileCatalog(base, spawn)
    const plan = compileDelegationPlan(catalog, {
      profile: 'review',
      description: 'review change',
      prompt: 'Review the patch.',
    })

    expect(plan).toMatchObject({
      profile: 'review',
      mode: 'foreground',
      subagentProvider: 'spawn',
      label: 'review change',
      prompt: 'Review the patch.',
      result: 'review-v1',
      maxDepth: 2,
      toolFilter: { deny: ['write'] },
      outputSchema: {
        type: 'object',
        required: ['verdict', 'summary', 'findings', 'verification'],
      },
    })
    plan.toolFilter!.deny!.push('edit')
    expect(catalog.activeProfiles.review?.toolFilter?.deny).toEqual(['write'])
  })

  it('refuses a structured profile when invocation forces background execution', () => {
    const catalog = compileCatalog(base, spawn)
    expect(() => compileDelegationPlan(catalog, {
      profile: 'review',
      description: 'review change',
      prompt: 'Review the patch.',
      runInBackground: true,
    })).toThrow(/foreground-only result contract/)
  })

  it('changes only catalogDigest when provider runtime facts change', () => {
    const first = compileCatalog(base, spawn)
    const second = compileCatalog(base, {
      providers: {
        spawn: {
          capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
          continuable: false,
        },
      },
    })

    expect(second.policyDigest).toBe(first.policyDigest)
    expect(second.catalogDigest).not.toBe(first.catalogDigest)
  })
})
