import { snapshotJsonValue } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session/types'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { ProfileName, StrategyName } from '../identity.ts'
import {
  ArtifactDigest,
  AuthorityDigest,
  AttemptId,
  ContextDigest,
  ContextGeneration,
  EnvironmentDigest,
  Fence,
  GoalVersion,
  ContinuationId,
  MailId,
  ReservationId,
  PlanDigest,
  PlanVersion,
  RoutePlanDigest,
  StrategyPlanDigest,
  CatalogDigest,
  RUN_STATUSES,
  RunId,
  TASK_STATUSES,
  ATTEMPT_STATUSES,
  TaskId,
  trustedRecord,
} from './contract.ts'
import { materializePlanGraph } from './graph.ts'
import { createAuthorityEnvelope } from './plan-delta.ts'
import { materializeAttemptBinding } from './attempt-binding.ts'
import {
  isLegionEventType,
  type LegionEvent,
  type LegionEventType,
} from './events.ts'

function record(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`dsh-legion: ${at} must be an object`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`dsh-legion: ${at} must be a plain object`)
  }
  return value as Record<string, unknown>
}

function assertKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  at: string,
): void {
  const known = new Set(allowed)
  const unknown = Object.keys(value).filter(key => !known.has(key))
  if (unknown.length > 0) {
    throw new Error(`dsh-legion: ${at} contains unknown field(s): ${unknown.sort().join(', ')}`)
  }
}

function text(value: unknown, at: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`dsh-legion: ${at} must be a non-empty string`)
  }
  return value
}

function natural(value: unknown, at: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`dsh-legion: ${at} must be a non-negative safe integer`)
  }
  return value as number
}

function stringList(value: unknown, at: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`dsh-legion: ${at} must be an array`)
  return value.map((entry, index) => text(entry, `${at}[${index}]`))
}

function choice<Value extends string>(
  value: unknown,
  values: readonly Value[],
  at: string,
): Value {
  if (typeof value !== 'string' || !values.includes(value as Value)) {
    throw new Error(`dsh-legion: invalid ${at}`)
  }
  return value as Value
}

function parseArtifact(value: unknown): SessionEventMap['legion/task-state']['record']['acceptedArtifacts'][number] {
  const source = record(value, 'artifact')
  assertKeys(source, ['name', 'digest', 'mediaType', 'byteLength'], 'artifact')
  return {
    name: text(source.name, 'artifact.name'),
    digest: ArtifactDigest(source.digest),
    mediaType: text(source.mediaType, 'artifact.mediaType'),
    byteLength: natural(source.byteLength, 'artifact.byteLength'),
  }
}

function parseGoal(value: unknown): SessionEventMap['legion/run-state']['record']['goal'] {
  const source = record(value, 'goal')
  assertKeys(source, ['version', 'statement', 'acceptance', 'constraints', 'nonGoals', 'authorityDigest'], 'goal')
  return {
    version: GoalVersion(source.version),
    statement: text(source.statement, 'goal.statement'),
    acceptance: stringList(source.acceptance, 'goal.acceptance'),
    constraints: stringList(source.constraints, 'goal.constraints'),
    nonGoals: stringList(source.nonGoals, 'goal.nonGoals'),
    authorityDigest: ArtifactDigest(source.authorityDigest),
  }
}

