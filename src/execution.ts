import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JsonValue } from '@deepseek-ai/dsh-tools'
import type { SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import type { CompiledCatalog, DelegationPlan } from './compiler.ts'
import { compileDelegationPlan } from './compiler.ts'
import { assertCompiledStrategyPlan } from './orchestration.ts'
import type {
  CompiledArtifact,
  CompiledOrchestrationCatalog,
  CompiledStrategyPlan,
  DshPrimitive,
  FanoutPrimitive,
} from './orchestration.ts'
import { materializeStructuredResult } from './result-contract.ts'
import { applyRoutePlan, compileRoutePlan, observeModelRoutes } from './route.ts'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

export interface StrategyExecutionSnapshot {
  readonly kind: 'strategy-execution-snapshot'
  readonly catalogDigest: CompiledOrchestrationCatalog['digest']
  readonly profilePolicyDigest: CompiledCatalog['policyDigest']
  readonly profileCatalogDigest: CompiledCatalog['catalogDigest']
  readonly profiles: CompiledCatalog
  readonly orchestration: CompiledOrchestrationCatalog
}

export interface MaterializedStrategyArtifact {
  readonly name: string
  readonly contract: CompiledArtifact['contract']
  readonly collection: boolean
  readonly availability: CompiledArtifact['availability']
  readonly value: JsonValue
  readonly bytes: number
}

export interface StrategyMemberFailure {
  readonly stage: string
  readonly member: string
  readonly index?: number
  readonly code: string
  readonly message: string
}

export type TeamRunOutcome =
  | {
      readonly kind: 'completed'
      readonly planDigest: string
      readonly artifacts: readonly MaterializedStrategyArtifact[]
      readonly final: MaterializedStrategyArtifact
    }
  | {
      readonly kind: 'degraded'
      readonly planDigest: string
      readonly artifacts: readonly MaterializedStrategyArtifact[]
      readonly final: MaterializedStrategyArtifact
      readonly failures: readonly StrategyMemberFailure[]
    }
  | {
      readonly kind: 'cancelled'
      readonly planDigest: string
      readonly artifacts: readonly MaterializedStrategyArtifact[]
      readonly reason: string
    }
  | {
      readonly kind: 'failed'
      readonly planDigest: string
      readonly artifacts: readonly MaterializedStrategyArtifact[]
      readonly failure: StrategyMemberFailure
    }

type TerminalClaim = TeamRunOutcome['kind']

class TerminalArbiter {
  private claimed: TerminalClaim | undefined

  claim(kind: TerminalClaim): boolean {
    if (this.claimed !== undefined) return false
    this.claimed = kind
    return true
  }

  get value(): TerminalClaim | undefined {
    return this.claimed
  }
}

class PrimitiveFailure extends Error {
  constructor(readonly failure: StrategyMemberFailure) {
    super(failure.message)
    this.name = 'PrimitiveFailure'
  }
}

function deepFreeze<Value>(value: Value): Value {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}

export function createStrategyExecutionSnapshot(
  profiles: CompiledCatalog,
  orchestration: CompiledOrchestrationCatalog,
): StrategyExecutionSnapshot {
  if (orchestration.profilePolicyDigest !== profiles.policyDigest
    || orchestration.profileCatalogDigest !== profiles.catalogDigest) {
    throw new Error('dsh-legion: orchestration catalog does not match Profile catalog generation')
  }
  return deepFreeze({
    kind: 'strategy-execution-snapshot',
    catalogDigest: orchestration.digest,
    profilePolicyDigest: profiles.policyDigest,
    profileCatalogDigest: profiles.catalogDigest,
    profiles,
    orchestration,
  })
}

function boundedMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.length <= 500 ? message : `${message.slice(0, 497)}...`
}

function failure(
  primitive: DshPrimitive,
  code: string,
  error: unknown,
  index?: number,
): StrategyMemberFailure {
  return deepFreeze({
    stage: primitive.stage,
    member: String(primitive.member),
    ...index === undefined ? {} : { index },
    code,
    message: boundedMessage(error),
  })
}

function combinedSignal(parent: AbortSignal, deadlineMs: number): {
  signal: AbortSignal
  dispose(): void
} {
  const controller = new AbortController()
  const abort = () => controller.abort(parent.reason ?? 'strategy parent cancelled')
  if (parent.aborted) abort()
  else parent.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort('strategy deadline exceeded'), deadlineMs)
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer)
      parent.removeEventListener('abort', abort)
    },
  }
}

