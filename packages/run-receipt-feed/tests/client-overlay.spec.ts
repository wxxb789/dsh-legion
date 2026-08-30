// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  RemoteStream, RemoteStreamCarrierError,
  type RemoteStreamOptions,
} from '@deepseek-ai/dsh-api-gateway/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { SlotTestRuntime, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { ReceiptFeedFrame, ReceiptSessionModel, RunReceipt } from '../src/types.ts'
import { receipt, runId, settle } from './fixtures.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as applySettings, inject as settingsInject } from '../../../src/client/index.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { createElement: element } = await import('react')
  return {
    Button: ({ variant: _variant, size: _size, icon: _icon, children, ...props }: Record<string, unknown> & { children?: ReactNode }) =>
      element('button', { type: 'button', ...props }, children),
    Pill: ({ active: _active, children, onClick, ...props }: Record<string, unknown> & { children?: ReactNode }) =>
      element(onClick === undefined ? 'span' : 'button', onClick === undefined ? props : { type: 'button', onClick, ...props }, children),
    StateDot: ({ state }: { state: string }) => element('span', { 'data-state': state, 'aria-hidden': 'true' }),
  }
})

class TestLocale {
  private readonly dictionaries = new Map<string, Record<string, string>>()
  private readonly listeners = new Set<() => void>()
  private revision = 0

  register(namespace: string, dictionaries: { en: Record<string, string> }): () => void {
    this.dictionaries.set(namespace, dictionaries.en)
    this.revision += 1
    for (const listener of this.listeners) listener()
    return () => { this.dictionaries.delete(namespace) }
  }

  bind(namespace: string): (key: string, params?: Record<string, unknown>) => string {
    return (key, params = {}) => {
      const template = this.dictionaries.get(namespace)?.[key] ?? key
      return template.replace(/\{([^}]+)\}/g, (_match, name: string) => String(params[name] ?? `{${name}}`))
    }
  }

  getSnapshot(): { revision: number } {
    return { revision: this.revision }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}

interface PendingFrame {
  readonly value: ReceiptFeedFrame
  readonly accepted: () => void
}

class FollowChannel implements AsyncIterable<ReceiptFeedFrame>, AsyncIterator<ReceiptFeedFrame> {
  private readonly pending: PendingFrame[] = []
  private waiting: (() => void) | undefined
  private delivered: (() => void) | undefined
  private failure: unknown
  private ended = false
  private closeGate: Promise<void> | undefined

  constructor(signal: AbortSignal) {
    const close = (): void => { this.close() }
    signal.addEventListener('abort', close, { once: true })
    if (signal.aborted) close()
  }

  holdClose(gate: Promise<void>): void {
    this.closeGate = gate
  }

  push(value: ReceiptFeedFrame): Promise<void> {
    return new Promise((resolve) => {
      this.pending.push({ value, accepted: resolve })
      this.wake()
    })
  }

  fail(error: unknown): void {
    this.failure = error
    this.wake()
  }

  close(): void {
    this.ended = true
    this.wake()
  }

  async next(): Promise<IteratorResult<ReceiptFeedFrame>> {
    this.delivered?.()
    this.delivered = undefined
    while (this.pending.length === 0 && this.failure === undefined && !this.ended) {
      await new Promise<void>((resolve) => { this.waiting = resolve })
    }
    if (this.failure !== undefined) {
      const error = this.failure
      this.failure = undefined
      throw error
    }
    const frame = this.pending.shift()
    if (frame !== undefined) {
      this.delivered = frame.accepted
      return { done: false, value: frame.value }
    }
    await this.closeGate
    return { done: true, value: undefined }
  }

  async return(): Promise<IteratorResult<ReceiptFeedFrame>> {
    this.ended = true
    this.delivered?.()
    this.delivered = undefined
    for (const frame of this.pending.splice(0)) frame.accepted()
    this.wake()
    await this.closeGate
    return { done: true, value: undefined }
  }

