import { describe, expect, it } from 'vitest'
import { access, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))

interface PackageManifest {
  main?: string
  types?: string
  files?: string[]
  exports?: Record<string, unknown>
  bin?: Record<string, string>
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  scripts?: Record<string, string>
  dsh?: { bundle?: { patch?: string } }
}

describe('published package contract', () => {
  it('declares a real parseable DSH bundle patch', async () => {
    const manifest = JSON.parse(
      await readFile(resolve(ROOT, 'package.json'), 'utf8'),
    ) as PackageManifest
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const patchPath = resolve(ROOT, manifest.dsh!.bundle!.patch!)
    const patch = load(await readFile(patchPath, 'utf8'), { schema: entryListSchema })
    expect(patch).toEqual([])
  })

  it('ships every runtime, preset, and example surface named by its manifest and README', async () => {
    const manifest = JSON.parse(
      await readFile(resolve(ROOT, 'package.json'), 'utf8'),
    ) as PackageManifest
    expect(manifest.files).toEqual(expect.arrayContaining([
      'lib', 'cordis.patch.yml', 'examples', 'presets', 'README.md', 'LICENSE',
    ]))
    expect(manifest.exports).toHaveProperty('.')
    expect(manifest.bin).toEqual({ 'dsh-legion': './lib/bin.js' })
    expect(manifest.dependencies).toHaveProperty('js-yaml')
    expect(manifest.peerDependencies?.['@deepseek-ai/dsh-agent'])
      .toBe('>=0.1.0-rc.6 <0.2.0')
    expect(manifest.scripts?.['test:packed-delegation'])
      .toBe('node scripts/verify-packed-delegation.mjs')
    await Promise.all([
      access(resolve(ROOT, manifest.main!)),
      access(resolve(ROOT, manifest.types!)),
      access(resolve(ROOT, manifest.bin!['dsh-legion']!)),
      access(resolve(ROOT, 'presets/legion/agent.cordis.yml')),
      access(resolve(ROOT, 'presets/legion/preset.yml')),
      access(resolve(ROOT, 'presets/legion/resources/review.md')),
      access(resolve(ROOT, 'examples/legion.agent.cordis.fragment.yml')),
    ])
    expect(await readFile(resolve(ROOT, manifest.bin!['dsh-legion']!), 'utf8'))
      .toMatch(/^#!\/usr\/bin\/env node/)
    const rootExport = await import(pathToFileURL(resolve(ROOT, manifest.main!)).href)
    expect(rootExport).toHaveProperty('compileCatalog')
    expect(rootExport).toHaveProperty('explainCatalog')
  })
})