function parseRunRecord(value: unknown): SessionEventMap['legion/run-state']['record'] {
  const source = record(value, 'run record')
  assertKeys(source, [
    'schemaVersion', 'runId', 'anchorSessionId', 'strategyName', 'strategyPlanDigest', 'catalogDigest', 'goalVersion', 'goal',
    'currentPlanVersion', 'status', 'currentMilestone', 'fence', 'environmentDigest',
    'contextDigest', 'createdAt', 'updatedAt', 'terminalSummary',
  ], 'run record')
  if (source.schemaVersion !== 1) throw new Error('dsh-legion: invalid run record schemaVersion')
  return {
    schemaVersion: 1,
    runId: RunId(source.runId),
    anchorSessionId: SessionId(text(source.anchorSessionId, 'anchorSessionId')),
    strategyName: StrategyName(text(source.strategyName, 'strategyName')),
    strategyPlanDigest: StrategyPlanDigest(text(source.strategyPlanDigest, 'strategyPlanDigest')),
    catalogDigest: CatalogDigest(text(source.catalogDigest, 'catalogDigest')),
    goalVersion: GoalVersion(source.goalVersion),
    goal: parseGoal(source.goal),
    currentPlanVersion: PlanVersion(source.currentPlanVersion),
    status: choice(source.status, RUN_STATUSES, 'run status'),
    ...(source.currentMilestone === undefined ? {} : { currentMilestone: text(source.currentMilestone, 'currentMilestone') }),
    ...(source.fence === undefined ? {} : { fence: Fence(source.fence) }),
    environmentDigest: EnvironmentDigest(source.environmentDigest),
    ...(source.contextDigest === undefined ? {} : { contextDigest: ContextDigest(source.contextDigest) }),
    createdAt: natural(source.createdAt, 'createdAt'),
    updatedAt: natural(source.updatedAt, 'updatedAt'),
    ...(source.terminalSummary === undefined ? {} : { terminalSummary: text(source.terminalSummary, 'terminalSummary') }),
  }
}

function parsePlanRecord(value: unknown): SessionEventMap['legion/plan-state']['record'] {
  const source = record(value, 'plan record')
  assertKeys(
    source,
    [
      'schemaVersion', 'runId', 'version', 'goalVersion', 'digest',
      'nodeCount', 'environmentDigest', 'graph',
    ],
    'plan record',
  )
  if (source.schemaVersion !== 1) {
    throw new Error('dsh-legion: invalid plan record schemaVersion')
  }
  const version = PlanVersion(source.version)
  const goalVersion = GoalVersion(source.goalVersion)
  const digest = PlanDigest(source.digest)
  const nodeCount = natural(source.nodeCount, 'nodeCount')
  const graph = source.graph === undefined ? undefined : materializePlanGraph(source.graph)
  if (graph !== undefined
    && (graph.planVersion !== version
      || graph.goalVersion !== goalVersion
      || graph.digest !== digest
      || Object.keys(graph.nodes).length !== nodeCount)) {
    throw new Error('dsh-legion: plan record does not match its full graph')
  }
  return {
    schemaVersion: 1,
    runId: RunId(source.runId),
    version,
    goalVersion,
    digest,
    nodeCount,
    environmentDigest: EnvironmentDigest(source.environmentDigest),
    ...(graph === undefined ? {} : { graph }),
  }
}

function parseTaskRecord(value: unknown): SessionEventMap['legion/task-state']['record'] {
  const source = record(value, 'task record')
  assertKeys(source, ['schemaVersion', 'taskId', 'planVersion', 'generation', 'status', 'currentAttempt', 'acceptedArtifacts', 'contextDigest', 'failure', 'updatedAt'], 'task record')
  if (source.schemaVersion !== 1) throw new Error('dsh-legion: invalid task record schemaVersion')
  if (!Array.isArray(source.acceptedArtifacts)) throw new Error('dsh-legion: acceptedArtifacts must be an array')
  return {
    schemaVersion: 1,
    taskId: TaskId(source.taskId),
    planVersion: PlanVersion(source.planVersion),
    generation: natural(source.generation, 'generation'),
    status: choice(source.status, TASK_STATUSES, 'task status'),
    ...(source.currentAttempt === undefined ? {} : { currentAttempt: AttemptId(source.currentAttempt) }),
    acceptedArtifacts: source.acceptedArtifacts.map(parseArtifact),
    ...(source.contextDigest === undefined ? {} : { contextDigest: ContextDigest(source.contextDigest) }),
    ...(source.failure === undefined ? {} : { failure: text(source.failure, 'failure') }),
    updatedAt: natural(source.updatedAt, 'updatedAt'),
  }
}

function parseOwnerFingerprint(value: unknown) {
  const source = record(value, 'owner fingerprint')
  assertKeys(
    source,
    ['hostInstanceId', 'processBootId', 'pluginGeneration', 'anchorSessionId', 'activationId'],
    'owner fingerprint',
  )
  return {
    hostInstanceId: text(source.hostInstanceId, 'owner.hostInstanceId'),
    processBootId: text(source.processBootId, 'owner.processBootId'),
    pluginGeneration: text(source.pluginGeneration, 'owner.pluginGeneration'),
    anchorSessionId: text(source.anchorSessionId, 'owner.anchorSessionId'),
    activationId: text(source.activationId, 'owner.activationId'),
  }
}

