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
    // One Host-plane row, and it contributes only the settings namespace and the
    // card bundle: a delegation row here would land in the global tool layer.
    expect(patch).toEqual([
      {
        insert: [
          { id: 'legion-settings', name: 'dsh-legion', config: { role: 'settings', specialists: {} } },
        ],
      },
    ])
  })

  it('ships every runtime, preset, and example surface named by its manifest and README', async () => {
    const manifest = JSON.parse(
      await readFile(resolve(ROOT, 'package.json'), 'utf8'),
    ) as PackageManifest
    expect(manifest.files).toEqual(expect.arrayContaining([
      'lib', 'cordis.patch.yml', 'docs/notes/dsh-0.1.2-alpha.1-upgrade.md',
      'examples', 'presets', 'README.md', 'LICENSE',
    ]))
    expect(manifest.exports).toHaveProperty('.')
    expect(manifest.exports).toMatchObject({
      './contracts/v1.json': './contracts/v1.json',
      './contracts/compatibility.json': './contracts/compatibility.json',
      './contracts/journal-v1.json': './contracts/journal-v1.json',
    })
    expect(manifest.bin).toEqual({ 'dsh-legion': 'lib/bin.js' })
    expect(manifest.dependencies).toHaveProperty('js-yaml')
    const compatibility = JSON.parse(
      await readFile(resolve(ROOT, 'contracts/compatibility.json'), 'utf8'),
    ) as { dshPeerRange: string }
    expect(manifest.peerDependencies?.['@deepseek-ai/dsh-agent'])
      .toBe(compatibility.dshPeerRange)
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
      access(resolve(ROOT, 'benchmarks/protocol-thresholds.json')),
      access(resolve(ROOT, 'scripts/benchmark-protocol.mjs')),
      access(resolve(ROOT, 'scripts/evaluate-quality-campaign.mjs')),
      access(resolve(ROOT, 'scripts/evaluate-exposure-evidence.mjs')),
      access(resolve(ROOT, 'scripts/verify-public-contract.mjs')),
      access(resolve(ROOT, 'scripts/verify-journal-contract.mjs')),
      access(resolve(ROOT, 'scripts/verify-compatibility-receipts.mjs')),
      access(resolve(ROOT, 'scripts/verify-reproducible-pack.mjs')),
      access(resolve(ROOT, 'scripts/verify-supplied-packed-delegation.mjs')),
      access(resolve(ROOT, 'scripts/trusted-temp-root.mjs')),
      access(resolve(ROOT, 'scripts/trusted-temp-root.d.mts')),
      access(resolve(ROOT, 'contracts/v1.json')),
      access(resolve(ROOT, 'contracts/compatibility.json')),
      access(resolve(ROOT, 'contracts/journal-v1.json')),
      access(resolve(ROOT, 'docs/notes/dsh-0.1.2-alpha.1-upgrade.md')),
      access(resolve(ROOT, 'examples/durable-stair-step.config.yml')),
    ])
    expect(await readFile(resolve(ROOT, manifest.bin!['dsh-legion']!), 'utf8'))
      .toMatch(/^#!\/usr\/bin\/env node/)
    const rootExport = await import(pathToFileURL(resolve(ROOT, manifest.main!)).href)
    expect(rootExport).toHaveProperty('compileCatalog')
    expect(rootExport).toHaveProperty('explainCatalog')
  })
})
