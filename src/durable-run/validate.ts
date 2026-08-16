import { snapshotJsonValue } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session/types'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { ProfileName, StrategyName } from '../identity.ts'
import {
  ArtifactDigest,
  AttemptId,
  ContextDigest,
  EnvironmentDigest,
  Fence,
  GoalVersion,
  ContinuationId,
  MailId,
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
    'owner', 'effectClass', 'idempotencyKey', 'profile', 'routePlanDigest', 'status',
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
        ? ['taskId', 'mailId']
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
      const value = record(source.record, 'mail record')
      assertKeys(value, ['schemaVersion', 'mailId', 'runId', 'taskId', 'status', 'payloadDigest', 'updatedAt'], 'mail record')
      const mailId = MailId(source.mailId)
      const taskId = TaskId(source.taskId)
      const mail = {
        schemaVersion: 1 as const,
        mailId: MailId(value.mailId),
        runId: RunId(value.runId),
        taskId: TaskId(value.taskId),
        status: choice(value.status, ['queued', 'reserved', 'incorporated', 'acknowledged', 'reclaimed', 'discarded'] as const, 'mail status'),
        payloadDigest: ArtifactDigest(value.payloadDigest),
        updatedAt: natural(value.updatedAt, 'updatedAt'),
      }
      if (mail.mailId !== mailId || mail.taskId !== taskId || mail.runId !== runId) throw new Error('dsh-legion: mail header does not match record')
      data = { ...header, mailId, taskId, record: mail }
      break
    }
    case 'legion/milestone': {
      const value = record(source.record, 'milestone record')
      assertKeys(value, ['schemaVersion', 'milestoneId', 'title', 'summary', 'acceptedAt'], 'milestone record')
      data = { ...header, record: { schemaVersion: 1, milestoneId: text(value.milestoneId, 'milestoneId'), title: text(value.title, 'title'), summary: text(value.summary, 'summary'), acceptedAt: natural(value.acceptedAt, 'acceptedAt') } }
      break
    }
    case 'legion/decision': {
      const value = record(source.record, 'decision record')
      assertKeys(value, ['schemaVersion', 'decisionId', 'kind', 'summary', 'digest'], 'decision record')
      data = { ...header, record: { schemaVersion: 1, decisionId: text(value.decisionId, 'decisionId'), kind: choice(value.kind, ['plan-change', 'failure', 'recovery', 'review'] as const, 'decision kind'), summary: text(value.summary, 'summary'), digest: ArtifactDigest(value.digest) } }
      break
    }
    case 'legion/continuation-state': {
      const value = record(source.record, 'continuation record')
      assertKeys(value, ['schemaVersion', 'continuationId', 'status', 'planVersion', 'digest', 'updatedAt'], 'continuation record')
      const continuationId = ContinuationId(source.continuationId)
      const continuation = { schemaVersion: 1 as const, continuationId: ContinuationId(value.continuationId), status: choice(value.status, ['active', 'consumed'] as const, 'continuation status'), planVersion: PlanVersion(value.planVersion), digest: ArtifactDigest(value.digest), updatedAt: natural(value.updatedAt, 'updatedAt') }
      if (continuation.continuationId !== continuationId || continuation.planVersion !== planVersion) throw new Error('dsh-legion: continuation header does not match record')
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