  [Symbol.asyncIterator](): AsyncIterator<ReceiptFeedFrame> {
    return this
  }

  private wake(): void {
    const waiting = this.waiting
    this.waiting = undefined
    waiting?.()
  }
}

class FollowScript {
  private readonly unread = new Map<string, FollowChannel[]>()
  private readonly waiters = new Map<string, ((channel: FollowChannel) => void)[]>()

  open(sessionId: string, signal: AbortSignal): AsyncIterable<ReceiptFeedFrame> {
    const channel = new FollowChannel(signal)
    const waiter = this.waiters.get(sessionId)?.shift()
    if (waiter === undefined) {
      const unread = this.unread.get(sessionId) ?? []
      unread.push(channel)
      this.unread.set(sessionId, unread)
    } else {
      waiter(channel)
    }
    return channel
  }

  nextOpen(sessionId: string): Promise<FollowChannel> {
    const unread = this.unread.get(sessionId)
    const channel = unread?.shift()
    if (channel !== undefined) return Promise.resolve(channel)
    return new Promise((resolve) => {
      const waiters = this.waiters.get(sessionId) ?? []
      waiters.push(resolve)
      this.waiters.set(sessionId, waiters)
    })
  }
}

class ScriptedRemote {
  readonly generation = createSnapshotStore({ id: 1, host: { home: '' } })
  readonly mounted: unknown[] = []
  disposedMounts = 0
  readonly legionReceipts?: { follow(sessionId: string, signal?: AbortSignal): AsyncIterable<ReceiptFeedFrame> }
  private readonly mountFailure: Error | undefined

  constructor(script: FollowScript, options: { incompatible?: boolean; missingNamespace?: boolean } = {}) {
    this.mountFailure = options.incompatible === true ? new Error('incompatible Remote contribution') : undefined
    if (options.missingNamespace !== true) {
      this.legionReceipts = {
        follow: (sessionId, signal = new AbortController().signal) => script.open(sessionId, signal),
      }
    }
  }

  async $mount(contribution: unknown): Promise<() => Promise<void>> {
    if (this.mountFailure !== undefined) throw this.mountFailure
    this.mounted.push(contribution)
    return async () => { this.disposedMounts += 1 }
  }

  $stream<Item>(options: RemoteStreamOptions<Item>): RemoteStream<Item> {
    return new RemoteStream({ generation: this.generation }, options)
  }
}

function model(sessionId: string, revision: number, receipts: readonly RunReceipt[]): ReceiptSessionModel {
  return {
    schemaVersion: 1,
    sessionId,
    revision,
    feed: { status: 'available' },
    receipts,
  }
}

function baseline(sessionId: string, revision: number, receipts: readonly RunReceipt[] = []): ReceiptFeedFrame {
  return { type: 'baseline', value: model(sessionId, revision, receipts) }
}

function replacement(sessionId: string, revision: number, receipts: readonly RunReceipt[] = []): ReceiptFeedFrame {
  return { type: 'replacement', value: model(sessionId, revision, receipts) }
}

function partialReceipt(sessionId: string): RunReceipt {
  const value = receipt(sessionId, 1, 2)
  const unavailable = { status: 'unavailable' as const, reason: 'remote-unobservable' as const }
  const rows = [
    value.participation.rows[0]!,
    {
      ...value.participation.rows[1]!,
      source: 'remote' as const,
      state: 'ended' as const,
      timing: unavailable,
    },
  ]
  const sessions = [
    value.tokenAccount.sessions[0]!,
    {
      ...value.tokenAccount.sessions[1]!,
      logRevision: null,
      totalTokens: unavailable,
      uncachedInputTokens: unavailable,
      outputTokens: unavailable,
      cacheReadTokens: unavailable,
      cacheWriteTokens: unavailable,
    },
  ]
  const coverage = { status: 'partial' as const, total: 2, reported: 1, provisional: 0, unavailable: 1, truncated: 0 }
  const totals: RunReceipt['tokenAccount']['totals'] = {
    totalTokens: { value: 3, coverage },
    uncachedInputTokens: { value: 1, coverage },
    outputTokens: { value: 2, coverage },
    cacheReadTokens: { value: 0, coverage },
    cacheWriteTokens: { value: 0, coverage },
  }
  return {
    ...value,
    timing: { ...value.timing, coverage },
    participation: { ...value.participation, rows },
    tokenAccount: { coverage: 'partial', totals, sessions },
  }
}

