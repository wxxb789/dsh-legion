import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { LEGION_SETTINGS_NAMESPACE } from '../src/settings.ts'
import { CLIENT_BANNER, CLIENT_FOOTER, CLIENT_INTRO } from '../tsdown.client.config.ts'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  name: string
  exports: Record<string, unknown>
  dsh?: { client?: { platform?: unknown; inject?: unknown } }
}

function bundle(): string {
  try {
    return readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  } catch {
    throw new Error('lib/client.js is missing — run `pnpm run build` before this suite')
  }
}

interface StyleTag {
  dataset: Record<string, string>
  textContent: string
}

function materialize(options: { document?: boolean } = {}): {
  id: string
  exports: Record<string, unknown>
  required: string[]
  styles: StyleTag[]
} {
  const required: string[] = []
  const styles: StyleTag[] = []
  let handoff: { id: string; factory: (require: (specifier: string) => unknown) => unknown } | undefined
  const document = {
    head: { appendChild(tag: StyleTag) { styles.push(tag) } },
    querySelector: (selector: string) => styles.find(tag => selector.includes(tag.dataset.pluginCss ?? '\u0000')) ?? null,
    createElement: (): StyleTag => ({ dataset: {}, textContent: '' }),
  }
  runInNewContext(bundle(), {
    window: { __ModuleLoader__: { load(value: typeof handoff) { handoff = value } } },
    ...options.document === false ? {} : { document },
    console,
  }, { filename: 'lib/client.js' })
  if (handoff === undefined) throw new Error('bundle did not register through __ModuleLoader__.load')
  const table: Record<string, unknown> = {
    react: { createElement() {}, useEffect() {}, useState() {} },
    '@deepseek-ai/dsh-client-store': { createSnapshotStore() {}, defineStore() {} },
    '@deepseek-ai/dsh-client-ui-primitives': { IconChevronDownOutline14() {} },
  }
  const exports = handoff.factory((specifier) => {
    required.push(specifier)
    const value = table[specifier]
    if (value === undefined) throw new Error(`require("${specifier}") missed the module table`)
    return value
  }) as Record<string, unknown>
  return { id: handoff.id, exports, required, styles }
}

describe('root Client bundle artifact', () => {
  it('uses the loader handoff and exact package identity', () => {
    const source = bundle()
    expect(source.startsWith('window.__ModuleLoader__.load(')).toBe(true)
    for (const token of [...CLIENT_BANNER.split('\n'), CLIENT_INTRO, CLIENT_FOOTER].flatMap(
      part => part.split(/[{};]/).map(piece => piece.trim()).filter(piece => piece.length > 3),
    )) expect(source.replace(/\s+/g, ' '), token).toContain(token.replace(/\s+/g, ' '))
    expect(materialize().id).toBe(manifest.name)
  })

  it('requests only the frozen Settings-card module-table entries', () => {
    expect(materialize().required).toEqual([
      '@deepseek-ai/dsh-client-store',
      'react',
      '@deepseek-ai/dsh-client-ui-primitives',
    ])
  })

  it('claims one root Settings stylesheet and no Receipt styles', () => {
    const { styles } = materialize()
    expect(styles).toHaveLength(1)
    expect(styles[0]?.dataset).toMatchObject({
      plugin: manifest.name,
      pluginCss: `${manifest.name}/legion-card.css`,
    })
    expect(styles[0]?.textContent).toContain('.dsh-legion-card')
    expect(styles[0]?.textContent).not.toContain('.dsh-legion-receipt')
  })

  it('exports only the Settings Client surface and contains no projection/overlay literals', () => {
    const client = materialize()
    expect(client.exports.LEGION_NAMESPACE).toBe(LEGION_SETTINGS_NAMESPACE)
    expect(client.exports.inject).toEqual(['slots', 'locale', 'settingsScope'])
    expect(client.exports).not.toHaveProperty('RunReceiptOverlay')
    expect(client.exports).not.toHaveProperty('LEGION_RUN_RECEIPT_PROJECTION_KEY')
    const source = bundle()
    expect(source).not.toContain('legion/run-receipts')
    expect(source).not.toContain('shell.overlay')
    expect(source).not.toContain('RunReceiptOverlay')
  })

  it('keeps the exact Web registry platform, Client export, and supplier edge', () => {
    expect(manifest.dsh?.client).toEqual({
      platform: 'web',
      inject: ['@deepseek-ai/dsh-client-ui-settings-plugins'],
    })
    const client = manifest.exports['./client'] as { default?: string } | string | undefined
    expect(typeof client === 'string' ? client : client?.default).toBe('./lib/client.js')
  })

  it('loads without a DOM and carries no unsubstituted environment reads', () => {
    expect(() => materialize({ document: false })).not.toThrow()
    expect(bundle()).not.toMatch(/process\.env|import\.meta/)
  })
})
