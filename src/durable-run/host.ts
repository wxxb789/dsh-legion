import type { AttemptId, Fence, OwnerFingerprint, ResultEnvelope, RunId, TaskId } from './contract.ts'

export const LEGION_RUN_COORDINATION_KEY = 'legionRunCoordination'
export const LEGION_GLOBAL_ADMISSION_KEY = 'legionGlobalAdmission'
export const LEGION_CHILD_RECEIPTS_KEY = 'legionChildReceipts'

export interface AcquireRunLeaseRequest {
  readonly runId: RunId
  readonly anchorSessionId: string
  readonly owner: OwnerFingerprint
  readonly ttlMs: number
  readonly observedJournalSeq: number
}

export interface RunLease {
  readonly leaseId: string
  readonly runId: RunId
  readonly owner: OwnerFingerprint
  readonly fence: Fence
  readonly acquiredAt: number
  readonly renewAfter: number
  readonly expiresAt: number
  readonly journalWatermark?: number
}

export type LeaseAcquireResult =
  | { readonly kind: 'granted'; readonly lease: RunLease }
  | { readonly kind: 'conflict'; readonly retryAfter?: number }

export type LeaseMutationResult =
  | { readonly kind: 'current'; readonly lease: RunLease }
  | { readonly kind: 'lost'; readonly reason: string }

export interface RunCoordination {
  acquire(request: AcquireRunLeaseRequest): Promise<unknown>
  renew(request: { readonly lease: RunLease; readonly ttlMs: number }): Promise<unknown>
  assert(request: { readonly runId: RunId; readonly owner: OwnerFingerprint; readonly fence: Fence }): Promise<unknown>
  release(request: { readonly lease: RunLease }): Promise<void>
}

export interface AdmissionRequest {
  readonly runId: RunId
  readonly taskId: TaskId
  readonly attemptId: AttemptId
  readonly provider: string
  readonly model: string
  readonly concurrentActivations: number
}

export type AdmissionResult =
  | { readonly kind: 'granted'; readonly reservationId: string }
  | { readonly kind: 'denied'; readonly reason: string }

export interface GlobalAdmission {
  reserve(request: AdmissionRequest): Promise<AdmissionResult>
  reconcile(reservationId: string, usage: Readonly<Record<string, number>>): Promise<void>
  release(reservationId: string): Promise<void>
}

export type ChildReceiptObservation =
  | { readonly kind: 'found'; readonly result: ResultEnvelope }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unknown'; readonly reason: string }

export interface DurableChildReceipts {
  lookup(request: {
    readonly anchorSessionId: string
    readonly childSessionId: string
    readonly attemptId: AttemptId
  }): Promise<ChildReceiptObservation>
}

export interface DurableHostServices {
  /** Return true only when an authoritative Session durability listener ran. */
  readonly flush?: () => Promise<boolean>
  readonly projection?: unknown
  readonly coordination?: RunCoordination
  readonly globalAdmission?: GlobalAdmission
  readonly childReceipts?: DurableChildReceipts
}
