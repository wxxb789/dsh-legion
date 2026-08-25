import { deepCopy, deepFreeze } from './internal/value.ts'
import type { CatalogLayer, StrategySpec, CohortSpec } from './orchestration-contract.ts'
import { ORCHESTRATION_NAME } from './orchestration-contract.ts'

export type CatalogNamespace = 'profiles' | 'teams' | 'strategies'

export interface CatalogEntryProvenance {
  readonly sourceLayer: string
  readonly supersededLayers: readonly string[]
}

export interface ResolvedCatalogLayers<Specialist> {
  readonly specialists: Readonly<Record<string, Specialist>>
  readonly cohorts: Readonly<Record<string, CohortSpec>>
  readonly strategies: Readonly<Record<string, StrategySpec>>
  readonly provenance: {
    readonly specialists: Readonly<Record<string, CatalogEntryProvenance>>
    readonly cohorts: Readonly<Record<string, CatalogEntryProvenance>>
    readonly strategies: Readonly<Record<string, CatalogEntryProvenance>>
  }
  readonly disabled: {
    readonly specialists: Readonly<Record<string, string>>
    readonly cohorts: Readonly<Record<string, string>>
    readonly strategies: Readonly<Record<string, string>>
  }
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

/** Internal resolver for schema-validated layers; external callers cross materializeConfig(). */
export function resolveCatalogLayers<Specialist>(
  layers: readonly CatalogLayer<Specialist>[],
): ResolvedCatalogLayers<Specialist> {
  if (layers.length === 0 || layers.length > 32) {
    throw new Error('dsh-legion: catalog must contain between 1 and 32 layers')
  }
  const ids = new Set<string>()
  const specialists: MutableState<Specialist> = { values: {}, provenance: {}, disabled: {} }
  const cohorts: MutableState<CohortSpec> = { values: {}, provenance: {}, disabled: {} }
  const strategies: MutableState<StrategySpec> = { values: {}, provenance: {}, disabled: {} }
  for (const layer of layers) {
    if (!ORCHESTRATION_NAME.test(layer.id) || ids.has(layer.id)) {
      throw new Error(`dsh-legion: invalid or duplicate catalog layer id "${layer.id}"`)
    }
    ids.add(layer.id)
    applyNamespace('profiles', layer.id, layer.profiles, layer.disable?.profiles, specialists)
    applyNamespace('teams', layer.id, layer.teams, layer.disable?.teams, cohorts)
    applyNamespace('strategies', layer.id, layer.strategies, layer.disable?.strategies, strategies)
  }
  return deepFreeze({
    specialists: specialists.values,
    cohorts: cohorts.values,
    strategies: strategies.values,
    provenance: {
      specialists: specialists.provenance,
      cohorts: cohorts.provenance,
      strategies: strategies.provenance,
    },
    disabled: {
      specialists: specialists.disabled,
      cohorts: cohorts.disabled,
      strategies: strategies.disabled,
    },
  })
}
