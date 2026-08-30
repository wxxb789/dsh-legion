import { describe, expect, it, vi } from 'vitest'
import type {
  SettingsScope, SettingsScopeSnapshot,
} from '@deepseek-ai/dsh-client-ui-settings/client'
import { LegionCard, type LegionCardProps } from '../src/client/LegionCard.ts'
import {
  LegionCardController, type LegionCardSection,
} from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'
import { materializeCurrentConfigWithDiagnostics } from '../src/config.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconChevronDownOutline14: () => null,
}))

class FakeScope implements SettingsScope<LegionCardSection> {
  private readonly listeners = new Set<() => void>()
  readonly mutations: Array<Parameters<SettingsScope<LegionCardSection>['mutate']>[0]> = []
  private snapshot: SettingsScopeSnapshot<LegionCardSection>

  constructor(section: LegionCardSection, base: LegionCardSection = {}) {
    this.snapshot = {
      status: 'ready',
      value: { ...base, ...section },
      base: { ...base },
      user: { ...section },
      revision: 1,
      writable: true,
      mode: 'host',
    }
  }

  getSnapshot(): SettingsScopeSnapshot<LegionCardSection> {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async mutate(ops: Parameters<SettingsScope<LegionCardSection>['mutate']>[0]): Promise<void> {
    this.mutations.push(ops)
    const user = { ...this.snapshot.user as LegionCardSection } as Record<string, unknown>
    for (const op of ops) {
      const field = op.path[0]
      if (typeof field !== 'string') continue
      if (op.op === 'set') user[field] = op.value
      else if (op.op === 'unset') delete user[field]
    }
    this.snapshot = {
      ...this.snapshot,
      value: { ...this.snapshot.base as LegionCardSection, ...user },
      user,
      revision: (this.snapshot.revision ?? 0) + 1,
    }
    for (const listener of this.listeners) listener()
  }

  set(field: string, value: unknown): Promise<void> {
    return this.mutate([{ op: 'set', path: [field], value: value as never }])
  }

  unset(field: string): Promise<void> {
    return this.mutate([{ op: 'unset', path: [field] }])
  }
}

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

function records(value: unknown): Record<string, unknown>[] {
  if (typeof value !== 'object' || value === null) return []
  const record = value as Record<string, unknown>
  const children = (record.props as { children?: unknown } | undefined)?.children
  return [record, ...Array.isArray(children)
    ? children.flatMap(records)
    : children === undefined ? [] : records(children)]
}

describe('Legion Settings card canonical vocabulary', () => {
  it('loads legacy defaultProfile and saves only canonical defaultSpecialist', async () => {
    const scope = new FakeScope({ defaultProfile: 'quick' })
    const face = new LegionCardController(scope).inject()

    expect(face.hooks.legionCard.getSnapshot().defaultSpecialist).toMatchObject({
      text: 'quick',
      overridden: true,
    })
    expect(materializeCurrentConfigWithDiagnostics({
      profiles: {
        quick: {
          description: 'Quick.', subagentProvider: 'spawn', maxDepth: 1,
          defaultRunInBackground: false,
        },
      },
      defaultProfile: 'quick',
    }).diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'config.defaultProfile',
        replacement: 'config.defaultSpecialist',
        removalVersion: '2.0.0',
      }),
    ]))

    face.edit('defaultSpecialist', 'quick')
    face.save()
    await settle()

    expect(scope.mutations).toEqual([[{
      op: 'unset',
      path: ['defaultProfile'],
    }, {
      op: 'set',
      path: ['defaultSpecialist'],
      value: 'quick',
    }]])
    expect(scope.getSnapshot().user).toEqual({ defaultSpecialist: 'quick' })
  })

  it('renders current Specialist copy and canonical accessible control ids', () => {
    const state = new LegionCardController(new FakeScope({ defaultSpecialist: 'quick' })).inject()
      .hooks.legionCard.getSnapshot()
    const tree = LegionCard({
      t: key => en[key as keyof typeof en],
      useLegionCard: selector => selector({ ...state, open: true }),
      toggle() {},
      edit() {},
      resetField() {},
      save() {},
      discard() {},
    } as LegionCardProps)
    const nodes = records(tree)
    const text = JSON.stringify(tree)
    const control = nodes.find(node => (node.props as { id?: unknown } | undefined)?.id === 'dsh-legion-default-specialist')
    const label = nodes.find(node => (node.props as { htmlFor?: unknown } | undefined)?.htmlFor === 'dsh-legion-default-specialist')

    expect(text).toContain('Default Specialist')
    expect(text).toContain('Specialists, Cohorts, and Strategies')
    expect(text).not.toMatch(/\b(?:profile|profiles|team|teams)\b/i)
    expect(control).toBeDefined()
    expect(label).toBeDefined()
  })
})
