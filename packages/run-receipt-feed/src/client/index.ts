/** Run Receipt companion browser entry. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import receiptsRemote from 'dsh-legion-receipts/remote'
import './styles.ts'
import { ClientReceiptModel, type ReceiptRemote } from './model.ts'
import {
  createReceiptPresentationStore,
  RUN_RECEIPT_OVERLAY_ID,
  RUN_RECEIPT_OVERLAY_SLOT,
  RunReceiptOverlay,
} from './RunReceiptOverlay.ts'
import { en, RECEIPT_LOCALE_NS, zh } from './locales.ts'

export { ClientReceiptModel } from './model.ts'
export type { ClientReceiptSnapshot, ClientReceiptState } from './model.ts'
export {
  createReceiptPresentationStore,
  RUN_RECEIPT_OVERLAY_ID,
  RUN_RECEIPT_OVERLAY_SLOT,
  RunReceiptOverlay,
} from './RunReceiptOverlay.ts'
export type { ReceiptPresentationState, RunReceiptOverlayProps } from './RunReceiptOverlay.ts'
export { en, RECEIPT_LOCALE_NS, zh } from './locales.ts'

/** The Gateway-owned Client Remote service must exist before self-mount. */
export const inject = ['remote']

function isReceiptRemote(value: unknown): value is ReceiptRemote {
  if (typeof value !== 'object' || value === null || typeof Reflect.get(value, '$stream') !== 'function') return false
  const namespace = Reflect.get(value, 'legionReceipts')
  return typeof namespace === 'object' && namespace !== null && typeof Reflect.get(namespace, 'follow') === 'function'
}

function registerUi(ctx: Context, unavailableReason?: string): () => Promise<void> {
  const remote = unavailableReason === undefined && isReceiptRemote(ctx.remote) ? ctx.remote : undefined
  const model = new ClientReceiptModel(
    ctx.sessions,
    remote,
    unavailableReason ?? (remote === undefined ? 'Run Receipt Remote namespace is unavailable' : undefined),
  )
  const stopModel = ctx.effect(
    () => async () => { await model.dispose() },
    'dsh-legion-receipts: current Session model',
  )
  const presentation = createReceiptPresentationStore()
  ctx.effect(() => ctx.locale.register(RECEIPT_LOCALE_NS, { en, zh }), 'dsh-legion-receipts: dictionaries')
  ctx.slots.inject(RUN_RECEIPT_OVERLAY_SLOT, () => ctx.slots.register({
    name: RUN_RECEIPT_OVERLAY_SLOT,
    id: RUN_RECEIPT_OVERLAY_ID,
    order: 100,
    locale: RECEIPT_LOCALE_NS,
    store: presentation,
    inject: () => ({ hooks: { receipt: model.store } }),
  }, RunReceiptOverlay))
  return async () => { await stopModel() }
}

/** Mount generated Remote first, then the React-free model and additive Slot UI. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  let disposeRemote: (() => Promise<void>) | undefined
  let unavailableReason: string | undefined
  try {
    disposeRemote = await ctx.remote.$mount(receiptsRemote)
  } catch (error) {
    unavailableReason = error instanceof Error ? error.message : String(error)
  }

  const ui = ctx.inject(['sessions', 'slots', 'locale'], child => registerUi(child, unavailableReason))
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeRemote?.()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeRemote?.()
  }
}
