import type { CompiledCatalog, EffectiveProfile } from './compiler.ts'
import { deepFreeze, sha256Digest } from './internal/value.ts'
import type {
  ArtifactContract,
  StrategyLimits,
  StrategySpec,
  StrategyStageSpec,
  TeamSpec,
} from './orchestration-contract.ts'
import {
  ArtifactName,
  MemberSlotName,
  StrategyGenerationId,
  StrategyName,
  StrategyPlanDigest,
  TeamName,
  type ArtifactName as ArtifactNameType,
  type MemberSlotName as MemberSlotNameType,
  type ProfileName,
  type StrategyGenerationId as StrategyGenerationIdType,
  type StrategyName as StrategyNameType,
  type StrategyPlanDigest as StrategyPlanDigestType,
  type TeamName as TeamNameType,
} from './identity.ts'

export type OrchestrationDiagnosticCode =
  | 'TEAM_EMPTY'
  | 'TEAM_PROFILE_UNKNOWN'
  | 'TEAM_PROFILE_INACTIVE'
  | 'TEAM_SLOT_MIN_EXCEEDS_MAX'
  | 'TEAM_MEMBER_LIMIT_EXCEEDED'
  | 'TEAM_CONCURRENCY_LIMIT_EXCEEDED'
  | 'STRATEGY_TEAM_UNKNOWN'
  | 'STRATEGY_STAGE_DUPLICATE'
  | 'STRATEGY_STAGE_DEPENDENCY_DUPLICATE'
  | 'STRATEGY_STAGE_DEPENDENCY_UNKNOWN'
  | 'STRATEGY_STAGE_DEPENDENCY_SELF'
  | 'STRATEGY_STAGE_DEPENDENCY_CYCLE'
  | 'STRATEGY_MEMBER_UNKNOWN'
  | 'STRATEGY_MEMBER_CARDINALITY_UNSATISFIED'
  | 'STRATEGY_ARTIFACT_UNKNOWN'
  | 'STRATEGY_ARTIFACT_FORWARD_REFERENCE'
  | 'STRATEGY_ARTIFACT_DUPLICATE'
  | 'STRATEGY_ARTIFACT_CONTRACT_MISMATCH'
  | 'STRATEGY_OBJECTIVE_INVALID'
  | 'STRATEGY_ARTIFACT_AVAILABILITY_MISMATCH'
  | 'STRATEGY_PROFILE_RESULT_MISMATCH'
  | 'STRATEGY_CONTINUABLE_ARTIFACT_UNSUPPORTED'
  | 'STRATEGY_COMPLETION_UNKNOWN_ARTIFACT'
  | 'STRATEGY_COMPLETION_CONTRACT_MISMATCH'
  | 'STRATEGY_AGENT_LIMIT_EXCEEDED'
  | 'STRATEGY_CONCURRENCY_LIMIT_EXCEEDED'
  | 'STRATEGY_UNUSED_ARTIFACT'
  | 'STRATEGY_PARTIAL_POLICY_UNUSED'
  | 'STRATEGY_PARTIAL_POLICY_CONFLICT'
  | 'STRATEGY_LIMIT_WIDENING'
  | 'STRATEGY_LIMIT_UNSATISFIABLE'
  | 'STRATEGY_REQUEST_INVALID'
  | 'STRATEGY_UNKNOWN'

export interface OrchestrationDiagnostic {
  readonly code: OrchestrationDiagnosticCode
  readonly severity: 'warning' | 'error'
  readonly message: string
  readonly team?: string
  readonly strategy?: string
  readonly stage?: string
}

export interface CompiledMemberSlot {
  readonly name: MemberSlotNameType
  readonly profile: ProfileName
  readonly minParticipants: number
  readonly maxParticipants: number
  readonly tags: readonly string[]
  readonly active: boolean
}

export interface CompiledTeam {
  readonly name: TeamNameType
  readonly description: string
  readonly members: Readonly<Record<string, CompiledMemberSlot>>
  readonly maxMembers: number
  readonly maxConcurrentMembers: number
}

export type ArtifactAvailability = 'required' | 'degraded' | 'optional'

export interface CompiledArtifact {
  readonly name: ArtifactNameType
  readonly contract: ArtifactContract
  readonly collection: boolean
  readonly availability: ArtifactAvailability
  readonly producer?: string
}

