import type { AdmissionRequest, AdmissionResult, GlobalAdmission } from './host.ts'

export const LEGION_GLOBAL_ADMISSION_UNAVAILABLE = 'LEGION_GLOBAL_ADMISSION_UNAVAILABLE' as const
export interface AdmissionAdapter {
  readonly scope: 'host-global-admitted' | 'per-run-conservative'
  readonly diagnostics: readonly string[]
  reserve(request: AdmissionRequest): Promise<AdmissionResult>
  reconcile(reservationId: string, usage: Readonly<Record<string, number>>): Promise<void>
  release(reservationId: string): Promise<void>
}
function validateRequest(request: AdmissionRequest): void {
  if (!Number.isSafeInteger(request.concurrentActivations)
    || request.concurrentActivations < 1) {
    throw new Error('dsh-legion: invalid admission request')
  }
}
function materializeResult(value: AdmissionResult): AdmissionResult {
  if (value.kind === 'granted'
    && typeof value.reservationId === 'string'
    && value.reservationId.length > 0) return value
  if (value.kind === 'denied' && typeof value.reason === 'string' && value.reason.length > 0) {
    return value
  }
  throw new Error('dsh-legion: invalid Host admission response')
}
export function createAdmissionAdapter(
  host: GlobalAdmission | undefined,
  limits: { readonly maxConcurrent: number },
): AdmissionAdapter {
  if (!Number.isSafeInteger(limits.maxConcurrent) || limits.maxConcurrent < 1) {
    throw new Error('dsh-legion: invalid per-run admission limit')
  }
  if (host !== undefined) {
    return {
      scope: 'host-global-admitted',
      diagnostics: [],
      async reserve(request) {
        validateRequest(request)
        return materializeResult(await host.reserve(request))
      },
      reconcile: (id, usage) => host.reconcile(id, usage),
      release: id => host.release(id),
    }
  }
  let active = 0
  let sequence = 0
  const held = new Map<string, number>()
  return {
    scope: 'per-run-conservative',
    diagnostics: [LEGION_GLOBAL_ADMISSION_UNAVAILABLE],
    async reserve(request) {
      validateRequest(request)
      if (active + request.concurrentActivations > limits.maxConcurrent) {
        return { kind: 'denied', reason: 'PER_RUN_CONCURRENCY_LIMIT' }
      }
      const reservationId = 'per-run-' + String(++sequence)
      held.set(reservationId, request.concurrentActivations)
      active += request.concurrentActivations
      return { kind: 'granted', reservationId }
    },
    async reconcile() {},
    async release(reservationId) {
      const weight = held.get(reservationId)
      if (weight !== undefined) {
        held.delete(reservationId)
        active -= weight
      }
    },
  }
}