function selectedAdapterPresent(ctx: Context, plan: DelegationPlan): boolean {
  const provider = plan.routePlan?.selected.provider
  return provider === undefined
    || ctx.get('llm')?.listProviders().some(item => item.id === provider) === true
}

async function delegationPlan(
  ctx: Context,
  catalog: CompiledCatalog,
  primitive: DshPrimitive,
  prompt: string,
  signal: AbortSignal,
): Promise<DelegationPlan> {
  let plan = compileDelegationPlan(catalog, {
    profile: String(primitive.profile),
    description: `${primitive.stage} ${primitive.member}`,
    prompt,
    runInBackground: false,
  })
  const profile = catalog.activeProfiles[primitive.profile]
  if (profile === undefined) throw new Error(`profile "${primitive.profile}" is inactive`)
  if (profile.routes !== undefined) {
    const facts = await observeModelRoutes(ctx.get('llm'), profile.routes, signal)
    const route = compileRoutePlan({ ...profile, routes: profile.routes }, catalog.policyDigest, facts)
    if (route.kind === 'unroutable-route-plan') throw new Error('no exact route passed static preflight')
    plan = applyRoutePlan(plan, route)
  }
  if (!selectedAdapterPresent(ctx, plan)) throw new Error('selected LLM adapter disappeared before start')
  if (ctx.subagents.getProvider(plan.subagentProvider) === undefined) {
    throw new Error(`subagent provider "${plan.subagentProvider}" is unavailable`)
  }
  return plan
}

function renderPrompt(
  primitive: DshPrimitive,
  objective: string,
  artifacts: ReadonlyMap<string, MaterializedStrategyArtifact>,
): string {
  const inputs = primitive.inputs.map((name) => {
    if (name === 'objective') {
      return { name: 'objective', contract: 'objective-v1', collection: false, value: objective }
    }
    const artifact = artifacts.get(String(name))
    if (artifact === undefined) throw new Error(`required artifact "${name}" is unavailable`)
    return {
      name: artifact.name,
      contract: artifact.contract,
      collection: artifact.collection,
      value: artifact.value,
    }
  })
  return [
    primitive.prompt,
    '',
    '<legion_objective>',
    objective,
    '</legion_objective>',
    '<legion_artifacts>',
    JSON.stringify(inputs, null, 2),
    '</legion_artifacts>',
  ].join('\n')
}

function awaitAbortable<Value>(task: Promise<Value>, signal: AbortSignal): Promise<Value> {
  if (signal.aborted) return Promise.reject(new Error(boundedMessage(signal.reason)))
  return new Promise<Value>((resolve, reject) => {
    const abort = () => reject(new Error(boundedMessage(signal.reason)))
    signal.addEventListener('abort', abort, { once: true })
    task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort)).catch(() => undefined)
  })
}

async function boundedDispose(run: SubagentRun): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const disposal = run.dispose().then(
    () => ({ kind: 'disposed' as const }),
    (error: unknown) => ({ kind: 'error' as const, error }),
  )
  try {
    const result = await Promise.race([
      disposal,
      new Promise<{ readonly kind: 'timeout' }>((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout({ kind: 'timeout' }), 1000)
      }),
    ])
    if (result.kind === 'error') throw result.error
    if (result.kind === 'timeout') throw new Error('subagent disposal exceeded grace period')
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function settleRun(
  run: SubagentRun,
  plan: DelegationPlan,
  signal: AbortSignal,
  claimExecutionFailure?: () => void,
): Promise<SubagentResult> {
  let result: SubagentResult | undefined
  let resultError: unknown
  let disposeError: unknown
  try {
    result = await awaitAbortable(run.result, signal)
  } catch (error: unknown) {
    resultError = error
    if (!signal.aborted) claimExecutionFailure?.()
  }
  if (result !== undefined && result.stopReason !== 'completed') {
    resultError = new Error(`profile "${plan.profile}" ended with ${result.stopReason}`)
    claimExecutionFailure?.()
  }
  try {
    await boundedDispose(run)
  } catch (error: unknown) {
    disposeError = error
  }
  if (resultError !== undefined || disposeError !== undefined) {
    throw new AggregateError(
      [resultError, disposeError].filter(value => value !== undefined),
      `profile "${plan.profile}" child run or disposal failed`,
    )
  }
  if (result === undefined) throw new Error(`profile "${plan.profile}" returned no result`)
  return result
}

function contentText(output: ContentBlock[]): string {
  return output
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
}

