import { describe, expect, it } from 'vitest'
import { access, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))

interface PackageManifest {
  main?: string
  types?: string
  files?: string[]
  exports?: Record<string, unknown>
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
    await Promise.all([
      access(resolve(ROOT, manifest.main!)),
      access(resolve(ROOT, manifest.types!)),
      access(resolve(ROOT, 'presets/legion/agent.cordis.yml')),
      access(resolve(ROOT, 'presets/legion/preset.yml')),
      access(resolve(ROOT, 'examples/legion.agent.cordis.fragment.yml')),
    ])
  })
})
