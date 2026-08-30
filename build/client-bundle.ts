import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { UserConfig } from 'tsdown'
import { defineConfig } from 'tsdown'

interface ClientManifest {
  readonly name?: unknown
}

export interface ClientBundleOptions {
  readonly manifest: URL
  readonly entry: string
  readonly outDir?: string
  readonly inline?: readonly string[]
}

export const CLIENT_INTRO = 'var module = { exports: {} }; var exports = module.exports;'
export const CLIENT_FOOTER = 'return module.exports; } });'

/** Loader ABI banner keyed by the package manifest identity. */
export function clientBanner(id: string): string {
  return `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`
}

function packageId(packageJson: URL): string {
  const manifest = JSON.parse(readFileSync(packageJson, 'utf8')) as ClientManifest
  if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
    throw new Error('client bundle package.json must declare a non-empty name')
  }
  return manifest.name
}

function isBareSpecifier(specifier: string): boolean {
  return !specifier.startsWith('.')
    && !specifier.startsWith('/')
    && !specifier.startsWith('\0')
    && !isAbsolute(specifier)
}

/** Build one DSH lazy-CJS Client artifact, inlining only package-owned wire code. */
export function clientBundle(options: ClientBundleOptions): ReturnType<typeof defineConfig> {
  const id = packageId(options.manifest)
  const inline = new Set(options.inline ?? [])
  const shouldInline = (specifier: string): boolean => inline.has(specifier) || !isBareSpecifier(specifier)
  const mode = process.env.NODE_ENV ?? 'production'
  const config: UserConfig = {
    name: `${id}/client`,
    entry: { client: options.entry },
    outDir: options.outDir ?? 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: (specifier: string) => isBareSpecifier(specifier) && !inline.has(specifier),
      alwaysBundle: shouldInline,
    },
    inputOptions: {
      resolve: {
        conditionNames: [
          mode === 'development' ? 'development' : 'production',
          'browser',
          'import',
          'module',
          'default',
        ],
      },
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode),
      'import.meta.env.MODE': JSON.stringify(mode),
      'import.meta.env': JSON.stringify({ MODE: mode }),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      sourcemapExcludeSources: false,
      banner: clientBanner(id),
      intro: CLIENT_INTRO,
      footer: CLIENT_FOOTER,
    },
  }
  return defineConfig(config)
}