interface Bench {
  readonly runtime: SlotTestRuntime
  readonly script: FollowScript
  readonly remote: ScriptedRemote
  readonly view: ReturnType<SlotTestRuntime['renderSlot']>
  readonly conversation: ReturnType<SlotTestRuntime['renderSlot']>
  readonly receiptFeature: Awaited<ReturnType<SlotTestRuntime['mount']>>
}

async function bench(options: { incompatible?: boolean; missingNamespace?: boolean; otherOverlay?: boolean } = {}): Promise<Bench> {
  localStorage.clear()
  const runtime = await SlotTestRuntime.create()
  await runtime.sessions.add({ id: 'session-a' })
  await runtime.sessions.add({ id: 'session-b' }, { current: false })
  const locale = new TestLocale()
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  const script = new FollowScript()
  const remote = new ScriptedRemote(script, options)
  runtime.ctx.provide('remote', remote)
  const settings = stubSettingsScope<Record<string, unknown>>()
  settings.publish({
    status: 'ready', value: {}, base: {}, user: {}, revision: 1, writable: true, mode: 'host',
  })
  runtime.ctx.provide('settingsScope', { bind: () => settings.scope })
  await runtime.declare({
    'shell.overlay': { kind: 'list', scope: 'root' },
    conversation: { kind: 'single', scope: 'session-maybe' },
    'settings.plugin.item': { kind: 'keyed', scope: 'root' },
  })
  runtime.slots.register({ name: 'conversation' }, () =>
    createElement('button', { type: 'button', onClick: () => { document.body.dataset.conversationClicked = 'yes' } }, 'Conversation control'))
  if (options.otherOverlay === true) {
    runtime.slots.register({ name: 'shell.overlay', id: 'other-overlay', order: 10 }, () =>
      createElement('button', { type: 'button', onClick: () => { document.body.dataset.otherClicked = 'yes' } }, 'Other control'))
  }
  await runtime.mount({ inject: [...settingsInject], apply: applySettings })
  const receiptFeature = await runtime.mount({ inject: [...inject], apply: apply as (ctx: Context) => unknown })
  const view = runtime.renderSlot('shell.overlay', {})
  const conversation = runtime.renderSlot('conversation', {})
  return { runtime, script, remote, view, conversation, receiptFeature }
}

async function show(channel: FollowChannel, frame: ReceiptFeedFrame, runtime: SlotTestRuntime): Promise<void> {
  await channel.push(frame)
  await runtime.flush()
}

const benches: SlotTestRuntime[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete document.body.dataset.otherClicked
  delete document.body.dataset.conversationClicked
  for (const runtime of benches.splice(0)) await runtime.dispose()
  localStorage.clear()
})

async function trackedBench(options?: Parameters<typeof bench>[0]): Promise<Bench> {
  const value = await bench(options)
  benches.push(value.runtime)
  return value
}

