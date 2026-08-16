import { describe, expect, it } from 'vitest'
import {
  Fence,
  TaskId,
  planRecovery,
  type AttemptRecord,
  type EffectClass,
  type OwnerFingerprint,
} from '../src/index.ts'
import { attemptRecord } from './durable-fixture.ts'
import { CRASH_CUTS, crashAtCut, recoveryBytes } from './helpers/crash-cut.ts'

const owner: OwnerFingerprint = {
  hostInstanceId: 'host-two',
  processBootId: 'boot-two',
  pluginGeneration: 'plugin',
  anchorSessionId: 'session-one',
  activationId: 'activation-two',
}

const effectClasses: readonly EffectClass[] = [
  'read',
  'idempotent-write',
  'non-idempotent-write',
]

describe('durable recovery crash cuts', () => {
  for (const cut of CRASH_CUTS) {
    for (const effectClass of effectClasses) {
      it('replays ' + effectClass + ' work deterministically at ' + cut, () => {
        const recovered = crashAtCut(cut)
        const events = recovered.events()
        const hasAttempt = events.includes('attempt-prepared')
        const terminal = events.includes('result-settled')
        const attempt = hasAttempt
          ? {
              ...attemptRecord,
              owner,
              effectClass,
              fence: Fence(1),
              ...(effectClass === 'idempotent-write'
                ? { idempotencyKey: 'stable-write-key' }
                : {}),
            } satisfies AttemptRecord
          : undefined
        const input = {
          tasks: [{
            taskId: TaskId('task-one'),
            generation: 1,
            terminal,
            effectClass,
            ...(attempt === undefined ? {} : { attempt }),
          }],
          receipts: {},
          baseJournalSeq: events.length,
          fence: Fence(2),
          owner,
        }
        const first = planRecovery(input)
        const second = planRecovery({
          ...input,
          tasks: [...input.tasks],
          receipts: { ...input.receipts },
        })
        expect(recoveryBytes(first)).toBe(recoveryBytes(second))
        if (terminal) {
          expect(first.actions).toEqual([
            { kind: 'keep-terminal', taskId: TaskId('task-one') },
          ])
        } else if (effectClass === 'read') {
          expect(first.actions.some(action => action.kind === 'retry')).toBe(true)
        } else if (effectClass === 'non-idempotent-write' || !hasAttempt) {
          expect(first.actions.some(action => action.kind === 'needs-attention')).toBe(true)
        } else {
          expect(first.actions).toContainEqual(expect.objectContaining({
            kind: 'retry',
            idempotencyKey: 'stable-write-key',
          }))
        }
      })
    }
  }
})
