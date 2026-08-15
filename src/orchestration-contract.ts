import z from '@deepseek-ai/schemastery'
import type { ResultContract } from './config.ts'

export const ORCHESTRATION_NAME = /^[a-z][a-z0-9-]*$/
export const ARTIFACT_CONTRACTS = [
  'objective-v1',
  'text',
  'findings-v1',
  'review-v1',
] as const
export const STRATEGY_STAGE_KINDS = ['delegate', 'fanout', 'synthesize'] as const
export const STRATEGY_LIMIT_FIELDS = [
  'maxAgents', 'maxConcurrent', 'deadlineMs', 'maxOutputBytes',
] as const
export type ArtifactContract = (typeof ARTIFACT_CONTRACTS)[number]

export interface MemberSlotSpec {
  readonly profile: string
  readonly minParticipants?: number
  readonly maxParticipants?: number
  readonly tags?: readonly string[]
}

export interface TeamLimits {
  readonly maxMembers?: number
  readonly maxConcurrentMembers?: number
}

export interface TeamSpec {
  readonly description: string
  readonly members: Readonly<Record<string, MemberSlotSpec>>
  readonly limits?: TeamLimits
}

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

export interface StrategySpec {
  readonly description: string
  readonly team: string
  readonly stages: readonly StrategyStageSpec[]
  readonly completion: {
    readonly artifact: string
    readonly contract: ArtifactContract
  }
  readonly limits: StrategyLimits
  readonly memberFailure: 'fail' | 'allow-partial'
}

export interface CatalogDisableSpec {
  readonly profiles?: readonly string[]
  readonly teams?: readonly string[]
  readonly strategies?: readonly string[]
}

export interface CatalogLayer<Profile> {
  readonly id: string
  readonly profiles?: Readonly<Record<string, Profile>>
  readonly teams?: Readonly<Record<string, TeamSpec>>
  readonly strategies?: Readonly<Record<string, StrategySpec>>
  readonly disable?: CatalogDisableSpec
}

const MemberSlotSchema = z.object({
  profile: z.string().pattern(ORCHESTRATION_NAME).required(),
  minParticipants: z.number().step(1).min(0).max(16),
  maxParticipants: z.number().step(1).min(1).max(16),
  tags: z.array(z.string().pattern(ORCHESTRATION_NAME)),
}) as unknown as z<MemberSlotSpec>

const TeamLimitsSchema: z<TeamLimits> = z.object({
  maxMembers: z.number().step(1).min(1).max(16),
  maxConcurrentMembers: z.number().step(1).min(1).max(16),
})

export const TeamSpecSchema = z.object({
  description: z.string().min(1).required(),
  members: z.dict(MemberSlotSchema).required(),
  limits: TeamLimitsSchema,
}) as unknown as z<TeamSpec>

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
}

const DelegateStageSchema = z.object({
  kind: z.const('delegate' as const).required(),
  ...StageBaseSchema,
  mode: z.union(['foreground', 'continuable'] as const),
}) as unknown as z<DelegateStageSpec>

const FanoutStageSchema = z.object({
  kind: z.const('fanout' as const).required(),
  ...StageBaseSchema,
  count: z.number().step(1).min(1).max(16).required(),
  minSuccess: z.number().step(1).min(1).max(16).required(),
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
  maxAgents: z.number().step(1).min(1).max(32).required(),
  maxConcurrent: z.number().step(1).min(1).max(16).required(),
  deadlineMs: z.number().step(1).min(1).max(24 * 60 * 60 * 1000).required(),
  maxOutputBytes: z.number().step(1).min(1).max(16 * 1024 * 1024).required(),
})

export const StrategySpecSchema = z.object({
  description: z.string().min(1).required(),
  team: z.string().pattern(ORCHESTRATION_NAME).required(),
  stages: z.array(StrategyStageSchema).min(1).max(32).required(),
  completion: z.object({
    artifact: z.string().pattern(ORCHESTRATION_NAME).required(),
    contract: z.union(ARTIFACT_CONTRACTS).required(),
  }).required(),
  limits: StrategyLimitsSchema.required(),
  memberFailure: z.union(['fail', 'allow-partial'] as const).required(),
}) as unknown as z<StrategySpec>

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

