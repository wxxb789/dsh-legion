import { createHash, createPublicKey, verify } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const STATUS = new Set(['valid', 'task_failure', 'safety_failure', 'infra_inconclusive', 'invalid_artifact'])
const ARMS = ['direct', 'treatment']

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function percentile(values, probability) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(probability * sorted.length))]
}

function bootstrap(values, replicates, seed, transform = value => value) {
  let state = seed >>> 0
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
  const samples = []
  for (let replicate = 0; replicate < replicates; replicate += 1) {
    const selected = Array.from({ length: values.length }, () => values[Math.floor(next() * values.length)])
    samples.push(transform(mean(selected)))
  }
  return {
    estimate: transform(mean(values)),
    ci95: [percentile(samples, 0.025), percentile(samples, 0.975)],
  }
}

function assertNumber(value, at, options = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${at} must be finite`)
  if (options.min !== undefined && value < options.min) throw new Error(`${at} is below minimum`)
  if (options.max !== undefined && value > options.max) throw new Error(`${at} exceeds maximum`)
  return value
}

async function readArtifact(campaignDirectory, uri, cache) {
  const cached = cache.get(uri)
  if (cached !== undefined) return cached
  const task = (async () => {
    const base = await realpath(campaignDirectory)
    const lexical = resolve(base, uri)
    let segmentPath = base
    for (const segment of uri.split('/')) {
      segmentPath = resolve(segmentPath, segment)
      if ((await lstat(segmentPath)).isSymbolicLink()) {
        throw new Error('run artifact crosses a symbolic link')
      }
    }
    const target = await realpath(lexical)
    const path = relative(base, target)
    if (isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`)) {
      throw new Error('run artifact resolves outside the campaign')
    }
    return readFile(target)
  })()
  cache.set(uri, task)
  return task
}

async function validateContentRef(reference, campaignDirectory, artifactCache, at) {
  if (typeof reference?.uri !== 'string'
    || reference.uri.length === 0
    || reference.uri.startsWith('/')
    || reference.uri.includes('\\')
    || reference.uri.split('/').some(segment => segment === '' || segment === '.' || segment === '..')
    || typeof reference?.sha256 !== 'string'
    || !/^sha256:[a-f0-9]{64}$/.test(reference.sha256)) {
    throw new Error(`${at} content reference is invalid`)
  }
  const bytes = await readArtifact(campaignDirectory, reference.uri, artifactCache)
  if (sha256(bytes) !== reference.sha256) throw new Error(`${at} content digest mismatch`)
  return reference
}

