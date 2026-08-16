import { deepFreeze } from '../internal/value.ts'
import type { TaskId } from './contract.ts'
import {
  deriveReadyFrontier,
  type FrontierArtifact,
  type FrontierTaskState,
  type PlanGraph,
  type TaskSpec,
} from './graph.ts'

export interface ActivationCommit {
  readonly taskId: TaskId
  readonly generation: number
  readonly phase: 'prepared' | 'settled'
  readonly outcome?: TaskExecutionOutcome
}

export interface ExecuteTaskRequest {
  readonly task: TaskSpec
  readonly artifacts: Readonly<Record<string, FrontierArtifact>>
  readonly outputByteBudget: number
  readonly signal: AbortSignal
}

export type TaskExecutionOutcome =
  | { readonly kind: 'succeeded'; readonly taskId: TaskId; readonly artifact: FrontierArtifact }
  | { readonly kind: 'failed'; readonly taskId: TaskId; readonly failure: string }
  | { readonly kind: 'cancelled'; readonly taskId: TaskId; readonly reason: string }

export interface ActivationCommitOptions {
  /** Prepared and settled facts must cross the Host durability barrier. */
  readonly flush: true
}

/**
 * Narrow M2 effect port. Its commit implementation owns Session append/flush
 * and its execute implementation delegates child lifecycle to DSH. The
 * interpreter provides no cross-process exclusion itself. Commit implementations
 * must run under the active Host lease/fence.
 */
export interface StaticDagEffectPort {
  /**
   * Prepared commits cross the durability barrier before dispatch. Settled commits
   * must atomically revalidate current attempt/generation/fence and append+flush.
   */
  commit(
    batch: readonly ActivationCommit[],
    options: ActivationCommitOptions,
  ): Promise<void>
  execute(request: ExecuteTaskRequest): Promise<TaskExecutionOutcome>
}

export interface StaticDagActivationInput {
  readonly graph: PlanGraph
  readonly tasks: Readonly<Record<string, FrontierTaskState>>
  readonly artifacts: Readonly<Record<string, FrontierArtifact>>
  /** Cumulative run usage restored from the authoritative projection. */
  readonly usage: {
    readonly startedAgents: number
    readonly acceptedOutputBytes: number
  }
  readonly bounds: {
    /** Logical DAG nodes that may start in this activation. */
    readonly maxStarts: number
    /** Physical child activations admitted concurrently. */
    readonly maxConcurrent: number
  }
  readonly signal: AbortSignal
}

export interface StaticDagActivationResult {
  readonly kind: 'settled' | 'cancelled' | 'idle'
  readonly started: readonly TaskId[]
  readonly outcomes: readonly TaskExecutionOutcome[]
}

function compareTaskId(left: TaskId, right: TaskId): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function canonicalOutcomes(
  outcomes: readonly TaskExecutionOutcome[],
): readonly TaskExecutionOutcome[] {
  return [...outcomes].sort((left, right) => compareTaskId(left.taskId, right.taskId))
}

function validateOutcome(task: TaskSpec, outcome: TaskExecutionOutcome): void {
  if (outcome.taskId !== task.taskId) {
    throw new Error(
      `dsh-legion: task "${task.taskId}" returned outcome for "${outcome.taskId}"`,
    )
  }
  if (outcome.kind !== 'succeeded') return
  const artifact = outcome.artifact
  if (artifact.name !== task.output.artifact
    || artifact.contract !== task.output.contract
    || artifact.collection !== task.output.collection) {
    throw new Error(`dsh-legion: task "${task.taskId}" returned an incompatible artifact`)
  }
  if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0) {
    throw new Error(`dsh-legion: task "${task.taskId}" returned invalid artifact bytes`)
  }
}

/**
 * Advance one bounded, single-caller static DAG activation.
 *
 * This function deliberately does not establish cross-process safety. M3 must
 * wrap this seam with Host-owned coordination before general journal execution.
 */
export async function runStaticDagActivation(
  input: StaticDagActivationInput,
  port: StaticDagEffectPort,
): Promise<StaticDagActivationResult> {
  if (!Number.isSafeInteger(input.bounds.maxStarts) || input.bounds.maxStarts < 1) {
    throw new Error('dsh-legion: activation maxStarts must be a positive safe integer')
  }
  if (!Number.isSafeInteger(input.bounds.maxConcurrent) || input.bounds.maxConcurrent < 1) {
    throw new Error('dsh-legion: activation maxConcurrent must be a positive safe integer')
  }
  if (input.signal.aborted) {
    return deepFreeze({ kind: 'cancelled', started: [], outcomes: [] })
  }

  const frontier = deriveReadyFrontier(input.graph, input.tasks, input.artifacts)
  const startedAgents = input.usage.startedAgents
  const acceptedOutputBytes = input.usage.acceptedOutputBytes
  if (!Number.isSafeInteger(startedAgents) || startedAgents < 0
    || !Number.isSafeInteger(acceptedOutputBytes) || acceptedOutputBytes < 0) {
    throw new Error('dsh-legion: invalid cumulative activation usage')
  }
  let remainingAgents = Math.max(0, input.graph.limits.maxAgents - startedAgents)
  const remainingOutputBytes = Math.max(
    0,
    input.graph.limits.maxOutputBytes - acceptedOutputBytes,
  )
  let remainingConcurrent = Math.min(
    input.graph.limits.maxConcurrent,
    input.bounds.maxConcurrent,
  )
  const admitted: TaskSpec[] = []
  for (const taskId of frontier) {
    const task = input.graph.nodes[taskId]!
    if (admitted.length >= input.bounds.maxStarts) break
    if (task.agentCount > remainingAgents || task.agentCount > remainingConcurrent) continue
    admitted.push(task)
    remainingAgents -= task.agentCount
    remainingConcurrent -= task.agentCount
  }
  if (admitted.length === 0 || remainingOutputBytes === 0) {
    return deepFreeze({ kind: 'idle', started: [], outcomes: [] })
  }

  const prepared = admitted.map(task => ({
    taskId: task.taskId,
    generation: input.tasks[task.taskId]!.generation,
    phase: 'prepared' as const,
  }))
  await port.commit(prepared, { flush: true })
  if (input.signal.aborted) {
    return deepFreeze({ kind: 'cancelled', started: [], outcomes: [] })
  }

  const outputByteBudget = Math.floor(remainingOutputBytes / admitted.length)
  const rawOutcomes = await Promise.all(admitted.map(task => port.execute({
    task,
    artifacts: input.artifacts,
    outputByteBudget,
    signal: input.signal,
  })))
  rawOutcomes.forEach((outcome, index) => {
    validateOutcome(admitted[index]!, outcome)
    if (outcome.kind === 'succeeded' && outcome.artifact.bytes > outputByteBudget) {
      throw new Error('dsh-legion: task outcome exceeded reserved output byte budget')
    }
  })
  const outcomes = canonicalOutcomes(rawOutcomes)
  const acceptedBytes = outcomes.reduce((total, outcome) =>
    total + (outcome.kind === 'succeeded' ? outcome.artifact.bytes : 0), 0)
  if (acceptedOutputBytes + acceptedBytes > input.graph.limits.maxOutputBytes) {
    throw new Error('dsh-legion: static DAG activation output limit exceeded')
  }

  await port.commit(outcomes.map(outcome => ({
    taskId: outcome.taskId,
    generation: input.tasks[outcome.taskId]!.generation,
    phase: 'settled' as const,
    outcome,
  })), { flush: true })
  return deepFreeze({
    kind: input.signal.aborted ? 'cancelled' : 'settled',
    started: admitted.map(task => task.taskId),
    outcomes,
  })
}
