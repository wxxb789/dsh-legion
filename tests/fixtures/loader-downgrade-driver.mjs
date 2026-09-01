#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { load } from 'js-yaml'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SessionStore from '@deepseek-ai/dsh-session'
import * as SystemPromptModule from '@deepseek-ai/dsh-system-prompt'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'

const cwd = process.cwd()
const driver = fileURLToPath(import.meta.url)

const run = (program, args) => {
  const result = spawnSync(program, args, { cwd, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${program} ${args.join(' ')} failed: ${result.stderr}`)
  }
  return result.stdout
}

const install = async artifacts => {
  const nodeModules = join(cwd, 'node_modules')
  for (const name of ['dsh-legion', 'dsh-legion-receipts']) {
    await rm(join(nodeModules, name), { recursive: true, force: true })
  }
  for (const artifact of artifacts) {
    const target = join(nodeModules, artifact.name)
    await mkdir(target, { recursive: true })
    run('tar', ['-xzf', artifact.tarball, '-C', target, '--strip-components=1'])
  }
}

const inspectInstalledGeneration = async expectedReceipts => {
  const ctx = new Context()
  try {
    ctx.baseUrl = pathToFileURL(cwd).href + '/'
    await ctx.plugin(Loader)
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(SessionStore)

    const rootDirectory = join(cwd, 'node_modules', 'dsh-legion')
    const manifest = JSON.parse(await readFile(join(rootDirectory, 'package.json'), 'utf8'))
    const patch = load(await readFile(join(rootDirectory, manifest.dsh.bundle.patch), 'utf8'))
    if (!Array.isArray(patch)) throw new Error('installed root bundle patch must be an array')
    const rows = patch.flatMap(operation => {
      if (typeof operation !== 'object' || operation === null || !Array.isArray(operation.insert)) {
        throw new Error('installed root bundle patch must contain insert operations')
      }
      return operation.insert
    })
    const ids = []
    for (const row of rows) ids.push(await ctx.loader.create(row))
    await ctx.loader.await()

    const names = ids.map(id => ctx.loader.resolve(id).options.name)
    const companionPackagePresent = existsSync(join(cwd, 'node_modules', 'dsh-legion-receipts'))
    const companionDependencyPresent = manifest.dependencies?.['dsh-legion-receipts'] !== undefined
    const receiptRemotePresent = ctx.get('legionReceipts') !== undefined
    const receiptRowPresent = names.includes('dsh-legion-receipts')
    if (!names.includes('dsh-legion')) throw new Error('installed root settings row did not mount')
    for (const [label, actual] of [
      ['companion package', companionPackagePresent],
      ['companion dependency', companionDependencyPresent],
      ['companion Remote', receiptRemotePresent],
      ['companion Loader row', receiptRowPresent],
    ]) {
      if (actual !== expectedReceipts) {
        throw new Error(`${label} presence was ${String(actual)}, expected ${String(expectedReceipts)}`)
      }
    }
    return {
      rows: names,
      settingsRowRestored: true,
      companionPackagePresent,
      companionDependencyPresent,
      receiptRemotePresent,
      receiptRowPresent,
      // @deepseek-ai/dsh-loader-smoke boots the Host only. With no browser
      // Client/Slot runtime in this seam, the executable downgrade proof stops
      // at absence of the only package that owns the Run Receipt Slot.
      browserSlotRuntime: 'not-covered: official loader-smoke is Host-only',
    }
  } finally {
    await ctx.fiber.dispose()
  }
}

try {
  if (process.argv.includes('--worker')) {
    const expectedReceipts = process.env.DSH_LEGION_EXPECT_RECEIPTS === '1'
    process.stdout.write(JSON.stringify(await inspectInstalledGeneration(expectedReceipts)))
  } else {
    const artifacts = JSON.parse(await readFile(join(cwd, 'downgrade-artifacts.json'), 'utf8'))
    const runWorker = expectedReceipts => {
      const result = spawnSync(process.execPath, [driver, '--worker'], {
        cwd,
        encoding: 'utf8',
        env: {
          ...process.env,
          DSH_LEGION_EXPECT_RECEIPTS: expectedReceipts ? '1' : '0',
        },
      })
      if (result.error !== undefined) throw result.error
      return result
    }
    const readCompatibleWorker = expectedReceipts => {
      const result = runWorker(expectedReceipts)
      if (result.status !== 0) throw new Error(`generation worker failed: ${result.stderr}`)
      return JSON.parse(result.stdout)
    }
    const assertPriorSourceIncompatible = async priorSourcePath => {
      const priorSource = await readFile(priorSourcePath, 'utf8')
      if (!priorSource.includes('FIRST_PARTY_SECTION_ORDER')) {
        throw new Error('prior generation does not contain the expected removed prompt-order import')
      }
      if ('FIRST_PARTY_SECTION_ORDER' in SystemPromptModule) {
        throw new Error('current DSH unexpectedly retains the removed prompt-order export')
      }
      return 'removed-prompt-order-export'
    }

    await install(artifacts.current)
    const current = readCompatibleWorker(true)
    const priorIncompatibility = await assertPriorSourceIncompatible(artifacts.priorSource)
    await install(artifacts.current)
    const reinstalled = readCompatibleWorker(true)
    process.stdout.write(JSON.stringify({ current, priorIncompatibility, reinstalled }))
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
}
