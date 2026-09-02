import { describe, expect, it, vi } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { LegionCard, type LegionCardProps } from '../src/client/LegionCard.ts'
import {
  LegionCardController, type LegionCardSection,
} from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'
import { materializeCurrentConfigWithDiagnostics } from '../src/config.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconChevronDownOutline14: () => null,
}))

function readyScope(section: LegionCardSection, base: LegionCardSection = {}) {
  const stub = stubSettingsScope<LegionCardSection>()
  stub.publish({
    status: 'ready', value: { ...base, ...section }, base: { ...base }, user: { ...section },
    revision: 1, writable: true, mode: 'host',
  })
  return stub
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
    const stub = readyScope({ defaultProfile: 'quick' })
    const accepted = Promise.withResolvers<void>()
    stub.mutate.mockReturnValue(accepted.promise)
    const face = new LegionCardController(stub.scope).inject()

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
    await vi.waitFor(() => expect(stub.mutate).toHaveBeenCalledWith([{
      op: 'unset',
      path: ['defaultProfile'],
    }, {
      op: 'set',
      path: ['defaultSpecialist'],
      value: 'quick',
    }]))
    stub.publish({
      value: { defaultSpecialist: 'quick' }, user: { defaultSpecialist: 'quick' }, revision: 2,
    })
    expect(face.hooks.legionCard.getSnapshot()).toMatchObject({
      dirty: false, saving: true, failed: false,
    })
    accepted.resolve()
    await settle()

    expect(stub.scope.getSnapshot().user).toEqual({ defaultSpecialist: 'quick' })
    expect(face.hooks.legionCard.getSnapshot()).toMatchObject({ dirty: false, failed: false })
  })

  it('keeps a staged draft when the Host does not publish acceptance', async () => {
    const stub = stubSettingsScope<LegionCardSection>()
    stub.publish({
      status: 'ready', value: { toolName: 'legion' }, base: {}, user: {},
      revision: 1, writable: true, mode: 'host',
    })
    const face = new LegionCardController(stub.scope).inject()

    face.edit('toolName', 'delegate')
    expect(face.hooks.legionCard.getSnapshot()).toMatchObject({
      dirty: true,
      failed: false,
      toolName: { text: 'delegate' },
    })
    face.save()
    await settle()

    expect(stub.set).toHaveBeenCalledWith('toolName', 'delegate')
    expect(stub.scope.getSnapshot().user).toEqual({})
    expect(face.hooks.legionCard.getSnapshot()).toMatchObject({
      dirty: true,
      failed: true,
      toolName: { text: 'delegate' },
    })
  })

  it('renders current Specialist copy and canonical accessible control ids', () => {
    const state = new LegionCardController(readyScope({ defaultSpecialist: 'quick' }).scope).inject()
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
