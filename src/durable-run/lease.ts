import { Fence, RunId, trustedRecord, type OwnerFingerprint } from './contract.ts'
import type {
  LeaseAcquireResult,
  LeaseMutationResult,
  RunCoordination,
  RunLease,
} from './host.ts'

function record(
  value: unknown,
  subject: string,
  allowed: readonly string[],
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`dsh-legion: invalid ${subject} response`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`dsh-legion: invalid ${subject} response`)
  }
  const source = value as Record<string, unknown>
  if (Object.keys(source).some(key => !allowed.includes(key))) {
    throw new Error(`dsh-legion: invalid ${subject} response fields`)
  }
  return source
}

function text(value: unknown, subject: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw new Error(`dsh-legion: invalid ${subject}`)
  }
  return value
}

function safeTime(value: unknown, subject: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`dsh-legion: invalid lease ${subject}`)
  }
  return value as number
}

export function materializeOwnerFingerprint(value: unknown): OwnerFingerprint {
  const source = record(value, 'lease owner', [
    'hostInstanceId', 'processBootId', 'pluginGeneration', 'anchorSessionId',
    'activationId',
  ])
  return trustedRecord({
    hostInstanceId: text(source.hostInstanceId, 'owner hostInstanceId'),
    processBootId: text(source.processBootId, 'owner processBootId'),
    pluginGeneration: text(source.pluginGeneration, 'owner pluginGeneration'),
    anchorSessionId: text(source.anchorSessionId, 'owner anchorSessionId'),
    activationId: text(source.activationId, 'owner activationId'),
  })
}

function sameOwner(left: OwnerFingerprint, right: OwnerFingerprint): boolean {
  return left.hostInstanceId === right.hostInstanceId
    && left.processBootId === right.processBootId
    && left.pluginGeneration === right.pluginGeneration
    && left.anchorSessionId === right.anchorSessionId
    && left.activationId === right.activationId
}

export function materializeRunLease(value: unknown): RunLease {
  const source = record(value, 'coordination lease', [
    'leaseId', 'runId', 'owner', 'fence', 'acquiredAt', 'renewAfter', 'expiresAt',
    'journalWatermark',
  ])
  const acquiredAt = safeTime(source.acquiredAt, 'acquiredAt')
  const renewAfter = safeTime(source.renewAfter, 'renewAfter')
  const expiresAt = safeTime(source.expiresAt, 'expiresAt')
  if (!(acquiredAt <= renewAfter && renewAfter < expiresAt)) {
    throw new Error('dsh-legion: invalid lease time ordering')
  }
  return trustedRecord({
    leaseId: text(source.leaseId, 'lease id'),
    runId: RunId(source.runId),
    owner: materializeOwnerFingerprint(source.owner),
    fence: Fence(source.fence),
    acquiredAt,
    renewAfter,
    expiresAt,
    ...(source.journalWatermark === undefined
      ? {}
      : { journalWatermark: safeTime(source.journalWatermark, 'journalWatermark') }),
  })
}

export function materializeLeaseAcquireResult(value: unknown): LeaseAcquireResult {
  const source = record(value, 'coordination acquire', ['kind', 'lease', 'retryAfter'])
  if (source.kind === 'granted') {
    if (source.retryAfter !== undefined) {
      throw new Error('dsh-legion: granted lease cannot carry retryAfter')
    }
    return { kind: 'granted', lease: materializeRunLease(source.lease) }
  }
  if (source.kind === 'conflict') {
    if (source.lease !== undefined) {
      throw new Error('dsh-legion: lease conflict cannot carry a lease')
    }
    return source.retryAfter === undefined
      ? { kind: 'conflict' }
      : { kind: 'conflict', retryAfter: safeTime(source.retryAfter, 'retryAfter') }
  }
  throw new Error('dsh-legion: invalid coordination acquire response')
}

export function materializeLeaseMutationResult(value: unknown): LeaseMutationResult {
  const source = record(value, 'coordination mutation', ['kind', 'lease', 'reason'])
  if (source.kind === 'current') {
    if (source.reason !== undefined) {
      throw new Error('dsh-legion: current lease cannot carry a loss reason')
    }
    return { kind: 'current', lease: materializeRunLease(source.lease) }
  }
  if (source.kind === 'lost') {
    if (source.lease !== undefined) {
      throw new Error('dsh-legion: lost lease cannot carry a lease')
    }
    return { kind: 'lost', reason: text(source.reason, 'lease loss reason') }
  }
  throw new Error('dsh-legion: invalid coordination mutation response')
}

function assertLeaseMatches(
  lease: RunLease,
  expected: Pick<RunLease, 'runId' | 'owner'>,
): void {
  if (lease.runId !== expected.runId || !sameOwner(lease.owner, expected.owner)) {
    throw new Error('dsh-legion: Host lease identity does not match the request')
  }
}


function positiveInteger(value: unknown, subject: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`dsh-legion: invalid ${subject}`)
  }
}

function naturalInteger(value: unknown, subject: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`dsh-legion: invalid ${subject}`)
  }
}

export class RunCoordinationAdapter {
  constructor(private readonly host: RunCoordination) {}

  async acquire(
    request: Parameters<RunCoordination['acquire']>[0],
  ): Promise<LeaseAcquireResult> {
    positiveInteger(request.ttlMs, 'lease ttlMs')
    naturalInteger(request.observedJournalSeq, 'observed journal sequence')
    if (request.anchorSessionId !== request.owner.anchorSessionId) {
      throw new Error('dsh-legion: lease owner anchor Session does not match the request')
    }
    const result = materializeLeaseAcquireResult(await this.host.acquire(request))
    if (result.kind === 'granted') assertLeaseMatches(result.lease, request)
    return result
  }

  async renew(
    request: Parameters<RunCoordination['renew']>[0],
  ): Promise<LeaseMutationResult> {
    positiveInteger(request.ttlMs, 'lease ttlMs')
    const result = materializeLeaseMutationResult(await this.host.renew(request))
    if (result.kind === 'current') {
      assertLeaseMatches(result.lease, request.lease)
      if (result.lease.leaseId !== request.lease.leaseId
        || result.lease.fence !== request.lease.fence) {
        throw new Error('dsh-legion: Host lease renewal changed its safety identity')
      }
    }
    return result
  }

  async assert(
    request: Parameters<RunCoordination['assert']>[0],
  ): Promise<LeaseMutationResult> {
    const result = materializeLeaseMutationResult(await this.host.assert(request))
    if (result.kind === 'current') {
      assertLeaseMatches(result.lease, request)
      if (result.lease.fence !== request.fence) {
        throw new Error('dsh-legion: Host lease assertion changed its fence')
      }
    }
    return result
  }

  release(request: Parameters<RunCoordination['release']>[0]): Promise<void> {
    return this.host.release(request)
  }
}
