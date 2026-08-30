import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { settleChildRun } from './child-run.ts'
import type { JsonValue } from '@deepseek-ai/dsh-tools'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import type { CompiledSpecialistCatalog, DelegationPlan } from './compiler.ts'
import { compileDelegationPlan } from './compiler.ts'
import { assertCompiledStrategyPlan } from './orchestration.ts'
import type {
  CompiledArtifact,
  CompiledOrchestrationCatalog,
  CompiledStrategyPlan,
  DshPrimitive,
  FanoutPrimitive,
} from './orchestration.ts'
import { CohortRunId, type CohortRunId as CohortRunIdType } from './identity.ts'
import { deepFreeze } from './internal/value.ts'
import {
  createRunReceipt,
  finishRunReceipt,
  observeRunReceiptParticipation,
  publishRunReceipt,
  setRunReceiptObservation,
  settleRunReceiptStage,
  summarizeRunReceipt,
  type LiveRunReceipt,
  type RunReceiptChildBinding,
  type RunReceiptFeedStatus,
  type RunReceiptStageStatus,
  type RunReceiptSummary,
} from './run-receipt.ts'
import { materializeStructuredResult } from './result-contract.ts'
import { applyRoutePlan, compileRoutePlan, observeModelRoutes } from './route.ts'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

export const COHORT_RUN_OUTCOMES = Object.freeze(['completed', 'degraded', 'cancelled', 'failed'] as const)
/** @deprecated Use COHORT_RUN_OUTCOMES. */
export const TEAM_RUN_OUTCOMES = COHORT_RUN_OUTCOMES