async function validateRun(run, caseIds, campaignDirectory, artifactCache) {
  if (typeof run !== 'object' || run === null || Array.isArray(run)) throw new Error('run must be an object')
  if (!caseIds.has(run.caseId)) throw new Error(`unknown caseId ${String(run.caseId)}`)
  if (!Number.isInteger(run.repeat) || run.repeat < 1 || run.repeat > 3) throw new Error('repeat must be 1..3')
  if (!ARMS.includes(run.arm)) throw new Error('arm must be direct or treatment')
  if (![1, 2].includes(run.order)) throw new Error('run order must be 1 or 2')
  if (!STATUS.has(run.status)) throw new Error('unknown run status')
  if (run.pairId !== `${run.caseId}-r${String(run.repeat)}`) throw new Error('pairId mismatch')
  if (typeof run.exposure !== 'string' || typeof run.provenance?.model !== 'string') {
    throw new Error('run exposure or model provenance is invalid')
  }
  await Promise.all([
    validateContentRef(run.artifact, campaignDirectory, artifactCache, 'run artifact'),
    validateContentRef(run.provenance?.input, campaignDirectory, artifactCache, 'input provenance'),
    validateContentRef(run.provenance?.config, campaignDirectory, artifactCache, 'config provenance'),
    validateContentRef(run.provenance?.budget, campaignDirectory, artifactCache, 'budget provenance'),
    validateContentRef(run.provenance?.plan, campaignDirectory, artifactCache, 'plan provenance'),
  ])
  if (run.status === 'infra_inconclusive') {
    await validateContentRef(run.infraReceipt, campaignDirectory, artifactCache, 'infra receipt')
    const receipt = JSON.parse((await readArtifact(
      campaignDirectory,
      run.infraReceipt.uri,
      artifactCache,
    )).toString('utf8'))
    if (receipt.schemaVersion !== 'legion-infra-receipt-v1'
      || !['provider-outage', 'rate-limit', 'credential', 'quota', 'worker-lost', 'artifact-store'].includes(receipt.classification)
      || typeof receipt.receiptId !== 'string') {
      throw new Error('infra receipt classification is invalid')
    }
    if (run.scores !== undefined) throw new Error('infra run must not contain task scores')
  } else if (run.infraReceipt !== undefined) {
    throw new Error('non-infra run cannot contain an infra receipt')
  }
  if (run.status !== 'infra_inconclusive' && run.status !== 'invalid_artifact') {
    assertNumber(run.scores?.quality, 'scores.quality', { min: 0, max: 1 })
    assertNumber(run.scores?.safety, 'scores.safety', { min: 0, max: 1 })
    assertNumber(run.scores?.evidence, 'scores.evidence', { min: 0, max: 1 })
    assertNumber(run.scores?.criticalSafetyViolations, 'scores.criticalSafetyViolations', { min: 0 })
  }
  const started = assertNumber(run.timing?.startedMonotonicMs, 'timing.startedMonotonicMs')
  const ended = assertNumber(run.timing?.endedMonotonicMs, 'timing.endedMonotonicMs')
  if (ended <= started) throw new Error('run timing must have positive duration')
  if (typeof run.usage !== 'object' || run.usage === null) throw new Error('run usage is missing')
  for (const key of ['inputTokens', 'outputTokens']) {
    if (run.usage[key] !== null) assertNumber(run.usage[key], `usage.${key}`, { min: 0 })
  }
  if (run.usage.billedCostUsd !== null) {
    assertNumber(run.usage.billedCostUsd, 'usage.billedCostUsd', { min: 0 })
  }
  return run
}

function pairedMetric(pairs, field) {
  const byCase = new Map()
  for (const pair of pairs) {
    const values = byCase.get(pair.caseId) ?? []
    values.push(pair.treatment.scores[field] - pair.direct.scores[field])
    byCase.set(pair.caseId, values)
  }
  return [...byCase.values()].map(mean)
}

function pairedLogRatio(pairs, selector) {
  const byCase = new Map()
  for (const pair of pairs) {
    const direct = selector(pair.direct)
    const treatment = selector(pair.treatment)
    if (typeof direct !== 'number' || typeof treatment !== 'number' || direct <= 0 || treatment <= 0) {
      return undefined
    }
    const values = byCase.get(pair.caseId) ?? []
    values.push(Math.log(treatment / direct))
    byCase.set(pair.caseId, values)
  }
  return [...byCase.values()].map(mean)
}

