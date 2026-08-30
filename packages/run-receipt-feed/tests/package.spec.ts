import { access, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const PACKAGE_ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const WORKSPACE_ROOT = resolve(PACKAGE_ROOT, '../..')
const DSH_RANGE = '>=0.1.2-alpha.1 <0.2.0'

interface ExportTarget {
  readonly types: string
  readonly default: string
}

interface PackageManifest {
  readonly name: string
  readonly version: string
  readonly main: string
  readonly types: string
  readonly exports: Record<string, ExportTarget | string>
  readonly files: string[]
  readonly scripts: Record<string, string>
  readonly dependencies: Record<string, string>
  readonly peerDependencies: Record<string, string>
  readonly devDependencies: Record<string, string>
  readonly dsh: {
    readonly client: {
      readonly external: string[]
      readonly inject: string[]
      readonly platform: string
    }
  }
}

async function manifest(): Promise<PackageManifest> {
  return JSON.parse(await readFile(resolve(PACKAGE_ROOT, 'package.json'), 'utf8')) as PackageManifest
}

function exportTarget(value: ExportTarget | string | undefined): ExportTarget {
  if (value === undefined || typeof value === 'string') throw new Error('expected conditional export target')
  return value
}

async function bundle(): Promise<string> {
  try {
    return await readFile(resolve(PACKAGE_ROOT, 'lib/client.js'), 'utf8')
  } catch {
    throw new Error('companion lib/client.js is missing — run `pnpm run build` before this suite')
  }
}

interface StyleTag {
  readonly dataset: Record<string, string>
  textContent: string
}

async function materialize(): Promise<{
  readonly id: string
  readonly exports: Record<string, unknown>
  readonly required: string[]
  readonly styles: StyleTag[]
}> {
  const required: string[] = []
  const styles: StyleTag[] = []
  let handoff: {
    readonly id: string
    readonly factory: (require: (specifier: string) => unknown) => unknown
  } | undefined
  const document = {
    head: { appendChild(tag: StyleTag) { styles.push(tag) } },
    querySelector: (selector: string) => styles.find(tag => selector.includes(tag.dataset.pluginCss ?? '\u0000')) ?? null,
    createElement: (): StyleTag => ({ dataset: {}, textContent: '' }),
    getElementById: () => null,
  }
  runInNewContext(await bundle(), {
    window: { __ModuleLoader__: { load(value: typeof handoff) { handoff = value } } },
    document,
    console,
  }, { filename: 'packages/run-receipt-feed/lib/client.js' })
  if (handoff === undefined) throw new Error('companion bundle did not register through __ModuleLoader__.load')
  const table: Record<string, unknown> = {
    '@deepseek-ai/dsh-api-gateway/client': {
      RemoteSnapshotStream: class RemoteSnapshotStream {},
      RemoteStreamCarrierError: class RemoteStreamCarrierError extends Error {},
    },
    '@deepseek-ai/dsh-client-store': { createSnapshotStore() {}, defineStore() {} },
    react: { createElement() {}, Fragment: Symbol('Fragment'), memo: (component: unknown) => component, useEffect() {}, useRef() {} },
    '@deepseek-ai/dsh-client-ui-primitives': { Button() {}, Pill() {}, StateDot() {} },
  }
  const exports = handoff.factory((specifier) => {
    required.push(specifier)
    const value = table[specifier]
    if (value === undefined) throw new Error(`unexpected companion module-table request: ${specifier}`)
    return value
  }) as Record<string, unknown>
  return { id: handoff.id, exports, required, styles }
}

describe('dsh-legion-receipts package contract', () => {
  it('publishes exact Host, types, Client, Typert, Remote, and manifest faces', async () => {
    const value = await manifest()
    expect(value.name).toBe('dsh-legion-receipts')
    expect(value.version).toBe('1.2.0')
    expect(value.main).toBe('./lib/index.js')
    expect(value.types).toBe('./lib/types/index.d.ts')
    expect(value.exports).toEqual({
      '.': { types: './lib/types/index.d.ts', default: './lib/index.js' },
      './types': { types: './lib/types/types.d.ts', default: './lib/types.js' },
      './client': { types: './lib/types/client/index.d.ts', default: './lib/client.js' },
      './typert': { types: './lib/typert.host.d.ts', default: './lib/typert.host.js' },
      './remote': { types: './lib/typert.remote-client.d.ts', default: './lib/typert.remote-client.js' },
      './package.json': './package.json',
    })
    expect(value.files).toEqual([
      'lib/index.js',
      'lib/types.js',
      'lib/client.js',
      'lib/types/**/*.d.ts',
      'lib/typert.host.js',
      'lib/typert.host.d.ts',
      'lib/typert.remote-client.js',
      'lib/typert.remote-client.d.ts',
    ])
  })

  it('declares the Web loader edges and every directly consumed official package', async () => {
    const value = await manifest()
    expect(value.dsh.client).toEqual({
      external: ['@deepseek-ai/dsh-api-gateway/client'],
      inject: [
        '@deepseek-ai/dsh-api-gateway',
        '@deepseek-ai/dsh-api-remotes',
        '@deepseek-ai/dsh-api-session-controller',
        '@deepseek-ai/dsh-client-locale',
        '@deepseek-ai/dsh-client-ui-layout',
        '@deepseek-ai/dsh-client-ui-renderer',
        '@deepseek-ai/dsh-client-ui-session',
      ],
      platform: 'web',
    })
    expect(value.dependencies).toEqual({ zod: '^4.4.3' })
    expect(value.peerDependencies).not.toHaveProperty('dsh-legion')
    expect(value.devDependencies).not.toHaveProperty('dsh-legion')
    for (const dependency of [
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-api-gateway',
      '@deepseek-ai/dsh-api-remotes',
      '@deepseek-ai/dsh-api-session-controller',
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-store',
      '@deepseek-ai/dsh-client-ui-layout',
      '@deepseek-ai/dsh-client-ui-primitives',
      '@deepseek-ai/dsh-client-ui-renderer',
      '@deepseek-ai/dsh-client-ui-session',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-llm',
      '@deepseek-ai/dsh-session',
      '@deepseek-ai/dsh-typert-protocol',
    ]) {
      expect(value.peerDependencies[dependency], dependency).toBe(
        dependency === '@deepseek-ai/cordis' ? '^4.0.1' : DSH_RANGE,
      )
      expect(value.devDependencies[dependency], dependency).toBe(
        dependency === '@deepseek-ai/cordis' ? '^4.0.1' : '0.1.2-alpha.1',
      )
    }
    expect(value.peerDependencies.react).toBe('^18.2.0')
    expect(value.devDependencies.jsdom).toBe('29.1.1')
    expect(value.devDependencies.react).toBe('^18.2.0')
    for (const dependency of [
      '@deepseek-ai/dsh-client-connection',
      '@deepseek-ai/dsh-client-test-runtime',
      '@deepseek-ai/dsh-host-webserver',
      '@deepseek-ai/dsh-typert-registry',
    ]) expect(value.devDependencies[dependency], dependency).toBe('0.1.2-alpha.1')
    expect(value.devDependencies['@deepseek-ai/dsh-typert-generator']).toBe('0.1.2-alpha.1')
    expect(value.devDependencies['@types/react']).toBe('~18.3.1')
    expect(value.devDependencies.tsdown).toBe('^0.22.2')
    expect(value.devDependencies.typescript).toBe('^6.0.3')
    expect(value.devDependencies.vitest).toBe('^4.1.8')
  })

  it('keeps Host and Client compilation faces separate and generates between them', async () => {
    const [solution, host, client] = await Promise.all([
      readFile(resolve(PACKAGE_ROOT, 'tsconfig.json'), 'utf8'),
      readFile(resolve(PACKAGE_ROOT, 'tsconfig.host-face.json'), 'utf8'),
      readFile(resolve(PACKAGE_ROOT, 'tsconfig.client.json'), 'utf8'),
    ])
    expect(JSON.parse(solution)).toMatchObject({
      files: [],
      references: [{ path: './tsconfig.host-face.json' }, { path: './tsconfig.client.json' }],
    })
    expect(JSON.parse(host).files).toEqual(['src/index.ts', 'src/feed.ts', 'src/types.ts'])
    expect(JSON.parse(client).files).toEqual([
      'src/client/index.ts',
      'src/client/model.ts',
      'src/client/RunReceiptOverlay.ts',
      'src/client/locales.ts',
      'src/client/styles.ts',
      'src/types.ts',
    ])

    const value = await manifest()
    expect(value.scripts.build).toBe('pnpm run build:package')
    expect(value.scripts['build:package'])
      .toBe('pnpm run clean:package && pnpm run build:host:package && pnpm run build:client:package')
    expect(value.scripts['build:host:package']).toMatch(/^tsc -b tsconfig\.host-face\.json && /)
    expect(value.scripts['build:client:package']).toMatch(/^tsc -b tsconfig\.client\.json && /)
    expect(value.scripts.test).toBe('pnpm run build:package && pnpm run test:unit:package')
    expect(value.scripts['test:unit:package'])
      .toBe('vitest run --root ../.. --config vitest.config.ts packages/run-receipt-feed/tests --maxWorkers=1')
  })

  it('uses package-mode Typert generation instead of handwritten descriptors', async () => {
    const config = await readFile(resolve(PACKAGE_ROOT, 'tsdown.config.ts'), 'utf8')
    expect(config).toContain("from '@deepseek-ai/dsh-typert-generator/tsdown'")
    expect(config).toMatch(/typertPlugin\(\{\s*mode:\s*'package',\s*faces:\s*\['host'\]\s*\}\)/)
    expect(config).not.toMatch(/\.typert-package|cpSync|writeBundle/)
    for (const path of [
      'lib/typert.host.js',
      'lib/typert.host.d.ts',
      'lib/typert.remote-client.js',
      'lib/typert.remote-client.d.ts',
      'lib/typert.remote-client.d.ts.map',
    ]) await access(resolve(PACKAGE_ROOT, path))

    const [hostArtifact, remoteArtifact] = await Promise.all([
      readFile(resolve(PACKAGE_ROOT, 'lib/typert.host.js'), 'utf8'),
      readFile(resolve(PACKAGE_ROOT, 'lib/typert.remote-client.js'), 'utf8'),
    ])
    expect(hostArtifact).toMatch(/^\/\* Generated by @deepseek-ai\/dsh-typert-generator/)
    expect(remoteArtifact).toMatch(/^\/\* Generated by @deepseek-ai\/dsh-typert-generator/)
    expect(remoteArtifact).toContain("package: 'dsh-legion-receipts'")
    expect(remoteArtifact).toContain("service: 'legionReceipts'")
    expect(remoteArtifact).toContain("namespace: 'legionReceipts'")
    expect(remoteArtifact).toContain("method: 'follow'")
    expect(remoteArtifact).toContain("mode: 'stream'")
    const { TYPERT } = await import(pathToFileURL(resolve(PACKAGE_ROOT, 'lib/typert.host.js')).href) as {
      readonly TYPERT: {
        readonly invocations: readonly [{
          readonly parameters: readonly { readonly name: string; readonly wire: string; readonly source: string }[]
        }]
      }
    }
    expect(TYPERT.invocations[0].parameters).toMatchObject([
      { name: 'sessionId', wire: 'sessionId', source: 'json' },
    ])
  })

  it('exposes one Session-scoped abortable empty baseline through the public Host face', async () => {
    const value = await manifest()
    const host = await import(pathToFileURL(resolve(PACKAGE_ROOT, exportTarget(value.exports['.']).default)).href)
    const { Context } = await import('@deepseek-ai/cordis')
    const { default: SessionStore, SessionId } = await import('@deepseek-ai/dsh-session')
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('package-contract'))
    const service = new host.RunReceiptFeed(ctx) as {
      follow(sessionId: string, signal: AbortSignal): AsyncIterable<{ type: string; value: unknown }>
    }
    const abort = new AbortController()
    const iterator = service.follow(String(session.id), abort.signal)[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {
        type: 'baseline',
        value: {
          schemaVersion: 1,
          sessionId: 'package-contract',
          revision: 0,
          feed: { status: 'available' },
          receipts: [],
        },
      },
    })
    abort.abort()
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
    await ctx.fiber.dispose()
  })

  it('registers under its own loader identity, declares exact externals, and inlines self Remote plus Zod', async () => {
    const value = await manifest()
    const client = await materialize()
    expect(client.id).toBe(value.name)
    expect(client.required).toEqual([
      '@deepseek-ai/dsh-api-gateway/client',
      '@deepseek-ai/dsh-client-store',
      'react',
      '@deepseek-ai/dsh-client-ui-primitives',
    ])
    expect(client.exports.inject).toEqual(['remote'])
    expect(client.styles).toHaveLength(1)
    expect(client.styles[0]?.dataset).toMatchObject({
      plugin: 'dsh-legion-receipts',
      pluginCss: 'dsh-legion-receipts/run-receipt.css',
    })
    expect(client.styles[0]?.textContent).toContain('.dsh-legion-receipt')
    expect(client.styles[0]?.textContent).toContain('@media (max-width: 639px), (pointer: coarse)')

    const source = await bundle()
    expect(source).toContain('dsh-legion-receipts')
    expect(source).not.toContain('require("dsh-legion-receipts/remote")')
    expect(source).not.toContain("require('dsh-legion-receipts/remote')")
    expect(source).not.toContain('require("zod")')
    expect(source).not.toContain("require('zod')")
  })
})

describe('workspace Client bundle helper', () => {
  it('is the only lazy-CJS wrapper and is called by root plus companion configs', async () => {
    const helperPath = resolve(WORKSPACE_ROOT, 'build/client-bundle.ts')
    const paths = [
      helperPath,
      resolve(WORKSPACE_ROOT, 'tsdown.client.config.ts'),
      resolve(PACKAGE_ROOT, 'tsdown.client.config.ts'),
    ]
    const [helper, rootConfig, companionConfig] = await Promise.all(paths.map(path => readFile(path, 'utf8')))
    expect(helper).toContain('window.__ModuleLoader__.load')
    expect(rootConfig).toContain("from './build/client-bundle.ts'")
    expect(companionConfig).toContain("from '../../build/client-bundle.ts'")
    expect(rootConfig).toContain('clientBundle(')
    expect(companionConfig).toContain('clientBundle(')
    expect([helper, rootConfig, companionConfig].join('\n').match(/window\.__ModuleLoader__\.load/g)).toHaveLength(1)
  })
})
