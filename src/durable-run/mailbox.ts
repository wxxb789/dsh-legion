import { deepCopy, deepFreeze, sha256Digest } from '../internal/value.ts'
import {
  ArtifactDigest,
  type AcknowledgedMailRecord,
  type ContextDigest,
  type ContextGeneration,
  type Fence,
  type IncorporatedMailRecord,
  type MailId,
  type MailMessage,
  type MailRecord,
  type OwnerFingerprint,
  type QueuedMailRecord,
  type ReservationId,
  type ReservedMailRecord,
  trustedRecord,
} from './contract.ts'

export interface MailboxState {
  readonly mail: Readonly<Record<string, MailRecord>>
}

export type MailCommand =
  | { readonly kind: 'enqueue'; readonly message: MailMessage; readonly recipientGeneration: number; readonly now: number }
  | { readonly kind: 'reserve'; readonly mailId: MailId; readonly recipientGeneration: number; readonly reservationId: ReservationId; readonly owner: OwnerFingerprint; readonly fence: Fence; readonly now: number; readonly expiresAt: number }
  | { readonly kind: 'incorporate'; readonly mailId: MailId; readonly recipientGeneration: number; readonly reservationId: ReservationId; readonly fence: Fence; readonly contextGeneration: ContextGeneration; readonly contextManifestDigest: ContextDigest; readonly sharedPrefixDigest: ContextDigest; readonly incorporatedArtifactDigests: readonly ArtifactDigest[]; readonly now: number }
  | { readonly kind: 'acknowledge'; readonly mailId: MailId; readonly recipientGeneration: number; readonly reservationId: ReservationId; readonly fence: Fence; readonly contextManifestDigest: ContextDigest; readonly now: number }
  | { readonly kind: 'reclaim'; readonly mailId: MailId; readonly recipientGeneration: number; readonly currentFence: Fence; readonly now: number }
  | {
      readonly kind: 'discard'
      readonly mailId: MailId
      readonly recipientGeneration: ContextGeneration
      readonly fence?: Fence
      readonly now: number
      readonly reason: 'expired' | 'recipient-terminal' | 'superseded' | 'policy'
    }

export type MailTransitionResult = {
  readonly kind: 'changed' | 'idempotent'
  readonly state: MailboxState
  readonly record: MailRecord
}

function fail(code: string): never {
  throw new Error(`dsh-legion: ${code}`)
}

function natural(value: number, subject: string): void {
  if (!Number.isSafeInteger(value) || value < 0) fail(`MAIL_${subject}_INVALID`)
}

function payloadIdentity(message: MailMessage): string {
  return sha256Digest({ kind: message.kind, payload: message.payload })
}

function put(state: MailboxState, mail: MailRecord): MailboxState {
  return deepFreeze({ mail: { ...state.mail, [mail.message.mailId]: trustedRecord(mail) } })
}

function result(
  kind: 'changed' | 'idempotent',
  state: MailboxState,
  record: MailRecord,
): MailTransitionResult {
  return deepFreeze({ kind, state, record })
}

function changed(state: MailboxState, record: MailRecord): MailTransitionResult {
  return result('changed', put(state, record), record)
}

function assertGeneration(record: MailRecord, generation: number): void {
  if (record.recipientGeneration !== generation) fail('MAIL_GENERATION_STALE')
}

function assertReservation(
  record: ReservedMailRecord | IncorporatedMailRecord | AcknowledgedMailRecord,
  reservationId: ReservationId,
  fence: Fence,
): void {
  if (record.reservation.reservationId !== reservationId) fail('MAIL_RESERVATION_STALE')
  if (record.reservation.fence !== fence) fail('MAIL_FENCE_STALE')
}

function enqueue(
  state: MailboxState,
  command: Extract<MailCommand, { kind: 'enqueue' }>,
): MailTransitionResult {
  natural(command.recipientGeneration, 'GENERATION')
  natural(command.now, 'TIME')
  natural(command.message.createdAt, 'CREATED_AT')
  if (command.message.idempotencyKey.length === 0) fail('MAIL_IDEMPOTENCY_KEY_INVALID')
  if (command.message.expiresAt !== undefined
    && command.message.expiresAt <= command.message.createdAt) fail('MAIL_EXPIRY_INVALID')
  const same = Object.values(state.mail).find(candidate =>
    candidate.message.runId === command.message.runId
    && candidate.message.recipientTaskId === command.message.recipientTaskId
    && candidate.message.idempotencyKey === command.message.idempotencyKey)
  if (same !== undefined) {
    if (payloadIdentity(same.message) !== payloadIdentity(command.message)) {
      fail('MAIL_IDEMPOTENCY_CONFLICT')
    }
    return result('idempotent', state, same)
  }
  if (state.mail[command.message.mailId] !== undefined) fail('MAIL_ID_CONFLICT')
  return changed(state, {
    schemaVersion: 1,
    status: 'queued',
    message: deepCopy(command.message),
    recipientGeneration: command.recipientGeneration,
    reclaimCount: 0,
    updatedAt: command.now,
  })
}

function reserve(
  state: MailboxState,
  current: MailRecord,
  command: Extract<MailCommand, { kind: 'reserve' }>,
): MailTransitionResult {
  if (current.status !== 'queued') fail('MAIL_NOT_QUEUED')
  assertGeneration(current, command.recipientGeneration)
  if (command.expiresAt <= command.now) fail('MAIL_RESERVATION_EXPIRY_INVALID')
  if (current.message.expiresAt !== undefined && current.message.expiresAt <= command.now) {
    fail('MAIL_MESSAGE_EXPIRED')
  }
  return changed(state, {
    ...current,
    status: 'reserved',
    reservation: {
      reservationId: command.reservationId,
      owner: deepCopy(command.owner),
      fence: command.fence,
      reservedAt: command.now,
      expiresAt: command.expiresAt,
    },
    updatedAt: command.now,
  })
}

