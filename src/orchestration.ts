import { createHash } from 'node:crypto'
import type { CompiledCatalog, EffectiveProfile } from './compiler.ts'
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
  StrategyName,
  StrategyPlanDigest,
  TeamName,
  type ArtifactName as ArtifactNameType,
  type MemberSlotName as MemberSlotNameType,
  type ProfileName,
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
  | 'STRATEGY_MEMBER_UNKNOWN'
  | 'STRATEGY_MEMBER_CARDINALITY_UNSATISFIED'
  | 'STRATEGY_ARTIFACT_UNKNOWN'
  | 'STRATEGY_ARTIFACT_FORWARD_REFERENCE'
  | 'STRATEGY_ARTIFACT_DUPLICATE'
  | 'STRATEGY_ARTIFACT_CONTRACT_MISMATCH'
  | 'STRATEGY_ARTIFACT_AVAILABILITY_MISMATCH'
  | 'STRATEGY_PROFILE_RESULT_MISMATCH'
  | 'STRATEGY_CONTINUABLE_ARTIFACT_UNSUPPORTED'
  | 'STRATEGY_COMPLETION_UNKNOWN_ARTIFACT'
  | 'STRATEGY_COMPLETION_CONTRACT_MISMATCH'
  | 'STRATEGY_AGENT_LIMIT_EXCEEDED'
  | 'STRATEGY_CONCURRENCY_LIMIT_EXCEEDED'
  | 'STRATEGY_ROUND_LIMIT_EXCEEDED'
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

export interface GoalPrimitive extends PrimitiveBase {
  readonly kind: 'dsh-goal'
  readonly maxRounds: number
}

export type DshPrimitive = DelegatePrimitive | FanoutPrimitive | GoalPrimitive
export type StrategyExecutionClass = 'subagents' | 'workflow' | 'goal' | 'hybrid'

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
  readonly executionClass: StrategyExecutionClass
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
  readonly profilePolicyDigest: string
}

export interface StrategyCompileRequest {
  readonly strategy: string
  readonly objective: string
  readonly limits?: Partial<StrategyLimits>
}

export interface CompiledStrategyPlan {
  readonly kind: 'compiled-strategy-plan'
  readonly strategy: StrategyNameType
  readonly team: TeamNameType
  readonly objective: string
  readonly objectiveDigest: `sha256:${string}`
  readonly catalogDigest: `sha256:${string}`
  readonly profilePolicyDigest: string
  readonly planDigest: StrategyPlanDigestType
  readonly executionClass: StrategyExecutionClass
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

function deepFreeze<Value>(value: Value): Value {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (typeof value !== 'object' || value === null) return value
  const source = value as Record<string, unknown>
  return Object.fromEntries(Object.keys(source).sort().flatMap(key =>
    source[key] === undefined ? [] : [[key, canonical(source[key])]]))
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}`
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

function executionClass(primitives: readonly DshPrimitive[]): StrategyExecutionClass {
  const classes = new Set(primitives.map((primitive) => {
    if (primitive.kind === 'dsh-subagent-fanout') return 'subagents'
    if (primitive.kind === 'dsh-goal') return 'goal'
    return 'subagents'
  }))
  if (classes.size === 1) return [...classes][0]!
  return 'hybrid'
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
  const effectiveLimits: StrategyLimits = {
    ...spec.limits,
    maxConcurrent: Math.min(
      spec.limits.maxConcurrent,
      spec.limits.maxAgents,
      team.maxConcurrentMembers,
    ),
  }
  const allOutputs = new Map(spec.stages.map((stage, index) => [stage.output.artifact, index]))
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
    if (stage.kind === 'goal' && stage.maxRounds > spec.limits.maxRounds) {
      push(
        diagnostics,
        'STRATEGY_ROUND_LIMIT_EXCEEDED',
        'error',
        `strategy "${name}" stage "${stage.id}" exceeds maxRounds`,
        location,
      )
    }
    if (diagnostics.slice(stageDiagnosticStart).some(item => item.severity === 'error')) continue
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
      }))
    } else if (stage.kind === 'goal') {
      primitives.push(deepFreeze({
        kind: 'dsh-goal',
        stage: stage.id,
        member: member.name,
        profile: member.profile,
        inputs: inputNames,
        output,
        prompt: stage.prompt,
        maxRounds: stage.maxRounds,
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
      }))
    }
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
    executionClass: executionClass(primitives),
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
    teams,
    strategies,
  }
  return deepFreeze({
    teams,
    strategies,
    diagnostics,
    digest: digest(identity),
    profilePolicyDigest: profiles.policyDigest,
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
    'maxAgents', 'maxConcurrent', 'maxRounds', 'deadlineMs', 'maxOutputBytes',
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
    .filter(strategy => strategy.active
      && strategy.primitives.every(primitive => primitive.kind !== 'dsh-goal'))
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
  const objectiveDigest = digest({ version: 1, kind: 'legion-objective', objective: plan.objective })
  const identity = {
    version: 1,
    kind: 'legion-strategy-plan',
    catalogDigest: plan.catalogDigest,
    profilePolicyDigest: plan.profilePolicyDigest,
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
    || StrategyPlanDigest(digest(identity)) !== plan.planDigest) {
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
      'STRATEGY_ARTIFACT_CONTRACT_MISMATCH',
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
  const requiredRounds = strategy.primitives.reduce(
    (largest, primitive) => Math.max(
      largest,
      primitive.kind === 'dsh-goal' ? primitive.maxRounds : 1,
    ),
    1,
  )
  if (limits.maxAgents < requiredAgents
    || limits.maxConcurrent < requiredConcurrent
    || limits.maxRounds < requiredRounds) {
    push(
      diagnostics,
      'STRATEGY_LIMIT_UNSATISFIABLE',
      'error',
      `strategy "${request.strategy}" invocation limits cannot execute the compiled primitive graph`,
      { strategy: request.strategy },
    )
    return deepFreeze({ ok: false, diagnostics })
  }
  const objectiveDigest = digest({ version: 1, kind: 'legion-objective', objective })
  const planIdentity = {
    version: 1,
    kind: 'legion-strategy-plan',
    catalogDigest: catalog.digest,
    profilePolicyDigest: catalog.profilePolicyDigest,
    strategy: strategy.name,
    team: strategy.team,
    objectiveDigest,
    primitives: strategy.primitives,
    artifacts: strategy.artifacts,
    completion: strategy.completion,
    limits,
    memberFailure: strategy.memberFailure,
  }
  const plan: CompiledStrategyPlan = deepFreeze({
    kind: 'compiled-strategy-plan',
    strategy: strategy.name,
    team: strategy.team,
    objective,
    objectiveDigest,
    catalogDigest: catalog.digest,
    profilePolicyDigest: catalog.profilePolicyDigest,
    planDigest: StrategyPlanDigest(digest(planIdentity)),
    executionClass: strategy.executionClass,
    primitives: strategy.primitives,
    artifacts: strategy.artifacts,
    completion: strategy.completion,
    limits,
    memberFailure: strategy.memberFailure,
  })
  return deepFreeze({ ok: true, plan, diagnostics })
}