interface PrimitiveBase {
  readonly stage: string
  readonly member: MemberSlotNameType
  readonly profile: ProfileName
  readonly inputs: readonly ArtifactNameType[]
  readonly output: CompiledArtifact
  readonly prompt: string
  readonly after: readonly string[]
}

export interface DelegatePrimitive extends PrimitiveBase {
  readonly kind: 'dsh-delegate'
  readonly mode: 'foreground' | 'continuable'
}

export interface FanoutPrimitive extends PrimitiveBase {
  readonly kind: 'dsh-subagent-fanout'
  readonly count: number
  readonly minSuccess: number
  readonly allowDegraded: boolean
}

export type DshPrimitive = DelegatePrimitive | FanoutPrimitive

export interface CompiledStrategyTemplate {
  readonly name: StrategyNameType
  readonly description: string
  readonly team: TeamNameType
  readonly primitives: readonly DshPrimitive[]
  readonly artifacts: Readonly<Record<string, CompiledArtifact>>
  readonly completion: {
    readonly artifact: ArtifactNameType
    readonly contract: ArtifactContract
  }
  readonly limits: Readonly<StrategyLimits>
  readonly memberFailure: 'fail' | 'allow-partial'
  readonly active: boolean
}

export class OrchestrationCompileError extends Error {
  readonly diagnostics: readonly OrchestrationDiagnostic[]

  constructor(diagnostics: readonly OrchestrationDiagnostic[]) {
    super(
      'dsh-legion: invalid orchestration catalog: '
      + diagnostics.filter(item => item.severity === 'error').map(item => `${item.code}: ${item.message}`).join('; '),
    )
    this.name = 'OrchestrationCompileError'
    this.diagnostics = diagnostics.map(item => ({ ...item }))
  }
}

export interface CompiledOrchestrationCatalog {
  readonly teams: Readonly<Record<string, CompiledTeam>>
  readonly strategies: Readonly<Record<string, CompiledStrategyTemplate>>
  readonly diagnostics: readonly OrchestrationDiagnostic[]
  readonly digest: `sha256:${string}`
  readonly generationId: StrategyGenerationIdType
  readonly profilePolicyDigest: string
  readonly profileCatalogDigest: string
}

export interface StrategyCompileRequest {
  readonly strategy: string
  readonly objective: string
  readonly limits?: Partial<StrategyLimits>
}

declare const compiledStrategyPlanBrand: unique symbol
const compiledStrategyPlansKey = Symbol.for('dsh-legion.compiled-strategy-plans.v1')
const globalRegistry = globalThis as unknown as Record<PropertyKey, unknown>
const existingCompiledStrategyPlans = globalRegistry[compiledStrategyPlansKey]
const compiledStrategyPlans = existingCompiledStrategyPlans instanceof WeakSet
  ? existingCompiledStrategyPlans as WeakSet<object>
  : new WeakSet<object>()
globalRegistry[compiledStrategyPlansKey] = compiledStrategyPlans

export interface CompiledStrategyPlan {
  readonly [compiledStrategyPlanBrand]: true
  readonly kind: 'compiled-strategy-plan'
  readonly strategy: StrategyNameType
  readonly team: TeamNameType
  readonly objective: string
  readonly objectiveDigest: `sha256:${string}`
  readonly generationId: StrategyGenerationIdType
  readonly planDigest: StrategyPlanDigestType
  readonly primitives: readonly DshPrimitive[]
  readonly artifacts: Readonly<Record<string, CompiledArtifact>>
  readonly completion: CompiledStrategyTemplate['completion']
  readonly limits: Readonly<StrategyLimits>
  readonly memberFailure: 'fail' | 'allow-partial'
}

export type StrategyCompileResult =
  | {
      readonly ok: true
      readonly plan: CompiledStrategyPlan
      readonly diagnostics: readonly OrchestrationDiagnostic[]
    }
  | {
      readonly ok: false
      readonly diagnostics: readonly OrchestrationDiagnostic[]
    }

function push(
  diagnostics: OrchestrationDiagnostic[],
  code: OrchestrationDiagnosticCode,
  severity: 'warning' | 'error',
  message: string,
  location: { team?: string; strategy?: string; stage?: string } = {},
): void {
  diagnostics.push({ code, severity, message, ...location })
}

