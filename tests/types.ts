import {
  ProfileName,
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

const invocation: DelegationInvocation = {
  profile: 'quick',
  description: 'fast work',
  prompt: 'Work.',
}

const profile: ProfileNameType = ProfileName('quick')
const profileAsString: string = profile
void config
void invocation
void profileAsString

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
void wrongPolicy
void wrongCatalog
void uncheckedPolicy
void uncheckedProfile

// @ts-expect-error Error diagnostic codes cannot carry warning severity.
const invalidDiagnostic: Diagnostic = {
  code: 'PROFILE_DEPTH_UNSUPPORTED',
  severity: 'warning',
  message: 'invalid',
  profile,
}
void invalidDiagnostic

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

export function diagnosticCodeClass(diagnostic: Diagnostic): WarningDiagnosticCode | ErrorDiagnosticCode {
  if (diagnostic.severity === 'warning') {
    const warning: WarningDiagnosticCode = diagnostic.code
    return warning
  }
  const error: ErrorDiagnosticCode = diagnostic.code
  return error
}
