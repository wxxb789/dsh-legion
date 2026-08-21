import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { deepCopy, deepFreeze } from '../internal/value.ts'
import { RunId, type AttemptRecord, type MilestoneReceipt, type TaskRecord } from './contract.ts'
import {
  LEGION_RUN_PROJECTION_STATE_VERSION,
  foldLegionProjection,
  legionRunProjection,
  viewLegionRun,
  type LegionProjectionState,
  type LegionRunProjectionView,
} from './projection.ts'
import { parseExportedSessionEvent } from './validate.ts'

export function projectLegionRun(
  events: readonly SessionEvent[],
  runId: RunId,
): LegionRunProjectionView {
  return viewLegionRun(foldLegionProjection(events), runId)
}

export interface LegionProjectionCheckpoint {
  readonly stateVersion: number
  readonly state: LegionProjectionState
}

export function restoreLegionProjection(
  checkpoint: LegionProjectionCheckpoint | undefined,
  tail: readonly SessionEvent[],
  full: readonly SessionEvent[],
): LegionProjectionState {
  if (checkpoint?.stateVersion === LEGION_RUN_PROJECTION_STATE_VERSION) {
    const state = legionRunProjection.stateSchema.parse(checkpoint.state)
    return foldLegionProjection(tail, state)
  }
  return foldLegionProjection(full)
}

export interface InspectFilter {
  readonly limit?: number
  readonly taskId?: string
  readonly attemptId?: string
}

export interface LegionRunExplainView extends LegionRunProjectionView {
  readonly tasks: readonly TaskRecord[]
  readonly attempts: readonly AttemptRecord[]
  readonly milestones: readonly MilestoneReceipt[]
  readonly currentStep?: number
  readonly retiredRisks: readonly string[]
  readonly nextDecision?: MilestoneReceipt['nextDecision']
  readonly decisionSummary?: string
  readonly truncated: boolean
}

function compareIdentity(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function explainLegionRun(
  state: LegionProjectionState,
  runId: RunId,
  filter: InspectFilter = {},
): LegionRunExplainView {
  const summary = viewLegionRun(state, runId)
  const projected = state.runs[runId]
  const limit = Math.min(100, Math.max(1, filter.limit ?? 20))
  const allTasks = Object.values(projected?.tasks ?? {})
    .filter(task => filter.taskId === undefined || task.taskId === filter.taskId)
    .sort((left, right) => compareIdentity(left.taskId, right.taskId))
  const allAttempts = Object.values(projected?.attempts ?? {})
    .filter(attempt => filter.attemptId === undefined || attempt.attemptId === filter.attemptId)
    .sort((left, right) => compareIdentity(left.attemptId, right.attemptId))
  const allMilestones = projected?.milestones ?? []
  const milestones = allMilestones.slice(-limit)
  const latestMilestone = allMilestones.at(-1)

  return deepFreeze({
    ...deepCopy(summary),
    tasks: allTasks.slice(0, limit).map(deepCopy),
    attempts: allAttempts.slice(0, limit).map(deepCopy),
    milestones: milestones.map(deepCopy),
    ...(latestMilestone === undefined ? {} : {
      currentStep: latestMilestone.step,
      nextDecision: latestMilestone.nextDecision,
      decisionSummary: latestMilestone.decisionSummary,
    }),
    retiredRisks: [...new Set(allMilestones.flatMap(item => item.retiredRisks))],
    truncated: allTasks.length > limit || allAttempts.length > limit || allMilestones.length > limit,
  })
}

export function parseExportedSessionEvents(source: string): SessionEvent[] {
  const events: SessionEvent[] = []
  let previousSeq: number | undefined
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (line.trim().length === 0) continue
    let input: unknown
    try {
      input = JSON.parse(line) as unknown
    } catch (error: unknown) {
      throw new Error(`dsh-legion: invalid exported event JSON at line ${index + 1}: ${String(error)}`)
    }
    const event = parseExportedSessionEvent(input)
    if (previousSeq !== undefined && event.seq !== previousSeq + 1) {
      throw new Error(`dsh-legion: exported event seq ${event.seq} is not contiguous after ${previousSeq}`)
    }
    previousSeq = event.seq
    events.push(event)
  }
  return events
}

export function renderLegionRunHuman(view: LegionRunExplainView): string {
  if (!view.found) return `Durable Strategy Run ${view.runId} not found.\n`
  return [
    `Durable Strategy Run ${view.runId}`,
    `Status: ${view.run?.status ?? 'unknown'}`,
    `Plan version: ${view.run?.currentPlanVersion ?? 'unknown'}`,
    `Tasks: ${view.counts.tasks}; attempts: ${view.counts.attempts}`,
    '',
  ].join('\n')
}

export function replayExportedSessionEvents(
  source: string,
  run: unknown,
): LegionRunExplainView {
  const runId = RunId(run)
  const events = parseExportedSessionEvents(source)
  return explainLegionRun(foldLegionProjection(events), runId)
}