export async function evaluateQualityCampaign(campaignPath, casePackOverride, trustStoreOverride) {
  const campaignBytes = await readFile(campaignPath)
  const campaign = JSON.parse(campaignBytes.toString('utf8'))
  if (campaign.schemaVersion !== 'legion-quality-campaign-v1') throw new Error('unsupported campaign schema')
  const track = campaign.campaign?.strategy
  if (!['independent-review', 'research-panel'].includes(track)) throw new Error('unsupported campaign strategy')
  if (typeof campaign.campaign?.id !== 'string'
    || !Number.isFinite(Date.parse(campaign.campaign?.startedAt))
    || !Number.isFinite(Date.parse(campaign.campaign?.endedAt))
    || Date.parse(campaign.campaign.endedAt) <= Date.parse(campaign.campaign.startedAt)) {
    throw new Error('campaign metadata is incomplete')
  }
  const openCasePackPath = resolve(
    root,
    'benchmarks',
    'quality',
    track === 'independent-review' ? 'review-v1.json' : 'research-v1.json',
  )
  const casePackPath = casePackOverride === undefined ? openCasePackPath : resolve(casePackOverride)
  const thresholdPath = resolve(root, 'benchmarks', 'quality', 'thresholds-v1.json')
  const [casePackBytes, openCasePackBytes, thresholdBytes] = await Promise.all([
    readFile(casePackPath),
    readFile(openCasePackPath),
    readFile(thresholdPath),
  ])
  const casePackVisibility = sha256(casePackBytes) === sha256(openCasePackBytes)
    ? 'development'
    : 'held-out'
  const casePack = JSON.parse(casePackBytes.toString('utf8'))
  const thresholds = JSON.parse(thresholdBytes.toString('utf8'))
  if (campaign.campaign.casePackId !== casePack.id
    || campaign.campaign.casePackSha256 !== sha256(casePackBytes)
    || campaign.campaign.thresholdsSha256 !== sha256(thresholdBytes)
    || !/^sha256:[a-f0-9]{64}$/.test(campaign.environment?.catalogDigest ?? '')
    || typeof campaign.environment?.executionCommit !== 'string') {
    throw new Error('campaign evidence digest mismatch')
  }
  if (casePack.track !== track || casePack.cases.length !== thresholds.caseCount) {
    throw new Error('case pack does not match campaign track or threshold count')
  }
  const caseIds = new Set(casePack.cases.map(item => item.id))
  if (caseIds.size !== thresholds.caseCount) throw new Error('case pack IDs are not unique')
  if (!Array.isArray(campaign.runs)) throw new Error('campaign runs must be an array')
  const artifactCache = new Map()
  const campaignDirectory = dirname(resolve(campaignPath))
  await Promise.all([
    validateContentRef(campaign.campaign.rubric, campaignDirectory, artifactCache, 'rubric'),
    validateContentRef(
      campaign.campaign.adjudicationReceipt,
      campaignDirectory,
      artifactCache,
      'adjudication receipt',
    ),
  ])
  const adjudication = JSON.parse((await readArtifact(
    campaignDirectory,
    campaign.campaign.adjudicationReceipt.uri,
    artifactCache,
  )).toString('utf8'))
  if (adjudication.schemaVersion !== 'legion-adjudication-receipt-v1'
    || typeof adjudication.batchId !== 'string'
    || typeof adjudication.signerId !== 'string'
    || typeof adjudication.payload !== 'object'
    || adjudication.payload === null
    || adjudication.blinded !== true) {
    throw new Error('adjudication receipt is invalid or not blinded')
  }
  const runs = await Promise.all(
    campaign.runs.map(run => validateRun(
      run,
      caseIds,
      campaignDirectory,
      artifactCache,
    )),
  )
  const expectedRuns = thresholds.caseCount * thresholds.repeats * 2
  if (runs.length !== expectedRuns) throw new Error(`campaign requires exactly ${String(expectedRuns)} runs`)
  const scoredRunRecords = [...runs]
    .sort((left, right) => `${left.pairId}:${left.arm}`.localeCompare(`${right.pairId}:${right.arm}`))
  const expectedAdjudicationPayload = {
    casePackSha256: sha256(casePackBytes),
    rubricSha256: campaign.campaign.rubric.sha256,
    thresholdsSha256: sha256(thresholdBytes),
    scoredRunsSha256: sha256(canonical(scoredRunRecords)),
  }
  if (canonical(adjudication.payload) !== canonical(expectedAdjudicationPayload)) {
    throw new Error('adjudication receipt is not bound to campaign scores and evidence')
  }
  if (casePackVisibility === 'held-out') {
    if (trustStoreOverride === undefined) throw new Error('held-out campaign requires a trusted adjudicator store')
    const trustStore = JSON.parse(await readFile(resolve(trustStoreOverride), 'utf8'))
    const publicKey = trustStore.schemaVersion === 'legion-adjudicator-trust-v1'
      ? trustStore.adjudicators?.[adjudication.signerId]
      : undefined
    if (typeof publicKey !== 'string'
      || typeof adjudication.signature !== 'string'
      || !verify(
        null,
        Buffer.from(canonical(adjudication.payload)),
        createPublicKey(publicKey),
        Buffer.from(adjudication.signature, 'base64'),
      )) {
      throw new Error('held-out adjudication signature is invalid or untrusted')
    }
  }

  const safetyFailures = runs.filter(run => run.status === 'safety_failure').length
  const pairs = []
  const infraPairs = []
  const asymmetricInfraPairs = []
  for (const caseId of caseIds) {
    for (let repeat = 1; repeat <= thresholds.repeats; repeat += 1) {
      const pairRuns = runs.filter(run => run.caseId === caseId && run.repeat === repeat)
      const direct = pairRuns.find(run => run.arm === 'direct')
      const treatment = pairRuns.find(run => run.arm === 'treatment')
      if (pairRuns.length !== 2 || direct === undefined || treatment === undefined) {
        throw new Error(`incomplete or duplicate pair ${caseId}-r${String(repeat)}`)
      }
      const expectedDirectOrder = repeat % 2 === 1 ? 1 : 2
      if (direct.order !== expectedDirectOrder
        || treatment.order === direct.order
        || direct.exposure !== 'direct-delegation'
        || treatment.exposure !== `strategy:${track}`) {
        throw new Error(`pair exposure or balanced order mismatch ${direct.pairId}`)
      }
      if (direct.provenance.input.sha256 !== treatment.provenance.input.sha256
        || direct.provenance.model !== treatment.provenance.model
        || direct.provenance.config.sha256 !== treatment.provenance.config.sha256
        || direct.provenance.budget.sha256 !== treatment.provenance.budget.sha256) {
        throw new Error(`pair provenance mismatch ${direct.pairId}`)
      }
      if (direct.status === 'invalid_artifact' || treatment.status === 'invalid_artifact') {
        throw new Error(`invalid artifact in pair ${direct.pairId}`)
      }
      const directInfra = direct.status === 'infra_inconclusive'
      const treatmentInfra = treatment.status === 'infra_inconclusive'
      if (directInfra || treatmentInfra) {
        const record = { caseId, direct: direct.status, treatment: treatment.status }
        infraPairs.push(record)
        if (directInfra !== treatmentInfra) asymmetricInfraPairs.push(record)
      } else {
        pairs.push({ caseId, direct, treatment })
      }
    }
  }
  const validPairCounts = new Map()
  for (const pair of pairs) validPairCounts.set(pair.caseId, (validPairCounts.get(pair.caseId) ?? 0) + 1)
  const validCases = [...validPairCounts.values()]
    .filter(count => count >= thresholds.minimumValidRepeatsPerCase)
    .length
  const reasons = []
  let verdict = safetyFailures > 0 ? 'fail' : 'pass'
  if (safetyFailures > 0) reasons.push('one or more campaign arms had a safety_failure')
  if (verdict === 'pass'
    && (validCases < thresholds.minimumValidCases
      || infraPairs.length > thresholds.maximumInfraPairs
      || asymmetricInfraPairs.length > 0)) {
    verdict = 'inconclusive'
    reasons.push(asymmetricInfraPairs.length > 0
      ? 'asymmetric infrastructure exclusion is not admissible'
      : 'insufficient complete paired evidence')
  }
  const quality = pairedMetric(pairs, 'quality')
  const evidence = pairedMetric(pairs, 'evidence')
  const qualityMetric = quality.length === 0
    ? undefined
    : bootstrap(quality, thresholds.bootstrapReplicates, thresholds.bootstrapSeed)
  const evidenceMetric = evidence.length === 0
    ? undefined
    : bootstrap(evidence, thresholds.bootstrapReplicates, thresholds.bootstrapSeed + 1)
  const costLogs = pairedLogRatio(pairs, run => run.usage.billedCostUsd)
  const latencyLogs = pairedLogRatio(
    pairs,
    run => run.timing.endedMonotonicMs - run.timing.startedMonotonicMs,
  )
  const costMetric = costLogs === undefined
    ? undefined
    : bootstrap(costLogs, thresholds.bootstrapReplicates, thresholds.bootstrapSeed + 2, Math.exp)
  const latencyMetric = latencyLogs === undefined
    ? undefined
    : bootstrap(latencyLogs, thresholds.bootstrapReplicates, thresholds.bootstrapSeed + 3, Math.exp)
  const wins = pairs.filter(pair => pair.treatment.scores.quality > pair.direct.scores.quality).length
  const losses = pairs.filter(pair => pair.treatment.scores.quality < pair.direct.scores.quality).length
  const treatmentSafety = pairs.length === 0 ? 0 : mean(pairs.map(pair => pair.treatment.scores.safety))
  const critical = pairs.reduce(
    (total, pair) => total + pair.treatment.scores.criticalSafetyViolations,
    0,
  )
  if (verdict === 'pass' && (qualityMetric === undefined
    || qualityMetric.ci95[0] <= thresholds.minimumQualityDelta
    || evidenceMetric === undefined
    || evidenceMetric.ci95[0] < thresholds.minimumEvidenceDelta
    || treatmentSafety < thresholds.minimumTreatmentSafety
    || critical > thresholds.maximumCriticalSafetyViolations
    || safetyFailures > 0
    || wins / pairs.length < thresholds.minimumWinRate
    || losses / pairs.length > thresholds.maximumLossRate)) {
    verdict = 'fail'
    reasons.push('quality, evidence, or safety threshold failed')
  }
  const hardBudget = campaign.environment?.deploymentHardBudget === true
  const costReceiptCount = pairs.reduce(
    (count, pair) => count
      + (typeof pair.direct.usage.billedCostUsd === 'number' ? 1 : 0)
      + (typeof pair.treatment.usage.billedCostUsd === 'number' ? 1 : 0),
    0,
  )
  if (verdict === 'pass' && costReceiptCount > 0 && costReceiptCount < pairs.length * 2) {
    verdict = 'inconclusive'
    reasons.push('cost receipts are only partially available')
  } else if (verdict === 'pass' && costMetric === undefined && !hardBudget) {
    verdict = 'inconclusive'
    reasons.push('cost receipts unavailable and no deployment hard budget recorded')
  } else if (verdict === 'pass'
    && costMetric !== undefined
    && costMetric.ci95[1] > thresholds.maximumCostRatio[track]) {
    verdict = 'fail'
    reasons.push('cost ratio threshold failed')
  }
  if (verdict === 'pass'
    && (latencyMetric === undefined
      || latencyMetric.ci95[1] > thresholds.maximumLatencyRatio[track])) {
    verdict = latencyMetric === undefined ? 'inconclusive' : 'fail'
    reasons.push('latency ratio threshold failed')
  }
  return {
    schemaVersion: 'legion-quality-score-v1',
    campaignId: campaign.campaign.id,
    strategy: track,
    verdict,
    evidence: {
      campaignSha256: sha256(campaignBytes),
      casePack: {
        id: casePack.id,
        sha256: sha256(casePackBytes),
        visibility: casePackVisibility,
      },
      thresholdsSha256: sha256(thresholdBytes),
      rubricSha256: campaign.campaign.rubric.sha256,
      adjudicationReceiptSha256: campaign.campaign.adjudicationReceipt.sha256,
      adjudicationBatch: adjudication.batchId,
      catalogDigest: campaign.environment?.catalogDigest,
      executionCommit: campaign.environment?.executionCommit,
      startedAt: campaign.campaign.startedAt,
      endedAt: campaign.campaign.endedAt,
    },
    counts: {
      expectedPairs: thresholds.caseCount * thresholds.repeats,
      validPairs: pairs.length,
      validCases,
      infraPairs: infraPairs.length,
      asymmetricInfraPairs: asymmetricInfraPairs.length,
    },
    metrics: {
      qualityDelta: qualityMetric,
      evidenceDelta: evidenceMetric,
      treatmentSafety,
      criticalSafetyViolations: critical,
      safetyFailures,
      winRate: pairs.length === 0 ? 0 : wins / pairs.length,
      lossRate: pairs.length === 0 ? 0 : losses / pairs.length,
      costRatio: costMetric,
      latencyRatio: latencyMetric,
    },
    bootstrap: {
      unit: 'case',
      replicates: thresholds.bootstrapReplicates,
      seed: thresholds.bootstrapSeed,
    },
    reasons,
  }
}

const invoked = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invoked) {
  const campaignPath = process.argv[2]
  const casePackPath = process.argv[3]
  const trustStorePath = process.argv[4]
  if (campaignPath === undefined) {
    throw new Error(
      'usage: evaluate-quality-campaign.mjs <campaign.json> '
      + '[held-out-case-pack.json trusted-adjudicators.json]',
    )
  }
  const result = await evaluateQualityCampaign(
    resolve(campaignPath),
    casePackPath === undefined ? undefined : resolve(casePackPath),
    trustStorePath === undefined ? undefined : resolve(trustStorePath),
  )
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  if (result.verdict !== 'pass') process.exitCode = 1
}
