/** Run Receipt presentation for the Host-owned frame overlay seat. */
import {
  createElement as h, useEffect, useState,
  type PointerEvent as ReactPointerEvent, type ReactNode,
} from 'react'
import { defineStore } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ComposedProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { RunReceipt, RunReceiptProjection } from '../run-receipt.ts'

/** The Host projection key published by Legion's agent-plane half. */
export const LEGION_RUN_RECEIPT_PROJECTION_KEY = 'legion/run-receipts'
/** Additive shell entry id; another plugin uses a different id beside it. */
export const LEGION_RUN_RECEIPT_OVERLAY_ID = 'legion.run-receipt'
/** The only frame-wide shell slot the Host declares. */
export const LEGION_RUN_RECEIPT_OVERLAY_SLOT = 'shell.overlay'

export interface RunReceiptOverlayState {
  docked: boolean
  x: number
  y: number
  dismissedRunId: string | null
}

/** Root-scoped presentation state. Run facts remain in the Session projection. */
export const runReceiptOverlayStore = defineStore({
  init: (): RunReceiptOverlayState => ({ docked: true, x: 24, y: 24, dismissedRunId: null }),
  persist: 'dsh-legion.run-receipt-overlay.v1',
  actions: {
    move(state, x: number, y: number) {
      state.docked = false
      state.x = x
      state.y = y
    },
    dock(state) { state.docked = true },
    dismiss(state, runId: string) { state.dismissedRunId = runId },
  },
})

export type RunReceiptOverlayProps = ComposedProps<
  'shell.overlay', never, never, typeof runReceiptOverlayStore, object, never, 'settings.legion'
>

type OverlayActions = Pick<RunReceiptOverlayProps['actions'], 'move' | 'dock' | 'dismiss'>
type LegionProjectionValues = Readonly<Record<string, unknown>> & {
  readonly [LEGION_RUN_RECEIPT_PROJECTION_KEY]?: RunReceiptProjection
}

function latestReceipt(projection: RunReceiptProjection | undefined): RunReceipt | undefined {
  if (projection === undefined) return undefined
  let latest: RunReceipt | undefined
  for (const receipt of Object.values(projection.receipts)) {
    if (latest === undefined
      || receipt.startedAt > latest.startedAt
      || (receipt.startedAt === latest.startedAt && String(receipt.runId) > String(latest.runId))) {
      latest = receipt
    }
  }
  return latest
}

function elapsed(ms: number): string {
  if (ms < 1000) return String(ms) + ' ms'
  const seconds = ms / 1000
  return seconds.toFixed(Number.isInteger(seconds) ? 0 : 1) + ' s'
}

function number(value: number): string {
  return value.toLocaleString()
}

function useLiveElapsed(receipt: RunReceipt | undefined): number {
  const [live, setLive] = useState(() => ({ receipt, elapsedMs: receipt?.elapsedMs ?? 0 }))
  useEffect(() => {
    const elapsedMs = receipt?.elapsedMs ?? 0
    setLive({ receipt, elapsedMs })
    if (receipt?.outcome !== 'running') return
    const observedAt = Date.now()
    const timer = setInterval(() => {
      setLive({ receipt, elapsedMs: elapsedMs + Date.now() - observedAt })
    }, 1000)
    return () => { clearInterval(timer) }
  }, [receipt])
  return live.receipt === receipt ? live.elapsedMs : receipt?.elapsedMs ?? 0
}

function stageRows(receipt: RunReceipt, t: RunReceiptOverlayProps['t']): ReactNode[] {
  return receipt.stages.map(stage => h('li', {
    className: 'dsh-legion-receipt__row',
    key: stage.id,
  }, [
    h('span', { className: 'dsh-legion-receipt__primary', key: 'primary' }, [
      h('strong', { key: 'stage' }, stage.id),
      h('span', { key: 'member' }, stage.member),
    ]),
    h('span', { className: 'dsh-legion-receipt__secondary', key: 'after' },
      stage.after.length === 0 ? t('receiptRootStage') : t('receiptAfter') + ' ' + stage.after.join(', ')),
    h('span', {
      className: 'dsh-legion-receipt__status',
      'data-status': stage.status,
      key: 'status',
    }, stage.status),
  ]))
}

function participationRows(receipt: RunReceipt): ReactNode[] {
  return receipt.participation.map(participant => h('li', {
    className: 'dsh-legion-receipt__row',
    key: String(participant.childId),
  }, [
    h('span', { className: 'dsh-legion-receipt__primary', key: 'primary' }, [
      h('strong', { key: 'member' }, participant.member),
      h('span', { key: 'stage' }, participant.stage),
    ]),
    h('span', { className: 'dsh-legion-receipt__secondary', key: 'child' }, String(participant.childId)),
    h('span', {
      className: 'dsh-legion-receipt__status',
      'data-status': participant.state === 'live' ? participant.registryStatus : 'ended',
      key: 'status',
    }, participant.state === 'live' ? participant.registryStatus : 'ended'),
  ]))
}

function tokenAccount(receipt: RunReceipt, t: RunReceiptOverlayProps['t']): ReactNode {
  const totals = receipt.tokenAccount.totals
  const rows = [
    ['receiptTotal', totals.totalTokens],
    ['receiptInput', totals.uncachedInputTokens],
    ['receiptOutput', totals.outputTokens],
    ['receiptCacheRead', totals.cacheReadTokens],
    ['receiptCacheWrite', totals.cacheWriteTokens],
  ] as const
  return h('dl', { className: 'dsh-legion-receipt__tokens' }, rows.flatMap(([key, value]) => [
    h('dt', { key: key + '-label' }, t(key)),
    h('dd', { key }, number(value)),
  ]))
}

