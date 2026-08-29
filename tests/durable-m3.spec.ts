import { describe, expect, it } from 'vitest'
import {
  AttemptId,
  Fence,
  RunCoordinationAdapter,
  RunId,
  TaskId,
  assertDurableMutationAvailable,
  compileDurableCapabilities,
  decideResultAcceptance,
  detectDurableCapabilities,
  materializeLeaseAcquireResult,
  parseRunControlInput,
  planRecovery,
  type AttemptRecord,
  type OwnerFingerprint,
  type ResultEnvelope,
  type RunCoordination,
  type RunLease,
  type RunRecord,
  type TaskRecord,
} from '../src/index.ts'
import {
  attemptRecord,
  runId,
  runRecord,
  taskId,
  taskRecord,
} from './durable-fixture.ts'

const owner: OwnerFingerprint = {
  hostInstanceId: 'host',
  processBootId: 'boot',
  pluginGeneration: 'plugin',
  anchorSessionId: 'session-one',
  activationId: 'activation',
}

function lease(overrides: Partial<RunLease> = {}): RunLease {
  return {
    leaseId: 'lease-one',
    runId,
    owner,
    fence: Fence(2),
    acquiredAt: 1,
    renewAfter: 2,
    expiresAt: 3,
    ...overrides,
  }
}

function result(
  attempt: AttemptRecord = attemptRecord,
  overrides: Partial<ResultEnvelope> = {},
): ResultEnvelope {
  return {
    schemaVersion: 1,
    runId,
    taskId: attempt.taskId,
    attemptId: attempt.attemptId,
    planVersion: attempt.planVersion,
    generation: attempt.generation,
    fence: attempt.fence,
    routePlanDigest: attempt.routePlanDigest,
    environmentDigest: attempt.environmentDigest,
    ...(attempt.contextDigest === undefined ? {} : { contextDigest: attempt.contextDigest }),
    summary: 'Bounded result.',
    artifacts: [],
    evidence: [],
    decisions: [],
    verification: [],
    openRisks: [],
    progress: {},
    ...overrides,
  }
}

describe('durable Host capabilities', () => {
  it('fails durable mutation closed while preserving optional diagnostics', () => {
    const snapshot = compileDurableCapabilities({
      flush: async () => true,
      projection: {},
    })
    expect(snapshot.durableMutation).toBe(false)
    expect(snapshot.diagnostics).toContain('LEGION_DURABLE_COORDINATION_UNAVAILABLE')
    expect(snapshot.diagnostics).toContain('LEGION_GLOBAL_ADMISSION_UNAVAILABLE')
    expect(() => assertDurableMutationAvailable(snapshot))
      .toThrow(/LEGION_DURABLE_COORDINATION_UNAVAILABLE/)
  })

  it('feature-detects only complete structural Host services', () => {
    const capabilities = detectDurableCapabilities({
      get(key) {
        if (key === 'sessions') return { flush() {} }
        if (key === 'sessionProjections') return { register() {} }
        if (key === 'legionRunCoordination') {
          return { acquire() {}, renew() {}, assert() {}, release() {} }
        }
        return undefined
      },
    })
    expect(capabilities.durableMutation).toBe(true)
    expect(capabilities.globalAdmission.kind).toBe('unavailable')
  })
})

describe('Host lease boundary', () => {
  it('strictly validates detached Host lease responses', () => {
    expect(materializeLeaseAcquireResult({ kind: 'granted', lease: lease() }))
      .toEqual({ kind: 'granted', lease: lease() })
    expect(() => materializeLeaseAcquireResult({
      kind: 'granted',
      lease: lease({ acquiredAt: 3, renewAfter: 2, expiresAt: 1 }),
    })).toThrow(/time ordering/)
    expect(() => materializeLeaseAcquireResult({
      kind: 'granted',
      lease: { ...lease(), owner: { ...owner, hostInstanceId: 5 } },
    })).toThrow(/hostInstanceId/)
    expect(() => materializeLeaseAcquireResult({
      kind: 'granted',
      lease: lease(),
      surprise: true,
    })).toThrow(/fields/)
  })

  it('rejects Host identity and fence changes during acquisition and renewal', async () => {
    const host: RunCoordination = {
      async acquire() {
        return { kind: 'granted', lease: lease({ runId: RunId('other') }) }
      },
      async renew(request) {
        return {
          kind: 'current',
          lease: lease({ ...request.lease, fence: Fence(Number(request.lease.fence) + 1) }),
        }
      },
      async assert(request) {
        return { kind: 'current', lease: lease({ ...request, leaseId: 'lease-one' }) }
      },
      async release() {},
    }
    const adapter = new RunCoordinationAdapter(host)
    await expect(adapter.acquire({
      runId,
      anchorSessionId: 'session-one',
      owner,
      ttlMs: 100,
      observedJournalSeq: 7,
    })).rejects.toThrow(/identity/)
    await expect(adapter.renew({ lease: lease(), ttlMs: 100 }))
      .rejects.toThrow(/safety identity/)
  })
})

