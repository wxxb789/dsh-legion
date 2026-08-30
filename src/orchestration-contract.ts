import z from '@deepseek-ai/schemastery'
import type { ResultContract } from './config.ts'

export const ORCHESTRATION_NAME = /^[a-z][a-z0-9-]*$/
export const ARTIFACT_CONTRACTS = Object.freeze([
  'objective-v1',
  'text',
  'findings-v1',
  'review-v1',
] as const)
export const STRATEGY_STAGE_KINDS = Object.freeze(['delegate', 'fanout', 'synthesize'] as const)
export const STRATEGY_LIMIT_FIELDS = Object.freeze([
  'maxAgents', 'maxConcurrent', 'deadlineMs', 'maxOutputBytes',
] as const)
export const STRATEGY_FANOUT_MAX = 16
export const STRATEGY_LIMIT_MAXIMUMS = Object.freeze({
  maxAgents: 32,
  maxConcurrent: 16,
  deadlineMs: 24 * 60 * 60 * 1000,
  maxOutputBytes: 16 * 1024 * 1024,
})
export type ArtifactContract = (typeof ARTIFACT_CONTRACTS)[number]

export interface MemberSlotSpec {
  readonly specialist: string
  readonly minParticipants?: number
  readonly maxParticipants?: number
  readonly tags?: readonly string[]
}

export interface CohortLimits {
  readonly maxMembers?: number
  readonly maxConcurrentMembers?: number
}

export interface CohortSpec {
  readonly description: string
  readonly members: Readonly<Record<string, MemberSlotSpec>>
  readonly limits?: CohortLimits
}

/** @deprecated Use CohortLimits. */
export type TeamLimits = CohortLimits
/** @deprecated Use CohortSpec. */
export type TeamSpec = CohortSpec

export interface ArtifactInputRef {
  readonly artifact: string
  readonly contract: ArtifactContract
  readonly collection?: boolean
  readonly optional?: boolean
}

export interface ArtifactOutputSpec {
  readonly artifact: string
  readonly contract: Exclude<ArtifactContract, 'objective-v1'>
}

interface StageBase {
  readonly id: string
  readonly member: string
  readonly inputs: readonly ArtifactInputRef[]
  readonly output: ArtifactOutputSpec
  readonly prompt: string
  /** Additional control-only stage dependencies. */
  readonly after?: readonly string[]
}

export interface DelegateStageSpec extends StageBase {
  readonly kind: 'delegate'
  readonly mode?: 'foreground' | 'continuable'
}

export interface FanoutStageSpec extends StageBase {
  readonly kind: 'fanout'
  readonly count: number
  readonly minSuccess: number
  readonly allowDegraded: boolean
}

export interface SynthesizeStageSpec extends StageBase {
  readonly kind: 'synthesize'
}

export type StrategyStageSpec =
  | DelegateStageSpec
  | FanoutStageSpec
  | SynthesizeStageSpec

export interface StrategyLimits {
  readonly maxAgents: number
  readonly maxConcurrent: number
  readonly deadlineMs: number
  readonly maxOutputBytes: number
}

export const STAIR_STEP_PAUSE_REASONS = Object.freeze([
  'authority-expansion',
  'irreversible-effect',
  'high-cost-ambiguity',
  'verification-failure',
  'no-progress',
] as const)
export type StairStepPauseReason = (typeof STAIR_STEP_PAUSE_REASONS)[number]

export interface StairStepPolicySpec {
  readonly kind: 'stair-step'
  readonly plannerMember: string
  readonly verifierMember: string
  readonly advancement?: 'continuous' | 'checkpoint'
  readonly maxMilestones?: number
  readonly maxNoProgressMilestones?: number
  readonly requireVisibleArtifact?: boolean
  readonly pauseOn?: readonly StairStepPauseReason[]
}

export interface StrategySpec {
  readonly description: string
  readonly cohort: string
  readonly stages: readonly StrategyStageSpec[]
  readonly advancement?: StairStepPolicySpec
  readonly completion: {
    readonly artifact: string
    readonly contract: ArtifactContract
  }
  readonly limits: StrategyLimits
  readonly memberFailure: 'fail' | 'allow-partial'
}

export interface CatalogDisableSpec {
  readonly specialists?: readonly string[]
  readonly cohorts?: readonly string[]
  readonly strategies?: readonly string[]
}

