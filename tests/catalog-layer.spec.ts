import { describe, expect, it } from 'vitest'
import type { CatalogLayer, StrategySpec, TeamSpec } from '../src/orchestration-contract.ts'
import { resolveCatalogLayers } from '../src/catalog-layer.ts'
import { materializeConfig } from '../src/config.ts'

const team: TeamSpec = {
  description: 'Base team.',
  members: { executor: { profile: 'deep' } },
}
const strategy: StrategySpec = {
  description: 'Base strategy.',
  team: 'coding',
  stages: [{
    kind: 'delegate',
    id: 'execute',
    member: 'executor',
    inputs: [{ artifact: 'objective', contract: 'objective-v1' }],
    output: { artifact: 'result', contract: 'text' },
    prompt: 'Execute.',
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
}

describe('ordered catalog layering', () => {
  it('extends by new names, replaces by same name, disables, and revives deterministically', () => {
    const layers: CatalogLayer<{ description: string }>[] = [
      {
        id: 'defaults',
        profiles: { deep: { description: 'Default deep.' } },
        teams: { coding: team },
        strategies: { coding: strategy },
      },
      {
        id: 'package',
        profiles: { quick: { description: 'Quick.' } },
        teams: { coding: { ...team, description: 'Package replacement.' } },
        disable: { strategies: ['coding'] },
      },
      {
        id: 'deployment',
        strategies: { coding: { ...strategy, description: 'Revived.' } },
      },
    ]
    const resolved = resolveCatalogLayers(layers)

    expect(Object.keys(resolved.profiles)).toEqual(['deep', 'quick'])
    expect(resolved.teams.coding?.description).toBe('Package replacement.')
    expect(resolved.strategies.coding?.description).toBe('Revived.')
    expect(resolved.provenance.teams.coding).toEqual({
      sourceLayer: 'package',
      supersededLayers: ['defaults'],
    })
    expect(resolved.provenance.strategies.coding?.sourceLayer).toBe('deployment')
    expect(resolved.disabled.strategies.coding).toBeUndefined()
    expect(Object.isFrozen(resolved)).toBe(true)
  })

  it('retains tombstones and rejects ambiguous or duplicate layers', () => {
    const disabled = resolveCatalogLayers<{ description: string }>([{
      id: 'defaults',
      disable: { teams: ['missing'] },
    }])
    expect(disabled.disabled.teams.missing).toBe('defaults')

    expect(() => resolveCatalogLayers([
      { id: 'same' },
      { id: 'same' },
    ])).toThrow(/duplicate catalog layer id/)
    expect(() => resolveCatalogLayers([{
      id: 'bad',
      teams: { coding: team },
      disable: { teams: ['coding'] },
    }])).toThrow(/cannot define and disable/)
  })

  it('lets config v2 consume a third-party layer and then replace it in the deployment layer', () => {
    const materialized = materializeConfig({
      configVersion: 2,
      profiles: {
        deep: {
          description: 'Deployment deep.',
          subagentProvider: 'spawn',
          maxDepth: 2,
          defaultRunInBackground: false,
        },
      },
      catalogLayers: [{
        id: 'third-party',
        profiles: {
          deep: {
            description: 'Package deep.',
            subagentProvider: 'spawn',
            maxDepth: 3,
            defaultRunInBackground: true,
          },
          quick: {
            description: 'Package quick.',
            subagentProvider: 'spawn',
            maxDepth: 2,
            defaultRunInBackground: false,
          },
        },
      }],
    })
    expect(materialized.profiles.deep?.description).toBe('Deployment deep.')
    expect(materialized.profiles.quick?.description).toBe('Package quick.')
    expect(materialized.catalogLayers).toEqual([])
  })

  it('allows a public deployment layer id without colliding with the final root overlay', () => {
    const materialized = materializeConfig({
      configVersion: 2,
      profiles: {
        deep: {
          description: 'Root deep.',
          subagentProvider: 'spawn',
          maxDepth: 2,
          defaultRunInBackground: false,
        },
      },
      catalogLayers: [{
        id: 'deployment',
        profiles: {
          quick: {
            description: 'Layer quick.',
            subagentProvider: 'spawn',
            maxDepth: 2,
            defaultRunInBackground: false,
          },
        },
      }],
    })
    expect(Object.keys(materialized.profiles)).toEqual(['deep', 'quick'])
  })

  it('changes semantics when layer order changes but ignores map insertion order', () => {
    const first = resolveCatalogLayers([
      { id: 'one', teams: { coding: team } },
      { id: 'two', teams: { coding: { ...team, description: 'Two.' } } },
    ])
    const reversed = resolveCatalogLayers([
      { id: 'two', teams: { coding: { ...team, description: 'Two.' } } },
      { id: 'one', teams: { coding: team } },
    ])
    expect(first.teams.coding?.description).toBe('Two.')
    expect(reversed.teams.coding?.description).toBe('Base team.')
  })
})
