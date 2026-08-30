/** Accessible Run Receipt presentation for the additive shell overlay seat. */
import {
  createElement as h,
  Fragment,
  memo,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { defineStore } from '@deepseek-ai/dsh-client-store'
import { Button, Pill, StateDot, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ComposedProps } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  RunReceipt,
  RunReceiptEvidenceCoverage,
  RunReceiptParticipant,
  RunReceiptStageStatus,
  RunReceiptTokenEvidence,
  RunReceiptTokenField,
  RunReceiptTokenSample,
} from '../types.ts'
import type { ClientReceiptSnapshot } from './model.ts'
import { RECEIPT_LOCALE_NS, type ReceiptLocaleKey } from './locales.ts'

export const RUN_RECEIPT_OVERLAY_ID = 'legion.run-receipts'
export const RUN_RECEIPT_OVERLAY_SLOT = 'shell.overlay'

interface SelectedRun {
  sessionId: string
  runId: string
}

export interface ReceiptPresentationState {
  docked: boolean
  x: number
  y: number
  selected: SelectedRun | null
  dismissed: string[]
}

const dismissalKey = (sessionId: string, runId: string): string => `${sessionId}\u0000${runId}`

/** Persist only presentation choices; full Receipt DTOs stay in the model store. */
export function createReceiptPresentationStore() {
  return defineStore({
    init: (): ReceiptPresentationState => ({ docked: true, x: 24, y: 24, selected: null, dismissed: [] }),
    persist: 'dsh-legion-receipts.presentation.v1',
    actions: {
      move(state, x: number, y: number) {
        state.docked = false
        state.x = x
        state.y = y
      },
      dock(state) { state.docked = true },
      select(state, sessionId: string, runId: string) {
        state.selected = { sessionId, runId }
      },
      dismiss(state, sessionId: string, runId: string) {
        const key = dismissalKey(sessionId, runId)
        state.dismissed = [...state.dismissed.filter(item => item !== key), key].slice(-64)
      },
      reopen(state, sessionId: string, runId: string) {
        const key = dismissalKey(sessionId, runId)
        state.dismissed = state.dismissed.filter(item => item !== key)
        state.selected = { sessionId, runId }
      },
    },
  })
}

type ReceiptPresentationStore = ReturnType<typeof createReceiptPresentationStore>
type ReceiptInjected = {
  hooks: { receipt: { getSnapshot(): ClientReceiptSnapshot; subscribe(fn: () => void): () => void } }
}

export type RunReceiptOverlayProps = ComposedProps<
  'shell.overlay', never, never, ReceiptPresentationStore, ReceiptInjected, never, typeof RECEIPT_LOCALE_NS
>

type OverlayActions = Pick<RunReceiptOverlayProps['actions'], 'move' | 'dock' | 'select' | 'dismiss' | 'reopen'>

const TOKEN_FIELDS = [
  ['totalTokens', 'totalTokens'],
  ['uncachedInputTokens', 'inputTokens'],
  ['outputTokens', 'outputTokens'],
  ['cacheReadTokens', 'cacheReadTokens'],
  ['cacheWriteTokens', 'cacheWriteTokens'],
] as const satisfies readonly (readonly [RunReceiptTokenField, ReceiptLocaleKey])[]

function sortedActive(receipts: readonly RunReceipt[]): RunReceipt[] {
  return receipts.filter(receipt => receipt.outcome === 'running').sort((left, right) =>
    right.startedAt - left.startedAt || right.runId.localeCompare(left.runId))
}

function selectedReceipt(
  snapshot: ClientReceiptSnapshot,
  state: ReceiptPresentationState,
): RunReceipt | undefined {
  const sessionId = snapshot.sessionId
  const receipts = snapshot.model?.receipts ?? []
  if (sessionId === undefined) return undefined
  const dismissed = new Set(state.dismissed)
  const visible = (receipt: RunReceipt): boolean => !dismissed.has(dismissalKey(sessionId, receipt.runId))
  const active = sortedActive(receipts).filter(visible)
  const retained = state.selected?.sessionId === sessionId
    ? receipts.find(receipt => receipt.runId === state.selected?.runId && visible(receipt))
    : undefined
  if (retained !== undefined) return retained
  if (active[0] !== undefined) return active[0]
  return receipts.filter(receipt => receipt.outcome !== 'running' && visible(receipt))
    .sort((left, right) => right.startedAt - left.startedAt || right.runId.localeCompare(left.runId))[0]
}

