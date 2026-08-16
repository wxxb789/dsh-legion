import { describe, expect, it } from 'vitest'
import { ArtifactDigest, TaskId, type MilestoneSpec, type ProgressEvidence } from '../src/durable-run/contract.ts'
import {
  checkpointMilestoneBeforeYield, decideStairStepAdvancement,
  evaluateStairStepMilestone, expandStairStepPolicy,
  materializeStairStepPolicy, type MilestoneObservation,
} from '../src/durable-run/stair-step.ts'
import type { StairStepPolicySpec } from '../src/orchestration-contract.ts'

const a = ArtifactDigest('sha256:' + 'a'.repeat(64))
const b = ArtifactDigest('sha256:' + 'b'.repeat(64))
const policy: Required<StairStepPolicySpec> = {
  kind: 'stair-step', plannerMember: 'planner', verifierMember: 'verifier',
  advancement: 'continuous', maxMilestones: 4, maxNoProgressMilestones: 2,
  requireVisibleArtifact: true, pauseOn: ['no-progress', 'authority-expansion'],
}
const spec: MilestoneSpec = {
  index: 1, outcomeDelta: 'Prove the seam.', deliverable: 'text',
  acceptance: [{ criterion: 'focused test passes' }], risksToRetire: ['contract drift'],
  taskIds: [TaskId('probe')], budget: { maxTasks: 1, maxAttempts: 1 }, interaction: 'auto',
}
const observation: MilestoneObservation = {
  milestoneId: 'milestone-one', title: 'Prove seam', summary: 'The seam is verified.',
  artifacts: [{ name: 'probe-result', digest: a, mediaType: 'text/plain', byteLength: 10 }],
  verification: [{ criterion: 'focused test passes', accepted: true, evidence: [b] }],
  risksRetired: ['contract drift'], openRisks: [], observedDelta: 'Verified.',
  progress: [{ kind: 'risk-retired', risk: 'contract drift', evidence: [b] }], acceptedAt: 10,
}
function evaluate(extra: Partial<Parameters<typeof evaluateStairStepMilestone>[0]> = {}) {
  return evaluateStairStepMilestone({ policy, spec, observation, previousNoProgressMilestones: 0, ...extra })
}
function accepted() {
  const result = evaluate()
  if (result.kind !== 'accepted') throw new Error('expected accepted result')
  return result
}

describe('Stair-step policy', () => {
  it('strictly expands deterministic hygienic public policy data', () => {
    expect(() => materializeStairStepPolicy({ ...policy, hidden: true })).toThrow(/fields/)
    expect(() => expandStairStepPolicy(policy, '@legion')).toThrow(/namespace/)
    const first = expandStairStepPolicy(policy, 'review-step')
    const second = expandStairStepPolicy({ ...policy, pauseOn: [...policy.pauseOn].reverse() }, 'review-step')
    expect(first).toEqual(second)
    expect(first.plannerTaskId).toBe('@legion/delta/review-step/stair-step-planner')
  })
  it('requires visible artifacts, verification evidence, and targeted risks', () => {
    expect(evaluate({ observation: { ...observation, artifacts: [] } })).toMatchObject({ kind: 'rejected', reason: 'visible-artifact-required' })
    expect(evaluate({ observation: { ...observation, verification: [] } })).toMatchObject({ kind: 'rejected', reason: 'verification-failure' })
    expect(evaluate({ observation: { ...observation, risksRetired: ['unknown-risk'] } })).toMatchObject({ kind: 'rejected', reason: 'malformed' })
  })
  it('accepts every semantic progress evidence kind', () => {
    const progress: readonly ProgressEvidence[] = [
      { kind: 'accepted-artifact', digest: a },
      { kind: 'criterion-satisfied', criterion: 'focused test passes', evidence: [b] },
      { kind: 'risk-retired', risk: 'contract drift', evidence: [b] },
      { kind: 'uncertainty-reduced', uncertainty: 'api shape', evidence: [b] },
      { kind: 'blocked-path-rejected', path: 'unsafe retry', evidence: [b] },
    ]
    for (const item of progress) {
      expect(evaluate({ observation: { ...observation, progress: [item] } })).toMatchObject({ kind: 'accepted', madeProgress: true })
    }
  })
  it('suspends repeated semantic progress at the no-progress bound', () => {
    const first = accepted()
    expect(evaluate({ previousNoProgressMilestones: 1, acceptedProgressDigests: [first.receipt.progressDigest] }))
      .toMatchObject({ kind: 'suspended', reason: 'no-progress', receipt: { nextDecision: 'pause', noProgressMilestones: 2 } })
  })
  it('orders pause, checkpoint, activation yield, then continuous advance', () => {
    const receipt = accepted().receipt
    expect(decideStairStepAdvancement({ policy, receipt: { ...receipt, nextDecision: 'pause' }, milestonesInActivation: 1, activationMilestoneLimit: 3 })).toEqual({ kind: 'yield', reason: 'policy-pause' })
    expect(decideStairStepAdvancement({ policy: { ...policy, advancement: 'checkpoint' }, receipt, milestonesInActivation: 1, activationMilestoneLimit: 3 })).toEqual({ kind: 'yield', reason: 'checkpoint' })
    expect(decideStairStepAdvancement({ policy, receipt, milestonesInActivation: 2, activationMilestoneLimit: 2 })).toEqual({ kind: 'yield', reason: 'activation-limit' })
    expect(decideStairStepAdvancement({ policy, receipt, milestonesInActivation: 1, activationMilestoneLimit: 2 })).toEqual({ kind: 'continue' })
  })
  it('flushes milestone then continuation before checkpoint return', async () => {
    const calls: string[] = []
    await checkpointMilestoneBeforeYield({
      appendMilestone() { calls.push('milestone') },
      appendContinuation() { calls.push('continuation') },
      flush() { calls.push('flush'); return true },
    })
    expect(calls).toEqual(['milestone', 'flush', 'continuation', 'flush'])
  })
})
