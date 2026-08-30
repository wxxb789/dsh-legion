import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { runNativeCommand } from './native-command.mjs'
import { readPackedPackageSet } from './package-set.mjs'
import { resolveNpmRegistry } from './registry-config.mjs'
import { trustedTempRoot } from './trusted-temp-root.mjs'
import { readWorkspacePackages } from './workspace-packages.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'))
const dshRegistry = resolveNpmRegistry(projectRoot)
const canonicalTempRoot = trustedTempRoot()
const sandboxRoot = await mkdtemp(join(canonicalTempRoot, 'dsh-legion-packed-profile-'))
const relativeSandbox = relative(canonicalTempRoot, resolve(sandboxRoot))
if (relativeSandbox.startsWith('..') || relativeSandbox === '') {
  throw new Error(`refusing to use unexpected temporary path: ${sandboxRoot}`)
}

const run = (program, args, cwd) => runNativeCommand(program, args, cwd)
const runNode = (args, cwd) => {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`node ${args.join(' ')} failed with exit code ${String(result.status)}`)
}

try {
  const packDir = join(sandboxRoot, 'pack')
  const profileDir = join(sandboxRoot, 'profiles', 'web')
  await mkdir(packDir, { recursive: true })
  await mkdir(profileDir, { recursive: true })

  const workspacePackages = readWorkspacePackages(projectRoot)
  for (const workspacePackage of workspacePackages) {
    run('pnpm', [
      '--dir', workspacePackage.directory,
      '--config.ignore-scripts=true',
      'pack',
      '--pack-destination', packDir,
    ], projectRoot)
  }
  const packageSet = readPackedPackageSet(packDir, workspacePackages)
  const rootArtifact = packageSet.find(item => item.name === manifest.name)
  const companionArtifact = packageSet.find(item => item.name === 'dsh-legion-receipts')
  if (rootArtifact === undefined || companionArtifact === undefined
    || rootArtifact.manifest.dependencies?.[companionArtifact.name] !== companionArtifact.version) {
    throw new Error('profile install requires one exact dsh-legion package pair')
  }

  await writeFile(join(profileDir, 'package.json'), `${JSON.stringify({
    name: 'dsh-legion-packed-profile-test',
    private: true,
  }, null, 2)}\n`)
  if (process.env.DSH_LEGION_OFFLINE === '1') {
    const nodeModules = join(profileDir, 'node_modules')
    await mkdir(nodeModules, { recursive: true })
    await symlink(join(projectRoot, 'node_modules', '.pnpm'), join(nodeModules, '.pnpm'), 'junction')
    await symlink(join(projectRoot, 'node_modules', '@deepseek-ai'), join(nodeModules, '@deepseek-ai'), 'junction')
    for (const dependency of ['js-yaml', 'react', 'zod']) {
      await symlink(join(projectRoot, 'node_modules', dependency), join(nodeModules, dependency), 'junction')
    }
    for (const artifact of [companionArtifact, rootArtifact]) {
      const target = join(nodeModules, artifact.name)
      await mkdir(target, { recursive: true })
      run('tar', ['-xzf', artifact.tarball, '-C', target, '--strip-components=1'], profileDir)
    }
  } else {
    run('pnpm', [
      'add',
      '--config.ignore-scripts=true',
      `--registry=${dshRegistry}`,
      companionArtifact.tarball,
      rootArtifact.tarball,
    ], profileDir)
  }

  const installedRoot = JSON.parse(await readFile(join(profileDir, 'node_modules', manifest.name, 'package.json'), 'utf8'))
  const installedCompanion = JSON.parse(await readFile(join(profileDir, 'node_modules', companionArtifact.name, 'package.json'), 'utf8'))
  if (installedRoot.version !== manifest.version
    || installedCompanion.version !== manifest.version
    || installedRoot.dependencies?.[companionArtifact.name] !== installedCompanion.version) {
    throw new Error('profile installed a mismatched package pair')
  }
  runNode([join(profileDir, 'node_modules', 'dsh-legion', 'lib', 'bin.js'), '--help'], profileDir)

  const configPath = join(profileDir, 'cordis.yml')
  await writeFile(configPath, '[]\n')
  if (process.env.DSH_LEGION_OFFLINE === '1') {
    process.stdout.write('packed profile installed the exact local tarball pair without registry resolution\n')
  } else {
    const driver = join(projectRoot, 'tests', 'fixtures', 'loader-smoke-driver.mjs')
    const smoke = await runLoaderSmoke({
      label: 'dsh-legion packed profile',
      tempDirPrefix: 'dsh-legion-profile-loader-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: join(projectRoot, 'tsconfig.json'),
      mode: 'lib',
      processTimeoutMs: LOADER_SMOKE_TEST_TIMEOUT_MS,
      prepare: async (cwd) => {
        const nodeModules = join(cwd, 'node_modules')
        const installedModules = join(profileDir, 'node_modules')
        await mkdir(nodeModules, { recursive: true })
        for (const dependency of ['.pnpm', '@deepseek-ai', 'js-yaml', 'react', 'zod']) {
          await symlink(join(installedModules, dependency), join(nodeModules, dependency), 'junction')
        }
        for (const dependency of ['dsh-legion', 'dsh-legion-receipts']) {
          await cp(join(installedModules, dependency), join(nodeModules, dependency), { recursive: true })
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
    const report = JSON.parse(smoke.stdout)
    if (report.settingsRow !== 'dsh-legion'
      || report.receiptRow !== 'dsh-legion-receipts'
      || report.receiptAbsentAfterUninstall !== true
      || report.receiptRestoredAfterReinstall !== true) {
      throw new Error(`packed profile Loader report is invalid: ${smoke.stdout}`)
    }
    process.stdout.write('packed profile resolved, removed, and restored both exact Host rows\n')
  }
} finally {
  await rm(sandboxRoot, { recursive: true, force: true })
}
