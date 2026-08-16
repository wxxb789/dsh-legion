import { describe, expect, it } from 'vitest'
import { RoutePlanDigest } from '../src/identity.ts'
import {
  ArtifactDigest,
  ContextGeneration,
  RunId,
  TaskId,
} from '../src/durable-run/contract.ts'
import {
  createContextManifest,
  propagateContextEvidence,
  requiredWriteRevalidation,
  type ContextPage,
} from '../src/durable-run/context.ts'

function digest(hex: string) {
  return ArtifactDigest(`sha256:${hex.repeat(64)}`)
}

const route = RoutePlanDigest(`sha256:${'a'.repeat(64)}`)

function page(
  id: string,
  slot: ContextPage['slot'],
  bytes = 10,
  extra: Partial<ContextPage> = {},
): ContextPage {
  const value = digest(id === 'one' ? '1' : id === 'two' ? '2' : id === 'three' ? '3' : '4')
  return {
    pageId: id,
    digest: value,
    source: { name: id, digest: value, mediaType: 'text/plain', byteLength: bytes },
    slot,
    orderKey: id,
    trust: 'system',
    freshness: { kind: 'timeless' },
    pin: 'evictable',
    estimatedTokens: { test: 1 },
    lineage: [],
    ...extra,
  }
}

function manifest(
  pages: readonly ContextPage[],
  options: {
    readonly task?: string
    readonly run?: string
    readonly generation?: number
    readonly maxPages?: number
    readonly maxBytes?: number
  } = {},
) {
  return createContextManifest({
    generation: ContextGeneration(options.generation ?? 1),
    runId: RunId(options.run ?? 'run-one'),
    taskId: TaskId(options.task ?? 'task-one'),
    profile: 'deep',
    routePlanDigest: route,
    pages,
    bounds: {
      maxPages: options.maxPages ?? 20,
      maxBytes: options.maxBytes ?? 1_000,
    },
  })
}

describe('ordered ContextManifest', () => {
  it('orders by slot and Unicode code point independent of input permutation', () => {
    const authored = [
      page('two', 'task', 10, { orderKey: '\u{10000}' }),
      page('three', 'goal'),
      page('one', 'task', 10, { orderKey: '\uE000' }),
    ]
    const first = manifest(authored)
    const second = manifest([...authored].reverse())
    expect(first.pages.map(value => value.pageId)).toEqual(['three', 'one', 'two'])
    expect(second).toEqual(first)
    ;(authored[0]!.source as { name: string }).name = 'changed'
    expect(first.pages[2]!.source.name).toBe('two')
    expect(Object.isFrozen(first.pages[0]!.source)).toBe(true)
  })

  it('keeps equivalent sibling prefixes stable across run/task/generation and goal pages', () => {
    const shared = [
      page('one', 'profile-policy', 10, { pin: 'required' }),
      page('two', 'shared-run', 10, { pin: 'required' }),
    ]
    const left = manifest([
      ...shared,
      page('three', 'goal'),
      page('four', 'task'),
    ])
    const right = manifest([
      ...shared,
      page('four', 'goal'),
      page('three', 'task'),
    ], { task: 'task-two', run: 'run-two', generation: 2 })
    expect(left.sharedPrefixDigest).toBe(right.sharedPrefixDigest)
    expect(left.sharedPrefixPageCount).toBe(2)
    expect(left.digest).not.toBe(right.digest)
  })

  it('rejects dynamic freshness in shared-prefix slots', () => {
    expect(() => manifest([
      page('one', 'profile-policy', 10, {
        freshness: { kind: 'fresh', observedAt: 1 },
      }),
    ])).toThrow(/must be timeless/)
  })

  it('evicts expired and evictable pages deterministically while preserving required pages', () => {
    const pages = [
      page('one', 'goal', 40, { pin: 'required' }),
      page('two', 'evidence', 40, { pin: 'preferred' }),
      page('three', 'mail', 40, {
        freshness: { kind: 'expired', observedAt: 1, expiredAt: 2 },
      }),
    ]
    expect(manifest(pages, { maxPages: 2, maxBytes: 80 }).pages.map(value => value.pageId))
      .toEqual(['one', 'two'])
    expect(() => manifest([
      page('one', 'goal', 101, { pin: 'required' }),
    ], { maxPages: 1, maxBytes: 100 })).toThrow(/required pages exceed bounds/)
  })

  it('propagates worst trust, expired freshness, and complete lineage', () => {
    const result = propagateContextEvidence([
      page('one', 'evidence', 10, {
        trust: 'tool',
        freshness: { kind: 'fresh', observedAt: 20, expiresAt: 90 },
        lineage: [digest('3')],
      }),
      page('two', 'evidence', 10, {
        trust: 'untrusted-external',
        freshness: { kind: 'expired', observedAt: 10, expiredAt: 80 },
      }),
    ])
    expect(result).toEqual({
      trust: 'untrusted-external',
      freshness: { kind: 'expired', observedAt: 10, expiredAt: 80 },
      lineage: [digest('1'), digest('2'), digest('3')],
    })
  })

  it('requires write revalidation for expired or untrusted evidence', () => {
    const result = requiredWriteRevalidation([
      page('one', 'evidence', 10, { trust: 'untrusted-external' }),
      page('two', 'mail', 10, {
        freshness: { kind: 'fresh', observedAt: 1, expiresAt: 5 },
      }),
      page('three', 'goal', 10, { trust: 'untrusted-external' }),
    ], 5)
    expect(result).toEqual({
      required: true,
      pageIds: ['one', 'two'],
      reasons: { one: ['untrusted'], two: ['expired'] },
    })
  })
})
