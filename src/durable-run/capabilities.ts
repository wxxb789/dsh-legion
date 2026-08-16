import { deepFreeze } from '../internal/value.ts'
import {
  LEGION_CHILD_RECEIPTS_KEY,
  LEGION_GLOBAL_ADMISSION_KEY,
  LEGION_RUN_COORDINATION_KEY,
  type DurableHostServices,
} from './host.ts'

export const DURABLE_DIAGNOSTIC_CODES = [
  'LEGION_DURABLE_FLUSH_UNAVAILABLE',
  'LEGION_SESSION_PROJECTION_UNAVAILABLE',
  'LEGION_DURABLE_COORDINATION_UNAVAILABLE',
  'LEGION_GLOBAL_ADMISSION_UNAVAILABLE',
  'LEGION_DURABLE_CHILD_RECEIPT_UNAVAILABLE',
  'LEGION_RECOVERY_EFFECT_AMBIGUOUS',
] as const

export type DurableDiagnosticCode = typeof DURABLE_DIAGNOSTIC_CODES[number]
export type CapabilityFact =
  | { readonly kind: 'available' }
  | { readonly kind: 'unavailable'; readonly diagnostic: DurableDiagnosticCode }

export interface DurableCapabilitySnapshot {
  readonly durableMutation: boolean
  readonly flush: CapabilityFact
  readonly projection: CapabilityFact
  readonly coordination: CapabilityFact
  readonly globalAdmission: CapabilityFact
  readonly childReceipts: CapabilityFact
  readonly diagnostics: readonly DurableDiagnosticCode[]
}

export interface DurableCapabilityContext {
  get?(key: string): unknown
}

function fact(available: boolean, diagnostic: DurableDiagnosticCode): CapabilityFact {
  return available ? { kind: 'available' } : { kind: 'unavailable', diagnostic }
}

function snapshot(availability: {
  readonly flush: boolean
  readonly projection: boolean
  readonly coordination: boolean
  readonly globalAdmission: boolean
  readonly childReceipts: boolean
}): DurableCapabilitySnapshot {
  const flush = fact(availability.flush, 'LEGION_DURABLE_FLUSH_UNAVAILABLE')
  const projection = fact(availability.projection, 'LEGION_SESSION_PROJECTION_UNAVAILABLE')
  const coordination = fact(
    availability.coordination,
    'LEGION_DURABLE_COORDINATION_UNAVAILABLE',
  )
  const globalAdmission = fact(
    availability.globalAdmission,
    'LEGION_GLOBAL_ADMISSION_UNAVAILABLE',
  )
  const childReceipts = fact(
    availability.childReceipts,
    'LEGION_DURABLE_CHILD_RECEIPT_UNAVAILABLE',
  )
  const facts = [flush, projection, coordination, globalAdmission, childReceipts]
  return deepFreeze({
    durableMutation: flush.kind === 'available'
      && projection.kind === 'available'
      && coordination.kind === 'available',
    flush,
    projection,
    coordination,
    globalAdmission,
    childReceipts,
    diagnostics: facts.flatMap(item =>
      item.kind === 'unavailable' ? [item.diagnostic] : []),
  })
}

function hasMethods(value: unknown, methods: readonly string[]): boolean {
  if (typeof value !== 'object' || value === null) return false
  const source = value as Record<string, unknown>
  return methods.every(method => typeof source[method] === 'function')
}

export function detectDurableCapabilities(
  ctx: DurableCapabilityContext,
): DurableCapabilitySnapshot {
  return snapshot({
    flush: hasMethods(ctx.get?.('sessions'), ['flush']),
    projection: hasMethods(ctx.get?.('sessionProjections'), ['register']),
    coordination: hasMethods(
      ctx.get?.(LEGION_RUN_COORDINATION_KEY),
      ['acquire', 'renew', 'assert', 'release'],
    ),
    globalAdmission: hasMethods(
      ctx.get?.(LEGION_GLOBAL_ADMISSION_KEY),
      ['reserve', 'reconcile', 'release'],
    ),
    childReceipts: hasMethods(ctx.get?.(LEGION_CHILD_RECEIPTS_KEY), ['lookup']),
  })
}

export function assertDurableMutationAvailable(
  capabilities: DurableCapabilitySnapshot,
): void {
  if (!capabilities.durableMutation) {
    const blocking = capabilities.diagnostics.filter(code =>
      code === 'LEGION_DURABLE_FLUSH_UNAVAILABLE'
      || code === 'LEGION_SESSION_PROJECTION_UNAVAILABLE'
      || code === 'LEGION_DURABLE_COORDINATION_UNAVAILABLE')
    throw new Error(
      `dsh-legion: ${blocking.join(', ') || 'LEGION_DURABLE_COORDINATION_UNAVAILABLE'}`,
    )
  }
}

export function compileDurableCapabilities(
  services: DurableHostServices,
): DurableCapabilitySnapshot {
  return snapshot({
    flush: typeof services.flush === 'function',
    projection: services.projection !== undefined,
    coordination: services.coordination !== undefined,
    globalAdmission: services.globalAdmission !== undefined,
    childReceipts: services.childReceipts !== undefined,
  })
}
