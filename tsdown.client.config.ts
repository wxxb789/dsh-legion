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
 * not published, so the constants below are a hand-maintained mirror. They have
 * no compile-time link to upstream: a change to the module table or the wrapper
 * strings breaks the card at load time, not at build time. `tests/client-bundle.spec.ts`
 * pins every one of them so a local edit cannot drift silently.
 */

/** Must equal the package name: the loader validates the id it is handed. */
const ID = 'dsh-legion'

/**
 * Specifiers the Host's module table answers. Mirrors PLATFORM_MODULES plus the
 * runtime store exemption in `packages/client/tsdown.client.ts`. Anything not
 * listed here MUST inline: a `require` the table cannot answer throws at load.
 */
export const CLIENT_EXTERNALS: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-client-runtime/client',
]

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
  external: [...CLIENT_EXTERNALS],
  // tsdown auto-externalizes package dependencies. Anything not in the module
  // table must inline instead, so the rule is the table list itself.
  noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
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