function dragStart(event: ReactPointerEvent<HTMLDivElement>): void {
  const panel = event.currentTarget.closest<HTMLElement>('.dsh-legion-receipt')
  const bounds = panel?.parentElement?.getBoundingClientRect()
  const rect = panel?.getBoundingClientRect()
  if (panel === null || bounds === undefined || rect === undefined) return
  const data = event.currentTarget.dataset
  data.startX = String(event.clientX)
  data.startY = String(event.clientY)
  data.originX = String(rect.left - bounds.left)
  data.originY = String(rect.top - bounds.top)
  data.maxX = String(Math.max(12, bounds.width - rect.width - 12))
  data.maxY = String(Math.max(12, bounds.height - rect.height - 12))
  event.currentTarget.setPointerCapture(event.pointerId)
}

function dragMove(event: ReactPointerEvent<HTMLDivElement>, actions: OverlayActions): void {
  if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
  const data = event.currentTarget.dataset
  const values = [data.startX, data.startY, data.originX, data.originY, data.maxX, data.maxY].map(Number)
  if (values.some(value => !Number.isFinite(value))) return
  const [startX, startY, originX, originY, maxX, maxY] = values as [number, number, number, number, number, number]
  actions.move(
    Math.max(12, Math.min(maxX, originX + event.clientX - startX)),
    Math.max(12, Math.min(maxY, originY + event.clientY - startY)),
  )
}

function dragEnd(event: ReactPointerEvent<HTMLDivElement>, actions: OverlayActions): void {
  if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
  dragMove(event, actions)
  event.currentTarget.releasePointerCapture(event.pointerId)
}

/** Render the newest Receipt in the current Session, or nothing when absent/dismissed. */
export function RunReceiptOverlay(props: RunReceiptOverlayProps): ReactNode {
  const projection = props.useSessions((sessions) => {
    const current = sessions.current
    if (current === undefined) return undefined
    const values = sessions.byId[current]?.projectionValues as LegionProjectionValues | undefined
    return values?.[LEGION_RUN_RECEIPT_PROJECTION_KEY]
  })
  const receipt = latestReceipt(projection)
  const state = props.useStore(snapshot => snapshot)
  const hidden = receipt === undefined || state.dismissedRunId === String(receipt.runId)
  const liveElapsed = useLiveElapsed(hidden ? undefined : receipt)
  if (hidden || receipt === undefined) return null

  const position = state.docked
    ? { right: 16, bottom: 16 }
    : {
        left: `clamp(12px, ${state.x}px, calc(100% - min(360px, calc(100% - 24px)) - 12px))`,
        top: `clamp(12px, ${state.y}px, calc(100% - 48px))`,
      }
  return h('aside', {
    className: 'dsh-legion-receipt',
    'data-docked': state.docked || undefined,
    'data-run-id': String(receipt.runId),
    style: position,
    'aria-label': props.t('receiptTitle'),
  }, [
    h('header', { className: 'dsh-legion-receipt__drag', key: 'header' }, [
      h('div', {
        className: 'dsh-legion-receipt__title',
        title: props.t('receiptMove'),
        onPointerDown: dragStart,
        onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => { dragMove(event, props.actions) },
        onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => { dragEnd(event, props.actions) },
        key: 'title',
      }, props.t('receiptTitle')),
      h('div', { className: 'dsh-legion-receipt__actions', key: 'actions' }, [
        !state.docked && h('button', {
          className: 'dsh-legion-receipt__button',
          type: 'button',
          onClick: props.actions.dock,
          key: 'dock',
        }, props.t('receiptDock')),
        h('button', {
          className: 'dsh-legion-receipt__button',
          type: 'button',
          onClick: () => { props.actions.dismiss(String(receipt.runId)) },
          key: 'dismiss',
        }, props.t('receiptDismiss')),
      ]),
    ]),
    h('div', { className: 'dsh-legion-receipt__meta', key: 'meta' }, [
      h('span', { className: 'dsh-legion-receipt__metric', key: 'identity' }, String(receipt.strategy) + ' · ' + String(receipt.cohort)),
      h('span', { className: 'dsh-legion-receipt__metric', key: 'elapsed' }, props.t('receiptElapsed') + ': ' + elapsed(liveElapsed)),
      h('span', {
        className: 'dsh-legion-receipt__status',
        'data-status': receipt.outcome,
        key: 'outcome',
      }, receipt.outcome),
    ]),
    h('section', { className: 'dsh-legion-receipt__section', key: 'stages' }, [
      h('h2', { className: 'dsh-legion-receipt__heading', key: 'heading' }, props.t('receiptStages')),
      h('ol', { className: 'dsh-legion-receipt__list', key: 'list' }, stageRows(receipt, props.t)),
    ]),
    h('section', { className: 'dsh-legion-receipt__section', key: 'participation' }, [
      h('h2', { className: 'dsh-legion-receipt__heading', key: 'heading' }, props.t('receiptParticipation')),
      h('ul', { className: 'dsh-legion-receipt__list', key: 'list' }, participationRows(receipt)),
    ]),
    h('section', { className: 'dsh-legion-receipt__section', key: 'tokens' }, [
      h('h2', { className: 'dsh-legion-receipt__heading', key: 'heading' }, props.t('receiptTokens')),
      tokenAccount(receipt, props.t),
    ]),
  ])
}
