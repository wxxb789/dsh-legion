import type { AttemptStatus, RunStatus, TaskStatus } from './contract.ts'

const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set([
  'completed',
  'degraded',
  'cancelled',
  'failed',
])
const TERMINAL_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set([
  'succeeded',
  'failed',
  'cancelled',
  'superseded',
  'blocked',
])
const TERMINAL_ATTEMPT_STATUSES: ReadonlySet<AttemptStatus> = new Set([
  'settled',
  'abandoned',
  'rejected-stale',
])

export function isTerminalRunStatus(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUSES.has(status)
}

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.has(status)
}

export function isTerminalAttemptStatus(status: AttemptStatus): boolean {
  return TERMINAL_ATTEMPT_STATUSES.has(status)
}
