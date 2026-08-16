import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import {
  ArtifactDigest,
  ContextDigest,
  ContextGeneration,
  Fence,
  MailId,
  ReservationId,
  RunId,
  TaskId,
  type MailMessage,
  type OwnerFingerprint,
} from '../src/durable-run/contract.ts'
import {
  EMPTY_MAILBOX_STATE,
  deliverReservedMail,
  transitionMail,
} from '../src/durable-run/mailbox.ts'
import { foldLegionProjection, viewLegionRun } from '../src/durable-run/projection.ts'
import { validateLegionEventData } from '../src/durable-run/validate.ts'
import { exportedEvent, pendingRun, planVersion } from './durable-fixture.ts'

function digest(character: string) {
  return ArtifactDigest(`sha256:${character.repeat(64)}`)
}

const owner: OwnerFingerprint = {
  hostInstanceId: 'host',
  processBootId: 'boot',
  pluginGeneration: 'plugin',
  anchorSessionId: 'session',
  activationId: 'activation',
}

function message(payload = digest('a')): MailMessage {
  return {
    mailId: MailId('mail-one'),
    runId: RunId('run-one'),
    sender: { kind: 'controller', id: 'controller-one' },
    recipientTaskId: TaskId('task-one'),
    kind: 'evidence',
    payload: [{
      name: 'evidence',
      digest: payload,
      mediaType: 'text/plain',
      byteLength: 4,
    }],
    idempotencyKey: 'delivery-one',
    createdAt: 1,
  }
}

function queued() {
  return transitionMail(EMPTY_MAILBOX_STATE, {
    kind: 'enqueue',
    message: message(),
    recipientGeneration: 1,
    now: 1,
  }).state
}

function reserved() {
  return transitionMail(queued(), {
    kind: 'reserve',
    mailId: MailId('mail-one'),
    recipientGeneration: 1,
    reservationId: ReservationId('reservation-one'),
    owner,
    fence: Fence(2),
    now: 2,
    expiresAt: 10,
  }).state
}

const manifestDigest = ContextDigest(`sha256:${'c'.repeat(64)}`)
const prefixDigest = ContextDigest(`sha256:${'d'.repeat(64)}`)

function incorporation() {
  return {
    kind: 'incorporate' as const,
    mailId: MailId('mail-one'),
    recipientGeneration: 1,
    reservationId: ReservationId('reservation-one'),
    fence: Fence(2),
    contextGeneration: ContextGeneration(1),
    contextManifestDigest: manifestDigest,
    sharedPrefixDigest: prefixDigest,
    incorporatedArtifactDigests: [digest('a')],
    now: 3,
  }
}

