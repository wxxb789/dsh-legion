import type { RecoveryPlan } from '../../src/index.ts'

export type CrashCut =
  | 'after-acquire-before-event'
  | 'after-append-before-flush'
  | 'after-flush-before-start'
  | 'after-start-before-attempt-update'
  | 'after-completion-before-result-commit'
  | 'after-result-commit-before-next-transition'
  | 'after-recovery-append-before-flush'
  | 'after-final-flush-before-return'

export const CRASH_CUTS: readonly CrashCut[] = [
  'after-acquire-before-event',
  'after-append-before-flush',
  'after-flush-before-start',
  'after-start-before-attempt-update',
  'after-completion-before-result-commit',
  'after-result-commit-before-next-transition',
  'after-recovery-append-before-flush',
  'after-final-flush-before-return',
]

export class CrashJournal {
  private durable: string[] = []
  private pending: string[] = []

  append(event: string): void {
    this.pending.push(event)
  }

  flush(): void {
    this.durable.push(...this.pending)
    this.pending = []
  }

  crash(): CrashJournal {
    const next = new CrashJournal()
    next.durable = [...this.durable]
    return next
  }

  events(): readonly string[] {
    return [...this.durable]
  }
}

export function crashAtCut(cut: CrashCut): CrashJournal {
  const journal = new CrashJournal()
  if (cut === 'after-acquire-before-event') return journal.crash()

  journal.append('attempt-prepared')
  if (cut === 'after-append-before-flush') return journal.crash()
  journal.flush()
  if (cut === 'after-flush-before-start'
    || cut === 'after-start-before-attempt-update'
    || cut === 'after-completion-before-result-commit') {
    return journal.crash()
  }

  if (cut === 'after-result-commit-before-next-transition') {
    journal.append('result-settled')
    journal.flush()
    return journal.crash()
  }

  journal.append('recovery-decision')
  if (cut === 'after-recovery-append-before-flush') return journal.crash()
  journal.flush()
  return journal.crash()
}

export function recoveryBytes(plan: RecoveryPlan): string {
  return JSON.stringify(plan)
}
