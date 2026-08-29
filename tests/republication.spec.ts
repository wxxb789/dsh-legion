import { describe, expect, it } from 'vitest'
import { createSerializedRepublication } from '../src/internal/republication.ts'

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<Value>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe('serialized latest-generation republication', () => {
  it('drains a newer pending generation after the in-flight generation fails', async () => {
    const firstStarted = deferred<void>()
    const releaseFirst = deferred<void>()
    const failures: unknown[] = []
    const published: string[] = []
    let current = 'first'
    let calls = 0

    const republication = createSerializedRepublication({
      active: () => true,
      publishLatest: async () => {
        const captured = current
        calls += 1
        if (calls === 1) {
          firstStarted.resolve()
          await releaseFirst.promise
          throw new Error('first generation failed')
        }
        published.push(captured)
      },
      onError: error => { failures.push(error) },
    })

    const first = republication.request()
    await firstStarted.promise
    current = 'second'
    const pending = republication.request()
    releaseFirst.resolve()
    await Promise.all([first, pending])

    expect(calls).toBe(2)
    expect(published).toEqual(['second'])
    expect(failures).toEqual([expect.objectContaining({ message: 'first generation failed' })])
  })

  it('restarts when a request lands after drain exit but before running cleanup', async () => {
    const release = deferred<void>()
    let calls = 0
    let republication!: ReturnType<typeof createSerializedRepublication>
    release.promise.then(() => {
      queueMicrotask(() => { void republication.request() })
    })
    republication = createSerializedRepublication({
      active: () => true,
      publishLatest: async () => {
        calls += 1
        if (calls === 1) await release.promise
      },
      onError: () => undefined,
    })

    const first = republication.request()
    release.resolve()
    await first

    expect(calls).toBe(2)
  })

  it('does not start queued work after the owner becomes inactive', async () => {
    const firstStarted = deferred<void>()
    const releaseFirst = deferred<void>()
    let active = true
    let calls = 0
    const republication = createSerializedRepublication({
      active: () => active,
      publishLatest: async () => {
        calls += 1
        firstStarted.resolve()
        await releaseFirst.promise
      },
      onError: () => undefined,
    })

    const first = republication.request()
    await firstStarted.promise
    const queued = republication.request()
    active = false
    releaseFirst.resolve()
    await Promise.all([first, queued])
    await republication.request()

    expect(calls).toBe(1)
  })
})