function artifactValue(
  artifact: CompiledArtifact,
  result: SubagentResult,
): JsonValue {
  if (artifact.contract === 'text') return contentText(result.output)
  if (artifact.contract === 'objective-v1') throw new Error('a child cannot produce objective-v1')
  if (result.structured === undefined) {
    throw new Error(`child omitted structured ${artifact.contract} output`)
  }
  const materialized = materializeStructuredResult(artifact.contract, result.structured)
  if (materialized === undefined) throw new Error(`failed to materialize ${artifact.contract}`)
  return materialized
}

function materializedArtifact(
  definition: CompiledArtifact,
  value: JsonValue,
): MaterializedStrategyArtifact {
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength
  return deepFreeze({
    name: String(definition.name),
    contract: definition.contract,
    collection: definition.collection,
    availability: definition.availability,
    value,
    bytes,
  })
}

async function executeOne(
  ctx: Context,
  catalog: CompiledCatalog,
  primitive: DshPrimitive,
  prompt: string,
  parent: Agent,
  signal: AbortSignal,
  claimExecutionFailure?: () => void,
): Promise<JsonValue> {
  const plan = await delegationPlan(ctx, catalog, primitive, prompt, signal)
  const run = await ctx.subagents.start(plan.subagentProvider, {
    label: plan.label,
    prompt: [{ type: 'text', text: plan.prompt }],
    parent,
    signal,
    ...plan.agentOptions === undefined ? {} : { agentOptions: plan.agentOptions },
    ...plan.persona === undefined ? {} : { persona: plan.persona },
    ...plan.toolFilter === undefined ? {} : { toolFilter: plan.toolFilter },
    ...plan.maxDepth === undefined ? {} : { maxDepth: plan.maxDepth },
    ...plan.outputSchema === undefined ? {} : { outputSchema: plan.outputSchema },
  })
  return artifactValue(
    primitive.output,
    await settleRun(run, plan, signal, claimExecutionFailure),
  )
}

async function executeFanout(
  ctx: Context,
  catalog: CompiledCatalog,
  primitive: FanoutPrimitive,
  prompt: string,
  parent: Agent,
  signal: AbortSignal,
  claimTerminalFailure: () => void,
): Promise<{
  artifact?: MaterializedStrategyArtifact
  failures: StrategyMemberFailure[]
}> {
  let failedMembers = 0
  const maximumToleratedFailures = primitive.count - primitive.minSuccess
  const settled = await Promise.all(Array.from({ length: primitive.count }, async (_, index) => {
    let memberFailed = false
    const markFailure = () => {
      if (memberFailed) return
      memberFailed = true
      failedMembers += 1
      if (failedMembers > maximumToleratedFailures) claimTerminalFailure()
    }
    try {
      return {
        index,
        value: await executeOne(
          ctx,
          catalog,
          primitive,
          `${prompt}\n\nPanel member: ${String(index + 1)}`,
          parent,
          signal,
          markFailure,
        ),
      }
    } catch (error: unknown) {
      markFailure()
      return { index, error }
    }
  }))
  const failures = settled.flatMap(item => 'error' in item
    ? [failure(primitive, 'MEMBER_FAILED', item.error, item.index)]
    : [])
  const values = settled.flatMap(item => 'value' in item ? [item.value] : [])
  if (values.length < primitive.minSuccess) return { failures }
  const definition: CompiledArtifact = failures.length === 0
    ? { ...primitive.output, availability: 'required' }
    : primitive.output
  return {
    artifact: materializedArtifact(definition, values),
    failures,
  }
}

