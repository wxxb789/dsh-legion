import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import { settleChildRun, type ChildCleanup } from './child-run.ts'
import type { DelegationPlan } from './compiler.ts'
import { materializeStructuredResult } from './result-contract.ts'

export interface ForegroundResult {
  readonly kind: 'foreground'
  readonly profile: string
  readonly runId: SubagentRun['id']
  readonly resultContract: DelegationPlan['result']
  readonly policyDigest: DelegationPlan['policyDigest']
  readonly catalogDigest: DelegationPlan['catalogDigest']
  readonly resourceDigest: DelegationPlan['resourceDigest']
  readonly routePlan?: JsonValue
  readonly output: JsonValue[]
  readonly structured?: JsonValue
}

/**
 * Read the provider-authored failure detail DSH 0.1.0-rc.8 added to
 * `SubagentResult`.
 *
 * This is a real version boundary, not a convenience cast: Legion's peer range
 * still admits 0.1.0-rc.6, whose `SubagentResult` declares no `diagnostic`
 * member, so the field is read as `unknown` and validated instead of declared.
 * Providers cap it at 4096 UTF-8 bytes and keep it free of tool inputs, file
 * contents, environment values, and credentials.
 * @param result - the settled child result.
 * @returns the trimmed detail, or undefined when the Host or provider supplied none.
 */
function providerDiagnostic(result: SubagentResult): string | undefined {
  const value: unknown = (result as { readonly diagnostic?: unknown }).diagnostic
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

/**
 * Describe why a child run ended, preferring the provider's own account.
 *
 * The provider diagnostic is appended rather than substituted, so the stable
 * stop-reason phrasing callers may already match on survives. It stays separate
 * from the child's `output`, as the contract requires.
 * @param result - the settled child result.
 * @returns the failure sentence, or undefined when the run completed.
 */
function stopReasonError(result: SubagentResult): string | undefined {
  const reason = stopReasonSentence(result)
  if (reason === undefined) return undefined
  const diagnostic = providerDiagnostic(result)
  return diagnostic === undefined ? reason : `${reason} (provider diagnostic: ${diagnostic})`
}

function stopReasonSentence(result: SubagentResult): string | undefined {
  switch (result.stopReason) {
    case 'completed': return undefined
    case 'aborted': return 'Legion child run was cancelled'
    case 'error': return 'Legion child run failed'
    case 'max-tokens': return 'Legion child run hit its token limit before finishing'
    case 'refusal': return 'Legion child declined the task'
    default: return `Legion child run ended abnormally (${String(result.stopReason)})`
  }
}

function textOf(output: ContentBlock[]): string {
  return output
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** Start, settle, and release one foreground run through the shared child lifecycle Module. */
export async function settleForeground(
  plan: DelegationPlan,
  start: () => Promise<SubagentRun>,
  signal: AbortSignal,
  onLateCleanup?: (cleanup: ChildCleanup) => void,
): Promise<ForegroundResult> {
  const settlement = await settleChildRun({
    start,
    signal,
    ...onLateCleanup === undefined ? {} : { onLateCleanup },
  })
  const errors: unknown[] = []
  let result: SubagentResult | undefined
  if (settlement.execution.kind === 'completed') {
    result = settlement.execution.result
  } else if (settlement.execution.kind === 'failed') {
    result = settlement.execution.result
    const failure = result === undefined
      ? settlement.execution.error
      : new Error(textOf(result.output).length === 0
          ? stopReasonError(result) ?? String(settlement.execution.error)
          : `${stopReasonError(result) ?? String(settlement.execution.error)}\nPartial output before the run ended:\n${textOf(result.output)}`)
    errors.push(failure)
  } else {
    errors.push(new Error(`Legion child run was cancelled: ${String(settlement.execution.reason)}`))
  }
  if (settlement.cleanup.kind === 'failed') errors.push(settlement.cleanup.error)
  if (settlement.cleanup.kind === 'pending') errors.push(new Error('Legion child cleanup is still pending'))
  if (errors.length > 0) {
    if (errors.length === 1) throw errors[0]
    throw new AggregateError(
      errors,
      `Legion child execution and cleanup both failed: ${errors.map(error => String(error).slice(0, 500)).join('; ')}`,
    )
  }
  if (result === undefined || settlement.run === undefined) {
    throw new Error('Legion foreground child returned no completed run')
  }
  const structured = materializeStructuredResult(plan.result, result.structured)
  return {
    kind: 'foreground',
    profile: plan.profile,
    runId: settlement.run.id,
    resultContract: plan.result,
    policyDigest: plan.policyDigest,
    catalogDigest: plan.catalogDigest,
    resourceDigest: plan.resourceDigest,
    ...plan.routePlan === undefined
      ? {}
      : { routePlan: plan.routePlan as unknown as JsonValue },
    output: result.output as unknown as JsonValue[],
    ...structured === undefined ? {} : { structured },
  }
}

/** Project canonical JSON text blocks for the model-facing result. */
export function outputText(values: JsonValue[]): string {
  return values
    .filter((value): value is { type: 'text'; text: string } =>
      typeof value === 'object' && value !== null && !Array.isArray(value)
      && value.type === 'text' && typeof value.text === 'string')
    .map(value => value.text)
    .join('')
}
