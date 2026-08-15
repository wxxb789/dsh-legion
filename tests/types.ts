import {
  ArtifactName,
  MemberSlotName,
  ProfileName,
  StrategyName,
  TeamName,
  defineStrategy,
  defineStrategyFor,
  defineTeam,
  type ArtifactName as ArtifactNameType,
  type CatalogDigest,
  type CompiledCatalog,
  type DelegationInvocation,
  type DelegationPlan,
  type Diagnostic,
  type ErrorDiagnosticCode,
  type ExplainViewV1,
  type LegionConfig,
  type ProfileExplainView,
  type PolicyDigest,
  type ProfileName as ProfileNameType,
  type ResourceDigest,
  type RoutePlan,
  type RoutePlanDigest,
  type StrategyName as StrategyNameType,
  type TeamName as TeamNameType,
  type TeamRunOutcome,
  type WarningDiagnosticCode,
} from '../src/index.ts'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false
type Assert<Value extends true> = Value

export type CatalogPolicyDigestContract = Assert<Equal<CompiledCatalog['policyDigest'], PolicyDigest>>
export type PlanCatalogDigestContract = Assert<Equal<DelegationPlan['catalogDigest'], CatalogDigest>>
export type PlanResourceDigestContract = Assert<Equal<DelegationPlan['resourceDigest'], ResourceDigest>>

const config: LegionConfig = {
  toolName: 'legion',
  enableRunInBackground: true,
  defaultProfile: 'quick',
  profiles: {
    quick: {
      description: 'Fast work.',
      subagentProvider: 'spawn',
      maxDepth: 2,
      defaultRunInBackground: true,
    },
  },
}

const routedConfig: LegionConfig = {
  toolName: 'legion',
  enableRunInBackground: true,
  profiles: {
    deep: {
      description: 'Deep work.',
      subagentProvider: 'spawn',
      routes: [{
        id: 'strong',
        provider: 'provider',
        model: 'model',
        constraints: { minContextTokens: 64_000, minEffectiveOutputTokens: 8192 },
      }],
      maxDepth: 2,
      defaultRunInBackground: false,
    },
  },
}

const invocation: DelegationInvocation = {
  profile: 'quick',
  description: 'fast work',
  prompt: 'Work.',
}

const profile: ProfileNameType = ProfileName('quick')
const team: TeamNameType = TeamName('coding')
const strategy: StrategyNameType = StrategyName('independent-review')
const artifact: ArtifactNameType = ArtifactName('evidence')
const member = MemberSlotName('executor')
const profileAsString: string = profile
void config
void routedConfig
void invocation
void profileAsString
void team
void strategy
void artifact
void member

declare const policy: PolicyDigest
declare const catalog: CatalogDigest
declare const resource: ResourceDigest
const policyAsString: string = policy
const catalogAsString: string = catalog
const resourceAsString: string = resource
void policyAsString
void catalogAsString
void resourceAsString

// @ts-expect-error CatalogDigest and PolicyDigest are distinct identities.
const wrongPolicy: PolicyDigest = catalog
// @ts-expect-error ResourceDigest and CatalogDigest are distinct identities.
const wrongCatalog: CatalogDigest = resource
// @ts-expect-error Plain strings have not crossed the checked digest constructor.
const uncheckedPolicy: PolicyDigest = 'sha256:deadbeef'
// @ts-expect-error Plain strings have not crossed the checked profile constructor.
const uncheckedProfile: ProfileNameType = 'quick'
// @ts-expect-error Team and Strategy identities are not interchangeable.
const wrongTeam: TeamNameType = strategy
// @ts-expect-error Artifact and Team identities are not interchangeable.
const wrongArtifact: ArtifactNameType = team
void wrongPolicy
void wrongCatalog
void uncheckedPolicy
void uncheckedProfile
void wrongTeam
void wrongArtifact

// @ts-expect-error Error diagnostic codes cannot carry warning severity.
const invalidDiagnostic: Diagnostic = {
  code: 'PROFILE_DEPTH_UNSUPPORTED',
  severity: 'warning',
  message: 'invalid',
  profile,
}
void invalidDiagnostic

