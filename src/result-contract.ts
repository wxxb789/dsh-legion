import { validateJsonSchemaValue, type ObjectJsonSchema, type JsonValue } from '@deepseek-ai/dsh-tools'
import type { ResultContract } from './config.ts'
import { deepFreeze } from './internal/value.ts'

const evidenceItem = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    source: { type: 'string' as const, description: 'Exact source path, URL, command, or artifact id.' },
    detail: { type: 'string' as const, description: 'What this source proves.' },
  },
  required: ['source', 'detail'],
}

const findingItem = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    title: { type: 'string' as const },
    detail: { type: 'string' as const },
    evidence: { type: 'array' as const, items: evidenceItem },
  },
  required: ['title', 'detail', 'evidence'],
}

const reviewFindingItem = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    severity: { type: 'string' as const, enum: ['low', 'medium', 'high', 'critical'] },
    title: { type: 'string' as const },
    detail: { type: 'string' as const },
    evidence: { type: 'array' as const, items: evidenceItem },
    recommendation: { type: 'string' as const },
  },
  required: ['severity', 'title', 'detail', 'evidence', 'recommendation'],
}

export const FINDINGS_V1_SCHEMA: ObjectJsonSchema = deepFreeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    findings: { type: 'array', items: findingItem },
    decisions: { type: 'array', items: { type: 'string' } },
    verification: { type: 'array', items: { type: 'string' } },
    openRisks: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'findings', 'decisions', 'verification', 'openRisks'],
})

export const REVIEW_V1_SCHEMA: ObjectJsonSchema = deepFreeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['pass', 'needs-changes', 'block'] },
    summary: { type: 'string' },
    findings: { type: 'array', items: reviewFindingItem },
    verification: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'summary', 'findings', 'verification'],
})

/** Resolve one versioned result contract to its one-shot child schema. */
export function outputSchemaFor(contract: ResultContract): ObjectJsonSchema | undefined {
  return RESULT_CONTRACT_REGISTRY[contract].schema
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('dsh-legion: structured result is not an object')
  }
  return value as Record<string, unknown>
}

function text(value: unknown, at: string): string {
  if (typeof value !== 'string') throw new Error(`dsh-legion: structured result ${at} is not a string`)
  return value
}

function textArray(value: unknown, at: string): string[] {
  if (!Array.isArray(value)) throw new Error(`dsh-legion: structured result ${at} is not an array`)
  return value.map((item, index) => text(item, `${at}[${String(index)}]`))
}

function evidence(value: unknown, at: string): JsonValue[] {
  if (!Array.isArray(value)) throw new Error(`dsh-legion: structured result ${at} is not an array`)
  if (value.length === 0) throw new Error(`dsh-legion: structured result ${at} must not be empty`)
  return value.map((item, index) => {
    const source = record(item)
    return {
      source: text(source.source, `${at}[${String(index)}].source`),
      detail: text(source.detail, `${at}[${String(index)}].detail`),
    }
  })
}

function projectFindings(value: unknown): JsonValue {
  const source = record(value)
  const findings = source.findings
  if (!Array.isArray(findings)) throw new Error('dsh-legion: structured result findings is not an array')
  return {
    summary: text(source.summary, 'summary'),
    findings: findings.map((item, index) => {
      const finding = record(item)
      return {
        title: text(finding.title, `findings[${String(index)}].title`),
        detail: text(finding.detail, `findings[${String(index)}].detail`),
        evidence: evidence(finding.evidence, `findings[${String(index)}].evidence`),
      }
    }),
    decisions: textArray(source.decisions, 'decisions'),
    verification: textArray(source.verification, 'verification'),
    openRisks: textArray(source.openRisks, 'openRisks'),
  }
}

function projectReview(value: unknown): JsonValue {
  const source = record(value)
  const findings = source.findings
  if (!Array.isArray(findings)) throw new Error('dsh-legion: structured result findings is not an array')
  return {
    verdict: text(source.verdict, 'verdict'),
    summary: text(source.summary, 'summary'),
    findings: findings.map((item, index) => {
      const finding = record(item)
      return {
        severity: text(finding.severity, `findings[${String(index)}].severity`),
        title: text(finding.title, `findings[${String(index)}].title`),
        detail: text(finding.detail, `findings[${String(index)}].detail`),
        evidence: evidence(finding.evidence, `findings[${String(index)}].evidence`),
        recommendation: text(finding.recommendation, `findings[${String(index)}].recommendation`),
      }
    }),
    verification: textArray(source.verification, 'verification'),
  }
}

interface ResultContractCodec {
  readonly schema?: ObjectJsonSchema
  readonly project: (value: unknown) => JsonValue | undefined
}

const RESULT_CONTRACT_REGISTRY: Record<ResultContract, ResultContractCodec> = {
  text: { project: () => undefined },
  'findings-v1': { schema: FINDINGS_V1_SCHEMA, project: projectFindings },
  'review-v1': { schema: REVIEW_V1_SCHEMA, project: projectReview },
}

/**
 * Revalidate and project provider-owned `unknown` into a detached, contract-owned
 * JSON value. Live objects and undeclared properties never cross this seam.
 */
export function materializeStructuredResult(contract: ResultContract, value: unknown): JsonValue | undefined {
  const codec = RESULT_CONTRACT_REGISTRY[contract]
  if (codec.schema === undefined) return undefined
  const violations = validateJsonSchemaValue(codec.schema, value, 'structured')
  if (violations.length > 0) {
    throw new Error(`dsh-legion: structured result violated ${contract}: ${violations.join('; ')}`)
  }
  return codec.project(value)
}