function compiledTeam(
  name: string,
  spec: TeamSpec,
  profiles: CompiledCatalog,
  diagnostics: OrchestrationDiagnostic[],
): CompiledTeam | undefined {
  const startErrors = diagnostics.length
  const members: Record<string, CompiledMemberSlot> = {}
  const entries = Object.entries(spec.members).sort(([left], [right]) => left.localeCompare(right))
  if (entries.length === 0) push(diagnostics, 'TEAM_EMPTY', 'error', `team "${name}" has no members`, { team: name })
  let sumMin = 0
  let sumMax = 0
  for (const [slot, authored] of entries) {
    let profile: EffectiveProfile | undefined = profiles.profiles[authored.profile]
    if (profile === undefined) {
      push(
        diagnostics,
        'TEAM_PROFILE_UNKNOWN',
        'error',
        `team "${name}" member "${slot}" references unknown profile "${authored.profile}"`,
        { team: name },
      )
      continue
    }
    const min = authored.minParticipants ?? 1
    const max = authored.maxParticipants ?? 1
    if (min > max) {
      push(
        diagnostics,
        'TEAM_SLOT_MIN_EXCEEDS_MAX',
        'error',
        `team "${name}" member "${slot}" minParticipants exceeds maxParticipants`,
        { team: name },
      )
      continue
    }
    if (!profile.active) {
      push(
        diagnostics,
        'TEAM_PROFILE_INACTIVE',
        'warning',
        `team "${name}" member "${slot}" currently uses inactive profile "${authored.profile}"`,
        { team: name },
      )
    }
    sumMin += min
    sumMax += max
    members[slot] = deepFreeze({
      name: MemberSlotName(slot),
      profile: profile.name,
      minParticipants: min,
      maxParticipants: max,
      tags: [...new Set(authored.tags ?? [])].sort(),
      active: profile.active,
    })
  }
  const maxMembers = spec.limits?.maxMembers ?? sumMax
  const maxConcurrentMembers = spec.limits?.maxConcurrentMembers ?? maxMembers
  if (sumMax > 16 || maxMembers < sumMin || maxMembers > 16) {
    push(
      diagnostics,
      'TEAM_MEMBER_LIMIT_EXCEEDED',
      'error',
      `team "${name}" maxMembers must contain required members and stay within the compiler ceiling`,
      { team: name },
    )
  }
  if (maxConcurrentMembers > maxMembers) {
    push(
      diagnostics,
      'TEAM_CONCURRENCY_LIMIT_EXCEEDED',
      'error',
      `team "${name}" maxConcurrentMembers exceeds maxMembers`,
      { team: name },
    )
  }
  if (diagnostics.slice(startErrors).some(item => item.severity === 'error')) return undefined
  return deepFreeze({
    name: TeamName(name),
    description: spec.description,
    members,
    maxMembers,
    maxConcurrentMembers,
  })
}

function stageOutput(
  stage: StrategyStageSpec,
  availability: ArtifactAvailability,
): CompiledArtifact {
  return deepFreeze({
    name: ArtifactName(stage.output.artifact),
    contract: stage.output.contract,
    collection: stage.kind === 'fanout',
    availability,
    producer: stage.id,
  })
}

function expectedAgentCount(stage: StrategyStageSpec): number {
  return stage.kind === 'fanout' ? stage.count : 1
}


function hasStrategyDependencyCycle(spec: StrategySpec): boolean {
  const ids = spec.stages.map(stage => stage.id)
  const known = new Set(ids)
  const outgoing = new Map(ids.map(id => [id, new Set<string>()]))
  const indegree = new Map(ids.map(id => [id, 0]))
  const producerByArtifact = new Map(
    spec.stages.map(stage => [stage.output.artifact, stage.id]),
  )
  const addEdge = (from: string, to: string): void => {
    if (!known.has(from) || !known.has(to) || outgoing.get(from)?.has(to)) return
    outgoing.get(from)?.add(to)
    indegree.set(to, (indegree.get(to) ?? 0) + 1)
  }
  for (const stage of spec.stages) {
    for (const dependency of stage.after ?? []) addEdge(dependency, stage.id)
    for (const input of stage.inputs) {
      const producer = producerByArtifact.get(input.artifact)
      if (producer !== undefined) addEdge(producer, stage.id)
    }
  }
  const ready = ids.filter(id => indegree.get(id) === 0).sort()
  let visited = 0
  while (ready.length > 0) {
    const id = ready.shift()!
    visited += 1
    for (const successor of outgoing.get(id) ?? []) {
      const remaining = (indegree.get(successor) ?? 0) - 1
      indegree.set(successor, remaining)
      if (remaining === 0) {
        ready.push(successor)
        ready.sort()
      }
    }
  }
  return visited !== ids.length
}

