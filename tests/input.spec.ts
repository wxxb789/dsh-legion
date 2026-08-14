import { describe, expect, it } from 'vitest'
import {
  LegionInputError,
  loadConfigFile,
  parseConfigDocument,
  parseProviderSnapshotDocument,
} from '../src/input.ts'

const yamlConfig = `
toolName: legion
defaultProfile: quick
enableRunInBackground: true
profiles:
  quick:
    description: Fast work.
    subagentProvider: spawn
    maxDepth: 2
    defaultRunInBackground: true
`

describe('doctor input boundaries', () => {
  it('parses equivalent YAML and JSON through the Legion Config schema', () => {
    const yaml = parseConfigDocument('legion.yml', yamlConfig)
    const json = parseConfigDocument('legion.json', JSON.stringify({
      toolName: 'legion',
      defaultProfile: 'quick',
      enableRunInBackground: true,
      profiles: {
        quick: {
          description: 'Fast work.',
          subagentProvider: 'spawn',
          maxDepth: 2,
          defaultRunInBackground: true,
        },
      },
    }))

    expect(yaml).toEqual(json)
    expect(yaml.profiles.quick?.result).toBe('text')
  })

  it('validates and detaches a versioned provider fixture', () => {
    const fixture = parseProviderSnapshotDocument('providers.yml', `
version: 1
kind: legion-provider-snapshot
providers:
  spawn:
    continuable: true
    capabilities:
      outputSchema: true
      depthLimit: true
      toolFilter: true
      persona: true
`)

    expect(fixture).toEqual({
      version: 1,
      kind: 'legion-provider-snapshot',
      providers: {
        spawn: {
          continuable: true,
          capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
        },
      },
    })
  })

  it('rejects unsupported formats, malformed documents, and invalid schemas with typed codes', () => {
    for (const [file, source, code] of [
      ['legion.txt', yamlConfig, 'FORMAT_UNSUPPORTED'],
      ['legion.json', '{', 'PARSE_FAILED'],
      ['legion.yml', 'profiles: {}', 'CONFIG_INVALID'],
      ['providers.yml', 'version: 2\nkind: legion-provider-snapshot\nproviders: {}', 'SNAPSHOT_INVALID'],
    ] as const) {
      try {
        if (file.startsWith('providers')) parseProviderSnapshotDocument(file, source)
        else parseConfigDocument(file, source)
        throw new Error(`expected ${code}`)
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(LegionInputError)
        expect((error as LegionInputError).code).toBe(code)
      }
    }
  })

  it('rejects unknown fields at every external object layer', () => {
    for (const [file, source, code] of [
      ['legion.yml', `${yamlConfig}\ntoolNmae: typo\n`, 'CONFIG_INVALID'],
      ['legion.yml', yamlConfig.replace('description: Fast work.', 'description: Fast work.\n    mystery: true'), 'CONFIG_INVALID'],
      ['legion.yml', yamlConfig.replace('maxDepth: 2', 'maxDepth: 2\n    agentOptions:\n      model: fast\n      typo: nope'), 'CONFIG_INVALID'],
      ['legion.yml', yamlConfig.replace('maxDepth: 2', 'maxDepth: 2\n    promptFiles:\n      - root: local\n        path: prompt.md\n        typo: nope'), 'CONFIG_INVALID'],
      ['legion.yml', yamlConfig.replace('maxDepth: 2', 'maxDepth: 2\n    routes:\n      - id: exact\n        provider: route\n        model: model\n        typo: nope'), 'CONFIG_INVALID'],
      ['providers.yml', 'version: 1\nkind: legion-provider-snapshot\nproviders: {}\nhealth: true', 'SNAPSHOT_INVALID'],
      ['providers.yml', 'version: 1\nkind: legion-provider-snapshot\nproviders:\n  spawn:\n    continuable: true\n    capabilities:\n      outputSchema: true\n      depthLimit: true\n      toolFilter: true\n      persona: true\n      unknown: true', 'SNAPSHOT_INVALID'],
    ] as const) {
      try {
        if (file.startsWith('providers')) parseProviderSnapshotDocument(file, source)
        else parseConfigDocument(file, source)
        throw new Error(`expected ${code}`)
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(LegionInputError)
        expect((error as LegionInputError).code).toBe(code)
      }
    }
  })

  it('classifies file-read failures at the boundary', async () => {
    await expect(loadConfigFile('missing.yml', async () => {
      throw new Error('not found')
    })).rejects.toMatchObject({ code: 'READ_FAILED', file: 'missing.yml' })
  })
})
