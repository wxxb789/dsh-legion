import type { SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'

export type ChildExecution =
  | { readonly kind: 'completed'; readonly result: SubagentResult }
  | { readonly kind: 'failed'; readonly error: unknown; readonly result?: SubagentResult }
  | { readonly kind: 'cancelled'; readonly reason: unknown }

export type ChildCleanup =
  | { readonly kind: 'quiescent' }
  | { readonly kind: 'failed'; readonly error: unknown }
  | { readonly kind: 'pending' }

export interface ChildRunSettlement {
  readonly execution: ChildExecution
  readonly cleanup: ChildCleanup
  readonly run?: SubagentRun
  readonly cleanupDone?: Promise<ChildCleanup>
}

function observeWithAbort<Value>(
  task: Promise<Value>,
  signal: AbortSignal,
): Promise<Value | { readonly kind: 'aborted'; readonly reason: unknown }> {
  if (signal.aborted) return Promise.resolve({ kind: 'aborted', reason: signal.reason })
  return new Promise(resolve => {
    const abort = () => {
      signal.removeEventListener('abort', abort)
      resolve({ kind: 'aborted', reason: signal.reason })
    }
    signal.addEventListener('abort', abort, { once: true })
    task.then(value => {
      signal.removeEventListener('abort', abort)
      resolve(value)
    })
  })
}

async function cleanupRun(run: SubagentRun, timeoutMs: number): Promise<ChildCleanup> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const disposal = run.dispose().then(
    () => ({ kind: 'quiescent' as const }),
    (error: unknown) => ({ kind: 'failed' as const, error }),
  )
  try {
    return await Promise.race([
      disposal,
      new Promise<{ readonly kind: 'pending' }>(resolve => {
        timer = setTimeout(() => resolve({ kind: 'pending' }), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Own one one-shot child from admission through terminal execution and cleanup.
 * The execution terminal is fixed before cleanup, so cancellation during cleanup
 * cannot rewrite a completed or failed child. Late publication after cancellation
 * is retained by this Module and disposed when it eventually arrives.
 */
export async function settleChildRun(options: {
  readonly start: () => Promise<SubagentRun>
  readonly signal: AbortSignal
  readonly cleanupTimeoutMs?: number
  readonly onExecution?: (execution: ChildExecution) => void
  readonly onLateCleanup?: (cleanup: ChildCleanup) => void
}): Promise<ChildRunSettlement> {
  const cleanupTimeoutMs = options.cleanupTimeoutMs ?? 1000
  if (options.signal.aborted) {
    const execution: ChildExecution = { kind: 'cancelled', reason: options.signal.reason }
    options.onExecution?.(execution)
    return { execution, cleanup: { kind: 'quiescent' } }
  }
  const started = options.start().then(
    run => ({ kind: 'published' as const, run }),
    (error: unknown) => ({ kind: 'failed' as const, error }),
  )
  const admission = await observeWithAbort(started, options.signal)
  if (admission.kind === 'aborted') {
    const cleanupDone = started.then(async result => result.kind === 'published'
      ? cleanupRun(result.run, cleanupTimeoutMs)
      : { kind: 'quiescent' as const })
    if (options.onLateCleanup !== undefined) void cleanupDone.then(options.onLateCleanup)
    const execution: ChildExecution = { kind: 'cancelled', reason: admission.reason }
    options.onExecution?.(execution)
    return { execution, cleanup: { kind: 'pending' }, cleanupDone }
  }
  if (admission.kind === 'failed') {
    const execution: ChildExecution = { kind: 'failed', error: admission.error }
    options.onExecution?.(execution)
    return { execution, cleanup: { kind: 'quiescent' } }
  }

  const run = admission.run
  const resultTask = run.result.then(
    result => ({ kind: 'result' as const, result }),
    (error: unknown) => ({ kind: 'failed' as const, error }),
  )
  const observed = await observeWithAbort(resultTask, options.signal)
  let execution: ChildExecution
  if (observed.kind === 'aborted') {
    execution = { kind: 'cancelled', reason: observed.reason }
  } else if (observed.kind === 'failed') {
    execution = { kind: 'failed', error: observed.error }
  } else if (observed.result.stopReason === 'completed') {
    execution = { kind: 'completed', result: observed.result }
  } else {
    execution = {
      kind: 'failed',
      error: new Error(`child ended with ${observed.result.stopReason}`),
      result: observed.result,
    }
  }
  options.onExecution?.(execution)
  return {
    execution,
    cleanup: await cleanupRun(run, cleanupTimeoutMs),
    run,
  }
}