function compileStrategyTemplate(
  name: string,
  spec: StrategySpec,
  team: CompiledTeam | undefined,
  profiles: CompiledCatalog,
  diagnostics: OrchestrationDiagnostic[],
): CompiledStrategyTemplate | undefined {
  const startErrors = diagnostics.length
  if (team === undefined) {
    push(
      diagnostics,
      'STRATEGY_TEAM_UNKNOWN',
      'error',
      `strategy "${name}" references unavailable team "${spec.team}"`,
      { strategy: name },
    )
    return undefined
  }
  if (hasStrategyDependencyCycle(spec)) {
    push(
      diagnostics,
      'STRATEGY_STAGE_DEPENDENCY_CYCLE',
      'error',
      `strategy "${name}" contains a dependency cycle`,
      { strategy: name },
    )
  }
  const effectiveLimits: StrategyLimits = {
    ...spec.limits,
    maxConcurrent: Math.min(
      spec.limits.maxConcurrent,
      spec.limits.maxAgents,
      team.maxConcurrentMembers,
    ),
  }
  const allOutputs = new Map(spec.stages.map((stage, index) => [stage.output.artifact, index]))
  const allStageIds = new Set(spec.stages.map(stage => stage.id))
  const artifacts: Record<string, CompiledArtifact> = {
    objective: deepFreeze({
      name: ArtifactName('objective'),
      contract: 'objective-v1',
      collection: false,
      availability: 'required',
    }),
  }
  const stageIds = new Set<string>()
  const primitives: DshPrimitive[] = []
  const memberDemand = new Map(Object.keys(team.members).map(member => [member, 0]))
  let agents = 0
  let largestParallel = 1
  let hasDegraded = false
  for (const [index, stage] of spec.stages.entries()) {
    const location = { strategy: name, stage: stage.id }
    const stageDiagnosticStart = diagnostics.length
    if (stageIds.has(stage.id)) {
      push(diagnostics, 'STRATEGY_STAGE_DUPLICATE', 'error', `strategy "${name}" repeats stage "${stage.id}"`, location)
      continue
    }
    stageIds.add(stage.id)
    const after = [...(stage.after ?? [])].sort()
    if (new Set(after).size !== after.length) {
      push(diagnostics, 'STRATEGY_STAGE_DEPENDENCY_DUPLICATE', 'error', `strategy "${name}" stage "${stage.id}" repeats an after dependency`, location)
    }
    for (const dependency of after) {
      if (dependency === stage.id) {
        push(diagnostics, 'STRATEGY_STAGE_DEPENDENCY_SELF', 'error', `strategy "${name}" stage "${stage.id}" cannot depend on itself`, location)
      } else if (!allStageIds.has(dependency)) {
        push(diagnostics, 'STRATEGY_STAGE_DEPENDENCY_UNKNOWN', 'error', `strategy "${name}" stage "${stage.id}" references unknown stage "${dependency}"`, location)
      }
    }
    const member = team.members[stage.member]
    if (member === undefined) {
      push(
        diagnostics,
        'STRATEGY_MEMBER_UNKNOWN',
        'error',
        `strategy "${name}" stage "${stage.id}" references unknown member "${stage.member}"`,
        location,
      )
      continue
    }
    const inputNames: ArtifactNameType[] = []
    for (const input of stage.inputs) {
      const artifact = artifacts[input.artifact]
      if (artifact === undefined) {
        const producerIndex = allOutputs.get(input.artifact)
        push(
          diagnostics,
          producerIndex !== undefined && producerIndex > index
            ? 'STRATEGY_ARTIFACT_FORWARD_REFERENCE'
            : 'STRATEGY_ARTIFACT_UNKNOWN',
          'error',
          `strategy "${name}" stage "${stage.id}" cannot consume artifact "${input.artifact}"`,
          location,
        )
        continue
      }
      if (artifact.contract !== input.contract
        || artifact.collection !== (input.collection ?? false)) {
        push(
          diagnostics,
          'STRATEGY_ARTIFACT_CONTRACT_MISMATCH',
          'error',
          `strategy "${name}" stage "${stage.id}" input "${input.artifact}" has incompatible contract or cardinality`,
          location,
        )
      }
      if (artifact.availability === 'degraded' && input.optional !== true
        || artifact.availability === 'required' && input.optional === true) {
        push(
          diagnostics,
          'STRATEGY_ARTIFACT_AVAILABILITY_MISMATCH',
          'error',
          `strategy "${name}" stage "${stage.id}" optionality disagrees with artifact "${input.artifact}" availability`,
          location,
        )
      }
      inputNames.push(artifact.name)
    }
    if (artifacts[stage.output.artifact] !== undefined) {
      push(
        diagnostics,
        'STRATEGY_ARTIFACT_DUPLICATE',
        'error',
        `strategy "${name}" repeats artifact "${stage.output.artifact}"`,
        location,
      )
      continue
    }
    const profile = profiles.profiles[member.profile]
    if (profile === undefined || profile.result !== stage.output.contract) {
      push(
        diagnostics,
        'STRATEGY_PROFILE_RESULT_MISMATCH',
        'error',
        `strategy "${name}" stage "${stage.id}" output ${stage.output.contract} does not match profile "${member.profile}" result`,
        location,
      )
    }
    if (stage.kind === 'delegate' && stage.mode === 'continuable') {
      push(
        diagnostics,
        'STRATEGY_CONTINUABLE_ARTIFACT_UNSUPPORTED',
        'error',
        `strategy "${name}" stage "${stage.id}" cannot await a continuable artifact`,
        location,
      )
    }
    if (stage.kind !== 'fanout' && member.minParticipants > 1) {
      push(
        diagnostics,
        'STRATEGY_MEMBER_CARDINALITY_UNSATISFIED',
        'error',
        `strategy "${name}" stage "${stage.id}" selects one participant from a multi-participant slot`,
        location,
      )
    }
    if (stage.kind === 'fanout') {
      if (stage.count > member.maxParticipants || stage.count < member.minParticipants) {
        push(
          diagnostics,
          'STRATEGY_MEMBER_CARDINALITY_UNSATISFIED',
          'error',
          `strategy "${name}" stage "${stage.id}" fanout count is outside member capacity`,
          location,
        )
      }
      if (stage.minSuccess > stage.count || !stage.allowDegraded && stage.minSuccess !== stage.count) {
        push(
          diagnostics,
          'STRATEGY_MEMBER_CARDINALITY_UNSATISFIED',
          'error',
          `strategy "${name}" stage "${stage.id}" has invalid minSuccess`,
          location,
        )
      }
      largestParallel = Math.max(largestParallel, stage.count)
      hasDegraded ||= stage.allowDegraded && stage.minSuccess < stage.count
    }
    if (diagnostics.slice(stageDiagnosticStart).some(item => item.severity === 'error')) continue
    memberDemand.set(
      stage.member,
      Math.max(memberDemand.get(stage.member) ?? 0, expectedAgentCount(stage)),
    )
    const availability: ArtifactAvailability = stage.kind === 'fanout'
      && stage.allowDegraded
      && stage.minSuccess < stage.count
      ? 'degraded'
      : 'required'
    const output = stageOutput(stage, availability)
    artifacts[stage.output.artifact] = output
    agents += expectedAgentCount(stage)
    if (stage.kind === 'fanout') {
      primitives.push(deepFreeze({
        kind: 'dsh-subagent-fanout',
        stage: stage.id,
        member: member.name,
        profile: member.profile,
        inputs: inputNames,
        output,
        prompt: stage.prompt,
        count: stage.count,
        minSuccess: stage.minSuccess,
        allowDegraded: stage.allowDegraded,
        after,
      }))
    } else {
      primitives.push(deepFreeze({
        kind: 'dsh-delegate',
        stage: stage.id,
        member: member.name,
        profile: member.profile,
        inputs: inputNames,
        output,
        prompt: stage.prompt,
        mode: stage.kind === 'delegate' ? stage.mode ?? 'foreground' : 'foreground',
        after,
      }))
    }
  }
  for (const member of Object.values(team.members)) {
    if ((memberDemand.get(String(member.name)) ?? 0) < member.minParticipants) {
      push(
        diagnostics,
        'STRATEGY_MEMBER_CARDINALITY_UNSATISFIED',
        'error',
        `strategy "${name}" does not satisfy required participation for member "${member.name}"`,
        { strategy: name },
      )
    }
  }
  const participatingMembers = [...memberDemand.values()].reduce((total, demand) => total + demand, 0)
  if (participatingMembers > team.maxMembers) {
    push(
      diagnostics,
      'STRATEGY_MEMBER_CARDINALITY_UNSATISFIED',
      'error',
      `strategy "${name}" requires ${String(participatingMembers)} Team participants but maxMembers is ${String(team.maxMembers)}`,
      { strategy: name },
    )
  }
  if (agents > spec.limits.maxAgents) {
    push(
      diagnostics,
      'STRATEGY_AGENT_LIMIT_EXCEEDED',
      'error',
      `strategy "${name}" worst-case agents ${String(agents)} exceeds a hard limit`,
      { strategy: name },
    )
  }
  if (largestParallel > effectiveLimits.maxConcurrent) {
    push(
      diagnostics,
      'STRATEGY_CONCURRENCY_LIMIT_EXCEEDED',
      'error',
      `strategy "${name}" concurrency cannot satisfy its fanout/team limits`,
      { strategy: name },
    )
  }
  const completion = artifacts[spec.completion.artifact]
  if (completion === undefined) {
    push(
      diagnostics,
      'STRATEGY_COMPLETION_UNKNOWN_ARTIFACT',
      'error',
      `strategy "${name}" completion references unknown artifact "${spec.completion.artifact}"`,
      { strategy: name },
    )
  } else if (completion.contract !== spec.completion.contract || completion.collection) {
    push(
      diagnostics,
      'STRATEGY_COMPLETION_CONTRACT_MISMATCH',
      'error',
      `strategy "${name}" completion contract does not match artifact`,
      { strategy: name },
    )
  }
  if (spec.memberFailure === 'fail' && hasDegraded) {
    push(
      diagnostics,
      'STRATEGY_PARTIAL_POLICY_CONFLICT',
      'error',
      `strategy "${name}" has degraded fanout but memberFailure is fail`,
      { strategy: name },
    )
  }
  if (spec.memberFailure === 'allow-partial' && !hasDegraded) {
    push(
      diagnostics,
      'STRATEGY_PARTIAL_POLICY_UNUSED',
      'warning',
      `strategy "${name}" allows partial failure but has no degraded fanout`,
      { strategy: name },
    )
  }
  const consumed = new Set(spec.stages.flatMap(stage => stage.inputs.map(input => input.artifact)))
  for (const artifact of Object.keys(artifacts)) {
    if (artifact !== 'objective'
      && artifact !== spec.completion.artifact
      && !consumed.has(artifact)) {
      push(
        diagnostics,
        'STRATEGY_UNUSED_ARTIFACT',
        'warning',
        `strategy "${name}" artifact "${artifact}" is unused`,
        { strategy: name },
      )
    }
  }
  if (diagnostics.slice(startErrors).some(item => item.severity === 'error') || completion === undefined) {
    return undefined
  }
  return deepFreeze({
    name: StrategyName(name),
    description: spec.description,
    team: team.name,
    primitives,
    artifacts,
    completion: { artifact: completion.name, contract: completion.contract },
    limits: effectiveLimits,
    memberFailure: spec.memberFailure,
    active: primitives.every(primitive => team.members[primitive.member]?.active === true),
  })
}

