import { Context, Service } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import SqliteSessionQuery from '@deepseek-ai/dsh-session-query-sqlite'

interface TestProjectionDefinition {
  readonly key: string
  readonly stateSchema: { parse(value: unknown): unknown }
  init(): unknown
  apply(state: unknown, event: SessionEvent): unknown
  readonly wire?: {
    readonly viewSchema: { parse(value: unknown): unknown }
    view(state: unknown): unknown
  }
}

export class TestSessionProjections extends Service {
  private readonly definitions = new Map<string, TestProjectionDefinition>()
  private readonly fixedValues = new WeakMap<Session, Record<string, unknown>>()

  constructor(ctx: Context) {
    super(ctx, 'sessionProjections')
  }

  register(definition: TestProjectionDefinition): () => void {
    this.definitions.set(definition.key, definition)
    return () => { this.definitions.delete(definition.key) }
  }

  setValue(session: Session, key: string, value: unknown): void {
    this.fixedValues.set(session, { ...this.fixedValues.get(session), [key]: structuredClone(value) })
  }

  snapshot(session: Session): { asOfSeq: number; values: Record<string, unknown> } {
    const values: Record<string, unknown> = { ...this.fixedValues.get(session) }
    for (const definition of this.definitions.values()) {
      let state = definition.init()
      for (const event of session.events) state = definition.apply(state, event)
      state = definition.stateSchema.parse(state)
      if (definition.wire !== undefined) {
        values[definition.key] = definition.wire.viewSchema.parse(definition.wire.view(state))
      }
    }
    values.tokenUsage ??= {
      uncachedInputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }
    return { asOfSeq: session.seq - 1, values }
  }
}

export class TestTokenMeter extends Service {
  private readonly measurements = new WeakMap<Session, {
    readonly logRevision: number
    readonly totalTokens: number
    readonly surfaceTokens: number
  }>()

  constructor(ctx: Context) {
    super(ctx, 'tokenMeter')
  }

  set(session: Session, measurement: { readonly totalTokens: number; readonly surfaceTokens: number }): void {
    this.measurements.set(session, { logRevision: session.events.length, ...measurement })
  }

  measure(session: Session) {
    return structuredClone(this.measurements.get(session) ?? {
      logRevision: session.events.length,
      totalTokens: 0,
      surfaceTokens: 0,
    })
  }
}

/** Mount exact Session Query reads without opening the unused full-text index. */
export function mountTestSessionQuery(ctx: Context): void {
  if (ctx.get('sessionQuery') === undefined) {
    new SqliteSessionQuery(ctx, { path: ':memory:', openAt: 'never' })
  }
}

export async function mountTestTokenAccounting(ctx: Context): Promise<void> {
  if (ctx.get('sessionProjections') === undefined) await ctx.plugin(TestSessionProjections)
  if (ctx.get('tokenMeter') === undefined) await ctx.plugin(TestTokenMeter)
}