describe('effect-aware recovery', () => {
  it('sorts actions and applies all ambiguity rules deterministically', () => {
    const writeAttempt: AttemptRecord = {
      ...attemptRecord,
      attemptId: AttemptId('attempt-write'),
      taskId: TaskId('write'),
      effectClass: 'idempotent-write',
      idempotencyKey: 'same-key',
      fence: Fence(3),
      owner,
    }
    const plan = planRecovery({
      tasks: [
        {
          taskId: TaskId('write'),
          generation: 1,
          terminal: false,
          effectClass: 'idempotent-write',
          attempt: writeAttempt,
        },
        {
          taskId: TaskId('unsafe'),
          generation: 1,
          terminal: false,
          effectClass: 'non-idempotent-write',
        },
        {
          taskId: TaskId('read'),
          generation: 1,
          terminal: false,
          effectClass: 'read',
        },
      ],
      receipts: {},
      baseJournalSeq: 7,
      fence: Fence(3),
      owner,
    })
    expect(plan.actions.map(action => [action.kind, action.taskId])).toEqual([
      ['retry', 'read'],
      ['needs-attention', 'unsafe'],
      ['abandon-attempt', 'write'],
      ['retry', 'write'],
    ])
    expect(plan.actions.at(-1)).toMatchObject({ idempotencyKey: 'same-key' })
    expect(() => planRecovery({
      tasks: [],
      receipts: {},
      baseJournalSeq: -1,
      fence: Fence(3),
      owner,
    })).toThrow(/journal sequence/)
  })

  it('incorporates only a receipt bound to the active attempt and fence', () => {
    const active = { ...attemptRecord, fence: Fence(4), owner }
    const task = {
      taskId,
      generation: active.generation,
      terminal: false,
      effectClass: 'read' as const,
      attempt: active,
    }
    const accepted = planRecovery({
      tasks: [task],
      receipts: { [taskId]: { kind: 'proven', result: result(active) } },
      baseJournalSeq: 8,
      fence: Fence(5),
      owner,
    })
    expect(accepted.fence).toBe(5)
    expect(accepted.actions[0]).toMatchObject({ kind: 'incorporate-receipt' })

    const stale = planRecovery({
      tasks: [task],
      receipts: {
        [taskId]: {
          kind: 'proven',
          result: result(active, { fence: Fence(3) }),
        },
      },
      baseJournalSeq: 8,
      fence: Fence(4),
      owner,
    })
    expect(stale.actions[0]).toMatchObject({ kind: 'reject-stale-result' })
  })
})

describe('result fencing', () => {
  const activeAttempt: AttemptRecord = {
    ...attemptRecord,
    generation: 2,
    fence: Fence(4),
    owner,
    status: 'started',
  }
  const runningTask: TaskRecord = {
    ...taskRecord,
    generation: 2,
    currentAttempt: activeAttempt.attemptId,
    status: 'running',
  }
  const envelope = result(activeAttempt)

  it('accepts only the current matching task, attempt, fence, and digests', () => {
    expect(decideResultAcceptance({
      run: runRecord,
      task: runningTask,
      attempt: activeAttempt,
      activeFence: Fence(4),
      result: envelope,
      contractValid: true,
    })).toEqual({ kind: 'accept' })
    expect(decideResultAcceptance({
      run: runRecord,
      task: runningTask,
      attempt: activeAttempt,
      activeFence: Fence(5),
      result: envelope,
      contractValid: true,
    })).toEqual({ kind: 'reject', code: 'fence-stale' })
    expect(decideResultAcceptance({
      run: runRecord,
      task: { ...runningTask, taskId: TaskId('other') },
      attempt: activeAttempt,
      activeFence: Fence(4),
      result: envelope,
      contractValid: true,
    })).toEqual({ kind: 'reject', code: 'task-missing' })
    for (const status of ['succeeded', 'failed', 'cancelled', 'superseded', 'blocked'] satisfies TaskRecord['status'][]) {
      expect(decideResultAcceptance({
        run: runRecord,
        task: { ...runningTask, status },
        attempt: activeAttempt,
        activeFence: Fence(4),
        result: envelope,
        contractValid: true,
      }), status).toEqual({ kind: 'reject', code: 'task-terminal' })
    }
    for (const status of ['completed', 'degraded', 'cancelled', 'failed'] satisfies RunRecord['status'][]) {
      expect(decideResultAcceptance({
        run: { ...runRecord, status },
        task: runningTask,
        attempt: activeAttempt,
        activeFence: Fence(4),
        result: envelope,
        contractValid: true,
      }), status).toEqual({ kind: 'reject', code: 'task-terminal' })
    }
    for (const status of ['settled', 'abandoned', 'rejected-stale'] satisfies AttemptRecord['status'][]) {
      expect(decideResultAcceptance({
        run: runRecord,
        task: runningTask,
        attempt: { ...activeAttempt, status },
        activeFence: Fence(4),
        result: envelope,
        contractValid: true,
      }), status).toEqual({ kind: 'reject', code: 'task-terminal' })
    }
  })
})

describe('run-control input', () => {
  it('parses only the closed inspect, resume, and cancel vocabulary', () => {
    expect(parseRunControlInput({ kind: 'run', action: 'inspect', runId }))
      .toEqual({ kind: 'run', action: 'inspect', runId })
    expect(() => parseRunControlInput({ kind: 'run', action: 'steer', runId }))
      .toThrow(/RUN_CONTROL_INVALID/)
    expect(() => parseRunControlInput({ kind: 'run', action: 'cancel', runId, message: 'x' }))
      .toThrow(/RUN_CONTROL_INVALID/)
    expect(() => parseRunControlInput(Object.assign(Object.create(null), {
      kind: 'run', action: 'inspect', runId,
    }))).not.toThrow()
  })
})
