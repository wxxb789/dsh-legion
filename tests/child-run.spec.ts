import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import { settleChildRun } from '../src/child-run.ts'

const completed: SubagentResult = {
  output: [{ type: 'text', text: 'done' }],
  stopReason: 'completed',
}

function run(options: {
  result?: Promise<SubagentResult>
  dispose?: () => Promise<void>
} = {}): SubagentRun {
  return {
    id: SessionId('child-run-lifecycle'),
    localAgent: undefined,
    result: options.result ?? Promise.resolve(completed),
    dispose: options.dispose ?? (() => Promise.resolve()),
  }
}

describe('ChildRunLifecycle', () => {
  it('does not call provider admission when signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort('pre-aborted')
    let starts = 0
    const settlement = await settleChildRun({
      signal: controller.signal,
      start: async () => { starts += 1; return run() },
    })
    expect(settlement).toMatchObject({
      execution: { kind: 'cancelled', reason: 'pre-aborted' },
      cleanup: { kind: 'quiescent' },
    })
    expect(starts).toBe(0)
  })

  it('returns cancellation when admission ignores abort and owns a late-published run', async () => {
    const publication = Promise.withResolvers<SubagentRun>()
    let disposed = 0
    const controller = new AbortController()
    const pending = settleChildRun({ start: () => publication.promise, signal: controller.signal })
    controller.abort('stop admission')
    const settlement = await pending
    expect(settlement).toMatchObject({
      execution: { kind: 'cancelled', reason: 'stop admission' },
      cleanup: { kind: 'pending' },
      cleanupDone: expect.any(Promise),
    })
    publication.resolve(run({ dispose: async () => { disposed += 1 } }))
    await settlement.cleanupDone
    expect(disposed).toBe(1)
  })

  it('does not let abort during cleanup rewrite completed execution', async () => {
    const controller = new AbortController()
    const settlement = await settleChildRun({
      signal: controller.signal,
      start: async () => run({
        dispose: async () => { controller.abort('cleanup abort') },
      }),
    })
    expect(settlement).toMatchObject({
      execution: { kind: 'completed', result: completed },
      cleanup: { kind: 'quiescent' },
    })
  })

  it('reports cleanup pending while retaining final disposal ownership', async () => {
    const disposal = Promise.withResolvers<void>()
    const settlement = await settleChildRun({
      signal: new AbortController().signal,
      cleanupTimeoutMs: 5,
      start: async () => run({ dispose: () => disposal.promise }),
    })
    expect(settlement).toMatchObject({
      execution: { kind: 'completed' },
      cleanup: { kind: 'pending' },
      cleanupDone: expect.any(Promise),
    })
    if (settlement.cleanupDone === undefined) throw new Error('missing cleanup completion owner')
    disposal.reject(new Error('late cleanup rejection'))
    await expect(settlement.cleanupDone).resolves.toMatchObject({
      kind: 'failed', error: expect.any(Error),
    })
  })

  it('retains abnormal execution and cleanup failures separately', async () => {
    const abnormal: SubagentResult = {
      output: [{ type: 'text', text: 'partial' }],
      stopReason: 'error',
    }
    const settlement = await settleChildRun({
      signal: new AbortController().signal,
      start: async () => run({
        result: Promise.resolve(abnormal),
        dispose: () => Promise.reject(new Error('cleanup failed')),
      }),
    })
    expect(settlement.execution).toMatchObject({ kind: 'failed', result: abnormal })
    expect(settlement.cleanup).toMatchObject({ kind: 'failed', error: expect.any(Error) })
  })
})