/** Execute a static compiled plan through real DSH one-shot subagent primitives. */
export async function executeStrategyPlan(
  ctx: Context,
  snapshot: StrategyExecutionSnapshot,
  plan: CompiledStrategyPlan,
  parent: Agent,
  parentSignal: AbortSignal,
): Promise<TeamRunOutcome> {
  const { profiles: catalog, orchestration } = snapshot
  if (snapshot.kind !== 'strategy-execution-snapshot'
    || snapshot.catalogDigest !== orchestration.digest
    || snapshot.profilePolicyDigest !== catalog.policyDigest
    || snapshot.profileCatalogDigest !== catalog.catalogDigest
    || orchestration.profilePolicyDigest !== catalog.policyDigest
    || orchestration.profileCatalogDigest !== catalog.catalogDigest) {
    throw new Error('dsh-legion: invalid Strategy execution snapshot generation')
  }
  assertCompiledStrategyPlan(plan)
  if (plan.catalogDigest !== orchestration.digest) {
    throw new Error('dsh-legion: Strategy Plan catalog generation does not match execution snapshot')
  }
  if (plan.profilePolicyDigest !== catalog.policyDigest) {
    throw new Error('dsh-legion: Strategy Plan Profile policy does not match execution catalog')
  }
  const deadline = combinedSignal(parentSignal, plan.limits.deadlineMs)
  const terminal = new TerminalArbiter()
  const claimCancellation = () => { terminal.claim('cancelled') }
  if (deadline.signal.aborted) claimCancellation()
  else deadline.signal.addEventListener('abort', claimCancellation, { once: true })
  const artifacts = new Map<string, MaterializedStrategyArtifact>()
  const failures: StrategyMemberFailure[] = []
  let outputBytes = 0
  try {
    for (const primitive of plan.primitives) {
      deadline.signal.throwIfAborted()
      const prompt = renderPrompt(primitive, plan.objective, artifacts)
      if (primitive.kind === 'dsh-subagent-fanout') {
        const fanout = await executeFanout(
          ctx,
          catalog,
          primitive,
          prompt,
          parent,
          deadline.signal,
          () => { terminal.claim('failed') },
        )
        failures.push(...fanout.failures)
        if (fanout.artifact === undefined) {
          throw new PrimitiveFailure(failure(primitive, 'MIN_SUCCESS_UNSATISFIED', 'fanout did not reach minSuccess'))
        }
        if (outputBytes + fanout.artifact.bytes > plan.limits.maxOutputBytes) {
          throw new PrimitiveFailure(failure(primitive, 'OUTPUT_LIMIT_EXCEEDED', 'strategy output limit exceeded'))
        }
        artifacts.set(fanout.artifact.name, fanout.artifact)
        outputBytes += fanout.artifact.bytes
      } else {
        let artifact: MaterializedStrategyArtifact
        try {
          const value = await executeOne(
            ctx,
            catalog,
            primitive,
            prompt,
            parent,
            deadline.signal,
            () => { terminal.claim('failed') },
          )
          artifact = materializedArtifact(primitive.output, value)
        } catch (error: unknown) {
          throw new PrimitiveFailure(failure(primitive, 'MEMBER_FAILED', error))
        }
        if (outputBytes + artifact.bytes > plan.limits.maxOutputBytes) {
          throw new PrimitiveFailure(failure(primitive, 'OUTPUT_LIMIT_EXCEEDED', 'strategy output limit exceeded'))
        }
        artifacts.set(artifact.name, artifact)
        outputBytes += artifact.bytes
      }
    }
    const final = artifacts.get(String(plan.completion.artifact))
    if (final === undefined) {
      throw new PrimitiveFailure({
        stage: 'completion',
        member: 'none',
        code: 'COMPLETION_ARTIFACT_MISSING',
        message: `completion artifact "${plan.completion.artifact}" is missing`,
      })
    }
    const list = [...artifacts.values()]
    const firstFailure = failures[0]
    if (firstFailure !== undefined && plan.memberFailure === 'fail') {
      throw new PrimitiveFailure(firstFailure)
    }
    const kind = failures.length === 0 ? 'completed' : 'degraded'
    if (!terminal.claim(kind)) {
      return deepFreeze({
        kind: 'cancelled',
        planDigest: plan.planDigest,
        artifacts: list,
        reason: boundedMessage(deadline.signal.reason),
      })
    }
    return deepFreeze(kind === 'completed'
      ? { kind, planDigest: plan.planDigest, artifacts: list, final }
      : { kind, planDigest: plan.planDigest, artifacts: list, final, failures })
  } catch (error: unknown) {
    const list = [...artifacts.values()]
    if (terminal.value === 'cancelled'
      || (terminal.value === undefined && deadline.signal.aborted)) {
      terminal.claim('cancelled')
      return deepFreeze({
        kind: 'cancelled',
        planDigest: plan.planDigest,
        artifacts: list,
        reason: boundedMessage(deadline.signal.reason),
      })
    }
    const memberFailure = error instanceof PrimitiveFailure
      ? error.failure
      : {
          stage: 'execution',
          member: 'unknown',
          code: 'EXECUTION_FAILED',
          message: boundedMessage(error),
        }
    terminal.claim('failed')
    return deepFreeze({ kind: 'failed', planDigest: plan.planDigest, artifacts: list, failure: memberFailure })
  } finally {
    deadline.signal.removeEventListener('abort', claimCancellation)
    deadline.dispose()
  }
}