function launcherReceipt(snapshot: ClientReceiptSnapshot, state: ReceiptPresentationState): RunReceipt | undefined {
  const receipts = snapshot.model?.receipts ?? []
  const retained = state.selected?.sessionId === snapshot.sessionId
    ? receipts.find(receipt => receipt.runId === state.selected?.runId)
    : undefined
  return retained ?? sortedActive(receipts)[0] ?? receipts.filter(receipt => receipt.outcome !== 'running')
    .sort((left, right) => right.startedAt - left.startedAt || right.runId.localeCompare(left.runId))[0]
}

function elapsed(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  const seconds = ms / 1000
  return `${seconds.toFixed(Number.isInteger(seconds) ? 0 : 1)} s`
}

function number(value: number): string {
  return value.toLocaleString()
}

function dot(status: RunReceiptStageStatus | RunReceipt['outcome'] | RunReceiptParticipant['state']): StateDotState {
  if (status === 'running') return 'ongoing'
  if (status === 'completed' || status === 'ended' || status === 'idle') return 'done'
  if (status === 'pending' || status === 'degraded') return 'warning'
  return 'error'
}

function stateMessage(state: ClientReceiptSnapshot['state'], t: RunReceiptOverlayProps['t']): string {
  switch (state) {
    case 'opening': return t('opening')
    case 'ready-empty': return t('readyEmpty')
    case 'active': return t('active')
    case 'partial': return t('partial')
    case 'reconnecting': return t('reconnecting')
    case 'feed-unavailable': return t('feedUnavailable')
    case 'invalid-frame': return t('invalidFrame')
    case 'stream-error': return t('streamError')
    case 'settled': return t('settled')
    case 'direct-clear-empty': return t('directClearEmpty')
    case 'new-instance-empty': return t('newInstanceEmpty')
  }
}

function constrainedLayout(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(max-width: 639px)').matches || window.matchMedia('(pointer: coarse)').matches
}

function availability(
  participant: RunReceiptParticipant,
  sample: RunReceiptTokenSample | undefined,
  t: RunReceiptOverlayProps['t'],
): string {
  const tokens = sample === undefined ? [] : TOKEN_FIELDS.map(([field]) => sample[field])
  const unavailable = tokens.filter(token => token.status === 'unavailable').length
  if (participant.timing.status === 'unavailable' && unavailable === tokens.length) return t('unavailable')
  if (participant.timing.status === 'unavailable' || unavailable > 0
    || tokens.some(token => token.status === 'provisional')) return t('coveragePartial')
  return t('available')
}

function evidenceText(evidence: RunReceiptTokenEvidence, t: RunReceiptOverlayProps['t']): string {
  return evidence.status === 'unavailable'
    ? `${t('unavailable')} · ${evidence.reason}`
    : `${number(evidence.value)} · ${evidence.status} · ${evidence.source}`
}

function coverageText(coverage: RunReceiptEvidenceCoverage, t: RunReceiptOverlayProps['t']): string {
  if (coverage.status === 'complete') return t('coverageComplete')
  if (coverage.status === 'partial') return t('coveragePartial')
  return t('coverageUnavailable')
}

function coverageDetails(
  coverage: RunReceiptEvidenceCoverage,
  t: RunReceiptOverlayProps['t'],
): string {
  return `${coverageText(coverage, t)} · ${t('reported')}: ${coverage.reported}`
    + ` · ${t('provisional')}: ${coverage.provisional}`
    + ` · ${t('unavailable')}: ${coverage.unavailable}`
    + ` · ${t('truncated')}: ${coverage.truncated}`
}