export function assertOrchestrationCatalogUsable(catalog: CompiledOrchestrationCatalog): void {
  const errors = catalog.diagnostics.filter(item => item.severity === 'error')
  if (errors.length > 0) throw new OrchestrationCompileError(errors)
}

/** Compile layered Team/Strategy data against one already-compiled Profile catalog. */
export function compileOrchestrationCatalog(
  profiles: CompiledCatalog,
): CompiledOrchestrationCatalog {
  const diagnostics: OrchestrationDiagnostic[] = []
  const teams: Record<string, CompiledTeam> = {}
  for (const name of Object.keys(profiles.teams).sort()) {
    const team = compiledTeam(name, profiles.teams[name]!, profiles, diagnostics)
    if (team !== undefined) teams[name] = team
  }
  const strategies: Record<string, CompiledStrategyTemplate> = {}
  for (const name of Object.keys(profiles.strategies).sort()) {
    const spec = profiles.strategies[name]!
    const strategy = compileStrategyTemplate(name, spec, teams[spec.team], profiles, diagnostics)
    if (strategy !== undefined) strategies[name] = strategy
  }
  const identity = {
    version: 1,
    kind: 'legion-orchestration-catalog',
    profilePolicyDigest: profiles.policyDigest,
    profileCatalogDigest: profiles.catalogDigest,
    teams,
    strategies,
  }
  const catalogDigest = sha256Digest(identity)
  return deepFreeze({
    teams,
    strategies,
    diagnostics,
    digest: catalogDigest,
    generationId: StrategyGenerationId(catalogDigest),
    profilePolicyDigest: profiles.policyDigest,
    profileCatalogDigest: profiles.catalogDigest,
  })
}