function parseResultEnvelope(
  value: unknown,
): NonNullable<SessionEventMap['legion/attempt-state']['record']['result']> {
  const source = record(value, 'result envelope')
  assertKeys(source, [
    'schemaVersion', 'taskId', 'attemptId', 'generation', 'fence', 'runId',
    'planVersion', 'routePlanDigest', 'environmentDigest', 'contextDigest',
    'summary', 'artifacts', 'evidence', 'decisions', 'verification', 'openRisks',
    'progress',
  ], 'result envelope')
  if (source.schemaVersion !== 1) throw new Error('dsh-legion: invalid result schemaVersion')
  if (!Array.isArray(source.artifacts)
    || !Array.isArray(source.evidence)
    || !Array.isArray(source.decisions)
    || !Array.isArray(source.verification)) {
    throw new Error('dsh-legion: invalid result collections')
  }
  const progress = record(deepJson(source.progress), 'result progress')
  return {
    schemaVersion: 1,
    taskId: TaskId(source.taskId),
    attemptId: AttemptId(source.attemptId),
    generation: natural(source.generation, 'result generation'),
    fence: Fence(source.fence),
    runId: RunId(source.runId),
    planVersion: PlanVersion(source.planVersion),
    routePlanDigest: RoutePlanDigest(text(source.routePlanDigest, 'result routePlanDigest')),
    environmentDigest: EnvironmentDigest(source.environmentDigest),
    ...(source.contextDigest === undefined ? {} : { contextDigest: ContextDigest(source.contextDigest) }),
    summary: text(source.summary, 'result summary'),
    artifacts: source.artifacts.map(parseArtifact),
    evidence: source.evidence.map(parseArtifact),
    decisions: source.decisions.map((item, index) =>
      record(deepJson(item), `result decisions[${index}]`)),
    verification: source.verification.map((item, index) =>
      record(deepJson(item), `result verification[${index}]`)),
    openRisks: stringList(source.openRisks, 'result openRisks'),
    progress,
  }
}

function parseAttemptRecord(value: unknown): SessionEventMap['legion/attempt-state']['record'] {
  const source = record(value, 'attempt record')
  assertKeys(source, [
    'schemaVersion', 'attemptId', 'taskId', 'planVersion', 'generation', 'fence',
    'owner', 'effectClass', 'idempotencyKey', 'profile', 'binding', 'routePlanDigest', 'status',
    'environmentDigest', 'contextDigest', 'childSessionIds', 'result', 'failure',
    'updatedAt',
  ], 'attempt record')
  if (source.schemaVersion !== 1) throw new Error('dsh-legion: invalid attempt record schemaVersion')
  if (!Array.isArray(source.childSessionIds)) throw new Error('dsh-legion: childSessionIds must be an array')
  return {
    schemaVersion: 1,
    attemptId: AttemptId(source.attemptId),
    taskId: TaskId(source.taskId),
    planVersion: PlanVersion(source.planVersion),
    generation: natural(source.generation, 'generation'),
    fence: Fence(source.fence),
    owner: parseOwnerFingerprint(source.owner),
    effectClass: choice(
      source.effectClass,
      ['read', 'idempotent-write', 'non-idempotent-write'] as const,
      'effectClass',
    ),
    ...(source.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: text(source.idempotencyKey, 'idempotencyKey') }),
    profile: ProfileName(text(source.profile, 'profile')),
    ...(source.binding === undefined
      ? {}
      : { binding: materializeAttemptBinding(deepJson(source.binding)) }),
    routePlanDigest: RoutePlanDigest(text(source.routePlanDigest, 'routePlanDigest')),
    status: choice(source.status, ATTEMPT_STATUSES, 'attempt status'),
    environmentDigest: EnvironmentDigest(source.environmentDigest),
    ...(source.contextDigest === undefined ? {} : { contextDigest: ContextDigest(source.contextDigest) }),
    childSessionIds: source.childSessionIds.map((id, index) => SessionId(text(id, `childSessionIds[${index}]`))),
    ...(source.result === undefined ? {} : { result: parseResultEnvelope(source.result) }),
    ...(source.failure === undefined ? {} : { failure: text(source.failure, 'failure') }),
    updatedAt: natural(source.updatedAt, 'updatedAt'),
  }
}


