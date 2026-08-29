export interface SerializedRepublicationOptions {
  readonly active: () => boolean
  readonly publishLatest: () => Promise<void>
  readonly onError: (error: unknown) => void
}

export interface SerializedRepublication {
  /** Request publication of the latest source, coalescing while one pass is active. */
  request(): Promise<void>
}

/**
 * Serialize asynchronous publication while preserving one latest pending pass.
 * A failed pass is reported independently and never consumes a request that
 * arrived while it was in flight.
 */
export function createSerializedRepublication(
  options: SerializedRepublicationOptions,
): SerializedRepublication {
  let running: Promise<void> | undefined
  let pending = false

  const drain = async (): Promise<void> => {
    do {
      pending = false
      try {
        await options.publishLatest()
      } catch (error: unknown) {
        options.onError(error)
      }
    } while (pending && options.active())
  }

  const request = (): Promise<void> => {
    if (!options.active()) return Promise.resolve()
    if (running !== undefined) {
      pending = true
      return running
    }
    running = drain().finally(() => {
      running = undefined
      if (pending && options.active()) return request()
    })
    return running
  }

  return { request }
}
