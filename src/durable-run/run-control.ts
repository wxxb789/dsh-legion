import { deepFreeze } from '../internal/value.ts'
import { RunId, type RunId as RunIdType } from './contract.ts'
import type { RunLease } from './host.ts'
import {
  materializePlanDeltaProposal,
  type PlanDeltaProposal,
} from './plan-delta.ts'

export type RunControlInput =
  | { readonly kind: 'run'; readonly action: 'inspect'; readonly runId: RunIdType }
  | { readonly kind: 'run'; readonly action: 'resume'; readonly runId: RunIdType }
  | { readonly kind: 'run'; readonly action: 'cancel'; readonly runId: RunIdType }
  | { readonly kind: 'run'; readonly action: 'steer'; readonly runId: RunIdType; readonly proposal: PlanDeltaProposal }

export function parseRunControlInput(value: unknown): RunControlInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('dsh-legion: RUN_CONTROL_INVALID')
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('dsh-legion: RUN_CONTROL_INVALID')
  }
  const source = value as Record<string, unknown>
  if (Object.keys(source).some(key => !['kind', 'action', 'runId', 'proposal'].includes(key))
    || source.kind !== 'run') {
    throw new Error('dsh-legion: RUN_CONTROL_INVALID')
  }
  if (source.action !== 'inspect' && source.action !== 'resume' && source.action !== 'cancel' && source.action !== 'steer') {
    throw new Error('dsh-legion: RUN_CONTROL_INVALID')
  }
  if (source.action === 'steer') {
    if (source.proposal === undefined) throw new Error('dsh-legion: RUN_CONTROL_INVALID')
    return deepFreeze({
      kind: 'run',
      action: 'steer',
      runId: RunId(source.runId),
      proposal: materializePlanDeltaProposal(source.proposal),
    })
  }
  if (source.proposal !== undefined) throw new Error('dsh-legion: RUN_CONTROL_INVALID')
  return deepFreeze({ kind: 'run', action: source.action, runId: RunId(source.runId) })
}

export interface RunControlPort<State, Recovery, Activation> {
  inspect(runId: RunIdType): Promise<State>
  assertCapabilities(): void
  acquire(runId: RunIdType): Promise<RunLease>
  release(lease: RunLease): Promise<void>
  reread(runId: RunIdType): Promise<State>
  planRecovery(state: State, lease: RunLease): Recovery
  commitRecovery(plan: Recovery, lease: RunLease): Promise<void>
  flush(): Promise<boolean>
  activate(state: State, lease: RunLease): Promise<Activation>
  commitCancelIntent(state: State, lease: RunLease): Promise<void>
  closeAdmission(): void
  cancelLiveChildren(state: State): Promise<void>
  assertLease(lease: RunLease): Promise<void>
  commitCancelled(state: State, lease: RunLease): Promise<void>
  validateSteer?(state: State, proposal: PlanDeltaProposal): unknown
  commitSteerProposal?(state: State, proposal: unknown, lease: RunLease): Promise<void>
}

async function requireFlush<State, Recovery, Activation>(
  port: RunControlPort<State, Recovery, Activation>,
): Promise<void> {
  if (!await port.flush()) {
    throw new Error('dsh-legion: LEGION_DURABLE_FLUSH_UNAVAILABLE')
  }
}

export async function controlDurableRun<State, Recovery, Activation>(
  input: RunControlInput,
  port: RunControlPort<State, Recovery, Activation>,
): Promise<State | Activation> {
  if (input.action === 'inspect') return port.inspect(input.runId)
  port.assertCapabilities()
  const lease = await port.acquire(input.runId)
  try {
    let state = await port.reread(input.runId)
    if (input.action === 'steer') {
      if (port.validateSteer === undefined || port.commitSteerProposal === undefined) {
        throw new Error('dsh-legion: STEER_UNAVAILABLE')
      }
      const proposal = port.validateSteer(state, input.proposal)
      await port.commitSteerProposal(state, proposal, lease)
      await requireFlush(port)
      return state
    }
    if (input.action === 'resume') {
      const plan = port.planRecovery(state, lease)
      await port.commitRecovery(plan, lease)
      await requireFlush(port)
      await port.assertLease(lease)
      state = await port.reread(input.runId)
      return await port.activate(state, lease)
    }
    await port.commitCancelIntent(state, lease)
    await requireFlush(port)
    port.closeAdmission()
    await port.cancelLiveChildren(state)
    await port.assertLease(lease)
    await port.commitCancelled(state, lease)
    await requireFlush(port)
    return state
  } finally {
    await port.release(lease)
  }
}