function parseMailRecord(value: unknown): import('./contract.ts').MailRecord {
  const source = record(value, 'mail record')
  const status = choice(
    source.status,
    ['queued', 'reserved', 'incorporated', 'acknowledged', 'discarded'] as const,
    'mail status',
  )
  const common = [
    'schemaVersion', 'status', 'message', 'recipientGeneration', 'reclaimCount',
    'updatedAt',
  ]
  const fields = status === 'reserved'
    ? ['reservation']
    : status === 'incorporated'
      ? ['reservation', 'contextGeneration', 'contextManifestDigest',
          'sharedPrefixDigest', 'receiptDigest', 'incorporatedAt']
      : status === 'acknowledged'
        ? ['reservation', 'contextGeneration', 'contextManifestDigest',
            'sharedPrefixDigest', 'receiptDigest', 'incorporatedAt', 'acknowledgedAt']
        : status === 'discarded' ? ['reason', 'discardedAt'] : []
  assertKeys(source, [...common, ...fields], 'mail record')
  if (source.schemaVersion !== 1) throw new Error('dsh-legion: invalid mail schemaVersion')

  const messageSource = record(source.message, 'mail message')
  assertKeys(messageSource, [
    'mailId', 'runId', 'sender', 'recipientTaskId', 'kind', 'payload',
    'idempotencyKey', 'createdAt', 'expiresAt',
  ], 'mail message')
  const senderSource = record(messageSource.sender, 'mail sender')
  assertKeys(senderSource, ['kind', 'id'], 'mail sender')
  const senderKind = choice(
    senderSource.kind,
    ['controller', 'task', 'user'] as const,
    'mail sender kind',
  )
  if (!Array.isArray(messageSource.payload)) {
    throw new Error('dsh-legion: mail payload must be an array')
  }
  const message = {
    mailId: MailId(messageSource.mailId),
    runId: RunId(messageSource.runId),
    sender: senderKind === 'task'
      ? { kind: senderKind, id: TaskId(senderSource.id) }
      : { kind: senderKind, id: text(senderSource.id, 'mail sender id') },
    recipientTaskId: TaskId(messageSource.recipientTaskId),
    kind: choice(
      messageSource.kind,
      ['assignment', 'evidence', 'decision', 'steer', 'cancel'] as const,
      'mail kind',
    ),
    payload: messageSource.payload.map(parseArtifact),
    idempotencyKey: text(messageSource.idempotencyKey, 'idempotencyKey'),
    createdAt: natural(messageSource.createdAt, 'createdAt'),
    ...(messageSource.expiresAt === undefined
      ? {}
      : { expiresAt: natural(messageSource.expiresAt, 'expiresAt') }),
  }
  const base = {
    schemaVersion: 1 as const,
    message,
    recipientGeneration: natural(source.recipientGeneration, 'recipientGeneration'),
    reclaimCount: natural(source.reclaimCount, 'reclaimCount'),
    updatedAt: natural(source.updatedAt, 'updatedAt'),
  }
  const reservation = () => {
    const candidate = record(source.reservation, 'mail reservation')
    assertKeys(
      candidate,
      ['reservationId', 'owner', 'fence', 'reservedAt', 'expiresAt'],
      'mail reservation',
    )
    const reservedAt = natural(candidate.reservedAt, 'reservedAt')
    const expiresAt = natural(candidate.expiresAt, 'expiresAt')
    if (expiresAt <= reservedAt) throw new Error('dsh-legion: invalid mail reservation expiry')
    return {
      reservationId: ReservationId(candidate.reservationId),
      owner: parseOwnerFingerprint(candidate.owner),
      fence: Fence(candidate.fence),
      reservedAt,
      expiresAt,
    }
  }
  const incorporated = () => {
    const reserved = reservation()
    const incorporatedAt = natural(source.incorporatedAt, 'incorporatedAt')
    if (incorporatedAt < reserved.reservedAt) {
      throw new Error('dsh-legion: mail incorporation precedes reservation')
    }
    return {
      reservation: reserved,
      contextGeneration: ContextGeneration(source.contextGeneration),
      contextManifestDigest: ContextDigest(source.contextManifestDigest),
      sharedPrefixDigest: ContextDigest(source.sharedPrefixDigest),
      receiptDigest: ArtifactDigest(source.receiptDigest),
      incorporatedAt,
    }
  }
  if (status === 'queued') return { ...base, status }
  if (status === 'reserved') return { ...base, status, reservation: reservation() }
  if (status === 'incorporated') return { ...base, status, ...incorporated() }
  if (status === 'acknowledged') {
    const incorporation = incorporated()
    const acknowledgedAt = natural(source.acknowledgedAt, 'acknowledgedAt')
    if (acknowledgedAt < incorporation.incorporatedAt) {
      throw new Error('dsh-legion: mail acknowledgement precedes incorporation')
    }
    return { ...base, status, ...incorporation, acknowledgedAt }
  }
  return {
    ...base,
    status,
    reason: choice(
      source.reason,
      ['expired', 'recipient-terminal', 'superseded', 'policy'] as const,
      'discard reason',
    ),
    discardedAt: natural(source.discardedAt, 'discardedAt'),
  }
}


