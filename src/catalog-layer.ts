import type { CatalogLayer, StrategySpec, TeamSpec } from './orchestration-contract.ts'
import { ORCHESTRATION_NAME } from './orchestration-contract.ts'

export type CatalogNamespace = 'profiles' | 'teams' | 'strategies'

export interface CatalogEntryProvenance {
  readonly sourceLayer: string
  readonly supersededLayers: readonly string[]
}

export interface ResolvedCatalogLayers<Profile> {
  readonly profiles: Readonly<Record<string, Profile>>
  readonly teams: Readonly<Record<string, TeamSpec>>
  readonly strategies: Readonly<Record<string, StrategySpec>>
  readonly provenance: {
    readonly profiles: Readonly<Record<string, CatalogEntryProvenance>>
    readonly teams: Readonly<Record<string, CatalogEntryProvenance>>
    readonly strategies: Readonly<Record<string, CatalogEntryProvenance>>
  }
  readonly disabled: {
    readonly profiles: Readonly<Record<string, string>>
    readonly teams: Readonly<Record<string, string>>
    readonly strategies: Readonly<Record<string, string>>
  }
}

function deepCopy<Value>(value: Value): Value {
  if (Array.isArray(value)) return value.map(deepCopy) as Value
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, deepCopy(child)]),
  ) as Value
}

function deepFreeze<Value>(value: Value): Value {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}

interface MutableState<Value> {
  values: Record<string, Value>
  provenance: Record<string, { sourceLayer: string; supersededLayers: string[] }>
  disabled: Record<string, string>
}

function applyNamespace<Value>(
  namespace: CatalogNamespace,
  layerId: string,
  definitions: Readonly<Record<string, Value>> | undefined,
  disabledNames: readonly string[] | undefined,
  state: MutableState<Value>,
): void {
  const disabled = new Set(disabledNames ?? [])
  for (const name of disabled) {
    if (!ORCHESTRATION_NAME.test(name)) {
      throw new Error(`dsh-legion: layer "${layerId}" has invalid disabled ${namespace} name "${name}"`)
    }
    if (definitions?.[name] !== undefined) {
      throw new Error(
        `dsh-legion: layer "${layerId}" cannot define and disable ${namespace} entry "${name}"`,
      )
    }
    delete state.values[name]
    delete state.provenance[name]
    state.disabled[name] = layerId
  }
  for (const name of Object.keys(definitions ?? {}).sort()) {
    if (!ORCHESTRATION_NAME.test(name)) {
      throw new Error(`dsh-legion: layer "${layerId}" has invalid ${namespace} name "${name}"`)
    }
    const previous = state.provenance[name]
    state.values[name] = deepCopy(definitions![name]!)
    state.provenance[name] = {
      sourceLayer: layerId,
      supersededLayers: previous === undefined
        ? []
        : [...previous.supersededLayers, previous.sourceLayer],
    }
    delete state.disabled[name]
  }
}

/** Resolve ordered catalog layers; later definitions replace and later tombstones disable. */
export function resolveCatalogLayers<Profile>(
  layers: readonly CatalogLayer<Profile>[],
): ResolvedCatalogLayers<Profile> {
  if (layers.length === 0 || layers.length > 32) {
    throw new Error('dsh-legion: catalog must contain between 1 and 32 layers')
  }
  const ids = new Set<string>()
  const profiles: MutableState<Profile> = { values: {}, provenance: {}, disabled: {} }
  const teams: MutableState<TeamSpec> = { values: {}, provenance: {}, disabled: {} }
  const strategies: MutableState<StrategySpec> = { values: {}, provenance: {}, disabled: {} }
  for (const layer of layers) {
    if (!ORCHESTRATION_NAME.test(layer.id) || ids.has(layer.id)) {
      throw new Error(`dsh-legion: invalid or duplicate catalog layer id "${layer.id}"`)
    }
    ids.add(layer.id)
    applyNamespace('profiles', layer.id, layer.profiles, layer.disable?.profiles, profiles)
    applyNamespace('teams', layer.id, layer.teams, layer.disable?.teams, teams)
    applyNamespace('strategies', layer.id, layer.strategies, layer.disable?.strategies, strategies)
  }
  return deepFreeze({
    profiles: profiles.values,
    teams: teams.values,
    strategies: strategies.values,
    provenance: {
      profiles: profiles.provenance,
      teams: teams.provenance,
      strategies: strategies.provenance,
    },
    disabled: {
      profiles: profiles.disabled,
      teams: teams.disabled,
      strategies: strategies.disabled,
    },
  })
}
