import { describe, expect, it } from 'vitest'
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))

interface PackageManifest {
  name?: string
  version?: string
  main?: string
  types?: string
  files?: string[]
  exports?: Record<string, unknown>
  bin?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
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
    // The exact Settings row stays service-free; the companion owns its Host
    // service in a separate Loader row. Neither belongs on the Agent tool plane.
    expect(patch).toEqual([
      {
        insert: [
          { id: 'legion-settings', name: 'dsh-legion', config: { role: 'settings', specialists: {} } },
          { id: 'legion-receipts', name: 'dsh-legion-receipts' },
        ],
      },
    ])
  })

  it('aggregates every workspace package through non-recursive package-local gates', async () => {
    const root = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8')) as PackageManifest
    const companion = JSON.parse(await readFile(
      resolve(ROOT, 'packages/run-receipt-feed/package.json'),
      'utf8',
    )) as PackageManifest
    const localScripts = {
      clean: 'clean:package',
      typecheck: 'typecheck:package',
      build: 'build:package',
      'test:unit': 'test:unit:package',
      'verify:pack': 'verify:pack:package',
    }
    for (const [aggregate, local] of Object.entries(localScripts)) {
      expect(root.scripts?.[aggregate], aggregate)
        .toBe(`node scripts/run-workspace-script.mjs ${local}`)
      expect(root.scripts?.[local], `root ${local}`).toBeTypeOf('string')
      expect(companion.scripts?.[local], `companion ${local}`).toBeTypeOf('string')
      const recursive = new RegExp(`(?:^|&&\\s*)pnpm run ${aggregate.replace(':', '\\:')}(?:\\s|$)`)
      expect(root.scripts?.[local]).not.toMatch(recursive)
      expect(companion.scripts?.[local]).not.toMatch(recursive)
    }
    expect(root.scripts?.['test:unit:package']).toContain('--exclude "packages/**"')
    expect(root.scripts?.prepare).toBe('pnpm run build:package')
    expect(companion.scripts?.prepare).toBe('pnpm run build:package')
    expect(root.files).toContain('scripts/workspace-packages.mjs')
    expect(root.files).toContain('scripts/workspace-packages.d.mts')
    expect(root.files).toContain('scripts/run-workspace-script.mjs')
    const config = await readFile(resolve(ROOT, 'vitest.config.ts'), 'utf8')
    expect(config).toContain("include: ['src/**/*.ts', 'packages/*/src/**/*.ts']")
    expect(config).toContain('process.env.DSH_LEGION_DSH_TEST_SOURCE')
    expect(config).toContain("officialClientSource('dsh-client-ui-renderer', 'ui-renderer', 'client/scoped-slots.tsx')")
  })

  it('makes source DSH installation workspace-manifest driven', async () => {
    const installer = await readFile(resolve(ROOT, 'scripts/install-dsh-tarballs.mjs'), 'utf8')
    expect(installer).toContain('readWorkspacePackages(projectRoot)')
    expect(installer).toContain('for (const group of workspaceDependencyGroups())')
    expect(installer).not.toContain("const packagePath = join(projectRoot, 'package.json')")
  })

  it('loads the source installer before dependencies exist and reaches argument validation', async () => {
    const checkout = await mkdtemp(join(tmpdir(), 'dsh-legion-install-free-'))
    try {
      const scripts = join(checkout, 'scripts')
      await mkdir(scripts)
      for (const name of [
        'install-dsh-tarballs.mjs',
        'native-command.mjs',
        'registry-config.mjs',
        'source-install-restore.mjs',
        'workspace-packages.mjs',
      ]) {
        await copyFile(resolve(ROOT, 'scripts', name), join(scripts, name))
      }
      const result = spawnSync(process.execPath, [join(scripts, 'install-dsh-tarballs.mjs')], {
        cwd: checkout,
        encoding: 'utf8',
        env: { ...process.env, NODE_PATH: '' },
      })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('usage: install-dsh-tarballs.mjs --from <directory>')
      expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND')
    } finally {
      await rm(checkout, { recursive: true, force: true })
    }
  })

  it('parses only the repository workspace list and rejects escaping patterns without dependencies', async () => {
    const checkout = await mkdtemp(join(tmpdir(), 'dsh-legion-workspace-parser-'))
    try {
      await mkdir(join(checkout, 'packages', 'child'), { recursive: true })
      await writeFile(join(checkout, 'package.json'), JSON.stringify({
        name: 'workspace-root',
        version: '1.0.0',
        dependencies: { 'workspace-child': 'workspace:1.0.0' },
      }))
      await writeFile(join(checkout, 'packages', 'child', 'package.json'), JSON.stringify({
        name: 'workspace-child',
        version: '1.0.0',
      }))
      const script = [
        `import { readWorkspacePackages } from ${JSON.stringify(pathToFileURL(resolve(ROOT, 'scripts/workspace-packages.mjs')).href)}`,
        'process.stdout.write(JSON.stringify(readWorkspacePackages(process.cwd()).map(item => item.name)))',
      ].join(';')
      await writeFile(join(checkout, 'pnpm-workspace.yaml'), [
        'packages:',
        "  - '.'",
        "  - 'packages/*'",
        '',
        'allowBuilds:',
        '  esbuild: true',
        '',
      ].join('\n'))
      const valid = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
        cwd: checkout,
        encoding: 'utf8',
        env: { ...process.env, NODE_PATH: '' },
      })
      expect(valid.status).toBe(0)
      expect(JSON.parse(valid.stdout)).toEqual(['workspace-child', 'workspace-root'])

      await writeFile(join(checkout, 'pnpm-workspace.yaml'), "packages:\n  - '../outside-*'\n")
      const escaping = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
        cwd: checkout,
        encoding: 'utf8',
        env: { ...process.env, NODE_PATH: '' },
      })
      expect(escaping.status).not.toBe(0)
      expect(escaping.stderr).toContain('package pattern escapes the workspace')
    } finally {
      await rm(checkout, { recursive: true, force: true })
    }
  })

  it('resolves isolated pnpm packages that are not linked at the workspace root', async () => {
    const checkout = await mkdtemp(join(tmpdir(), 'dsh-legion-isolated-package-'))
    try {
      const installed = join(
        checkout,
        'node_modules',
        '.pnpm',
        'deepseek-ai+dsh-api-gateway@0.1.2-alpha.1',
        'node_modules',
        '@deepseek-ai',
        'dsh-api-gateway',
      )
      await mkdir(installed, { recursive: true })
      await writeFile(join(installed, 'package.json'), JSON.stringify({
        name: '@deepseek-ai/dsh-api-gateway',
        version: '0.1.2-alpha.1',
      }))
      const script = [
        `import { resolveWorkspaceInstalledPackage } from ${JSON.stringify(pathToFileURL(resolve(ROOT, 'scripts/workspace-packages.mjs')).href)}`,
        `process.stdout.write(resolveWorkspaceInstalledPackage(process.cwd(), [], '@deepseek-ai/dsh-api-gateway', '0.1.2-alpha.1'))`,
      ].join(';')
      const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
        cwd: checkout,
        encoding: 'utf8',
        env: { ...process.env, NODE_PATH: '' },
      })
      expect(result.status).toBe(0)
      expect(result.stdout.replaceAll('\\', '/')).toContain('/node_modules/.pnpm/')
    } finally {
      await rm(checkout, { recursive: true, force: true })
    }
  })

  it('ships every runtime, preset, and example surface named by its manifest and README', async () => {
    const manifest = JSON.parse(
      await readFile(resolve(ROOT, 'package.json'), 'utf8'),
    ) as PackageManifest
    expect(manifest.files).toEqual(expect.arrayContaining([
      'lib', 'cordis.patch.yml', 'docs/notes/dsh-0.1.2-alpha.1-upgrade.md',
      'docs/notes/dsh-0.1.2-alpha.3-upgrade.md', 'docs/run-receipts.md',
      'examples', 'presets', 'scripts/registry-config.mjs',
      'README.md', 'LICENSE',
    ]))
    expect(manifest.exports).toHaveProperty('.')
    expect(manifest.exports).toMatchObject({
      './contracts/v1.json': './contracts/v1.json',
      './contracts/compatibility.json': './contracts/compatibility.json',
      './contracts/journal-v1.json': './contracts/journal-v1.json',
    })
    expect(manifest.bin).toEqual({ 'dsh-legion': 'lib/bin.js' })
    const compatibility = JSON.parse(
      await readFile(resolve(ROOT, 'contracts/compatibility.json'), 'utf8'),
    ) as { dshPeerRange: string; latestTestedDshVersion: string }
    expect(manifest.dependencies).toHaveProperty('js-yaml')
    expect(manifest.dependencies?.['@deepseek-ai/schemastery']).toBe('^3.18.2')
    expect(manifest.dependencies?.['dsh-legion-receipts']).toBe('workspace:1.2.0')
    expect(manifest.peerDependencies?.['@deepseek-ai/cordis']).toBe('^4.0.2')
    expect(manifest.devDependencies?.['@deepseek-ai/cordis']).toBe('4.0.2')
    expect(manifest.devDependencies?.['@deepseek-ai/cordis-plugin-include']).toBe('^1.0.7')
    expect(manifest.devDependencies?.['@deepseek-ai/cordis-plugin-loader']).toBe('^1.0.3')
    expect(manifest.dependencies?.['@deepseek-ai/dsh-util-values']).toBe(compatibility.dshPeerRange)
    expect(manifest.devDependencies?.['@deepseek-ai/dsh-typert-registry'])
      .toBe(compatibility.latestTestedDshVersion)
    for (const dependency of [
      '@deepseek-ai/dsh-agent',
      '@deepseek-ai/dsh-client-store',
      '@deepseek-ai/dsh-client-ui-primitives',
    ]) {
      expect(manifest.peerDependencies?.[dependency], dependency)
        .toBe(compatibility.dshPeerRange)
    }
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
      access(resolve(ROOT, 'scripts/registry-config.mjs')),
      access(resolve(ROOT, 'scripts/registry-config.d.mts')),
      access(resolve(ROOT, 'scripts/native-command.mjs')),
      access(resolve(ROOT, 'scripts/native-command.d.mts')),
      access(resolve(ROOT, 'scripts/run-native-command.ps1')),
      access(resolve(ROOT, 'scripts/trusted-temp-root.mjs')),
      access(resolve(ROOT, 'scripts/trusted-temp-root.d.mts')),
      access(resolve(ROOT, 'contracts/v1.json')),
      access(resolve(ROOT, 'contracts/compatibility.json')),
      access(resolve(ROOT, 'contracts/journal-v1.json')),
      access(resolve(ROOT, 'docs/notes/dsh-0.1.2-alpha.1-upgrade.md')),
      access(resolve(ROOT, 'docs/notes/dsh-0.1.2-alpha.3-upgrade.md')),
      access(resolve(ROOT, 'docs/run-receipts.md')),
      access(resolve(ROOT, 'examples/durable-stair-step.config.yml')),
    ])
    expect(await readFile(resolve(ROOT, manifest.bin!['dsh-legion']!), 'utf8'))
      .toMatch(/^#!\/usr\/bin\/env node/)
    const rootExport = await import(pathToFileURL(resolve(ROOT, manifest.main!)).href)
    expect(rootExport).toHaveProperty('compileCatalog')
    expect(rootExport).toHaveProperty('compileSpecialistCatalog')
    expect(rootExport).toHaveProperty('SpecialistSpecSchema')
    expect(rootExport).toHaveProperty('CohortSpecSchema')
    expect(rootExport).toHaveProperty('CohortRunId')
    expect(rootExport).toHaveProperty('materializeCurrentConfigWithDiagnostics')
    expect(rootExport).toHaveProperty('acpSpecialistCatalogLayer')
    expect(rootExport).toHaveProperty('explainCatalog')
    expect(rootExport.LegionProfileSchema).toBe(rootExport.SpecialistSpecSchema)
    expect(rootExport.TeamSpecSchema).toBe(rootExport.CohortSpecSchema)
    expect(rootExport.TEAM_RUN_OUTCOMES).toBe(rootExport.COHORT_RUN_OUTCOMES)
  })
})
