import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import type { DelegationPlan } from './compiler.ts'
import { materializeStructuredResult } from './result-contract.ts'

export interface ForegroundResult {
  readonly kind: 'foreground'
  readonly profile: string
  readonly runId: SubagentRun['id']
  readonly resultContract: DelegationPlan['result']
  readonly policyDigest: string
  readonly catalogDigest: string
  readonly output: JsonValue[]
  readonly structured?: JsonValue
}

function stopReasonError(result: SubagentResult): string | undefined {
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

/** Settle and release one foreground run without losing either failure. */
export async function settleForeground(
  plan: DelegationPlan,
  run: SubagentRun,
): Promise<ForegroundResult> {
  const [execution] = await Promise.allSettled([
    run.result.then((result): ForegroundResult => {
      const failure = stopReasonError(result)
      if (failure !== undefined) {
        const partial = textOf(result.output)
        throw new Error(partial.length === 0
          ? failure
          : `${failure}\nPartial output before the run ended:\n${partial}`)
      }
      const structured = materializeStructuredResult(plan.result, result.structured)
      return {
        kind: 'foreground',
        profile: plan.profile,
        runId: run.id,
        resultContract: plan.result,
        policyDigest: plan.policyDigest,
        catalogDigest: plan.catalogDigest,
        output: result.output as unknown as JsonValue[],
        ...structured === undefined ? {} : { structured },
      }
    }),
  ])

  const [disposal] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())])
  if (execution.status === 'rejected') {
    if (disposal.status === 'rejected') {
      throw new AggregateError(
        [execution.reason, disposal.reason],
        `Legion child execution failed and disposal also failed: ${String(execution.reason)}; ${String(disposal.reason)}`,
      )
    }
    throw execution.reason
  }
  if (disposal.status === 'rejected') throw disposal.reason
  return execution.value
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