function participantRow(
  participant: RunReceiptParticipant,
  sample: RunReceiptTokenSample | undefined,
  t: RunReceiptOverlayProps['t'],
): ReactNode {
  const timing = participant.timing.status === 'reported' ? elapsed(participant.timing.elapsedMs) : t('unavailable')
  return h('li', { className: 'dsh-legion-receipt__participant', key: participant.childId }, [
    h('div', { className: 'dsh-legion-receipt__participant-main', key: 'main' }, [
      h(StateDot, { state: dot(participant.state), key: 'dot' }),
      h('strong', { key: 'member' }, participant.member),
      h(Pill, { key: 'state' }, participant.state),
      h('span', { key: 'elapsed' }, timing),
      h('span', { key: 'availability' }, availability(participant, sample, t)),
    ]),
    h('details', { className: 'dsh-legion-receipt__details', key: 'details' }, [
      h('summary', { key: 'summary' }, t('details')),
      h('dl', { key: 'sources' }, [
        h('dt', { key: 'provider-label' }, t('provider')),
        h('dd', { key: 'provider' }, participant.provider ?? t('unavailable')),
        h('dt', { key: 'source-label' }, t('source')),
        h('dd', { key: 'source' }, participant.source),
        h('dt', { key: 'timing-label' }, t('timingSource')),
        h('dd', { key: 'timing' }, participant.timing.status === 'reported' ? participant.timing.source : participant.timing.reason),
        ...TOKEN_FIELDS.flatMap(([field, label]) => [
          h('dt', { key: `${field}-label` }, t(label)),
          h('dd', { key: field }, sample === undefined ? t('unavailable') : evidenceText(sample[field], t)),
        ]),
      ]),
    ]),
  ])
}

function stages(receipt: RunReceipt, t: RunReceiptOverlayProps['t']): ReactNode {
  const completed = receipt.stages.filter(stage => stage.status !== 'pending').length
  return h('section', { className: 'dsh-legion-receipt__section', key: 'stages' }, [
    h('h2', { key: 'heading' }, t('stages')),
    h('p', { className: 'dsh-legion-receipt__overview', key: 'overview' }, `${t('stageOverview')}: ${completed}/${receipt.stages.length}`),
    h('ol', { className: 'dsh-legion-receipt__stages', key: 'list' }, receipt.stages.map(stage =>
      h('li', { key: stage.id }, [
        h(StateDot, { state: dot(stage.status), key: 'dot' }),
        h('strong', { key: 'id' }, stage.id),
        h('span', { key: 'member' }, stage.member),
        h(Pill, { key: 'status' }, stage.status),
        h('small', { key: 'after' }, stage.after.length === 0 ? t('rootStage') : `${t('after')} ${stage.after.join(', ')}`),
      ]))),
  ])
}

function participants(receipt: RunReceipt, t: RunReceiptOverlayProps['t']): ReactNode {
  const samples = new Map(receipt.tokenAccount.sessions.map(sample => [sample.childId, sample]))
  const rowsByStage = new Map<string, RunReceiptParticipant[]>()
  for (const participant of receipt.participation.rows) {
    const rows = rowsByStage.get(participant.stage)
    if (rows === undefined) rowsByStage.set(participant.stage, [participant])
    else rows.push(participant)
  }
  return h('section', { className: 'dsh-legion-receipt__section', key: 'participants' }, [
    h('h2', { key: 'heading' }, t('participants')),
    ...receipt.stages.map(stage => {
      const rows = rowsByStage.get(stage.id)
      if (rows === undefined) return null
      return h('section', { className: 'dsh-legion-receipt__stage-group', key: stage.id }, [
        h('h3', { key: 'heading' }, `${stage.id} · ${stage.member}`),
        h('ul', { key: 'rows' }, rows.map(participant => participantRow(participant, samples.get(participant.childId), t))),
      ])
    }),
  ])
}

function aggregate(receipt: RunReceipt, t: RunReceiptOverlayProps['t']): ReactNode {
  return h('section', { className: 'dsh-legion-receipt__section dsh-legion-receipt__aggregate', key: 'aggregate' }, [
    h('h2', { key: 'heading' }, t('tokens')),
    h('dl', { key: 'tokens' }, TOKEN_FIELDS.flatMap(([field, label]) => {
      const total = receipt.tokenAccount.totals[field]
      const prefix = total.coverage.status === 'complete' ? t('total') : t('knownSubtotal')
      const value = total.value === null ? t('unavailable') : number(total.value)
      return [
        h('dt', { key: `${field}-label` }, `${prefix} · ${t(label)}`),
        h('dd', { key: field }, `${value} · ${coverageDetails(total.coverage, t)}`),
      ]
    })),
    h('p', { key: 'participation-coverage' },
      `${t('participants')}: ${coverageDetails(receipt.participation.coverage, t)}`),
    h('p', { key: 'timing-coverage' },
      `${t('elapsed')}: ${coverageDetails(receipt.timing.coverage, t)}`),
  ])
}

