import { describe, expect, it, vi } from 'vitest'
import { LEGION_GLOBAL_ADMISSION_UNAVAILABLE, createAdmissionAdapter } from '../src/durable-run/admission.ts'
import { AttemptId, RunId, TaskId } from '../src/durable-run/contract.ts'
import { groupDispatches } from '../src/durable-run/dispatch.ts'

const digest = (value: string) => 'sha256:' + value.repeat(64)
function item(id: string, patch: Record<string, string> = {}) {
  return {
    taskId: TaskId(id), attemptId: AttemptId('attempt-' + id),
    provider: 'provider', model: 'model', toolsetDigest: digest('a'),
    profileDigest: digest('b'), sharedPrefixDigest: digest('c'), ...patch,
  }
}
function request(weight = 1) {
  return {
    runId: RunId('run-one'), taskId: TaskId('task-a'), attemptId: AttemptId('attempt-a'),
    provider: 'provider', model: 'model', concurrentActivations: weight,
  }
}

describe('dispatch grouping', () => {
  it('groups only the exact five-tuple in deterministic order', () => {
    const groups = groupDispatches([
      item('task-b'), item('task-a'), item('task-c', { model: 'other' }),
    ])
    expect(groups.map(group => group.items.map(value => value.taskId)))
      .toEqual([['task-a', 'task-b'], ['task-c']])
    expect(groups[0]?.key).not.toBe(groups[1]?.key)
    expect(groupDispatches([item('task-a', { toolsetDigest: digest('d') })])[0]?.key)
      .not.toBe(groups[0]?.key)
  })
})

describe('admission adapter', () => {
  it('uses an honest weighted per-run fallback without Host admission', async () => {
    const adapter = createAdmissionAdapter(undefined, { maxConcurrent: 3 })
    expect(adapter.scope).toBe('per-run-conservative')
    expect(adapter.diagnostics).toEqual([LEGION_GLOBAL_ADMISSION_UNAVAILABLE])
    const first = await adapter.reserve(request(2))
    expect(first.kind).toBe('granted')
    expect((await adapter.reserve({ ...request(2), attemptId: AttemptId('attempt-b') })).kind)
      .toBe('denied')
    if (first.kind === 'granted') await adapter.release(first.reservationId)
    expect((await adapter.reserve({ ...request(2), attemptId: AttemptId('attempt-b') })).kind)
      .toBe('granted')
  })

  it('delegates reservation to an available Host contract before start', async () => {
    const reserve = vi.fn(async () => ({ kind: 'granted' as const, reservationId: 'host-one' }))
    const host = {
      reserve,
      reconcile: vi.fn(async () => {}),
      release: vi.fn(async () => {}),
    }
    const adapter = createAdmissionAdapter(host, { maxConcurrent: 1 })
    const result = await adapter.reserve(request())
    expect(adapter.scope).toBe('host-global-admitted')
    expect(result).toEqual({ kind: 'granted', reservationId: 'host-one' })
    expect(reserve).toHaveBeenCalledOnce()
  })
})