export interface StrategyExecutionSnapshot {
  readonly kind: 'strategy-execution-snapshot'
  readonly generationId: CompiledOrchestrationCatalog['generationId']
  readonly specialists: CompiledSpecialistCatalog
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

type CohortRunResult =
  | {
      readonly kind: 'completed'
      readonly runId: CohortRunIdType
      readonly planDigest: string
      readonly artifacts: readonly MaterializedStrategyArtifact[]
      readonly final: MaterializedStrategyArtifact
    }
  | {
      readonly kind: 'degraded'
      readonly runId: CohortRunIdType
      readonly planDigest: string
      readonly artifacts: readonly MaterializedStrategyArtifact[]
      readonly final: MaterializedStrategyArtifact
      readonly failures: readonly StrategyMemberFailure[]
    }
  | {
      readonly kind: 'cancelled'
      readonly runId: CohortRunIdType
      readonly planDigest: string
      readonly artifacts: readonly MaterializedStrategyArtifact[]
      readonly reason: string
    }
  | {
      readonly kind: 'failed'
      readonly runId: CohortRunIdType
      readonly planDigest: string
      readonly artifacts: readonly MaterializedStrategyArtifact[]
      readonly failure: StrategyMemberFailure
    }

export type CohortRunOutcome = CohortRunResult & { readonly receipt: RunReceiptSummary }
/** @deprecated Use CohortRunOutcome. */
export type TeamRunOutcome = CohortRunOutcome

type TerminalClaim = CohortRunOutcome['kind']

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

export function createStrategyExecutionSnapshot(
  specialists: CompiledSpecialistCatalog,
  orchestration: CompiledOrchestrationCatalog,
): StrategyExecutionSnapshot {
  if (orchestration.specialistPolicyDigest !== specialists.policyDigest
    || orchestration.specialistCatalogDigest !== specialists.catalogDigest) {
    throw new Error('dsh-legion: orchestration catalog does not match Specialist catalog generation')
  }
  return deepFreeze({
    kind: 'strategy-execution-snapshot',
    generationId: orchestration.generationId,
    specialists,
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
  catalog: CompiledSpecialistCatalog,
  primitive: DshPrimitive,
  prompt: string,
  signal: AbortSignal,
): Promise<DelegationPlan> {
  let plan = compileDelegationPlan(catalog, {
    specialist: String(primitive.specialist),
    description: `${primitive.stage} ${primitive.member}`,
    prompt,
    runInBackground: false,
  })
  const profile = catalog.activeSpecialists[primitive.specialist]
  if (profile === undefined) throw new Error(`Specialist "${primitive.specialist}" is inactive`)
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

type ObserveChild = (
  childId: SessionId,
  agent: Agent | undefined,
  binding: RunReceiptChildBinding,
) => void

async function executeOne(
  ctx: Context,
  catalog: CompiledSpecialistCatalog,
  primitive: DshPrimitive,
  prompt: string,
  parent: Agent,
  signal: AbortSignal,
  claimExecutionFailure?: () => void,
  observeChild?: ObserveChild,
  childIndex = 0,
): Promise<JsonValue> {
  const plan = await delegationPlan(ctx, catalog, primitive, prompt, signal)
  const settlement = await settleChildRun({
    signal,
    onExecution: execution => {
      if (execution.kind === 'failed') claimExecutionFailure?.()
    },
    onLateCleanup: cleanup => {
      if (cleanup.kind !== 'quiescent') {
        ctx.logger.warn(`dsh-legion: late child cleanup ended ${cleanup.kind}`)
      }
    },
    start: async () => {
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
      observeChild?.(run.id, run.localAgent, {
        stage: primitive.stage,
        member: String(primitive.member),
        childIndex,
      })
      return run
    },
  })
  const errors: unknown[] = []
  if (settlement.execution.kind === 'failed') errors.push(settlement.execution.error)
  if (settlement.cleanup.kind === 'failed') errors.push(settlement.cleanup.error)
  if (settlement.cleanup.kind === 'pending') errors.push(new Error('subagent cleanup is still pending'))
  if (errors.length > 0) {
    throw new AggregateError(errors, `Specialist "${plan.specialist}" child execution or cleanup failed`)
  }
  if (settlement.execution.kind === 'cancelled') {
    throw new Error(boundedMessage(settlement.execution.reason))
  }
  if (settlement.execution.kind !== 'completed') {
    throw new Error(`Specialist "${plan.specialist}" child did not complete`)
  }
  return artifactValue(primitive.output, settlement.execution.result)
}

async function executeFanout(
  ctx: Context,
  catalog: CompiledSpecialistCatalog,
  primitive: FanoutPrimitive,
  prompt: string,
  parent: Agent,
  signal: AbortSignal,
  maxConcurrent: number,
  claimTerminalFailure: () => void,
  observeChild: ObserveChild,
): Promise<{
  artifact?: MaterializedStrategyArtifact
  failures: StrategyMemberFailure[]
}> {
  type SettledMember =
    | { readonly index: number; readonly value: JsonValue }
    | { readonly index: number; readonly error: unknown }
  const stageController = new AbortController()
  const abortStage = () => stageController.abort(signal.reason)
  if (signal.aborted) abortStage()
  else signal.addEventListener('abort', abortStage, { once: true })
  const stageSignal = stageController.signal
  let failedMembers = 0
  let nextIndex = 0
  let stopAdmission = false
  const maximumToleratedFailures = primitive.count - primitive.minSuccess
  const settled: Array<SettledMember | undefined> = Array.from({ length: primitive.count })
  const worker = async (): Promise<void> => {
    while (!stageSignal.aborted && !stopAdmission) {
      const index = nextIndex
      nextIndex += 1
      if (index >= primitive.count) return
      let memberFailed = false
      const markFailure = () => {
        if (memberFailed) return
        memberFailed = true
        failedMembers += 1
        if (failedMembers > maximumToleratedFailures) {
          stopAdmission = true
          claimTerminalFailure()
          stageController.abort('fanout minSuccess became impossible')
        }
      }
      try {
        settled[index] = {
          index,
          value: await executeOne(
            ctx,
            catalog,
            primitive,
            `${prompt}\n\nPanel member: ${String(index + 1)}`,
            parent,
            stageSignal,
            markFailure,
            observeChild,
            index,
          ),
        }
      } catch (error: unknown) {
        markFailure()
        settled[index] = { index, error }
      }
    }
  }
  const workers = Math.max(1, Math.min(primitive.count, maxConcurrent))
  try {
    await Promise.all(Array.from({ length: workers }, worker))
  } finally {
    signal.removeEventListener('abort', abortStage)
  }
  const completed = settled.filter((item): item is SettledMember => item !== undefined)
  const failures = completed.flatMap(item => 'error' in item
    ? [failure(primitive, 'MEMBER_FAILED', item.error, item.index)]
    : [])
  const values = completed.flatMap(item => 'value' in item ? [item.value] : [])
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
): Promise<CohortRunOutcome> {
  const { specialists: catalog, orchestration } = snapshot
  if (snapshot.kind !== 'strategy-execution-snapshot'
    || snapshot.generationId !== orchestration.generationId
    || orchestration.specialistPolicyDigest !== catalog.policyDigest
    || orchestration.specialistCatalogDigest !== catalog.catalogDigest) {
    throw new Error('dsh-legion: invalid Strategy execution snapshot generation')
  }
  assertCompiledStrategyPlan(plan)
  if (plan.generationId !== snapshot.generationId) {
    throw new Error('dsh-legion: Strategy Plan generation does not match execution snapshot')
  }
  const runId = CohortRunId(`team-run-${randomUUID()}`)
  let feed: RunReceiptFeedStatus | undefined
  const publishReceipt = (next: LiveRunReceipt): LiveRunReceipt => {
    const publication = publishRunReceipt(ctx, parent.session, next)
    feed = feed === undefined || feed.status === 'available' ? publication : feed
    return next
  }
  let receipt = publishReceipt(createRunReceipt(plan, runId, parent.session.id))
  const participation = observeRunReceiptParticipation(
    ctx,
    parent,
    receipt.stages.map(stage => stage.id),
    (observation) => {
      receipt = publishReceipt(setRunReceiptObservation(receipt, observation))
    },
  )
  const observeChild: ObserveChild = participation.trackChild.bind(participation)
  const deadline = combinedSignal(parentSignal, plan.limits.deadlineMs)
  const settleStage = (
    stage: string,
    status: Exclude<RunReceiptStageStatus, 'pending'>,
  ): void => {
    participation.sample()
    receipt = publishReceipt(settleRunReceiptStage(receipt, stage, status))
  }
  const finishOutcome = async <Outcome extends CohortRunResult>(outcome: Outcome) => {
    await participation.finish(deadline.signal)
    receipt = publishReceipt(finishRunReceipt(receipt, outcome.kind))
    return deepFreeze({
      ...outcome,
      receipt: summarizeRunReceipt(
        receipt,
        feed ?? { status: 'unavailable', failure: 'publisher-unavailable' },
      ),
    })
  }
  const terminal = new TerminalArbiter()
  const claimCancellation = () => { terminal.claim('cancelled') }
  if (deadline.signal.aborted) claimCancellation()
  else deadline.signal.addEventListener('abort', claimCancellation, { once: true })
  const artifacts = new Map<string, MaterializedStrategyArtifact>()
  const failures: StrategyMemberFailure[] = []
  let outputBytes = 0
  try {
    if (String(plan.completion.artifact) === 'objective') {
      const objective = plan.artifacts.objective
      if (objective === undefined || objective.contract !== 'objective-v1') {
        throw new Error('dsh-legion: Strategy Plan objective artifact is invalid')
      }
      artifacts.set('objective', materializedArtifact(objective, plan.objective))
    }
    for (const primitive of plan.primitives) {
      deadline.signal.throwIfAborted()
      const prompt = renderPrompt(primitive, plan.objective, artifacts)
      if (primitive.kind === 'dsh-subagent-fanout') {
        let fanout: Awaited<ReturnType<typeof executeFanout>>
        try {
          fanout = await executeFanout(
            ctx,
            catalog,
            primitive,
            prompt,
            parent,
            deadline.signal,
            plan.limits.maxConcurrent,
            () => { terminal.claim('failed') },
            observeChild,
          )
        } catch (error: unknown) {
          settleStage(primitive.stage, deadline.signal.aborted ? 'cancelled' : 'failed')
          throw error
        }
        failures.push(...fanout.failures)
        if (fanout.artifact === undefined) {
          settleStage(primitive.stage, deadline.signal.aborted ? 'cancelled' : 'failed')
          throw new PrimitiveFailure(failure(primitive, 'MIN_SUCCESS_UNSATISFIED', 'fanout did not reach minSuccess'))
        }
        if (outputBytes + fanout.artifact.bytes > plan.limits.maxOutputBytes) {
          settleStage(primitive.stage, 'failed')
          throw new PrimitiveFailure(failure(primitive, 'OUTPUT_LIMIT_EXCEEDED', 'strategy output limit exceeded'))
        }
        artifacts.set(fanout.artifact.name, fanout.artifact)
        outputBytes += fanout.artifact.bytes
        settleStage(primitive.stage, fanout.failures.length === 0 ? 'completed' : 'degraded')
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
            observeChild,
          )
          artifact = materializedArtifact(primitive.output, value)
        } catch (error: unknown) {
          settleStage(primitive.stage, deadline.signal.aborted ? 'cancelled' : 'failed')
          throw new PrimitiveFailure(failure(primitive, 'MEMBER_FAILED', error))
        }
        if (outputBytes + artifact.bytes > plan.limits.maxOutputBytes) {
          settleStage(primitive.stage, 'failed')
          throw new PrimitiveFailure(failure(primitive, 'OUTPUT_LIMIT_EXCEEDED', 'strategy output limit exceeded'))
        }
        artifacts.set(artifact.name, artifact)
        outputBytes += artifact.bytes
        settleStage(primitive.stage, 'completed')
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
      if (terminal.value === 'failed') {
        return finishOutcome({
          kind: 'failed',
          runId,
          planDigest: plan.planDigest,
          artifacts: list,
          failure: firstFailure ?? {
            stage: 'execution',
            member: 'unknown',
            code: 'TERMINAL_FAILURE',
            message: 'Strategy execution failed before completion committed.',
          },
        })
      }
      return finishOutcome({
        kind: 'cancelled',
        runId,
        planDigest: plan.planDigest,
        artifacts: list,
        reason: boundedMessage(deadline.signal.reason),
      })
    }
    return finishOutcome(kind === 'completed'
      ? { kind, runId, planDigest: plan.planDigest, artifacts: list, final }
      : { kind, runId, planDigest: plan.planDigest, artifacts: list, final, failures })
  } catch (error: unknown) {
    const list = [...artifacts.values()]
    if (terminal.value === 'cancelled'
      || (terminal.value === undefined && deadline.signal.aborted)) {
      terminal.claim('cancelled')
      return finishOutcome({
        kind: 'cancelled',
        runId,
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
    return finishOutcome({ kind: 'failed', runId, planDigest: plan.planDigest, artifacts: list, failure: memberFailure })
  } finally {
    participation.dispose()
    deadline.signal.removeEventListener('abort', claimCancellation)
    deadline.dispose()
  }
}
