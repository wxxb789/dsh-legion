#!/usr/bin/env node

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { installLlmReplay } from '@deepseek-ai/dsh-llm-replay'

const ctx = new Context()
const profileDir = process.env.DSH_LEGION_PROFILE_DIR ?? process.cwd()
let replay
try {
  ctx.baseUrl = pathToFileURL(profileDir).href + '/'
  await ctx.plugin(Loader)
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(LlmRuntime)
  replay = installLlmReplay(ctx, {
    file: join(process.cwd(), 'unused.jsonl'),
    overrideFile: join(process.cwd(), 'replay.override.json'),
    providers: [{
      id: 'official-replay',
      models: [{ id: 'fixture', contextWindow: 4096, defaultMaxTokens: 64 }],
    }],
  })

  const settingsId = await ctx.loader.create({
    name: 'dsh-legion',
    config: { role: 'settings', specialists: {} },
  })
  const receiptId = await ctx.loader.create({ name: 'dsh-legion-receipts' })
  await ctx.loader.await()
  if (ctx.get('legionReceipts') === undefined) throw new Error('receipt service did not mount')

  let replayText = ''
  for await (const chunk of ctx.llm.stream({
    provider: 'official-replay',
    model: 'fixture',
    messages: [],
  })) {
    if (chunk.type === 'text-delta') replayText += chunk.text
  }
  replay.assertConsumed()

  const session = ctx.sessions.create(SessionId('loader-smoke-session'))
  const customReceiptEventObserved = session.events.some(event => event.type === 'legion/run-receipt')
  await ctx.loader.remove(receiptId)
  await ctx.loader.await()
  const receiptAbsentAfterUninstall = ctx.get('legionReceipts') === undefined
  const reinstalledReceiptId = await ctx.loader.create({ name: 'dsh-legion-receipts' })
  await ctx.loader.await()
  const receiptRestoredAfterReinstall = ctx.get('legionReceipts') !== undefined
  await ctx.loader.remove(reinstalledReceiptId)

  process.stdout.write(JSON.stringify({
    replayText,
    settingsRow: ctx.loader.resolve(settingsId).options.name,
    receiptRow: 'dsh-legion-receipts',
    receiptAbsentAfterUninstall,
    receiptRestoredAfterReinstall,
    customReceiptEventObserved,
  }))
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
} finally {
  replay?.dispose()
  await ctx.fiber.dispose()
}