function parseContinuationRecord(value: unknown): import('./contract.ts').ContinuationRecord {
  const source = record(value, 'continuation record')
  const status = choice(
    source.status,
    ['available', 'consumed', 'invalidated'] as const,
    'continuation status',
  )
  const extra = status === 'consumed'
    ? ['consumedAt', 'consumingFence']
    : status === 'invalidated' ? ['invalidatedAt', 'reason'] : []
  assertKeys(
    source,
    ['schemaVersion', 'continuationId', 'status', 'token', 'updatedAt', ...extra],
    'continuation record',
  )
  if (source.schemaVersion !== 1) throw new Error('dsh-legion: invalid continuation schemaVersion')
  const tokenSource = record(source.token, 'continuation token')
  assertKeys(tokenSource, [
    'schemaVersion', 'continuationId', 'runId', 'anchorSessionId', 'owner',
    'fence', 'planVersion', 'goalVersion', 'contextDigest', 'environmentDigest',
    'expectedInputs', 'limits', 'authority', 'authorityDigest', 'issuedAt',
    'expiresAt', 'digest',
  ], 'continuation token')
  if (tokenSource.schemaVersion !== 1 || !Array.isArray(tokenSource.expectedInputs)) {
    throw new Error('dsh-legion: invalid continuation token')
  }
  const limitSource = record(tokenSource.limits, 'continuation limits')
  const limits = Object.fromEntries(Object.entries(limitSource).map(([key, item]) => [
    key, natural(item, 'continuation limits.' + key),
  ]))
  const authoritySource = record(tokenSource.authority, 'continuation authority')
  assertKeys(
    authoritySource,
    ['profiles', 'maxDepth', 'allowGoalRevision', 'digest'],
    'continuation authority',
  )
  const authority = createAuthorityEnvelope({
    profiles: record(authoritySource.profiles, 'continuation authority profiles') as never,
    maxDepth: natural(authoritySource.maxDepth, 'authority maxDepth'),
    allowGoalRevision: authoritySource.allowGoalRevision === true,
  })
  const authorityDigest = AuthorityDigest(tokenSource.authorityDigest)
  if (authority.digest !== AuthorityDigest(authoritySource.digest)
    || authority.digest !== authorityDigest) {
    throw new Error('dsh-legion: continuation authority digest mismatch')
  }
  const token = {
    schemaVersion: 1 as const,
    continuationId: ContinuationId(tokenSource.continuationId),
    runId: RunId(tokenSource.runId),
    anchorSessionId: SessionId(text(tokenSource.anchorSessionId, 'anchorSessionId')),
    owner: parseOwnerFingerprint(tokenSource.owner),
    fence: Fence(tokenSource.fence),
    planVersion: PlanVersion(tokenSource.planVersion),
    goalVersion: GoalVersion(tokenSource.goalVersion),
    ...(tokenSource.contextDigest === undefined
      ? {}
      : { contextDigest: ContextDigest(tokenSource.contextDigest) }),
    environmentDigest: EnvironmentDigest(tokenSource.environmentDigest),
    expectedInputs: tokenSource.expectedInputs.map(ArtifactDigest),
    limits,
    authority,
    authorityDigest,
    issuedAt: natural(tokenSource.issuedAt, 'issuedAt'),
    ...(tokenSource.expiresAt === undefined
      ? {}
      : { expiresAt: natural(tokenSource.expiresAt, 'expiresAt') }),
    digest: ArtifactDigest(tokenSource.digest),
  }
  const continuationId = ContinuationId(source.continuationId)
  const base = {
    schemaVersion: 1 as const,
    continuationId,
    token,
    updatedAt: natural(source.updatedAt, 'updatedAt'),
  }
  if (token.continuationId !== continuationId) {
    throw new Error('dsh-legion: continuation identity mismatch')
  }
  if (status === 'available') return { ...base, status }
  if (status === 'consumed') {
    return {
      ...base,
      status,
      consumedAt: natural(source.consumedAt, 'consumedAt'),
      consumingFence: Fence(source.consumingFence),
    }
  }
  return {
    ...base,
    status,
    invalidatedAt: natural(source.invalidatedAt, 'invalidatedAt'),
    reason: choice(source.reason, [
      'expired', 'stale-fence', 'plan-changed', 'goal-changed',
      'context-changed', 'environment-changed', 'inputs-changed',
      'limits-incompatible', 'authority-incompatible', 'owner-changed',
    ] as const, 'continuation invalidation reason'),
  }
}

