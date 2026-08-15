import { describe, expect, it } from 'vitest'
import {
  CURRENT_CONFIG_VERSION,
  exportConfigDocument,
  materializeConfig,
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
    expect(migrated).toEqual(explicit)
    expect(compileCatalog(authored, runtime).policyDigest)
      .toBe(compileCatalog(explicit, runtime).policyDigest)
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

  it('rejects null and unknown future versions instead of guessing or partially migrating', () => {
    expect(() => materializeConfig({ ...authored, configVersion: null }))
      .toThrow(/unsupported configVersion null/)
    expect(() => materializeConfig({ ...authored, configVersion: 3 }))
      .toThrow(/unsupported configVersion 3/)
  })

  it('requires explicit v2 before any v2-only field is authored, even when empty', () => {
    expect(() => materializeConfig({ ...authored, teams: {} }))
      .toThrow(/configVersion 2 is required/)
    expect(() => materializeConfig({ ...authored, strategies: {} }))
      .toThrow(/configVersion 2 is required/)
    expect(() => materializeConfig({ ...authored, catalogLayers: [] }))
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
    expect(() => exportConfigDocument(v2, 1)).toThrow(/cannot be rolled back/)
    expect(() => exportConfigDocument(v2, 'legacy-unversioned')).toThrow(/cannot be rolled back/)
  })

  it('returns detached exports that cannot mutate authored input', () => {
    const current = exportConfigDocument(authored)
    ;(current.profiles.deep!.routes![0] as { model: string }).model = 'mutated'
    expect(authored.profiles.deep?.routes?.[0]?.model).toBe('strong')
  })
})
