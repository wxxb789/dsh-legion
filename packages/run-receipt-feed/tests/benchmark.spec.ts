import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const THRESHOLDS_URL = new URL('../../../benchmarks/receipt-feed-thresholds.json', import.meta.url)
const BENCHMARK_URL = new URL('../../../scripts/benchmark-receipt-feed.mjs', import.meta.url)

describe('RunReceiptFeed benchmark contract', () => {
  it('pins every U3 cap and the synchronous publication p95 threshold', async () => {
    const thresholds = JSON.parse(await readFile(THRESHOLDS_URL, 'utf8')) as Record<string, unknown>
    expect(thresholds).toEqual({
      schemaVersion: 1,
      limits: {
        activeReceiptsPerSession: 16,
        participantsPerReceipt: 256,
        serializedSessionReplacementBytes: 1_048_576,
        processFollowers: 64,
      },
      benchmark: {
        warmupPublications: 20,
        measuredPublications: 100,
        minimumByteSaturation: 0.95,
        publicationP95Milliseconds: 100,
        shape: {
          activeReceipts: 16,
          followers: 64,
          participantsPerReceipt: 'maximum-uniform-valid',
          note: 'Sixteen 256-row Receipts exceed the 1 MiB replacement cap; use the largest uniform participant count accepted by the public publisher.',
        },
      },
    })
  })

  it('uses the built public feed without adding a transport', async () => {
    const source = await readFile(BENCHMARK_URL, 'utf8')
    expect(source).toContain("from '../packages/run-receipt-feed/lib/index.js'")
    expect(source).not.toMatch(/setTimeout|setInterval|custom transport|WebSocket|EventSource/)
  })

  it('enforces byte saturation, shared replacement, and publication p95', () => {
    const output = execFileSync(process.execPath, [fileURLToPath(BENCHMARK_URL)], {
      cwd: fileURLToPath(new URL('../../..', import.meta.url)),
      encoding: 'utf8',
    })
    const result = JSON.parse(output) as {
      readonly byteSaturation: number
      readonly publicationP95Milliseconds: number
      readonly sharedReplacement: boolean
    }
    expect(result.byteSaturation).toBeGreaterThanOrEqual(0.95)
    expect(result.publicationP95Milliseconds).toBeLessThanOrEqual(100)
    expect(result.sharedReplacement).toBe(true)
  }, 15_000)
})
