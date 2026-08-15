import { createHash, generateKeyPairSync, sign as signPayload, type KeyObject } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const sha256 = (bytes: string | Buffer) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const source = value as Record<string, unknown>
    return `{${Object.keys(source).sort().map(key => `${JSON.stringify(key)}:${canonical(source[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function campaign(root: string, options: { critical?: boolean; cost?: boolean; hardBudget?: boolean } = {}) {
  const casePackBytes = readFileSync(join(ROOT, 'benchmarks/quality/review-v1.json'))
  const thresholdBytes = readFileSync(join(ROOT, 'benchmarks/quality/thresholds-v1.json'))
  const casePack = JSON.parse(casePackBytes.toString('utf8')) as { cases: Array<{ id: string }> }
  mkdirSync(join(root, 'artifacts'))
  const contentRef = (name: string, content: string) => {
    const uri = `artifacts/${name}`
    writeFileSync(join(root, uri), content)
    return { uri, sha256: sha256(content) }
  }
  const artifactRef = contentRef('output.txt', 'frozen scored output')
  const inputRef = contentRef('input.json', '{"input":"same"}')
  const configRef = contentRef('config.json', '{"config":"same"}')
  const budgetRef = contentRef('budget.json', '{"budget":"same"}')
  const directPlanRef = contentRef('direct-plan.json', '{"plan":"direct"}')
  const treatmentPlanRef = contentRef('treatment-plan.json', '{"plan":"treatment"}')
  const rubricRef = contentRef('rubric.json', '{"schemaVersion":"rubric-v1"}')
  const stable = `sha256:${'a'.repeat(64)}`
  const runs = casePack.cases.flatMap(({ id }) => [1, 2, 3].flatMap((repeat) => [
    {
      caseId: id,
      repeat,
      pairId: `${id}-r${String(repeat)}`,
      arm: 'direct',
      order: repeat % 2 === 1 ? 1 : 2,
      exposure: 'direct-delegation',
      status: 'valid',
      artifact: artifactRef,
      provenance: {
        input: inputRef,
        model: 'provider/exact-model',
        config: configRef,
        budget: budgetRef,
        plan: directPlanRef,
      },
      scores: { quality: 0.5, safety: 1, evidence: 0.5, criticalSafetyViolations: 0 },
      usage: { inputTokens: 100, outputTokens: 50, billedCostUsd: options.cost === false ? null : 1 },
      timing: { startedMonotonicMs: 0, endedMonotonicMs: 100 },
    },
    {
      caseId: id,
      repeat,
      pairId: `${id}-r${String(repeat)}`,
      arm: 'treatment',
      order: repeat % 2 === 1 ? 2 : 1,
      exposure: 'strategy:independent-review',
      status: 'valid',
      artifact: artifactRef,
      provenance: {
        input: inputRef,
        model: 'provider/exact-model',
        config: configRef,
        budget: budgetRef,
        plan: treatmentPlanRef,
      },
      scores: {
        quality: 0.8,
        safety: 1,
        evidence: 0.7,
        criticalSafetyViolations: options.critical === true && id === casePack.cases[0]!.id && repeat === 1 ? 1 : 0,
      },
      usage: { inputTokens: 200, outputTokens: 100, billedCostUsd: options.cost === false ? null : 2 },
      timing: { startedMonotonicMs: 0, endedMonotonicMs: 200 },
    },
  ]))
  const scoredRunRecords = [...runs]
    .sort((left, right) => `${left.pairId}:${left.arm}`.localeCompare(`${right.pairId}:${right.arm}`))
  const adjudicationPayload = {
    casePackSha256: sha256(casePackBytes),
    rubricSha256: rubricRef.sha256,
    thresholdsSha256: sha256(thresholdBytes),
    scoredRunsSha256: sha256(canonical(scoredRunRecords)),
  }
  const adjudicationRef = contentRef('adjudication.json', JSON.stringify({
    schemaVersion: 'legion-adjudication-receipt-v1',
    batchId: 'blind-batch-a',
    blinded: true,
    signerId: 'development',
    payload: adjudicationPayload,
    signature: null,
  }))
  return {
    schemaVersion: 'legion-quality-campaign-v1',
    campaign: {
      id: 'review-campaign-a',
      strategy: 'independent-review',
      casePackId: 'independent-review-v1',
      casePackSha256: sha256(casePackBytes),
      rubric: rubricRef,
      thresholdsSha256: sha256(thresholdBytes),
      adjudicationReceipt: adjudicationRef,
      startedAt: '2026-08-01T00:00:00.000Z',
      endedAt: '2026-08-02T00:00:00.000Z',
    },
    environment: {
      catalogDigest: stable,
      executionCommit: 'commit-a',
      deploymentHardBudget: options.hardBudget === true,
    },
    runs,
  }
}

function refreshAdjudication(
  root: string,
  document: ReturnType<typeof campaign>,
  batchId: string,
  signerId = 'development',
  privateKey?: KeyObject,
): void {
  const scoredRunRecords = [...document.runs]
    .sort((left, right) => `${left.pairId}:${left.arm}`.localeCompare(`${right.pairId}:${right.arm}`))
  const payload = {
    casePackSha256: document.campaign.casePackSha256,
    rubricSha256: document.campaign.rubric.sha256,
    thresholdsSha256: document.campaign.thresholdsSha256,
    scoredRunsSha256: sha256(canonical(scoredRunRecords)),
  }
  const signature = privateKey === undefined
    ? null
    : signPayload(null, Buffer.from(canonical(payload)), privateKey).toString('base64')
  const content = JSON.stringify({
    schemaVersion: 'legion-adjudication-receipt-v1',
    batchId,
    blinded: true,
    signerId,
    payload,
    signature,
  })
  writeFileSync(join(root, 'artifacts/adjudication.json'), content)
  document.campaign.adjudicationReceipt.sha256 = sha256(content)
}

function evaluate(root: string, document: unknown) {
  const path = join(root, 'campaign.json')
  writeFileSync(path, JSON.stringify(document, null, 2))
  const result = spawnSync(process.execPath, ['scripts/evaluate-quality-campaign.mjs', path], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (result.stdout.trim().length === 0) throw new Error(result.stderr)
  return {
    status: result.status,
    report: JSON.parse(result.stdout) as {
      verdict: string
      evidence: Record<string, unknown>
      metrics: Record<string, unknown>
      reasons: string[]
    },
  }
}

describe('real-model quality campaign scorer', () => {
  it('passes complete paired evidence with positive clustered confidence bounds', () => {
    const root = mkdtempSync(join(tmpdir(), 'legion-quality-pass-'))
    try {
      const result = evaluate(root, campaign(root))
      expect(result.status).toBe(0)
      expect(result.report).toMatchObject({
        verdict: 'pass',
        evidence: { casePack: { visibility: 'development' } },
        metrics: {
          qualityDelta: { ci95: expect.any(Array) },
          evidenceDelta: { ci95: expect.any(Array) },
          criticalSafetyViolations: 0,
          winRate: 1,
          lossRate: 0,
          costRatio: { estimate: 2 },
          latencyRatio: { estimate: 2 },
        },
      })
      const metrics = result.report.metrics as {
        qualityDelta: { estimate: number }
        evidenceDelta: { estimate: number }
      }
      expect(metrics.qualityDelta.estimate).toBeCloseTo(0.3)
      expect(metrics.evidenceDelta.estimate).toBeCloseTo(0.2)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects scores edited after the adjudication receipt was issued', () => {
    const root = mkdtempSync(join(tmpdir(), 'legion-quality-tampered-'))
    try {
      const document = campaign(root)
      document.runs[0]!.scores.quality = 1
      expect(() => evaluate(root, document)).toThrow(/not bound to campaign scores and evidence/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails a critical treatment safety violation even when quality improves', () => {
    const root = mkdtempSync(join(tmpdir(), 'legion-quality-fail-'))
    try {
      const result = evaluate(root, campaign(root, { critical: true }))
      expect(result.status).not.toBe(0)
      expect(result.report.verdict).toBe('fail')
      expect(result.report.metrics).toMatchObject({ criticalSafetyViolations: 1 })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('treats a direct-arm safety_failure status as a campaign hard gate', () => {
    const root = mkdtempSync(join(tmpdir(), 'legion-quality-status-fail-'))
    try {
      const document = campaign(root)
      const direct = document.runs.find(run => run.arm === 'direct')
      if (direct === undefined) throw new Error('missing direct fixture')
      direct.status = 'safety_failure'
      direct.scores.criticalSafetyViolations = 0
      refreshAdjudication(root, document, 'blind-batch-a')
      const result = evaluate(root, document)
      expect(result.status).not.toBe(0)
      expect(result.report).toMatchObject({
        verdict: 'fail',
        metrics: { safetyFailures: 1 },
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not let an infra arm mask the paired arm safety_failure', () => {
    const root = mkdtempSync(join(tmpdir(), 'legion-quality-safety-infra-'))
    try {
      const document = campaign(root)
      const direct = document.runs.find(run => run.arm === 'direct')
      const treatment = document.runs.find(run => run.arm === 'treatment')
      if (direct === undefined || treatment === undefined) throw new Error('missing pair fixture')
      const receipt = '{"schemaVersion":"legion-infra-receipt-v1","classification":"provider-outage","receiptId":"outage-safety"}'
      writeFileSync(join(root, 'artifacts/infra.json'), receipt)
      const mutable = direct as unknown as {
        status: string
        scores?: unknown
        infraReceipt?: { uri: string; sha256: string }
      }
      mutable.status = 'infra_inconclusive'
      delete mutable.scores
      mutable.infraReceipt = { uri: 'artifacts/infra.json', sha256: sha256(receipt) }
      treatment.status = 'safety_failure'
      refreshAdjudication(root, document, 'blind-batch-a')
      const result = evaluate(root, document)
      expect(result.status).not.toBe(0)
      expect(result.report).toMatchObject({
        verdict: 'fail',
        reasons: ['one or more campaign arms had a safety_failure'],
        metrics: { safetyFailures: 1 },
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('re-scores two independent held-out campaigns against the current catalog before exposure', () => {
    const root = mkdtempSync(join(tmpdir(), 'legion-exposure-'))
    const leftRoot = join(root, 'left')
    const rightRoot = join(root, 'right')
    mkdirSync(leftRoot)
    mkdirSync(rightRoot)
    try {
      const { publicKey, privateKey } = generateKeyPairSync('ed25519')
      const trustStorePath = join(root, 'trusted-adjudicators.json')
      writeFileSync(trustStorePath, JSON.stringify({
        schemaVersion: 'legion-adjudicator-trust-v1',
        adjudicators: {
          'quality-lab': publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        },
      }))
      const openPack = JSON.parse(
        readFileSync(join(ROOT, 'benchmarks/quality/review-v1.json'), 'utf8'),
      ) as { id: string; track: string; cases: unknown[]; campaignVariant?: string }
      const leftPack = { ...openPack, id: 'held-out-review-a', campaignVariant: 'a' }
      const rightPack = { ...openPack, id: 'held-out-review-b', campaignVariant: 'b' }
      const leftPackPath = join(root, 'left-pack.json')
      const rightPackPath = join(root, 'right-pack.json')
      const leftPackBytes = JSON.stringify(leftPack, null, 2)
      const rightPackBytes = JSON.stringify(rightPack, null, 2)
      writeFileSync(leftPackPath, leftPackBytes)
      writeFileSync(rightPackPath, rightPackBytes)

      const leftDocument = campaign(leftRoot)
      leftDocument.campaign.id = 'campaign-a'
      leftDocument.campaign.casePackId = leftPack.id
      leftDocument.campaign.casePackSha256 = sha256(leftPackBytes)
      const rightDocument = campaign(rightRoot)
      rightDocument.campaign.id = 'campaign-b'
      rightDocument.campaign.startedAt = '2026-08-03T00:00:00.000Z'
      rightDocument.campaign.endedAt = '2026-08-04T00:00:00.000Z'
      rightDocument.campaign.casePackId = rightPack.id
      rightDocument.campaign.casePackSha256 = sha256(rightPackBytes)
      refreshAdjudication(leftRoot, leftDocument, 'blind-batch-a', 'quality-lab', privateKey)
      refreshAdjudication(rightRoot, rightDocument, 'blind-batch-b', 'quality-lab', privateKey)
      const left = join(leftRoot, 'campaign.json')
      const right = join(rightRoot, 'campaign.json')
      writeFileSync(left, JSON.stringify(leftDocument, null, 2))
      writeFileSync(right, JSON.stringify(rightDocument, null, 2))
      const catalogDigest = leftDocument.environment.catalogDigest
      const args = [left, right, catalogDigest, leftPackPath, rightPackPath, trustStorePath]
      const eligible = spawnSync(process.execPath, [
        'scripts/evaluate-exposure-evidence.mjs', ...args,
      ], { cwd: ROOT, encoding: 'utf8' })
      expect(eligible.status).toBe(0)
      expect(JSON.parse(eligible.stdout)).toMatchObject({ eligible: true })

      const stale = spawnSync(process.execPath, [
        'scripts/evaluate-exposure-evidence.mjs',
        left,
        right,
        `sha256:${'e'.repeat(64)}`,
        leftPackPath,
        rightPackPath,
        trustStorePath,
      ], { cwd: ROOT, encoding: 'utf8' })
      expect(stale.status).not.toBe(0)
      expect(JSON.parse(stale.stdout)).toMatchObject({
        eligible: false,
        reasons: ['campaign catalog digest is stale'],
      })

      const receiptPath = join(rightRoot, 'artifacts/adjudication.json')
      const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as { signature: string }
      receipt.signature = Buffer.from('invalid').toString('base64')
      const tamperedReceipt = JSON.stringify(receipt)
      writeFileSync(receiptPath, tamperedReceipt)
      rightDocument.campaign.adjudicationReceipt.sha256 = sha256(tamperedReceipt)
      writeFileSync(right, JSON.stringify(rightDocument, null, 2))
      const untrusted = spawnSync(process.execPath, [
        'scripts/evaluate-exposure-evidence.mjs', ...args,
      ], { cwd: ROOT, encoding: 'utf8' })
      expect(untrusted.status).not.toBe(0)
      expect(untrusted.stderr).toContain('adjudication signature is invalid or untrusted')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('is inconclusive for asymmetric infrastructure exclusion with a content-addressed receipt', () => {
    const root = mkdtempSync(join(tmpdir(), 'legion-quality-infra-'))
    try {
      const document = campaign(root)
      const direct = document.runs.find(run => run.arm === 'direct')
      if (direct === undefined) throw new Error('missing direct fixture')
      const receipt = '{"schemaVersion":"legion-infra-receipt-v1","classification":"provider-outage","receiptId":"outage-a"}'
      writeFileSync(join(root, 'artifacts/infra.json'), receipt)
      const mutable = direct as unknown as {
        status: string
        scores?: unknown
        infraReceipt?: { uri: string; sha256: string }
      }
      mutable.status = 'infra_inconclusive'
      delete mutable.scores
      mutable.infraReceipt = { uri: 'artifacts/infra.json', sha256: sha256(receipt) }
      refreshAdjudication(root, document, 'blind-batch-a')
      const result = evaluate(root, document)
      expect(result.status).not.toBe(0)
      expect(result.report).toMatchObject({
        verdict: 'inconclusive',
        reasons: ['asymmetric infrastructure exclusion is not admissible'],
        metrics: expect.any(Object),
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('is inconclusive when cost receipts are only partially available', () => {
    const root = mkdtempSync(join(tmpdir(), 'legion-quality-inconclusive-'))
    try {
      const document = campaign(root)
      for (const run of document.runs) {
        if (run.arm === 'treatment') run.usage.billedCostUsd = null
      }
      refreshAdjudication(root, document, 'blind-batch-a')
      const result = evaluate(root, document)
      expect(result.status).not.toBe(0)
      expect(result.report.verdict).toBe('inconclusive')
      expect(result.report.reasons).toContain('cost receipts are only partially available')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
