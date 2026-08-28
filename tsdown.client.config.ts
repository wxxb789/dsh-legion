import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { defineConfig } from 'tsdown'

/**
 * Legion's browser half.
 *
 * DSH's client module loader fetches a plugin bundle outside any module graph
 * and evaluates it as a lazy CJS factory: the artifact hands
 * `window.__ModuleLoader__.load` an id and a factory, and every platform
 * specifier is answered by an injected `require` reading the Host's frozen
 * module table. That shape is a wire format, so this config reproduces it
 * exactly rather than approximating it.
 *
 * DSH's own preset for this lives at `packages/client/tsdown.client.ts` and is
 * not published. The wrapper strings below remain an unavoidable wire-format
 * mirror, while bare imports are discovered rather than copied from DSH's
 * platform-module roster. `tests/client-bundle.spec.ts` executes the artifact
 * against the Host seam so either kind of drift fails locally.
 */

interface PackageManifest { readonly name?: unknown }

const manifest = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as PackageManifest
if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
  throw new Error('client bundle package.json must declare a non-empty name')
}

/** Package identity comes from the same manifest the Host module registry reads. */
const ID = manifest.name

/**
 * Keep every bare runtime import as a loader request and bundle only local files.
 * The artifact test supplies the Host platform table and therefore fails on any
 * newly requested package the Host does not expose. This avoids copying the
 * upstream platform-module roster into Legion, where it could drift silently.
 */
function isClientExternal(id: string): boolean {
  return !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0') && !isAbsolute(id)
}

const MODE = process.env.NODE_ENV ?? 'production'

/** The lazy-CJS factory wrapper the loader evaluates. */
export const CLIENT_BANNER = `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`
export const CLIENT_INTRO = 'var module = { exports: {} }; var exports = module.exports;'
export const CLIENT_FOOTER = 'return module.exports; } });'

export default defineConfig({
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  // Lands beside the node half; clean must stay off or it wipes that output.
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  fixedExtension: false,
  // Types ship from the node half; a dts pass here would wrap the banner into
  // the declaration and break parsing.
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: isClientExternal,
    // Counter tsdown's dependency defaults: relative/absolute local modules must
    // inline, while every bare import remains visible to the loader-protocol test.
    alwaysBundle: (id: string) => !isClientExternal(id),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(MODE),
    'import.meta.env.MODE': JSON.stringify(MODE),
    'import.meta.env': JSON.stringify({ MODE }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: CLIENT_BANNER,
    intro: CLIENT_INTRO,
    footer: CLIENT_FOOTER,
  },
})
