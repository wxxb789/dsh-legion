import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveNativeInvocation, runNativeCommand, type SpawnSync } from '../scripts/native-command.mjs'

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))

function successfulSpawn(calls: Array<{ command: string; args: readonly string[]; options: unknown }>): SpawnSync {
  return (command, args, options) => {
    calls.push({ command, args, options })
    return { status: 0 }
  }
}

describe('native command execution', () => {
  it('passes every argument directly without a command interpreter', () => {
    const calls: Array<{ command: string; args: readonly string[]; options: unknown }> = []
    const hostile = 'https://registry.example.test/&echo INJECTED'

    runNativeCommand('pnpm', ['install', `--registry=${hostile}`], 'C:\\workspace', {
      platform: 'linux',
      spawnSync: successfulSpawn(calls),
    })

    expect(calls).toEqual([{
      command: 'pnpm',
      args: ['install', `--registry=${hostile}`],
      options: {
        cwd: 'C:\\workspace',
        shell: false,
        stdio: 'inherit',
        windowsHide: true,
      },
    }])
  })

  it('bypasses Windows npm and pnpm cmd shims through trusted JavaScript entrypoints', () => {
    const environment = {
      npm_execpath: 'C:\\pnpm\\dist\\pnpm.cjs',
      npm_node_execpath: 'C:\\node\\node.exe',
    }
    const hostile = '--registry=https://registry.example.test/&echo INJECTED'

    expect(resolveNativeInvocation('pnpm', ['install', hostile], {
      platform: 'win32', env: environment, execPath: 'C:\\fallback\\node.exe',
    })).toEqual({
      command: 'C:\\node\\node.exe',
      args: ['C:\\pnpm\\dist\\pnpm.cjs', 'install', hostile],
    })
    expect(resolveNativeInvocation('npm', ['pack', hostile], {
      platform: 'win32', env: environment, execPath: 'C:\\fallback\\node.exe',
    })).toEqual({
      command: 'C:\\node\\node.exe',
      args: ['C:\\node\\node_modules\\npm\\bin\\npm-cli.js', 'pack', hostile],
    })
    expect(resolveNativeInvocation('pnpm', ['install'], {
      platform: 'win32',
      env: { npm_execpath: 'C:\\pnpm\\pnpm.cmd' },
      execPath: 'C:\\node\\node.exe',
      findExecutable: () => 'C:\\pnpm\\pnpm.exe',
    })).toEqual({ command: 'C:\\pnpm\\pnpm.exe', args: ['install'] })
    expect(() => resolveNativeInvocation('pnpm', ['install'], {
      platform: 'win32',
      env: { npm_execpath: 'C:\\pnpm\\pnpm.cmd' },
      execPath: 'C:\\node\\node.exe',
      findExecutable: () => undefined,
    })).toThrow(/pnpm run or pnpm exec/)
  })

  it('fails loudly when the native process cannot start or exits nonzero', () => {
    expect(() => runNativeCommand('pnpm', ['install'], '.', {
      platform: 'linux',
      spawnSync: () => ({ status: null, error: Object.assign(new Error('missing'), { code: 'ENOENT' }) }),
    })).toThrow(/missing/)
    expect(() => runNativeCommand('pnpm', ['install'], '.', {
      platform: 'linux',
      spawnSync: () => ({ status: 7 }),
    })).toThrow(/exit code 7/)
  })

  it('routes every packaging launcher through the shared shell-free boundary', () => {
    for (const name of [
      'install-dsh-tarballs.mjs',
      'publish-release.mjs',
      'verify-packed-delegation.mjs',
      'verify-profile-install.mjs',
      'verify-reproducible-pack.mjs',
    ]) {
      const source = readFileSync(join(ROOT, 'scripts', name), 'utf8')
      expect(source, name).toContain("from './native-command.mjs'")
      expect(source, name).not.toMatch(/ComSpec|cmd\.exe|['"]\/c['"]/)
    }
  })
})