function narrowedLimits(
  authored: StrategyLimits,
  requested: Partial<StrategyLimits> | undefined,
  diagnostics: OrchestrationDiagnostic[],
  strategy: string,
): StrategyLimits | undefined {
  if (requested === undefined) return { ...authored }
  const result = { ...authored }
  const allowed = new Set<keyof StrategyLimits>([
    'maxAgents', 'maxConcurrent', 'deadlineMs', 'maxOutputBytes',
  ])
  const unknown = Object.keys(requested).filter(key => !allowed.has(key as keyof StrategyLimits))
  if (unknown.length > 0) {
    push(
      diagnostics,
      'STRATEGY_REQUEST_INVALID',
      'error',
      `strategy "${strategy}" invocation limits contain unknown field(s): ${unknown.sort().join(', ')}`,
      { strategy },
    )
    return undefined
  }
  for (const key of Object.keys(requested) as Array<keyof StrategyLimits>) {
    const value = requested[key]
    if (value === undefined) continue
    if (!Number.isSafeInteger(value) || value < 1 || value > authored[key]) {
      push(
        diagnostics,
        'STRATEGY_LIMIT_WIDENING',
        'error',
        `strategy "${strategy}" invocation limit "${key}" must narrow the catalog limit`,
        { strategy },
      )
      return undefined
    }
    result[key] = value
  }
  return result
}