export interface CatalogLayer<Specialist> {
  readonly id: string
  readonly specialists?: Readonly<Record<string, Specialist>>
  readonly cohorts?: Readonly<Record<string, CohortSpec>>
  readonly strategies?: Readonly<Record<string, StrategySpec>>
  readonly disable?: CatalogDisableSpec
}

const MemberSlotFields = {
  minParticipants: z.number().step(1).min(0).max(16),
  maxParticipants: z.number().step(1).min(1).max(16),
  tags: z.array(z.string().pattern(ORCHESTRATION_NAME)),
}

const MemberSlotSchema = z.union([
  z.object({
    specialist: z.string().pattern(ORCHESTRATION_NAME).required(),
    ...MemberSlotFields,
  }),
  z.object({
    profile: z.string().pattern(ORCHESTRATION_NAME).required()
      .description('Deprecated: use "specialist" instead.')
      .deprecated(),
    ...MemberSlotFields,
  }),
]) as unknown as z<MemberSlotSpec>

const CohortLimitsSchema: z<CohortLimits> = z.object({
  maxMembers: z.number().step(1).min(1).max(16),
  maxConcurrentMembers: z.number().step(1).min(1).max(16),
})

export const CohortSpecSchema = z.object({
  description: z.string().min(1).required(),
  members: z.dict(MemberSlotSchema).required(),
  limits: CohortLimitsSchema,
}) as unknown as z<CohortSpec>

/** @deprecated Use CohortSpecSchema. */
export const TeamSpecSchema = CohortSpecSchema

const ArtifactInputSchema: z<ArtifactInputRef> = z.object({
  artifact: z.string().pattern(ORCHESTRATION_NAME).required(),
  contract: z.union(ARTIFACT_CONTRACTS).required(),
  collection: z.boolean(),
  optional: z.boolean(),
})

const ArtifactOutputSchema: z<ArtifactOutputSpec> = z.object({
  artifact: z.string().pattern(ORCHESTRATION_NAME).required(),
  contract: z.union(['text', 'findings-v1', 'review-v1'] as const).required(),
})

const StageBaseSchema = {
  id: z.string().pattern(ORCHESTRATION_NAME).required(),
  member: z.string().pattern(ORCHESTRATION_NAME).required(),
  inputs: z.array(ArtifactInputSchema).min(1).required(),
  output: ArtifactOutputSchema.required(),
  prompt: z.string().min(1).required(),
  after: z.array(z.string().pattern(ORCHESTRATION_NAME)).max(32),
}

const DelegateStageSchema = z.object({
  kind: z.const('delegate' as const).required(),
  ...StageBaseSchema,
  mode: z.union(['foreground', 'continuable'] as const),
}) as unknown as z<DelegateStageSpec>

const FanoutStageSchema = z.object({
  kind: z.const('fanout' as const).required(),
  ...StageBaseSchema,
  count: z.number().step(1).min(1).max(STRATEGY_FANOUT_MAX).required(),
  minSuccess: z.number().step(1).min(1).max(STRATEGY_FANOUT_MAX).required(),
  allowDegraded: z.boolean().required(),
}) as unknown as z<FanoutStageSpec>

const SynthesizeStageSchema = z.object({
  kind: z.const('synthesize' as const).required(),
  ...StageBaseSchema,
}) as unknown as z<SynthesizeStageSpec>

export const StrategyStageSchema: z<StrategyStageSpec> = z.union([
  DelegateStageSchema,
  FanoutStageSchema,
  SynthesizeStageSchema,
])

const StrategyLimitsSchema: z<StrategyLimits> = z.object({
  maxAgents: z.number().step(1).min(1).max(STRATEGY_LIMIT_MAXIMUMS.maxAgents).required(),
  maxConcurrent: z.number().step(1).min(1).max(STRATEGY_LIMIT_MAXIMUMS.maxConcurrent).required(),
  deadlineMs: z.number().step(1).min(1).max(STRATEGY_LIMIT_MAXIMUMS.deadlineMs).required(),
  maxOutputBytes: z.number().step(1).min(1).max(STRATEGY_LIMIT_MAXIMUMS.maxOutputBytes).required(),
})