/** Enforce strict object vocabularies before Schemastery materialization. */
export function assertKnownOrchestrationKeys(
  teams: unknown,
  strategies: unknown,
  at = 'catalog',
): void {
  const teamMap = record(teams)
  if (teams !== undefined && teamMap === undefined) {
    throw new Error(`dsh-legion: ${at}.teams must be a plain object`)
  }
  if (teamMap !== undefined) {
    for (const [name, team] of Object.entries(teamMap)) {
      assertKnownKeys(team, ['description', 'members', 'limits'], `${at}.teams.${name}`)
      const source = record(team)
      const members = record(source?.members)
      if (source?.members !== undefined && members === undefined) {
        throw new Error(`dsh-legion: ${at}.teams.${name}.members must be a plain object`)
      }
      if (members !== undefined) {
        for (const [slot, member] of Object.entries(members)) {
          assertKnownKeys(
            member,
            ['profile', 'minParticipants', 'maxParticipants', 'tags'],
            `${at}.teams.${name}.members.${slot}`,
          )
        }
      }
      assertKnownKeys(
        source?.limits,
        ['maxMembers', 'maxConcurrentMembers'],
        `${at}.teams.${name}.limits`,
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
        ['description', 'team', 'stages', 'completion', 'limits', 'memberFailure'],
        `${at}.strategies.${name}`,
      )
      const source = record(strategy)
      assertKnownKeys(source?.completion, ['artifact', 'contract'], `${at}.strategies.${name}.completion`)
      assertKnownKeys(
        source?.limits,
        ['maxAgents', 'maxConcurrent', 'deadlineMs', 'maxOutputBytes'],
        `${at}.strategies.${name}.limits`,
      )
      if (Array.isArray(source?.stages)) {
        source.stages.forEach((stage, index) => {
          const stageRecord = record(stage)
          const baseKeys = ['kind', 'id', 'member', 'inputs', 'output', 'prompt']
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
type StageOutputType<Stage> = {
  readonly contract: StageOutputContract<Stage>
  readonly collection: Stage extends { readonly kind: 'fanout' } ? true : false
}
type StageInputUnion<Stage> = Stage extends { readonly inputs: readonly (infer Input)[] }
  ? Input
  : never
type ArtifactType = {
  readonly contract: ArtifactContract
  readonly collection: boolean
}
type InvalidStageInput<Stage, Env extends Readonly<Record<string, ArtifactType>>> =
  StageInputUnion<Stage> extends infer Input
    ? Input extends {
        readonly artifact: infer Name extends string
        readonly contract: infer Contract
        readonly collection?: infer Collection
      }
      ? Name extends keyof Env
        ? Contract extends Env[Name]['contract']
          ? (Collection extends true ? true : false) extends Env[Name]['collection'] ? never : Input
          : Input
        : Input
      : Input
    : never

type StageEnvironment<
  Stages extends readonly StrategyStageSpec[],
  Env extends Readonly<Record<string, ArtifactType>> = {
    readonly objective: { readonly contract: 'objective-v1'; readonly collection: false }
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

export interface DefinedTeam<Name extends string, Spec extends TeamSpec> {
  readonly name: Name
  readonly spec: Spec
}

export function defineTeam<const Name extends string, const Spec extends TeamSpec>(
  name: Name,
  spec: Spec,
): DefinedTeam<Name, Spec> {
  return { name, spec }
}

type StageMembers<Stages extends readonly StrategyStageSpec[]> = Stages[number]['member']

/** Type-level authoring helper; runtime data still crosses the normal schema/compiler seam. */
export function defineStrategy<const Spec extends StrategySpec>(
  spec: Spec & ValidStrategySpec<Spec>,
): Spec {
  return spec
}

export function defineStrategyFor<
  const Team extends DefinedTeam<string, TeamSpec>,
  const Spec extends StrategySpec,
>(
  _team: Team,
  spec: Spec
    & ValidStrategySpec<Spec>
    & (Spec['team'] extends Team['name'] ? unknown : never)
    & (Exclude<StageMembers<Spec['stages']>, keyof Team['spec']['members'] & string> extends never
      ? unknown
      : never),
): Spec {
  return spec
}

/** Profiles currently expose these artifact contracts directly. */
export function profileResultMatchesArtifact(
  result: ResultContract,
  artifact: Exclude<ArtifactContract, 'objective-v1'>,
): boolean {
  return result === artifact
}
