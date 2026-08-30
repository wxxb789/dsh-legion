import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { runNativeCommand } from '../scripts/native-command.mjs'

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const DRIVER = resolve(ROOT, 'tests/fixtures/loader-smoke-driver.mjs')
const CONFIG = resolve(ROOT, 'package.json')
function run(program: string, args: string[], cwd: string): void {
  runNativeCommand(program, args, cwd)
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
        await symlink(resolve(ROOT, 'node_modules/.pnpm'), join(nodeModules, '.pnpm'), 'junction')
        for (const directory of [ROOT, resolve(ROOT, 'packages/run-receipt-feed')]) {
          run('pnpm', [
            '--dir', directory,
            '--config.ignore-scripts=true',
            'pack',
            '--pack-destination', packDir,
          ], ROOT)
        }
        for (const scope of ['@deepseek-ai']) {
          await symlink(resolve(ROOT, 'node_modules', scope), join(nodeModules, scope), 'junction')
        }
        for (const dependency of ['zod', 'react', 'js-yaml']) {
          await symlink(resolve(ROOT, 'node_modules', dependency), join(nodeModules, dependency), 'junction')
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
})
