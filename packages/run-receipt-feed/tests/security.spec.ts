import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { ReceiptFeedFrame } from '../src/index.ts'
import { nextFrame, receipt, replace } from './fixtures.ts'

const PACKAGE_ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const host = await import(pathToFileURL(resolve(PACKAGE_ROOT, 'lib/index.js')).href) as typeof import('../src/index.ts')
const { RunReceiptFeed, RunReceiptSchema } = host

const SENTINELS = {
  objective: 'OBJECTIVE_SENTINEL_8cc5948d',
  prompt: 'PROMPT_SENTINEL_21f65177',
  output: 'CHILD_OUTPUT_SENTINEL_dd55f0ce',
  artifact: 'ARTIFACT_SENTINEL_21aa9ea3',
  log: 'LOG_SENTINEL_582d87bb',
} as const

const roots: Context[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

function expectNoSentinels(value: unknown): void {
  const serialized = JSON.stringify(value)
  for (const sentinel of Object.values(SENTINELS)) expect(serialized).not.toContain(sentinel)
  expect(serialized).not.toMatch(/"(?:money|price|cost|currency)"\s*:/iu)
}

describe('RunReceiptFeed allowlist boundary', () => {
  it('rejects sensitive canaries and never exposes their bytes in results, frames, or logs', async () => {
    const ctx = new Context()
    roots.push(ctx)
    await ctx.plugin(SessionStore)
    const feed = new RunReceiptFeed(ctx)
    const session = ctx.sessions.create(SessionId('sentinel-parent'))
    const original = receipt(String(session.id))
    expect(feed.publish(session, replace(original))).toMatchObject({ ok: true, revision: 1 })

    const warnings = vi.spyOn(ctx.logger, 'warn')
    const errors = vi.spyOn(ctx.logger, 'error')
    const malicious = {
      ...original,
      objective: SENTINELS.objective,
      primitivePrompt: SENTINELS.prompt,
      childOutput: SENTINELS.output,
      artifact: { body: SENTINELS.artifact },
      log: SENTINELS.log,
    }
    expect(RunReceiptSchema.safeParse(malicious).success).toBe(false)
    const result = feed.publish(session, {
      ...replace(original),
      receipt: malicious,
    } as never)
    expect(result).toEqual({ ok: false, code: 'invalid-publication' })
    expectNoSentinels(result)

    const abort = new AbortController()
    const iterator = feed.follow(String(session.id), abort.signal)[Symbol.asyncIterator]()
    const frame = await nextFrame(iterator as AsyncIterator<ReceiptFeedFrame>)
    expect(frame).toMatchObject({ value: { revision: 1, receipts: [original] } })
    expectNoSentinels(frame)

    expectNoSentinels(warnings.mock.calls)
    expectNoSentinels(errors.mock.calls)
    abort.abort()
  })

  it('owns parsed JSON instead of retaining caller aliases', async () => {
    const ctx = new Context()
    roots.push(ctx)
    await ctx.plugin(SessionStore)
    const feed = new RunReceiptFeed(ctx)
    const session = ctx.sessions.create(SessionId('owned-json'))
    const callerOwned = structuredClone(receipt(String(session.id)))
    expect(feed.publish(session, replace(callerOwned))).toMatchObject({ ok: true, revision: 1 })

    Reflect.set(callerOwned, 'strategy', SENTINELS.prompt)
    Reflect.set(callerOwned.stages[0]!, 'member', SENTINELS.output)
    const abort = new AbortController()
    const iterator = feed.follow(String(session.id), abort.signal)[Symbol.asyncIterator]()
    const frame = await nextFrame(iterator as AsyncIterator<ReceiptFeedFrame>)
    expect(frame).toMatchObject({ value: { receipts: [{ strategy: 'strategy' }] } })
    expectNoSentinels(frame)
    abort.abort()
  })
})
