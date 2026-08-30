import { randomBytes } from 'node:crypto'
import { request } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import { apply as applyConnection, inject as connectionInject } from '@deepseek-ai/dsh-client-connection'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'

const PACKAGE_ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const host = await import(pathToFileURL(resolve(PACKAGE_ROOT, 'lib/index.js')).href) as typeof import('../src/index.ts')
const { default: RunReceiptFeed } = host
const { TYPERT } = await import(pathToFileURL(resolve(PACKAGE_ROOT, 'lib/typert.host.js')).href) as {
  readonly TYPERT: unknown
}
const roots: Context[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

function provideCredentials(ctx: Context): void {
  const records = new Map<unknown, unknown>()
  ctx.provide('credentials', {
    async modifyRecord(key: unknown, mutate: (current: unknown) => Promise<unknown>): Promise<unknown> {
      const next = await mutate(records.get(key))
      if (next !== undefined) records.set(key, next)
      return next ?? records.get(key)
    },
  } as never)
}

async function setup(): Promise<Context> {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  provideCredentials(ctx)
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(Gateway)
  await ctx.plugin({ inject: [...connectionInject], apply: applyConnection })
  await ctx.plugin(SessionStore)
  await ctx.plugin(RunReceiptFeed)
  const typert = ctx.get('typert') as unknown as { register(contribution: TypertContribution): unknown }
  typert.register(TYPERT as TypertContribution)
  return ctx
}

function browserCookie(ctx: Context, origin: string): string {
  const target = new URL(ctx.connection.authenticatedUrl(origin))
  let setCookie: string | undefined
  ctx.connection.authorizeIndex({
    method: 'GET',
    url: `${target.pathname}${target.search}`,
    headers: { host: target.host },
  }, {
    writeHead(_status, headers) { setCookie = headers?.['set-cookie'] },
    end() {},
  })
  if (setCookie === undefined) throw new Error('connection did not issue a browser cookie')
  return setCookie.split(';', 1)[0]!
}

function upgradeStatus(url: string, headers: Readonly<Record<string, string>> = {}): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const requestHandle = request(url, {
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
        'Sec-WebSocket-Version': '13',
        ...headers,
      },
    })
    requestHandle.once('response', (response) => {
      const status = response.statusCode
      response.once('error', reject)
      response.once('end', () => { resolve(status) })
      response.resume()
    })
    requestHandle.once('upgrade', (response, socket) => {
      socket.destroy()
      resolve(response.statusCode)
    })
    requestHandle.once('error', reject)
    requestHandle.end()
  })
}

describe('RunReceiptFeed generated Remote and Gateway integration', () => {
  it('dispatches the generated strict stream through the real Gateway seam', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('remote-session'))
    const abort = new AbortController()
    const stream = await ctx.typertGateway.wireStream.open(
      'legionReceipts/follow',
      { args: { sessionId: String(session.id) } },
      abort.signal,
    )
    const iterator = stream[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {
        type: 'baseline',
        value: {
          schemaVersion: 1,
          sessionId: session.id,
          revision: 0,
          feed: { status: 'available' },
          receipts: [],
        },
      },
    })
    abort.abort()
    await expect(iterator.next()).rejects.toThrow(/aborted/i)
  })

  it('preserves official unauthenticated and wrong-origin upgrade rejection', async () => {
    const ctx = await setup()
    const origin = `http://127.0.0.1:${String(ctx.webServer.port)}`
    const socketUrl = `${origin}/api/remote.mux`

    await expect(upgradeStatus(socketUrl)).resolves.toBe(401)

    const cookie = browserCookie(ctx, origin)
    await expect(upgradeStatus(socketUrl, {
      Cookie: cookie,
      Origin: 'http://evil.example',
    })).resolves.toBe(403)
    await expect(upgradeStatus(socketUrl, { Cookie: cookie, Origin: origin })).resolves.toBe(101)
  })
})