export function renderOrchestrationGuidance(catalog: CompiledOrchestrationCatalog): string {
  const strategies = Object.values(catalog.strategies)
    .filter(strategy => strategy.active)
    .sort((left, right) => String(left.name).localeCompare(String(right.name)))
  if (strategies.length === 0) return ''
  return [
    'Configured bounded Team Strategies (use the strategy argument instead of profile):',
    ...strategies.map(strategy =>
      `- \`${strategy.name}\`: ${strategy.description} `
      + `(team: ${strategy.team}; max agents: ${String(strategy.limits.maxAgents)}; foreground)`),
    'Strategy calls are foreground and return completed, degraded, cancelled, or failed outcomes.',
  ].join('\n')
}

export function assertCompiledStrategyPlan(plan: CompiledStrategyPlan): void {
  if (typeof plan !== 'object'
    || plan === null
    || !compiledStrategyPlans.has(plan)) {
    throw new Error('dsh-legion: Strategy Plan was not produced by this compiler generation')
  }
  const objectiveDigest = sha256Digest({ version: 1, kind: 'legion-objective', objective: plan.objective })
  const identity = {
    version: 1,
    kind: 'legion-strategy-plan',
    generationId: plan.generationId,
    strategy: plan.strategy,
    team: plan.team,
    objectiveDigest,
    primitives: plan.primitives,
    artifacts: plan.artifacts,
    completion: plan.completion,
    limits: plan.limits,
    memberFailure: plan.memberFailure,
  }
  if (plan.objectiveDigest !== objectiveDigest
    || StrategyPlanDigest(sha256Digest(identity)) !== plan.planDigest) {
    throw new Error('dsh-legion: compiled Strategy Plan digest does not match its policy')
  }
}

