import { describe, expect, it } from 'vitest'
import {
  Fence,
  RunId,
  controlDurableRun,
  type OwnerFingerprint,
  materializePlanDeltaProposal,
  type RunControlPort,
  type RunLease,
} from '../src/index.ts'

const owner: OwnerFingerprint = {
  hostInstanceId: 'host',
  processBootId: 'boot',
  pluginGeneration: 'plugin',
  anchorSessionId: 'session',
  activationId: 'activation',
}

const lease: RunLease = {
  leaseId: 'lease',
  runId: RunId('run'),
  owner,
  fence: Fence(1),
  acquiredAt: 1,
  renewAfter: 2,
  expiresAt: 3,
}

function port(
  log: string[],
  flushResult = true,
): RunControlPort<string, string, string> {
  let reads = 0
  return {
    async inspect() { log.push('inspect'); return 'state' },
    assertCapabilities() { log.push('capabilities') },
    async acquire() { log.push('acquire'); return lease },
    async release() { log.push('release') },
    async reread() { reads += 1; log.push('reread-' + reads); return 'state-' + reads },
    planRecovery() { log.push('plan'); return 'recovery' },
    async commitRecovery() { log.push('commit-recovery') },
    async flush() { log.push('flush'); return flushResult },
    async activate(state) { log.push('activate-' + state); return 'activation' },
    async commitCancelIntent() { log.push('cancel-intent') },
    closeAdmission() { log.push('close-admission') },
    async cancelLiveChildren() { log.push('cancel-live') },
    async assertLease() { log.push('assert') },
    async commitCancelled() { log.push('cancelled') },
  }
}

describe('durable run controls', () => {
  it('keeps inspect read-only and free of capability or lease effects', async () => {
    const log: string[] = []
    await controlDurableRun(
      { kind: 'run', action: 'inspect', runId: RunId('run') },
      port(log),
    )
    expect(log).toEqual(['inspect'])
  })

  it('flushes recovery, reasserts ownership, rereads, and releases before return', async () => {
    const log: string[] = []
    const output = await controlDurableRun(
      { kind: 'run', action: 'resume', runId: RunId('run') },
      port(log),
    )
    expect(output).toBe('activation')
    expect(log).toEqual([
      'capabilities', 'acquire', 'reread-1', 'plan', 'assert', 'commit-recovery',
      'flush', 'assert', 'reread-2', 'activate-state-2', 'release',
    ])
  })

  it('durably records cancel intent before closing admission and live cancellation', async () => {
    const log: string[] = []
    await controlDurableRun(
      { kind: 'run', action: 'cancel', runId: RunId('run') },
      port(log),
    )
    expect(log).toEqual([
      'capabilities', 'acquire', 'reread-1', 'assert', 'cancel-intent', 'flush',
      'close-admission', 'cancel-live', 'assert', 'cancelled', 'flush', 'release',
    ])
  })

  it('records steering only as a validated durable proposal', async () => {
    const log: string[] = []
    const adapter = {
      ...port(log),
      validateSteer(_state: string, proposal: unknown) { log.push('validate-steer'); return proposal },
      async commitSteerProposal() { log.push('commit-steer') },
    }
    await controlDurableRun(
      {
        kind: 'run',
        action: 'steer',
        runId: RunId('run'),
        proposal: materializePlanDeltaProposal({
          schemaVersion: 1,
          deltaId: 'steer-one',
          basePlanVersion: 1,
          reason: 'Refine.',
          evidence: [],
          operations: [],
        }),
      },
      adapter,
    )
    expect(log).toEqual([
      'capabilities', 'acquire', 'reread-1', 'validate-steer',
      'assert', 'commit-steer', 'flush', 'release',
    ])
  })

  it('fails closed and still releases when the durability barrier is absent', async () => {
    const log: string[] = []
    await expect(controlDurableRun(
      { kind: 'run', action: 'resume', runId: RunId('run') },
      port(log, false),
    )).rejects.toThrow(/LEGION_DURABLE_FLUSH_UNAVAILABLE/)
    expect(log).toEqual([
      'capabilities', 'acquire', 'reread-1', 'plan', 'assert', 'commit-recovery',
      'flush', 'release',
    ])
  })
})
