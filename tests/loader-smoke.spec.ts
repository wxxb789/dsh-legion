import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { runNativeCommand } from '../scripts/native-command.mjs'
import { readWorkspacePackages, resolveWorkspaceInstalledPackage } from '../scripts/workspace-packages.mjs'

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const DRIVER = resolve(ROOT, 'tests/fixtures/loader-smoke-driver.mjs')
const DOWNGRADE_DRIVER = resolve(ROOT, 'tests/fixtures/loader-downgrade-driver.mjs')
const CONFIG = resolve(ROOT, 'package.json')
const IMPLEMENTATION_BASE = '9457beabc9b13ccd0610b97c25cc7d2867b97c81'
const DOWNGRADE_SMOKE_TIMEOUT_MS = 180_000
const WORKSPACE_PACKAGES = readWorkspacePackages(ROOT)
const COMPATIBILITY = JSON.parse(await readFile(resolve(ROOT, 'contracts/compatibility.json'), 'utf8')) as {
  latestTestedDshVersion: string
  registryInstallPackageClosure: string[]
}
const LOADER_DEEPSEEK_PACKAGES = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/cordis-plugin-loader',
  '@deepseek-ai/schemastery',
  ...COMPATIBILITY.registryInstallPackageClosure.map(name => `@deepseek-ai/${name}`),
]
function run(program: string, args: string[], cwd: string): void {
  runNativeCommand(program, args, cwd)
}

async function linkLoaderDependencies(nodeModules: string): Promise<void> {
  await mkdir(join(nodeModules, '@deepseek-ai'), { recursive: true })
  await symlink(resolve(ROOT, 'node_modules/.pnpm'), join(nodeModules, '.pnpm'), 'junction')
  for (const packageName of LOADER_DEEPSEEK_PACKAGES) {
    const source = resolveWorkspaceInstalledPackage(
      ROOT,
      WORKSPACE_PACKAGES,
      packageName,
      packageName.startsWith('@deepseek-ai/dsh-') ? COMPATIBILITY.latestTestedDshVersion : undefined,
    )
    const target = join(nodeModules, packageName)
    await mkdir(dirname(target), { recursive: true })
    await symlink(source, target, 'junction')
  }
  for (const dependency of ['zod', 'react', 'js-yaml']) {
    await symlink(
      resolveWorkspaceInstalledPackage(ROOT, WORKSPACE_PACKAGES, dependency),
      join(nodeModules, dependency),
      'junction',
    )
  }
}