/** Bind one objective and optional narrowing limits to a compiled Strategy template. */
export function compileStrategy(
  catalog: CompiledOrchestrationCatalog,
  input: unknown,
): StrategyCompileResult {
  const diagnostics: OrchestrationDiagnostic[] = []
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    push(diagnostics, 'STRATEGY_REQUEST_INVALID', 'error', 'strategy request must be a plain object')
    return deepFreeze({ ok: false, diagnostics })
  }
  const prototype = Object.getPrototypeOf(input)
  if (prototype !== Object.prototype && prototype !== null) {
    push(diagnostics, 'STRATEGY_REQUEST_INVALID', 'error', 'strategy request must be a plain object')
    return deepFreeze({ ok: false, diagnostics })
  }
  const source = input as Record<string, unknown>
  const unknown = Object.keys(source).filter(key => !['strategy', 'objective', 'limits'].includes(key))
  if (unknown.length > 0
    || typeof source.strategy !== 'string'
    || typeof source.objective !== 'string'
    || source.limits !== undefined
      && (typeof source.limits !== 'object'
        || source.limits === null
        || Array.isArray(source.limits)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(source.limits)))) {
    push(diagnostics, 'STRATEGY_REQUEST_INVALID', 'error', 'strategy request has invalid or unknown fields')
    return deepFreeze({ ok: false, diagnostics })
  }
  const request: StrategyCompileRequest = {
    strategy: source.strategy,
    objective: source.objective,
    ...source.limits === undefined ? {} : { limits: source.limits as Partial<StrategyLimits> },
  }
  const strategy = catalog.strategies[request.strategy]
  if (strategy === undefined) {
    push(
      diagnostics,
      'STRATEGY_UNKNOWN',
      'error',
      `unknown or invalid strategy "${request.strategy}"`,
      { strategy: request.strategy },
    )
    return deepFreeze({ ok: false, diagnostics })
  }
  if (!strategy.active) {
    push(
      diagnostics,
      'TEAM_PROFILE_INACTIVE',
      'error',
      `strategy "${request.strategy}" currently requires an inactive Profile`,
      { strategy: request.strategy },
    )
    return deepFreeze({ ok: false, diagnostics })
  }
  const objective = request.objective.trim()
  if (objective.length === 0 || objective.length > 100_000) {
    push(
      diagnostics,
      'STRATEGY_OBJECTIVE_INVALID',
      'error',
      'strategy objective must be a non-empty bounded string',
      { strategy: request.strategy },
    )
    return deepFreeze({ ok: false, diagnostics })
  }
  const limits = narrowedLimits(strategy.limits, request.limits, diagnostics, request.strategy)
  if (limits === undefined) return deepFreeze({ ok: false, diagnostics })
  const requiredAgents = strategy.primitives.reduce(
    (total, primitive) => total + (primitive.kind === 'dsh-subagent-fanout' ? primitive.count : 1),
    0,
  )
  const requiredConcurrent = strategy.primitives.reduce(
    (largest, primitive) => Math.max(
      largest,
      primitive.kind === 'dsh-subagent-fanout' ? primitive.count : 1,
    ),
    1,
  )
  if (limits.maxAgents < requiredAgents
    || limits.maxConcurrent < requiredConcurrent) {
    push(
      diagnostics,
      'STRATEGY_LIMIT_UNSATISFIABLE',
      'error',
      `strategy "${request.strategy}" invocation limits cannot execute the compiled primitive graph`,
      { strategy: request.strategy },
    )
    return deepFreeze({ ok: false, diagnostics })
  }
  const objectiveDigest = sha256Digest({ version: 1, kind: 'legion-objective', objective })
  const planIdentity = {
    version: 1,
    kind: 'legion-strategy-plan',
    generationId: catalog.generationId,
    strategy: strategy.name,
    team: strategy.team,
    objectiveDigest,
    primitives: strategy.primitives,
    artifacts: strategy.artifacts,
    completion: strategy.completion,
    limits,
    memberFailure: strategy.memberFailure,
  }
  const plan = {
    kind: 'compiled-strategy-plan',
    strategy: strategy.name,
    team: strategy.team,
    objective,
    objectiveDigest,
    generationId: catalog.generationId,
    planDigest: StrategyPlanDigest(sha256Digest(planIdentity)),
    primitives: strategy.primitives,
    artifacts: strategy.artifacts,
    completion: strategy.completion,
    limits,
    memberFailure: strategy.memberFailure,
  } as unknown as CompiledStrategyPlan
  compiledStrategyPlans.add(plan)
  deepFreeze(plan)
  return deepFreeze({ ok: true, plan, diagnostics })
}