describe('durable mailbox', () => {
  it('resends idempotently and rejects conflicting payload', () => {
    const first = queued()
    expect(transitionMail(first, {
      kind: 'enqueue',
      message: message(),
      recipientGeneration: 1,
      now: 2,
    }).kind).toBe('idempotent')
    expect(() => transitionMail(first, {
      kind: 'enqueue',
      message: message(digest('b')),
      recipientGeneration: 1,
      now: 2,
    })).toThrow(/IDEMPOTENCY_CONFLICT/)
  })

  it('reclaims only expired reservations under a current fence', () => {
    const state = reserved()
    expect(() => transitionMail(state, {
      kind: 'reclaim',
      mailId: MailId('mail-one'),
      recipientGeneration: 1,
      currentFence: Fence(2),
      now: 9,
    })).toThrow(/ACTIVE/)
    expect(() => transitionMail(state, {
      kind: 'reclaim',
      mailId: MailId('mail-one'),
      recipientGeneration: 1,
      currentFence: Fence(1),
      now: 10,
    })).toThrow(/FENCE_STALE/)
    expect(transitionMail(state, {
      kind: 'reclaim',
      mailId: MailId('mail-one'),
      recipientGeneration: 1,
      currentFence: Fence(3),
      now: 10,
    }).record).toMatchObject({ status: 'queued', reclaimCount: 1 })
  })

  it('incorporates once before acknowledgement and validates replay identity', () => {
    expect(() => transitionMail(reserved(), {
      kind: 'acknowledge',
      mailId: MailId('mail-one'),
      recipientGeneration: 1,
      reservationId: ReservationId('reservation-one'),
      fence: Fence(2),
      contextManifestDigest: manifestDigest,
      now: 4,
    })).toThrow(/NOT_INCORPORATED/)
    const incorporated = transitionMail(reserved(), incorporation())
    expect(transitionMail(incorporated.state, incorporation()).kind).toBe('idempotent')
    expect(() => transitionMail(incorporated.state, {
      ...incorporation(),
      fence: Fence(1),
    })).toThrow(/FENCE_STALE/)
    const acknowledged = transitionMail(incorporated.state, {
      kind: 'acknowledge',
      mailId: MailId('mail-one'),
      recipientGeneration: 1,
      reservationId: ReservationId('reservation-one'),
      fence: Fence(2),
      contextManifestDigest: manifestDigest,
      now: 4,
    })
    expect(acknowledged.record.status).toBe('acknowledged')
  })


  it('replays mail post-state into deterministic status counts and context digests', () => {
    const queuedResult = transitionMail(EMPTY_MAILBOX_STATE, {
      kind: 'enqueue',
      message: message(),
      recipientGeneration: 1,
      now: 1,
    })
    const reservedResult = transitionMail(queuedResult.state, {
      kind: 'reserve',
      mailId: MailId('mail-one'),
      recipientGeneration: 1,
      reservationId: ReservationId('reservation-one'),
      owner,
      fence: Fence(2),
      now: 2,
      expiresAt: 10,
    })
    const incorporatedResult = transitionMail(reservedResult.state, incorporation())
    const acknowledgedResult = transitionMail(incorporatedResult.state, {
      kind: 'acknowledge',
      mailId: MailId('mail-one'),
      recipientGeneration: 1,
      reservationId: ReservationId('reservation-one'),
      fence: Fence(2),
      contextManifestDigest: manifestDigest,
      now: 4,
    })
    const records = [
      queuedResult.record,
      reservedResult.record,
      incorporatedResult.record,
      acknowledgedResult.record,
    ]
    const events: SessionEvent[] = [
      exportedEvent(pendingRun(), 0) as unknown as SessionEvent,
      ...records.map((record, index) => ({
        type: 'legion/mail-state',
        seq: index + 1,
        time: index + 2,
        data: validateLegionEventData('legion/mail-state', {
          schemaVersion: 1,
          runId: RunId('run-one'),
          planVersion,
          correlationId: 'mail-replay',
          taskId: TaskId('task-one'),
          mailId: MailId('mail-one'),
          recipientGeneration: record.recipientGeneration,
          ...(record.status === 'reserved'
            || record.status === 'incorporated'
            || record.status === 'acknowledged'
            ? { fence: record.reservation.fence }
            : {}),
          record,
        }),
      } as SessionEvent)),
    ]
    const view = viewLegionRun(
      foldLegionProjection(events),
      RunId('run-one'),
    )
    expect(view.mailCounts).toEqual({
      queued: 0, reserved: 0, incorporated: 0, acknowledged: 1, discarded: 0,
    })
    expect(view.latestContextDigest).toBe(manifestDigest)
    expect(view.latestSharedPrefixDigest).toBe(prefixDigest)
  })

  it('requires matching generation and fence for discard', () => {
    expect(() => transitionMail(reserved(), {
      kind: 'discard',
      mailId: MailId('mail-one'),
      recipientGeneration: ContextGeneration(1),
      fence: Fence(1),
      reason: 'policy',
      now: 3,
    })).toThrow(/MAIL_FENCE_STALE/)
    expect(transitionMail(reserved(), {
      kind: 'discard',
      mailId: MailId('mail-one'),
      recipientGeneration: ContextGeneration(1),
      fence: Fence(2),
      reason: 'policy',
      now: 3,
    }).record.status).toBe('discarded')
  })

  it('orders reserve, manifest, incorporation, and ack around durability barriers', async () => {
    const calls: string[] = []
    await deliverReservedMail({
      reserve() { calls.push('reserve') },
      buildManifest() { calls.push('manifest') },
      flush() { calls.push('flush'); return true },
      incorporate() { calls.push('incorporate') },
      acknowledge() { calls.push('ack') },
    })
    expect(calls).toEqual([
      'reserve', 'manifest', 'flush', 'incorporate', 'flush', 'ack', 'flush',
    ])
  })

  it('does not acknowledge when incorporation durability fails', async () => {
    const calls: string[] = []
    let flushes = 0
    await expect(deliverReservedMail({
      reserve() { calls.push('reserve') },
      buildManifest() { calls.push('manifest') },
      flush() { flushes += 1; calls.push('flush'); return flushes === 1 },
      incorporate() { calls.push('incorporate') },
      acknowledge() { calls.push('ack') },
    })).rejects.toThrow(/DURABILITY_UNAVAILABLE/)
    expect(calls).toEqual(['reserve', 'manifest', 'flush', 'incorporate', 'flush'])
  })
})
