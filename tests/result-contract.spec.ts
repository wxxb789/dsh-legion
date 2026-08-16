import { describe, expect, it } from 'vitest'
import {
  REVIEW_V1_SCHEMA,
  materializeStructuredResult,
  outputSchemaFor,
} from '../src/result-contract.ts'

describe('versioned result contracts', () => {
  it('publishes deeply immutable schema generations', () => {
    expect(Object.isFrozen(outputSchemaFor('review-v1'))).toBe(true)
    const properties = REVIEW_V1_SCHEMA.properties
    if (properties === undefined) throw new Error('missing review schema properties')
    expect(Object.isFrozen(properties.findings)).toBe(true)
    expect(() => {
      ;(properties as Record<string, unknown>).extra = { type: 'string' }
    }).toThrow(TypeError)
    expect(outputSchemaFor('review-v1')).not.toHaveProperty('properties.extra')
  })

  it('projects findings-v1 into detached owned JSON', () => {
    const input = {
      summary: 'Found two modules.',
      findings: [{
        title: 'Router',
        detail: 'The router is explicit.',
        evidence: [{ source: 'src/router.ts:10', detail: 'Dispatch table.' }],
      }],
      decisions: ['Keep one tool.'],
      verification: ['pnpm test'],
      openRisks: ['No live provider E2E.'],
    }
    const result = materializeStructuredResult('findings-v1', input)
    expect(result).toEqual(input)
    expect(result).not.toBe(input)
    ;(result as { findings: Array<{ evidence: Array<{ detail: string }> }> }).findings[0]!.evidence[0]!.detail = 'changed'
    expect(input.findings[0]!.evidence[0]!.detail).toBe('Dispatch table.')
  })

  it('projects review-v1 and rejects undeclared or malformed data', () => {
    const input = {
      verdict: 'needs-changes',
      summary: 'One issue.',
      findings: [{
        severity: 'high',
        title: 'Unsafe retry',
        detail: 'The retry replays mutations.',
        evidence: [{ source: 'src/retry.ts:9', detail: 'Starts another child.' }],
        recommendation: 'Use one recovery owner.',
      }],
      verification: ['unit test reproduced'],
    }
    expect(materializeStructuredResult('review-v1', input)).toEqual(input)
    expect(() => materializeStructuredResult('review-v1', { ...input, extra: true }))
      .toThrow(/violated review-v1/)
    expect(() => materializeStructuredResult('review-v1', { ...input, verdict: 'maybe' }))
      .toThrow(/violated review-v1/)
    expect(() => materializeStructuredResult('review-v1', {
      ...input,
      findings: [{ ...input.findings[0], evidence: [] }],
    })).toThrow(/must not be empty/)
    expect(() => materializeStructuredResult('review-v1', {
      ...input,
      findings: [{
        ...input.findings[0],
        evidence: [{ source: '   ', detail: 'No source identity.' }],
      }],
    })).toThrow(/must not be blank/)
  })

  it('accepts bounded plan proposals but rejects generated identities and events', () => {
    const proposal = {
      schemaVersion: 1, deltaId: 'delta-one', basePlanVersion: 1, reason: 'Add verification.',
      evidence: [{ source: 'artifact-one', detail: 'Needs verification.' }],
      operations: [{ kind: 'supersede-pending', taskId: 'task-one' }],
    }
    expect(materializeStructuredResult('plan-delta-v1', proposal)).toEqual(proposal)
    expect(() => materializeStructuredResult('plan-delta-v1', {
      ...proposal, operations: [{ kind: 'add-edge', from: '@legion/delta/one/task', to: 'task-one', reason: 'after' }],
    })).toThrow(/generated identities/)
    expect(() => materializeStructuredResult('plan-delta-v1', { ...proposal, events: [] }))
      .toThrow(/violated plan-delta-v1/)
  })

  it('keeps text contract schema-free', () => {
    expect(outputSchemaFor('text')).toBeUndefined()
    expect(materializeStructuredResult('text', { ignored: true })).toBeUndefined()
  })
})