export const StairStepPolicySpecSchema = z.object({
  kind: z.const('stair-step' as const).required(),
  plannerMember: z.string().pattern(ORCHESTRATION_NAME).required(),
  verifierMember: z.string().pattern(ORCHESTRATION_NAME).required(),
  advancement: z.union(['continuous', 'checkpoint'] as const).default('checkpoint'),
  maxMilestones: z.number().step(1).min(1).max(256).default(12),
  maxNoProgressMilestones: z.number().step(1).min(1).max(256).default(2),
  requireVisibleArtifact: z.boolean().default(true),
  pauseOn: z.array(z.union(STAIR_STEP_PAUSE_REASONS)).max(STAIR_STEP_PAUSE_REASONS.length).default([
    'authority-expansion',
    'irreversible-effect',
    'high-cost-ambiguity',
    'verification-failure',
    'no-progress',
  ]),
}) as unknown as z<StairStepPolicySpec>

const StrategySpecFields = {
  description: z.string().min(1).required(),
  stages: z.array(StrategyStageSchema).min(1).max(32).required(),
  advancement: z.union([StairStepPolicySpecSchema]),
  completion: z.object({
    artifact: z.string().pattern(ORCHESTRATION_NAME).required(),
    contract: z.union(ARTIFACT_CONTRACTS).required(),
  }).required(),
  limits: StrategyLimitsSchema.required(),
  memberFailure: z.union(['fail', 'allow-partial'] as const).required(),
}

export const StrategySpecSchema = z.union([
  z.object({
    ...StrategySpecFields,
    cohort: z.string().pattern(ORCHESTRATION_NAME).required(),
  }),
  z.object({
    ...StrategySpecFields,
    team: z.string().pattern(ORCHESTRATION_NAME).required()
      .description('Deprecated: use "cohort" instead.')
      .deprecated(),
  }),
]) as unknown as z<StrategySpec>

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
    ? value as Record<string, unknown>
    : undefined
}

function assertKnownKeys(value: unknown, allowed: readonly string[], at: string): void {
  if (value === undefined || value === null) return
  const source = record(value)
  if (source === undefined) throw new Error(`dsh-legion: ${at} must be a plain object`)
  const known = new Set(allowed)
  const unknown = Object.keys(source).filter(key => !known.has(key))
  if (unknown.length > 0) {
    throw new Error(`dsh-legion: ${at} contains unknown field(s): ${unknown.sort().join(', ')}`)
  }
}

/** Enforce strict canonical orchestration vocabularies after Config normalization. */
export function assertKnownOrchestrationKeys(
  cohorts: unknown,
  strategies: unknown,
  at = 'catalog',
): void {
  const cohortMap = record(cohorts)
  if (cohorts !== undefined && cohortMap === undefined) {
    throw new Error(`dsh-legion: ${at}.cohorts must be a plain object`)
  }
  if (cohortMap !== undefined) {
    for (const [name, cohort] of Object.entries(cohortMap)) {
      assertKnownKeys(cohort, ['description', 'members', 'limits'], `${at}.cohorts.${name}`)
      const source = record(cohort)
      const members = record(source?.members)
      if (source?.members !== undefined && members === undefined) {
        throw new Error(`dsh-legion: ${at}.cohorts.${name}.members must be a plain object`)
      }
      if (members !== undefined) {
        for (const [slot, member] of Object.entries(members)) {
          if (!ORCHESTRATION_NAME.test(slot)) {
            throw new Error(`dsh-legion: ${at}.cohorts.${name}.members has invalid slot name "${slot}"`)
          }
          assertKnownKeys(
            member,
            ['specialist', 'minParticipants', 'maxParticipants', 'tags'],
            `${at}.cohorts.${name}.members.${slot}`,
          )
        }
      }
      assertKnownKeys(
        source?.limits,
        ['maxMembers', 'maxConcurrentMembers'],
        `${at}.cohorts.${name}.limits`,
      )
    }
  }
  const strategyMap = record(strategies)
  if (strategies !== undefined && strategyMap === undefined) {
    throw new Error(`dsh-legion: ${at}.strategies must be a plain object`)
  }
  if (strategyMap !== undefined) {
    for (const [name, strategy] of Object.entries(strategyMap)) {
      assertKnownKeys(
        strategy,
        ['description', 'cohort', 'stages', 'advancement', 'completion', 'limits', 'memberFailure'],
        `${at}.strategies.${name}`,
      )
      const source = record(strategy)
      assertKnownKeys(
        source?.advancement,
        [
          'kind', 'plannerMember', 'verifierMember', 'advancement', 'maxMilestones',
          'maxNoProgressMilestones', 'requireVisibleArtifact', 'pauseOn',
        ],
        `${at}.strategies.${name}.advancement`,
      )
      assertKnownKeys(source?.completion, ['artifact', 'contract'], `${at}.strategies.${name}.completion`)
      assertKnownKeys(
        source?.limits,
        ['maxAgents', 'maxConcurrent', 'deadlineMs', 'maxOutputBytes'],
        `${at}.strategies.${name}.limits`,
      )
      if (Array.isArray(source?.stages)) {
        source.stages.forEach((stage, index) => {
          const stageRecord = record(stage)
          const baseKeys = ['kind', 'id', 'member', 'inputs', 'output', 'prompt', 'after']
          const variantKeys = stageRecord?.kind === 'delegate'
            ? ['mode']
            : stageRecord?.kind === 'fanout'
              ? ['count', 'minSuccess', 'allowDegraded']
              : []
          assertKnownKeys(
            stage,
            [...baseKeys, ...variantKeys],
            `${at}.strategies.${name}.stages[${String(index)}]`,
          )
          if (Array.isArray(stageRecord?.inputs)) {
            stageRecord.inputs.forEach((input, inputIndex) => {
              assertKnownKeys(
                input,
                ['artifact', 'contract', 'collection', 'optional'],
                `${at}.strategies.${name}.stages[${String(index)}].inputs[${String(inputIndex)}]`,
              )
            })
          }
          assertKnownKeys(
            stageRecord?.output,
            ['artifact', 'contract'],
            `${at}.strategies.${name}.stages[${String(index)}].output`,
          )
        })
      }
    }
  }
}