export function validateLegionEventData<Type extends LegionEventType>(
  type: Type,
  input: unknown,
): SessionEventMap[Type] {
  const source = record(input, 'event data')
  const common = ['schemaVersion', 'runId', 'planVersion', 'correlationId', 'causationSeq', 'phase', 'record']
  const locator = type === 'legion/task-state'
    ? ['taskId', 'generation']
    : type === 'legion/attempt-state'
      ? ['taskId', 'attemptId', 'generation', 'fence']
      : type === 'legion/mail-state'
        ? ['taskId', 'mailId', 'recipientGeneration', 'fence']
        : type === 'legion/continuation-state'
          ? ['continuationId']
          : []
  assertKeys(source, [...common, ...locator], 'event data')
  if (source.schemaVersion !== 1) throw new Error('dsh-legion: unsupported Legion event schemaVersion')

  const runId = RunId(source.runId)
  const planVersion = PlanVersion(source.planVersion)
  const header = {
    schemaVersion: 1 as const,
    runId,
    planVersion,
    correlationId: text(source.correlationId, 'correlationId'),
    ...(source.causationSeq === undefined ? {} : { causationSeq: natural(source.causationSeq, 'causationSeq') }),
    ...(source.phase === undefined ? {} : { phase: choice(source.phase, ['create', 'plan', 'dispatch', 'settle', 'suspend', 'terminal'] as const, 'phase') }),
  }

  let data: SessionEventMap[LegionEventType]
  switch (type) {
    case 'legion/run-state': {
      const run = parseRunRecord(source.record)
      if (run.runId !== runId || run.currentPlanVersion !== planVersion) throw new Error('dsh-legion: run header does not match record')
      data = { ...header, record: run }
      break
    }
    case 'legion/plan-state': {
      const plan = parsePlanRecord(source.record)
      if (plan.runId !== runId || plan.version !== planVersion) throw new Error('dsh-legion: plan header does not match record')
      data = { ...header, record: plan }
      break
    }
    case 'legion/task-state': {
      const task = parseTaskRecord(source.record)
      const taskId = TaskId(source.taskId)
      const generation = natural(source.generation, 'generation')
      if (task.taskId !== taskId || task.planVersion !== planVersion || task.generation !== generation) throw new Error('dsh-legion: task header does not match record')
      data = { ...header, taskId, generation, record: task }
      break
    }
    case 'legion/mail-state': {
      const mail = parseMailRecord(source.record)
      const mailId = MailId(source.mailId)
      const taskId = TaskId(source.taskId)
      const recipientGeneration = natural(source.recipientGeneration, 'recipientGeneration')
      const fence = source.fence === undefined ? undefined : Fence(source.fence)
      const reservationFence = mail.status === 'reserved'
        || mail.status === 'incorporated'
        || mail.status === 'acknowledged'
        ? mail.reservation.fence
        : undefined
      if (mail.message.mailId !== mailId
        || mail.message.recipientTaskId !== taskId
        || mail.message.runId !== runId
        || mail.recipientGeneration !== recipientGeneration
        || reservationFence !== undefined && reservationFence !== fence
        || mail.status === 'queued' && mail.reclaimCount > 0 && fence === undefined) {
        throw new Error('dsh-legion: mail header does not match record')
      }
      data = {
        ...header,
        mailId,
        taskId,
        recipientGeneration,
        ...(fence === undefined ? {} : { fence }),
        record: mail,
      }
      break
    }
    case 'legion/milestone': {
      const value = record(source.record, 'milestone receipt')
      assertKeys(value, [
        'schemaVersion', 'milestoneId', 'step', 'title', 'summary', 'spec', 'artifacts',
        'verification', 'retiredRisks', 'openRisks', 'observedDelta', 'progress',
        'progressDigest', 'nextDecision', 'decisionSummary', 'acceptedAt',
        'noProgressMilestones', 'receiptDigest',
      ], 'milestone receipt')
      if (value.schemaVersion !== 1) throw new Error('dsh-legion: invalid milestone receipt schemaVersion')
      if (!Array.isArray(value.artifacts) || value.artifacts.length < 1 || value.artifacts.length > 16
        || !Array.isArray(value.verification) || value.verification.length < 1 || value.verification.length > 16
        || !Array.isArray(value.progress) || value.progress.length > 32) {
        throw new Error('dsh-legion: milestone receipt collections exceed bounded limits')
      }
      const retiredRisks = stringList(value.retiredRisks, 'milestone retiredRisks')
      const openRisks = stringList(value.openRisks, 'milestone openRisks')
      if (retiredRisks.length > 32 || openRisks.length > 32) throw new Error('dsh-legion: milestone risk lists exceed bounded limit')
      const spec = record(value.spec, 'milestone spec')
      assertKeys(spec, ['index', 'outcomeDelta', 'deliverable', 'acceptance', 'risksToRetire', 'taskIds', 'budget', 'interaction'], 'milestone spec')
      if (!Array.isArray(spec.acceptance) || !Array.isArray(spec.risksToRetire) || !Array.isArray(spec.taskIds)) throw new Error('dsh-legion: invalid milestone spec collections')
      const budget = record(spec.budget, 'milestone budget')
      assertKeys(budget, ['maxTasks', 'maxAttempts'], 'milestone budget')
      const milestoneSpec = {
        index: natural(spec.index, 'milestone spec index'),
        outcomeDelta: text(spec.outcomeDelta, 'milestone outcomeDelta'), deliverable: text(spec.deliverable, 'milestone deliverable'),
        acceptance: spec.acceptance.map((item, index) => { const entry = record(item, 'milestone acceptance'); assertKeys(entry, ['criterion'], 'milestone acceptance'); return { criterion: text(entry.criterion, 'milestone criterion ' + index) } }),
        risksToRetire: stringList(spec.risksToRetire, 'milestone risksToRetire'), taskIds: spec.taskIds.map(TaskId),
        budget: { maxTasks: natural(budget.maxTasks, 'milestone maxTasks'), maxAttempts: natural(budget.maxAttempts, 'milestone maxAttempts') },
        interaction: choice(spec.interaction, ['auto', 'checkpoint'] as const, 'milestone interaction'),
      }
      const verification = value.verification.map(item => { const entry = record(item, 'milestone verification'); assertKeys(entry, ['criterion', 'accepted', 'evidence'], 'milestone verification'); if (typeof entry.accepted !== 'boolean' || !Array.isArray(entry.evidence)) throw new Error('dsh-legion: invalid milestone verification'); return { criterion: text(entry.criterion, 'milestone verification criterion'), accepted: entry.accepted, evidence: entry.evidence.map(ArtifactDigest) } })
      data = { ...header, record: {
        schemaVersion: 1, milestoneId: text(value.milestoneId, 'milestoneId'), step: natural(value.step, 'milestone step'), title: text(value.title, 'title'), summary: text(value.summary, 'summary'),
        spec: milestoneSpec, artifacts: value.artifacts.map(parseArtifact), verification, retiredRisks, openRisks,
        observedDelta: text(value.observedDelta, 'milestone observedDelta'), progress: value.progress.map(item => {
          const entry = record(item, 'milestone progress')
          const kind = choice(entry.kind, ['accepted-artifact', 'criterion-satisfied', 'risk-retired', 'uncertainty-reduced', 'blocked-path-rejected'] as const, 'milestone progress kind')
          if (kind === 'accepted-artifact') { assertKeys(entry, ['kind', 'digest'], 'milestone progress'); return { kind, digest: ArtifactDigest(entry.digest) } }
          assertKeys(entry, ['kind', kind === 'criterion-satisfied' ? 'criterion' : kind === 'risk-retired' ? 'risk' : kind === 'uncertainty-reduced' ? 'uncertainty' : 'path', 'evidence'], 'milestone progress')
          if (!Array.isArray(entry.evidence)) throw new Error('dsh-legion: invalid milestone progress evidence')
          const evidence = entry.evidence.map(ArtifactDigest)
          return kind === 'criterion-satisfied' ? { kind, criterion: text(entry.criterion, 'criterion'), evidence } : kind === 'risk-retired' ? { kind, risk: text(entry.risk, 'risk'), evidence } : kind === 'uncertainty-reduced' ? { kind, uncertainty: text(entry.uncertainty, 'uncertainty'), evidence } : { kind, path: text(entry.path, 'path'), evidence }
        }),
        progressDigest: ArtifactDigest(value.progressDigest), nextDecision: choice(value.nextDecision, ['advance', 'revise', 'pause', 'complete'] as const, 'milestone nextDecision'),
        decisionSummary: text(value.decisionSummary, 'milestone decisionSummary'), acceptedAt: natural(value.acceptedAt, 'acceptedAt'),
        noProgressMilestones: natural(value.noProgressMilestones, 'milestone noProgressMilestones'), receiptDigest: ArtifactDigest(value.receiptDigest),
      } }
      break
    }
    case 'legion/decision': {
      const value = record(source.record, 'decision record')
      assertKeys(value, ['schemaVersion', 'decisionId', 'kind', 'summary', 'digest'], 'decision record')
      data = { ...header, record: { schemaVersion: 1, decisionId: text(value.decisionId, 'decisionId'), kind: choice(value.kind, ['plan-change', 'failure', 'recovery', 'review'] as const, 'decision kind'), summary: text(value.summary, 'summary'), digest: ArtifactDigest(value.digest) } }
      break
    }
    case 'legion/continuation-state': {
      const continuation = parseContinuationRecord(source.record)
      const continuationId = ContinuationId(source.continuationId)
      if (continuation.continuationId !== continuationId
        || continuation.token.runId !== runId
        || continuation.token.planVersion !== planVersion) {
        throw new Error('dsh-legion: continuation header does not match record')
      }
      data = { ...header, continuationId, record: continuation }
      break
    }
    case 'legion/attempt-state': {
      const attempt = parseAttemptRecord(source.record)
      const taskId = TaskId(source.taskId)
      const attemptId = AttemptId(source.attemptId)
      const generation = natural(source.generation, 'generation')
      const fence = Fence(source.fence)
      if (attempt.taskId !== taskId || attempt.attemptId !== attemptId || attempt.planVersion !== planVersion || attempt.generation !== generation || attempt.fence !== fence) throw new Error('dsh-legion: attempt header does not match record')
      data = { ...header, taskId, attemptId, generation, fence, record: attempt }
      break
    }
  }
  return trustedRecord(data) as SessionEventMap[Type]
}

export function parseExportedSessionEvent(input: unknown): SessionEvent {
  const source = record(input, 'event')
  assertKeys(
    source,
    ['type', 'seq', 'time', 'data', 'ignorable', 'sourceEventSeqs', 'surfaceOp'],
    'event',
  )
  const type = text(source.type, 'event.type')
  const seq = natural(source.seq, 'event.seq')
  const time = natural(source.time, 'event.time')
  if (!isLegionEventType(type)) {
    const event = deepJson(source)
    return event as SessionEvent
  }
  if (source.ignorable !== undefined
    || source.sourceEventSeqs !== undefined
    || source.surfaceOp !== undefined) {
    throw new Error('dsh-legion: Legion events must be required log-only events')
  }
  return trustedRecord({ type, seq, time, data: validateLegionEventData(type, source.data) }) as LegionEvent
}

function deepJson<Value>(value: Value): Value {
  const snapshot = snapshotJsonValue(value)
  if (snapshot === undefined) {
    throw new Error('dsh-legion: exported event is not losslessly JSON-serializable')
  }
  return snapshot
}