const invalidReasoningConfig: LegionConfig = {
  ...routedConfig,
  profiles: {
    deep: {
      ...routedConfig.profiles.deep!,
      routes: [{
        id: 'invalid',
        provider: 'provider',
        model: 'model',
        constraints: {
          // @ts-expect-error Reasoning constraints wait for an upstream per-child effort override seam.
          reasoning: 'forbidden',
        },
      }],
    },
  },
}
void invalidReasoningConfig

const typedStrategy = defineStrategy({
  description: 'Typed pipeline.',
  team: 'coding',
  stages: [
    {
      kind: 'delegate',
      id: 'execute',
      member: 'executor',
      inputs: [{ artifact: 'objective', contract: 'objective-v1' }],
      output: { artifact: 'evidence', contract: 'text' },
      prompt: 'Execute.',
    },
    {
      kind: 'delegate',
      id: 'review',
      member: 'reviewer',
      inputs: [{ artifact: 'evidence', contract: 'text' }],
      output: { artifact: 'review', contract: 'review-v1' },
      prompt: 'Review.',
    },
  ],
  completion: { artifact: 'review', contract: 'review-v1' },
  limits: {
    maxAgents: 2,
    maxConcurrent: 1,
    maxRounds: 1,
    deadlineMs: 60_000,
    maxOutputBytes: 64_000,
  },
  memberFailure: 'fail',
})
void typedStrategy
const codingTeam = defineTeam('coding', {
  description: 'Coding.',
  members: {
    executor: { profile: 'deep' },
    reviewer: { profile: 'review' },
  },
})
defineStrategyFor(codingTeam, typedStrategy)

// @ts-expect-error A Strategy member must name a slot in its typed Team.
defineStrategyFor(codingTeam, {
  ...typedStrategy,
  stages: [{ ...typedStrategy.stages[0], member: 'missing' }],
})

// @ts-expect-error A stage cannot consume an artifact produced by a later stage.
defineStrategy({
  description: 'Invalid forward reference.',
  team: 'coding',
  stages: [{
    kind: 'delegate',
    id: 'first',
    member: 'executor',
    inputs: [{ artifact: 'future', contract: 'text' }],
    output: { artifact: 'result', contract: 'text' },
    prompt: 'Invalid.',
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
})

// @ts-expect-error Artifact contracts must match the previously produced artifact.
defineStrategy({
  ...typedStrategy,
  stages: [
    typedStrategy.stages[0],
    {
      ...typedStrategy.stages[1],
      inputs: [{ artifact: 'evidence', contract: 'review-v1' }],
    },
  ],
})

// @ts-expect-error Completion must reference an existing single artifact with the same contract.
defineStrategy({
  ...typedStrategy,
  completion: { artifact: 'review', contract: 'text' },
})

// @ts-expect-error Active profiles must expose at least one allowed mode.
const invalidActiveProfile: ProfileExplainView = {
  kind: 'active-profile',
  name: profile,
  subagentProvider: 'spawn',
  description: 'invalid',
  defaultMode: 'foreground',
  allowedModes: [],
  resultContract: 'text',
  route: {},
}
void invalidActiveProfile

declare const explain: ExplainViewV1
const explainPolicy: PolicyDigest = explain.policyDigest
void explainPolicy

export function routePlanIdentity(plan: RoutePlan): RoutePlanDigest {
  if (plan.kind === 'selected-route-plan') {
    const selectedId: string = plan.selected.id
    void selectedId
  }
  return plan.planDigest
}

export function outcomeKind(outcome: TeamRunOutcome): TeamRunOutcome['kind'] {
  switch (outcome.kind) {
    case 'completed': return outcome.kind
    case 'degraded': return outcome.kind
    case 'cancelled': return outcome.kind
    case 'failed': return outcome.kind
    default: {
      const neverOutcome: never = outcome
      return neverOutcome
    }
  }
}

export function diagnosticCodeClass(diagnostic: Diagnostic): WarningDiagnosticCode | ErrorDiagnosticCode {
  if (diagnostic.severity === 'warning') {
    const warning: WarningDiagnosticCode = diagnostic.code
    return warning
  }
  const error: ErrorDiagnosticCode = diagnostic.code
  return error
}