function reclaim(
  state: MailboxState,
  current: MailRecord,
  command: Extract<MailCommand, { kind: 'reclaim' }>,
): MailTransitionResult {
  if (current.status !== 'reserved') fail('MAIL_NOT_RESERVED')
  assertGeneration(current, command.recipientGeneration)
  if (command.currentFence < current.reservation.fence) fail('MAIL_FENCE_STALE')
  if (command.now < current.reservation.expiresAt) fail('MAIL_RESERVATION_ACTIVE')
  const record: QueuedMailRecord = {
    schemaVersion: 1,
    status: 'queued',
    message: current.message,
    recipientGeneration: current.recipientGeneration,
    reclaimCount: current.reclaimCount + 1,
    updatedAt: command.now,
  }
  return changed(state, record)
}

function incorporate(
  state: MailboxState,
  current: MailRecord,
  command: Extract<MailCommand, { kind: 'incorporate' }>,
): MailTransitionResult {
  if (current.status === 'incorporated' || current.status === 'acknowledged') {
    assertGeneration(current, command.recipientGeneration)
    assertReservation(current, command.reservationId, command.fence)
    if (current.contextManifestDigest === command.contextManifestDigest
      && current.contextGeneration === command.contextGeneration) {
      return result('idempotent', state, current)
    }
    fail('MAIL_ALREADY_INCORPORATED')
  }
  if (current.status !== 'reserved') fail('MAIL_NOT_RESERVED')
  assertGeneration(current, command.recipientGeneration)
  assertReservation(current, command.reservationId, command.fence)
  const incorporated = new Set(command.incorporatedArtifactDigests)
  if (current.message.payload.some(artifact => !incorporated.has(artifact.digest))) {
    fail('MAIL_PAYLOAD_NOT_IN_MANIFEST')
  }
  const receiptDigest = ArtifactDigest(sha256Digest({
    mailId: current.message.mailId,
    generation: current.recipientGeneration,
    contextGeneration: command.contextGeneration,
    manifest: command.contextManifestDigest,
    payload: current.message.payload.map(artifact => artifact.digest),
  }))
  return changed(state, {
    ...current,
    status: 'incorporated',
    contextGeneration: command.contextGeneration,
    contextManifestDigest: command.contextManifestDigest,
    sharedPrefixDigest: command.sharedPrefixDigest,
    receiptDigest,
    incorporatedAt: command.now,
    updatedAt: command.now,
  })
}

function acknowledge(
  state: MailboxState,
  current: MailRecord,
  command: Extract<MailCommand, { kind: 'acknowledge' }>,
): MailTransitionResult {
  if (current.status === 'acknowledged') {
    assertGeneration(current, command.recipientGeneration)
    assertReservation(current, command.reservationId, command.fence)
    if (current.contextManifestDigest !== command.contextManifestDigest) fail('MAIL_CONTEXT_STALE')
    return result('idempotent', state, current)
  }
  if (current.status !== 'incorporated') fail('MAIL_NOT_INCORPORATED')
  assertGeneration(current, command.recipientGeneration)
  assertReservation(current, command.reservationId, command.fence)
  if (current.contextManifestDigest !== command.contextManifestDigest) fail('MAIL_CONTEXT_STALE')
  return changed(state, {
    ...current,
    status: 'acknowledged',
    acknowledgedAt: command.now,
    updatedAt: command.now,
  })
}

function discard(
  state: MailboxState,
  current: MailRecord,
  command: Extract<MailCommand, { kind: 'discard' }>,
): MailTransitionResult {
  if (current.status === 'acknowledged' || current.status === 'discarded') fail('MAIL_TERMINAL')
  assertGeneration(current, command.recipientGeneration)
  if (current.status === 'reserved' || current.status === 'incorporated') {
    if (command.fence === undefined || current.reservation.fence !== command.fence) fail('MAIL_FENCE_STALE')
  }
  return changed(state, {
    schemaVersion: 1,
    status: 'discarded',
    message: current.message,
    recipientGeneration: current.recipientGeneration,
    reclaimCount: current.reclaimCount,
    reason: command.reason,
    discardedAt: command.now,
    updatedAt: command.now,
  })
}

export function transitionMail(state: MailboxState, command: MailCommand): MailTransitionResult {
  if (command.kind === 'enqueue') return enqueue(state, command)
  const current = state.mail[command.mailId]
  if (current === undefined) fail('MAIL_UNKNOWN')
  switch (command.kind) {
    case 'reserve': return reserve(state, current, command)
    case 'reclaim': return reclaim(state, current, command)
    case 'incorporate': return incorporate(state, current, command)
    case 'acknowledge': return acknowledge(state, current, command)
    case 'discard': return discard(state, current, command)
  }
}

export interface MailDeliveryEffects {
  reserve(): void | Promise<void>
  buildManifest(): void | Promise<void>
  flush(): boolean | Promise<boolean>
  incorporate(): void | Promise<void>
  acknowledge(): void | Promise<void>
}

async function requireFlush(effects: MailDeliveryEffects): Promise<void> {
  if (!await effects.flush()) fail('MAIL_DURABILITY_UNAVAILABLE')
}

export async function deliverReservedMail(effects: MailDeliveryEffects): Promise<void> {
  await effects.reserve()
  await effects.buildManifest()
  await requireFlush(effects)
  await effects.incorporate()
  await requireFlush(effects)
  await effects.acknowledge()
  await requireFlush(effects)
}

export const EMPTY_MAILBOX_STATE: MailboxState = deepFreeze({ mail: {} })