function dragStart(event: ReactPointerEvent<HTMLElement>): void {
  if (constrainedLayout()) return
  const panel = event.currentTarget.closest<HTMLElement>('.dsh-legion-receipt')
  const bounds = panel?.parentElement?.getBoundingClientRect()
  const rect = panel?.getBoundingClientRect()
  if (panel === null || bounds === undefined || rect === undefined) return
  Object.assign(event.currentTarget.dataset, {
    startX: String(event.clientX), startY: String(event.clientY),
    originX: String(rect.left - bounds.left), originY: String(rect.top - bounds.top),
    maxX: String(Math.max(12, bounds.width - rect.width - 12)),
    maxY: String(Math.max(12, bounds.height - rect.height - 12)),
  })
  event.currentTarget.setPointerCapture(event.pointerId)
}

function dragMove(event: ReactPointerEvent<HTMLElement>, actions: OverlayActions): void {
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

function dragEnd(event: ReactPointerEvent<HTMLElement>, actions: OverlayActions): void {
  if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
  dragMove(event, actions)
  event.currentTarget.releasePointerCapture(event.pointerId)
}

interface ReceiptFactsProps {
  readonly actions: OverlayActions
  readonly selected: RunReceipt
  readonly snapshot: ClientReceiptSnapshot
  readonly t: RunReceiptOverlayProps['t']
}

const ReceiptFacts = memo(function ReceiptFacts({
  actions, selected, snapshot, t,
}: ReceiptFactsProps): ReactNode {
  return h(Fragment, null, [
    (snapshot.model?.receipts.length ?? 0) > 1
      ? h('label', { className: 'dsh-legion-receipt__selector', key: 'selector' }, [
          h('span', { key: 'label' }, t('selectRun')),
          h('select', {
            className: 'dsh-legion-receipt__action',
            'aria-label': t('selectRun'),
            value: selected.runId,
            onChange: (event: { currentTarget: HTMLSelectElement }) => {
              if (snapshot.sessionId !== undefined) actions.select(snapshot.sessionId, event.currentTarget.value)
            },
            key: 'select',
          }, snapshot.model?.receipts.map(receipt => h('option', { value: receipt.runId, key: receipt.runId },
            `${receipt.strategy} · ${receipt.runId} · ${receipt.outcome}`))),
        ])
      : null,
    stages(selected, t),
    participants(selected, t),
    aggregate(selected, t),
  ])
})

/** Render the current Session model without taking over the frame-wide pointer layer. */
export function RunReceiptOverlay(props: RunReceiptOverlayProps): ReactNode {
  const snapshot = props.useReceipt(value => value)
  const presentation = props.useStore(value => value)
  const selected = selectedReceipt(snapshot, presentation)
  const launcherTarget = launcherReceipt(snapshot, presentation)
  const heading = useRef<HTMLHeadingElement>(null)
  const focusHeading = useRef(false)
  const constrained = constrainedLayout()

  useEffect(() => {
    if (!focusHeading.current || selected === undefined) return
    focusHeading.current = false
    heading.current?.focus()
  }, [selected?.runId])

  useEffect(() => {
    if (selected === undefined || snapshot.sessionId === undefined) return
    if (presentation.selected?.sessionId === snapshot.sessionId
      && presentation.selected.runId === selected.runId) return
    props.actions.select(snapshot.sessionId, selected.runId)
  }, [presentation.selected?.runId, selected?.runId, snapshot.sessionId])

  const feedLabel = snapshot.state === 'reconnecting'
    ? props.t('stale')
    : snapshot.state === 'feed-unavailable' || snapshot.state === 'invalid-frame' || snapshot.state === 'stream-error'
      ? props.t('unavailable')
      : props.t('available')
  const live = snapshot.state === 'reconnecting'
    ? props.t('announceReconnect')
    : snapshot.state === 'feed-unavailable' || snapshot.state === 'invalid-frame' || snapshot.state === 'stream-error'
      ? props.t('announceFeedError')
      : selected !== undefined && selected.outcome !== 'running'
        ? props.t('announceTerminal', { outcome: selected.outcome })
        : ''

  const reopen = (): void => {
    if (snapshot.sessionId === undefined || launcherTarget === undefined) return
    focusHeading.current = selected === undefined
    props.actions.reopen(snapshot.sessionId, launcherTarget.runId)
    if (selected !== undefined) heading.current?.focus()
  }

  const dismiss = (): void => {
    if (snapshot.sessionId === undefined || selected === undefined) return
    props.actions.dismiss(snapshot.sessionId, selected.runId)
    document.getElementById('dsh-legion-receipts-launcher')?.focus()
  }

  const panel = selected === undefined && snapshot.model !== undefined && snapshot.model.receipts.length > 0
    ? null
    : h('aside', {
        key: 'panel',
        className: 'dsh-legion-receipt',
        'data-layout': constrained ? 'bottom-dock' : presentation.docked ? 'docked' : 'floating',
        'data-receipt-state': snapshot.state,
        'data-run-id': selected?.runId,
        style: constrained || presentation.docked
          ? { right: 16, bottom: 16 }
          : {
              left: `clamp(12px, ${presentation.x}px, calc(100% - min(420px, calc(100% - 24px)) - 12px))`,
              top: `clamp(12px, ${presentation.y}px, calc(100% - 48px))`,
            },
        'aria-label': props.t('title'),
      }, [
        h('header', { className: 'dsh-legion-receipt__header', key: 'header' }, [
          h('div', {
            className: 'dsh-legion-receipt__identity dsh-legion-receipt__drag',
            'data-draggable': constrained ? undefined : 'true',
            title: constrained ? undefined : props.t('move'),
            onPointerDown: constrained ? undefined : dragStart,
            onPointerMove: constrained ? undefined : (event: ReactPointerEvent<HTMLElement>) => { dragMove(event, props.actions) },
            onPointerUp: constrained ? undefined : (event: ReactPointerEvent<HTMLElement>) => { dragEnd(event, props.actions) },
            key: 'identity',
          }, [
            h('h1', { ref: heading, tabIndex: -1, key: 'title' }, props.t('title')),
            selected === undefined ? null : h(Fragment, { key: 'receipt-header' }, [
              h('code', { key: 'run' }, selected.runId),
              h('div', { className: 'dsh-legion-receipt__header-meta', key: 'meta' }, [
                h('span', { key: 'identity' }, `${selected.strategy} · ${selected.cohort}`),
                h('span', { key: 'outcome' }, [
                  h(StateDot, { state: dot(selected.outcome), key: 'dot' }),
                  h('span', { key: 'label' }, `${props.t('outcome')}: ${selected.outcome}`),
                ]),
                h(Pill, { key: 'feed' }, `${props.t('feed')}: ${feedLabel}`),
                h('span', { key: 'elapsed' }, `${props.t('elapsed')}: ${elapsed(selected.timing.elapsedMs)}`),
              ]),
            ]),
          ]),
          h('div', { className: 'dsh-legion-receipt__actions', key: 'actions' }, [
            h(Button, {
              className: 'dsh-legion-receipt__action', variant: 'outline',
              'aria-label': props.t('dock'), onClick: props.actions.dock, key: 'dock',
            }, props.t('dock')),
            selected === undefined ? null : h(Button, {
              className: 'dsh-legion-receipt__action', variant: 'ghost',
              'aria-label': props.t('dismiss'), onClick: dismiss, key: 'dismiss',
            }, props.t('dismiss')),
          ]),
        ]),
        h('p', { className: 'dsh-legion-receipt__notice', key: 'notice' }, stateMessage(snapshot.state, props.t)),
        snapshot.directClear && selected !== undefined
          ? h('p', { className: 'dsh-legion-receipt__notice', key: 'direct-clear' }, props.t('directClearActive'))
          : null,
        snapshot.diagnostic === undefined
          ? null
          : h('code', { className: 'dsh-legion-receipt__diagnostic', key: 'diagnostic' }, snapshot.diagnostic),
        selected === undefined ? null : h(ReceiptFacts, {
          actions: props.actions,
          selected,
          snapshot,
          t: props.t,
          key: 'facts',
        }),
      ])

  return h(Fragment, null, [
    h(Button, {
      id: 'dsh-legion-receipts-launcher',
      className: 'dsh-legion-receipt__launcher dsh-legion-receipt__action',
      variant: snapshot.state === 'feed-unavailable' ? 'outline' : 'toolbar',
      'aria-label': props.t('launcher'),
      onClick: reopen,
      key: 'launcher',
    }, snapshot.state === 'feed-unavailable'
      ? `${props.t('launcher')} · ${props.t('unavailable')}`
      : props.t('launcher')),
    panel,
    h('div', { className: 'dsh-legion-receipt__live', 'aria-live': 'polite', 'aria-atomic': 'true', key: 'live' }, live),
  ])
}