type StageOutputName<Stage> = Stage extends { readonly output: { readonly artifact: infer Name extends string } }
  ? Name
  : never
type StageOutputContract<Stage> = Stage extends {
  readonly output: { readonly contract: infer Contract extends ArtifactContract }
} ? Contract : never
type TupleOf<Length extends number, Values extends readonly unknown[] = []> =
  Values['length'] extends Length ? Values : TupleOf<Length, readonly [...Values, unknown]>
type LessThan<Left extends number, Right extends number> =
  TupleOf<Right> extends readonly [...TupleOf<Left>, ...infer Rest]
    ? Rest extends readonly [] ? false : true
    : false
type StageOutputAvailability<Stage> = Stage extends {
  readonly kind: 'fanout'
  readonly allowDegraded: true
  readonly minSuccess: infer Minimum extends number
  readonly count: infer Count extends number
} ? LessThan<Minimum, Count> extends true ? 'degraded' : 'required' : 'required'
type StageOutputType<Stage> = {
  readonly contract: StageOutputContract<Stage>
  readonly collection: Stage extends { readonly kind: 'fanout' } ? true : false
  readonly availability: StageOutputAvailability<Stage>
}
type StageInputUnion<Stage> = Stage extends { readonly inputs: readonly (infer Input)[] }
  ? Input
  : never
type ArtifactType = {
  readonly contract: ArtifactContract
  readonly collection: boolean
  readonly availability: 'required' | 'degraded'
}
type InvalidStageInput<Stage, Env extends Readonly<Record<string, ArtifactType>>> =
  StageInputUnion<Stage> extends infer Input
    ? Input extends {
        readonly artifact: infer Name extends string
        readonly contract: infer Contract
        readonly collection?: infer Collection
        readonly optional?: infer Optional
      }
      ? Name extends keyof Env
        ? Contract extends Env[Name]['contract']
          ? (Collection extends true ? true : false) extends Env[Name]['collection']
            ? (Optional extends true ? true : false) extends (Env[Name]['availability'] extends 'degraded' ? true : false)
              ? never
              : Input
            : Input
          : Input
        : Input
      : Input
    : never

type StageEnvironment<
  Stages extends readonly StrategyStageSpec[],
  Env extends Readonly<Record<string, ArtifactType>> = {
    readonly objective: {
      readonly contract: 'objective-v1'
      readonly collection: false
      readonly availability: 'required'
    }
  },