describe('Run Receipt companion Client', () => {
  it('self-mounts its generated Remote and exposes opening then ready-empty for the current Session', async () => {
    const b = await trackedBench()
    expect(b.remote.mounted).toHaveLength(1)
    expect(b.remote.mounted[0]).toMatchObject({ package: 'dsh-legion-receipts' })
    expect(b.view.container.querySelector('[data-receipt-state="opening"]')).not.toBeNull()

    const stream = await b.script.nextOpen('session-a')
    await show(stream, baseline('session-a', 0), b.runtime)
    expect(b.view.container.querySelector('[data-receipt-state="ready-empty"]')).not.toBeNull()
    expect(b.view.view.getByText('No Cohort Run exists in this live Session.')).toBeTruthy()
  })

  it('recreates the Client plugin generation and recovers the same active Host baseline', async () => {
    const b = await trackedBench()
    const first = await b.script.nextOpen('session-a')
    const active = receipt('session-a', 1, 1)
    await show(first, baseline('session-a', 3, [active]), b.runtime)
    expect(b.view.container.textContent).toContain(active.runId)

    await b.receiptFeature.dispose()
    await b.runtime.flush()
    expect(b.remote.disposedMounts).toBe(1)
    expect(b.view.container.querySelector('aside')).toBeNull()
    await b.runtime.mount({ inject: [...inject], apply: apply as (ctx: Context) => unknown })
    const reopened = await b.script.nextOpen('session-a')
    await show(reopened, baseline('session-a', 3, [active]), b.runtime)
    expect(b.view.container.textContent).toContain(active.runId)
    expect(b.remote.mounted).toHaveLength(2)
  })

  it('fences delayed frames across A-to-B-to-A navigation and clears before each new address', async () => {
    const b = await trackedBench()
    const firstA = await b.script.nextOpen('session-a')
    await show(firstA, baseline('session-a', 1, [receipt('session-a', 1, 1)]), b.runtime)
    expect(b.view.container.textContent).toContain(runId(1))

    let releaseFirstA!: () => void
    firstA.holdClose(new Promise(resolve => { releaseFirstA = resolve }))
    await b.runtime.sessions.setCurrent('session-b')
    expect(b.view.container.querySelector('[data-receipt-state="opening"]')).not.toBeNull()
    void firstA.push(replacement('session-a', 2, [receipt('session-a', 2, 1)]))
    await b.runtime.sessions.setCurrent('session-a')
    expect(b.view.container.textContent).not.toContain(runId(2))

    releaseFirstA()
    const reopenedA = await b.script.nextOpen('session-a')
    await show(reopenedA, baseline('session-a', 0), b.runtime)
    expect(b.view.container.querySelector('[data-receipt-state="ready-empty"]')).not.toBeNull()
    expect(b.view.container.textContent).not.toContain(runId(1))
  })

  it('preserves the last same-Session facts while reconnecting and resets revision on the next baseline', async () => {
    const b = await trackedBench()
    const first = await b.script.nextOpen('session-a')
    await show(first, baseline('session-a', 8, [receipt('session-a', 1, 1)]), b.runtime)
    expect(b.view.container.querySelector('[data-receipt-state="active"]')).not.toBeNull()
    first.fail(new RemoteStreamCarrierError('carrier lost'))
    const second = await b.script.nextOpen('session-a')
    await b.runtime.flush()
    expect(b.view.container.querySelector('[data-receipt-state="reconnecting"]')).not.toBeNull()
    expect(b.view.container.textContent).toContain(runId(1))

    await show(second, baseline('session-a', 0), b.runtime)
    expect(b.view.container.querySelector('[data-receipt-state="new-instance-empty"]')).not.toBeNull()
  })

  it('rejects lower and equal same-generation revisions without replacing the last valid facts', async () => {
    for (const revision of [5, 4]) {
      const b = await trackedBench()
      const stream = await b.script.nextOpen('session-a')
      await show(stream, baseline('session-a', 5, [receipt('session-a', 1, 1)]), b.runtime)
      await show(stream, replacement('session-a', revision, [receipt('session-a', 2, 1)]), b.runtime)
      expect(b.view.container.querySelector('[data-receipt-state="invalid-frame"]')).not.toBeNull()
      expect(b.view.container.textContent).toContain(runId(1))
      expect(b.view.container.textContent).not.toContain(runId(2))
      await b.runtime.dispose()
      benches.splice(benches.indexOf(b.runtime), 1)
    }
  })

  it('renders header, stages, stage-grouped members, elapsed/source disclosure, and honest partial subtotals', async () => {
    const b = await trackedBench()
    const stream = await b.script.nextOpen('session-a')
    await show(stream, baseline('session-a', 1, [partialReceipt('session-a')]), b.runtime)
    expect(b.view.container.querySelector('[data-receipt-state="partial"]')).not.toBeNull()

    const text = b.view.container.textContent ?? ''
    for (const visible of ['strategy', 'cohort', 'running', 'Stages', 'Participants', 'executor', '1 ms', 'Unavailable', 'Known subtotal', 'Partial coverage', 'Participants: Complete coverage', 'Elapsed: Partial coverage', 'Unavailable: 1', 'Truncated: 0']) {
      expect(text, visible).toContain(visible)
    }
    expect(text).not.toContain('Total: 3')
    const disclosure = b.view.view.getAllByText('Token and source details')[0]!.closest('details')!
    expect(disclosure).not.toBeNull()
    disclosure.open = true
    expect(disclosure.textContent).toContain('session-fold')
    expect(disclosure.textContent).toContain('subagent-timing')
  })

  it('selects concurrent runs deterministically, retains a valid selection, dismisses by Session+run, and reopens from the launcher', async () => {
    const b = await trackedBench()
    const stream = await b.script.nextOpen('session-a')
    const older = receipt('session-a', 1, 1)
    const newer = receipt('session-a', 2, 1)
    const terminal = settle(receipt('session-a', 3, 1), 'completed')
    await show(stream, baseline('session-a', 1, [older, newer, terminal]), b.runtime)

    const selector = b.view.view.getByRole('combobox', { name: 'Choose Run Receipt' }) as HTMLSelectElement
    expect(selector.value).toBe(newer.runId)
    selector.value = terminal.runId
    selector.dispatchEvent(new Event('change', { bubbles: true }))
    await b.runtime.flush()
    await show(stream, replacement('session-a', 2, [older, receipt('session-a', 4, 1), terminal]), b.runtime)
    expect((b.view.view.getByRole('combobox', { name: 'Choose Run Receipt' }) as HTMLSelectElement).value).toBe(terminal.runId)

    const retained = b.view.view.getByRole('combobox', { name: 'Choose Run Receipt' }) as HTMLSelectElement
    retained.value = older.runId
    retained.dispatchEvent(new Event('change', { bubbles: true }))
    await b.runtime.flush()
    expect(retained.value).toBe(older.runId)
    expect(JSON.parse(localStorage.getItem('dsh-legion-receipts.presentation.v1') ?? '{}'))
      .toMatchObject({ selected: { sessionId: 'session-a', runId: older.runId } })

    await show(stream, replacement('session-a', 3, [older, receipt('session-a', 4, 1), terminal]), b.runtime)
    expect((b.view.view.getByRole('combobox', { name: 'Choose Run Receipt' }) as HTMLSelectElement).value).toBe(older.runId)

    b.view.view.getByRole('button', { name: 'Dismiss Run Receipt' }).click()
    await b.runtime.flush()
    expect((b.view.view.getByRole('combobox', { name: 'Choose Run Receipt' }) as HTMLSelectElement).value).toBe(runId(4))
    const activeLauncher = b.view.view.getByRole('button', { name: 'Open Run Receipts' })
    activeLauncher.click()
    await b.runtime.flush()
    expect(document.activeElement).toBe(b.view.view.getByRole('heading', { name: 'Run Receipt' }))
    b.view.view.getByRole('button', { name: 'Dismiss Run Receipt' }).click()
    await b.runtime.flush()
    expect((b.view.view.getByRole('combobox', { name: 'Choose Run Receipt' }) as HTMLSelectElement).value).toBe(terminal.runId)
    b.view.view.getByRole('button', { name: 'Dismiss Run Receipt' }).click()
    await b.runtime.flush()
    expect(b.view.container.querySelector('aside')).toBeNull()

    const launcher = b.view.view.getByRole('button', { name: 'Open Run Receipts' })
    expect(document.activeElement).toBe(launcher)
    launcher.click()
    await b.runtime.flush()
    expect(document.activeElement).toBe(b.view.view.getByRole('heading', { name: 'Run Receipt' }))
  })

  it('renders every empty/error/terminal state and keeps facts only for reconnect or terminal update errors', async () => {
    const b = await trackedBench()
    const stream = await b.script.nextOpen('session-a')
    const active = receipt('session-a', 1, 1)
    const previousTerminal = settle(receipt('session-a', 2, 1), 'completed')
    await show(stream, baseline('session-a', 1, [active, previousTerminal]), b.runtime)
    await show(stream, replacement('session-a', 2, [active]), b.runtime)
    expect(b.view.container.querySelector('[data-receipt-state="active"]')).not.toBeNull()
    expect(b.view.container.textContent).toContain('The latest delegation was direct')
    expect(b.view.container.textContent).toContain(active.runId)
    const updatedActive = { ...active, timing: { ...active.timing, elapsedMs: active.timing.elapsedMs + 1 } }
    await show(stream, replacement('session-a', 3, [updatedActive]), b.runtime)
    expect(b.view.container.textContent).toContain('The latest delegation was direct')

    await show(stream, replacement('session-a', 4, [settle(updatedActive, 'completed')]), b.runtime)
    expect(b.view.container.querySelector('[data-receipt-state="settled"]')).not.toBeNull()
    expect(b.view.container.querySelector('[aria-live="polite"]')?.textContent).toContain('completed')

    await show(stream, replacement('session-a', 5), b.runtime)
    expect(b.view.container.querySelector('[data-receipt-state="direct-clear-empty"]')).not.toBeNull()

    const unavailableBench = await trackedBench()
    const unavailable = await unavailableBench.script.nextOpen('session-a')
    await show(unavailable, { type: 'unavailable', code: 'session-not-live' }, unavailableBench.runtime)
    expect(unavailableBench.view.container.querySelector('[data-receipt-state="feed-unavailable"]')).not.toBeNull()
    expect(unavailableBench.view.container.textContent).not.toContain(runId(1))

    const failedBench = await trackedBench()
    const failed = await failedBench.script.nextOpen('session-a')
    await show(failed, baseline('session-a', 1, [active]), failedBench.runtime)
    failed.fail(new Error('terminal stream failure'))
    await failedBench.runtime.flush()
    expect(failedBench.view.container.querySelector('[data-receipt-state="stream-error"]')).not.toBeNull()
    expect(failedBench.view.container.textContent).toContain(active.runId)
  })

  it('degrades incompatible or missing Remote namespaces without blocking the Settings bundle or shell', async () => {
    for (const options of [{ incompatible: true }, { missingNamespace: true }]) {
      const b = await trackedBench(options)
      expect(b.view.container.querySelector('[data-receipt-state="feed-unavailable"]')).not.toBeNull()
      expect(b.view.container.textContent).toContain('Run Receipt feed is unavailable')
      expect(b.runtime.slots.entries('settings.plugin.item').some(entry => entry.options.key === 'legion')).toBe(true)
      b.conversation.view.getByRole('button', { name: 'Conversation control' }).click()
      expect(document.body.dataset.conversationClicked).toBe('yes')
      await b.runtime.dispose()
      benches.splice(benches.indexOf(b.runtime), 1)
    }
  })

  it('keeps business facts out of localStorage and coexists with another overlay control', async () => {
    const b = await trackedBench({ otherOverlay: true })
    const stream = await b.script.nextOpen('session-a')
    await show(stream, baseline('session-a', 1, [receipt('session-a', 1, 1)]), b.runtime)
    b.view.view.getByRole('button', { name: 'Other control' }).click()
    b.conversation.view.getByRole('button', { name: 'Conversation control' }).click()
    expect(document.body.dataset.otherClicked).toBe('yes')
    expect(document.body.dataset.conversationClicked).toBe('yes')
    b.view.view.getByRole('button', { name: 'Dock Run Receipt' }).click()
    const persisted = Array.from({ length: localStorage.length }, (_, index) =>
      localStorage.getItem(localStorage.key(index) ?? '') ?? '').join('\n')
    expect(Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)))
      .toEqual(['dsh-legion-receipts.presentation.v1'])
    expect(persisted).not.toContain('strategy')
    expect(persisted).not.toContain('executor')
    expect(persisted).not.toContain('planDigest')
    expect(b.view.container.querySelector('.dsh-legion-receipts')).toBeNull()
  })

  it('uses keyboard-sized controls, bounded live regions, desktop drag, and a non-dragging narrow/touch dock', async () => {
    const desktop = await trackedBench()
    const desktopStream = await desktop.script.nextOpen('session-a')
    await show(desktopStream, baseline('session-a', 1, [receipt('session-a', 1, 1)]), desktop.runtime)
    const desktopPanel = desktop.view.container.querySelector('aside') as HTMLElement
    const drag = desktopPanel.querySelector('[data-draggable="true"]') as HTMLElement
    expect(desktopPanel.getAttribute('data-layout')).toBe('docked')
    expect(drag).not.toBeNull()
    let captured = false
    Object.defineProperties(drag, {
      setPointerCapture: { value: () => { captured = true } },
      hasPointerCapture: { value: () => captured },
      releasePointerCapture: { value: () => { captured = false } },
    })
    vi.spyOn(desktopPanel, 'getBoundingClientRect').mockReturnValue({
      x: 40, y: 50, left: 40, top: 50, right: 460, bottom: 350, width: 420, height: 300, toJSON() {},
    })
    vi.spyOn(desktopPanel.parentElement!, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 700, width: 900, height: 700, toJSON() {},
    })
    const pointer = (type: string, clientX: number, clientY: number): Event => {
      const event = new Event(type, { bubbles: true })
      Object.defineProperties(event, {
        clientX: { value: clientX }, clientY: { value: clientY }, pointerId: { value: 1 },
      })
      return event
    }
    drag.dispatchEvent(pointer('pointerdown', 100, 100))
    drag.dispatchEvent(pointer('pointermove', 180, 140))
    await desktop.runtime.flush()
    expect(desktop.view.container.querySelector('aside')?.getAttribute('data-layout')).toBe('floating')
    expect(JSON.parse(localStorage.getItem('dsh-legion-receipts.presentation.v1') ?? '{}'))
      .toMatchObject({ docked: false, x: 120, y: 90 })
    await desktop.runtime.dispose()
    benches.splice(benches.indexOf(desktop.runtime), 1)

    for (const constraint of ['narrow', 'touch'] as const) {
      vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
        matches: constraint === 'narrow' ? query.includes('max-width') : query.includes('pointer: coarse'),
        media: query,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent: () => true,
      })))
      const b = await trackedBench()
      const stream = await b.script.nextOpen('session-a')
      await show(stream, baseline('session-a', 1, [receipt('session-a', 1, 1)]), b.runtime)
      const panel = b.view.container.querySelector('aside')!
      expect(panel.getAttribute('data-layout'), constraint).toBe('bottom-dock')
      expect(panel.querySelector('[data-draggable="true"]'), constraint).toBeNull()
      for (const action of panel.querySelectorAll('button, select')) {
        expect(action.className).toContain('dsh-legion-receipt__action')
      }
      const live = [...b.view.container.querySelectorAll('[aria-live]')]
      expect(live).toHaveLength(1)
      expect(live[0]?.textContent).toBe('')
      await b.runtime.dispose()
      benches.splice(benches.indexOf(b.runtime), 1)
      vi.unstubAllGlobals()
    }
  })
})