describe('packed package pair through official DSH smoke seams', () => {
  it('mounts, uninstalls, and reinstalls exact Loader rows while replaying keyless model output', async () => {
    const result = await runLoaderSmoke({
      label: 'dsh-legion package pair',
      tempDirPrefix: 'dsh-legion-loader-smoke-',
      binScript: DRIVER,
      libBinScript: DRIVER,
      configPath: CONFIG,
      tsconfigPath: resolve(ROOT, 'tsconfig.json'),
      mode: 'lib',
      prepare: async (cwd) => {
        const packDir = join(cwd, 'pack')
        const nodeModules = join(cwd, 'node_modules')
        await mkdir(packDir, { recursive: true })
        await mkdir(nodeModules, { recursive: true })
        await linkLoaderDependencies(nodeModules)
        for (const directory of [ROOT, resolve(ROOT, 'packages/run-receipt-feed')]) {
          run('pnpm', [
            '--dir', directory,
            '--config.ignore-scripts=true',
            'pack',
            '--pack-destination', packDir,
          ], ROOT)
        }
        for (const name of ['dsh-legion', 'dsh-legion-receipts']) {
          const manifest = JSON.parse(await readFile(resolve(
            ROOT,
            name === 'dsh-legion' ? 'package.json' : 'packages/run-receipt-feed/package.json',
          ), 'utf8')) as { version: string }
          const target = join(nodeModules, name)
          await mkdir(target, { recursive: true })
          run('tar', [
            '-xzf', join(packDir, `${name}-${manifest.version}.tgz`),
            '-C', target,
            '--strip-components=1',
          ], cwd)
        }
        await writeFile(join(cwd, 'replay.override.json'), JSON.stringify([{
          kind: 'chunks',
          chunks: [
            { type: 'block-start', index: 0, blockType: 'text' },
            { type: 'text-delta', index: 0, text: 'official replay ok' },
            { type: 'block-end', index: 0, block: { type: 'text', text: 'official replay ok' } },
            { type: 'usage', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } },
            { type: 'finish', reason: { kind: 'stop' } },
          ],
        }]))
      },
    })
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual({
      replayText: 'official replay ok',
      settingsRow: 'dsh-legion',
      receiptRow: 'dsh-legion-receipts',
      receiptAbsentAfterUninstall: true,
      receiptRestoredAfterReinstall: true,
      customReceiptEventObserved: false,
    })
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('restores the prior root generation and then reinstalls the current exact pair', async () => {
    const result = await runLoaderSmoke({
      label: 'dsh-legion prior-generation downgrade',
      tempDirPrefix: 'dsh-legion-loader-downgrade-',
      binScript: DOWNGRADE_DRIVER,
      libBinScript: DOWNGRADE_DRIVER,
      configPath: CONFIG,
      tsconfigPath: resolve(ROOT, 'tsconfig.json'),
      mode: 'lib',
      processTimeoutMs: LOADER_SMOKE_TEST_TIMEOUT_MS,
      prepare: async (cwd) => {
        const currentPackDir = join(cwd, 'pack', 'current')
        const priorPackDir = join(cwd, 'pack', 'prior')
        const priorSource = join(cwd, 'prior-source')
        const archive = join(cwd, 'prior-source.tar')
        const nodeModules = join(cwd, 'node_modules')
        await mkdir(currentPackDir, { recursive: true })
        await mkdir(priorPackDir, { recursive: true })
        await mkdir(priorSource, { recursive: true })
        await mkdir(nodeModules, { recursive: true })

        for (const directory of [ROOT, resolve(ROOT, 'packages/run-receipt-feed')]) {
          run('pnpm', [
            '--dir', directory,
            '--config.ignore-scripts=true',
            'pack',
            '--pack-destination', currentPackDir,
          ], ROOT)
        }

        run('git', ['archive', '--format=tar', '--output', archive, IMPLEMENTATION_BASE], ROOT)
        run('tar', ['-xf', archive, '-C', priorSource], ROOT)
        // The official Host-only smoke is not a package installer, and this
        // repository does not carry the prior root's complete DSH/vendor
        // dependency closure as local tarballs. Reuse the already hydrated
        // exact assessed dependencies while building the isolated git archive;
        // the generation switches below still install only packed Legion bytes.
        await symlink(
          resolve(ROOT, 'node_modules'),
          join(priorSource, 'node_modules'),
          process.platform === 'win32' ? 'junction' : 'dir',
        )
        run('pnpm', ['--dir', priorSource, 'run', 'build'], ROOT)
        run('pnpm', [
          '--dir', priorSource,
          '--config.ignore-scripts=true',
          'pack',
          '--pack-destination', priorPackDir,
        ], ROOT)

        await linkLoaderDependencies(nodeModules)

        const rootManifest = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8')) as {
          version: string
        }
        const priorManifest = JSON.parse(await readFile(join(priorSource, 'package.json'), 'utf8')) as {
          version: string
        }
        const companionManifest = JSON.parse(await readFile(
          resolve(ROOT, 'packages/run-receipt-feed/package.json'),
          'utf8',
        )) as { version: string }
        await writeFile(join(cwd, 'downgrade-artifacts.json'), JSON.stringify({
          current: [
            { name: 'dsh-legion-receipts', tarball: join(currentPackDir, `dsh-legion-receipts-${companionManifest.version}.tgz`) },
            { name: 'dsh-legion', tarball: join(currentPackDir, `dsh-legion-${rootManifest.version}.tgz`) },
          ],
          prior: [
            { name: 'dsh-legion', tarball: join(priorPackDir, `dsh-legion-${priorManifest.version}.tgz`) },
          ],
        }))
      },
    })
    expect(result.stderr).toBe('')
    const limitation = 'not-covered: official loader-smoke is Host-only'
    expect(JSON.parse(result.stdout)).toEqual({
      current: {
        rows: ['dsh-legion', 'dsh-legion-receipts'],
        settingsRowRestored: true,
        companionPackagePresent: true,
        companionDependencyPresent: true,
        receiptRemotePresent: true,
        receiptRowPresent: true,
        browserSlotRuntime: limitation,
      },
      prior: {
        rows: ['dsh-legion'],
        settingsRowRestored: true,
        companionPackagePresent: false,
        companionDependencyPresent: false,
        receiptRemotePresent: false,
        receiptRowPresent: false,
        browserSlotRuntime: limitation,
      },
      reinstalled: {
        rows: ['dsh-legion', 'dsh-legion-receipts'],
        settingsRowRestored: true,
        companionPackagePresent: true,
        companionDependencyPresent: true,
        receiptRemotePresent: true,
        receiptRowPresent: true,
        browserSlotRuntime: limitation,
      },
    })
  }, DOWNGRADE_SMOKE_TIMEOUT_MS)
})