> = Stages extends readonly [
  infer Head extends StrategyStageSpec,
  ...infer Tail extends readonly StrategyStageSpec[],
]
  ? [InvalidStageInput<Head, Env>] extends [never]
    ? StageOutputName<Head> extends keyof Env
      ? never
      : StageEnvironment<
          Tail,
          Env & { readonly [Name in StageOutputName<Head>]: StageOutputType<Head> }
        >
    : never
  : Env

type ValidStrategySpec<Spec extends StrategySpec> =
  StageEnvironment<Spec['stages']> extends infer Env
    ? [Env] extends [never]
      ? never
      : Env extends Readonly<Record<string, ArtifactType>>
        ? Spec['completion']['artifact'] extends keyof Env
          ? Spec['completion']['contract'] extends Env[Spec['completion']['artifact']]['contract']
            ? Env[Spec['completion']['artifact']]['collection'] extends false ? unknown : never
            : never
          : never
        : never
    : never

export interface DefinedCohort<Name extends string, Spec extends CohortSpec> {
  readonly name: Name
  readonly spec: Spec
}
/** @deprecated Use DefinedCohort. */
export type DefinedTeam<Name extends string, Spec extends CohortSpec> = DefinedCohort<Name, Spec>

export function defineCohort<const Name extends string, const Spec extends CohortSpec>(
  name: Name,
  spec: Spec,
): DefinedCohort<Name, Spec> {
  return { name, spec }
}

/** @deprecated Use defineCohort. */
export const defineTeam = defineCohort

type StageMembers<Stages extends readonly StrategyStageSpec[]> = Stages[number]['member']
type MemberMinimum<Member> = Member extends { readonly minParticipants: infer Value extends number }
  ? Value : 0
type MemberMaximum<Member> = Member extends { readonly maxParticipants: infer Value extends number }
  ? Value : 1
type InvalidMemberStage<Cohort extends CohortSpec, Stage> = Stage extends {
  readonly member: infer Name extends keyof Cohort['members'] & string
} ? Cohort['members'][Name] extends infer Member
  ? Stage extends {
      readonly kind: 'fanout'
      readonly count: infer Count extends number
      readonly minSuccess: infer MinimumSuccess extends number
      readonly allowDegraded: infer AllowDegraded
    }
    ? LessThan<Count, MemberMinimum<Member>> extends true ? Stage
      : LessThan<MemberMaximum<Member>, Count> extends true ? Stage
        : LessThan<Count, MinimumSuccess> extends true ? Stage
          : AllowDegraded extends false
            ? Count extends MinimumSuccess ? never : Stage
            : never
    : LessThan<1, MemberMinimum<Member>> extends true ? Stage : never
  : Stage
: Stage
type InvalidMemberStages<Cohort extends CohortSpec, Stages extends readonly StrategyStageSpec[]> =
  Stages[number] extends infer Stage ? InvalidMemberStage<Cohort, Stage> : never
type RequiredCohortMembers<Cohort extends CohortSpec> = {
  [Name in keyof Cohort['members'] & string]: MemberMinimum<Cohort['members'][Name]> extends 0
    ? never
    : Name
}[keyof Cohort['members'] & string]
type MissingRequiredMembers<Cohort extends CohortSpec, Stages extends readonly StrategyStageSpec[]> =
  Exclude<RequiredCohortMembers<Cohort>, StageMembers<Stages>>

/** Type-level authoring helper; runtime data still crosses the normal schema/compiler seam. */
export function defineStrategy<const Spec extends StrategySpec>(
  spec: Spec & ValidStrategySpec<Spec>,
): Spec {
  return spec
}

export function defineStrategyFor<
  const Cohort extends DefinedCohort<string, CohortSpec>,
  const Spec extends StrategySpec,
>(
  _cohort: Cohort,
  spec: Spec
    & ValidStrategySpec<Spec>
    & (Spec['cohort'] extends Cohort['name'] ? unknown : never)
    & (Exclude<StageMembers<Spec['stages']>, keyof Cohort['spec']['members'] & string> extends never
      ? unknown
      : never)
    & (InvalidMemberStages<Cohort['spec'], Spec['stages']> extends never ? unknown : never)
    & (MissingRequiredMembers<Cohort['spec'], Spec['stages']> extends never ? unknown : never),
): Spec {
  return spec
}

/** Profiles currently expose these artifact contracts directly. */
export function specialistResultMatchesArtifact(
  result: ResultContract,
  artifact: Exclude<ArtifactContract, 'objective-v1'>,
): boolean {
  return result === artifact
}
