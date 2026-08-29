import { spawnSync } from 'node:child_process'
import { win32 } from 'node:path'

function findWindowsExecutable(program) {
  const result = spawnSync('where.exe', [program], {
    encoding: 'utf8', shell: false, windowsHide: true,
  })
  if (result.status !== 0) return undefined
  return result.stdout.split(/\r?\n/u).find(path => /\.exe$/iu.test(path.trim()))?.trim()
}

/** Resolve package-manager shims to argv-safe Node entrypoints on Windows. */
export function resolveNativeInvocation(program, args, internals = {}) {
  const platform = internals.platform ?? process.platform
  const environment = internals.env ?? process.env
  const execPath = internals.execPath ?? process.execPath
  if (platform !== 'win32') return { command: program, args: [...args] }

  if (program === 'pnpm') {
    const pnpmExecPath = environment.npm_execpath
    if (pnpmExecPath !== undefined && /[\\/]pnpm(?:\.[cm]?js)?$/i.test(pnpmExecPath)) {
      return { command: environment.npm_node_execpath ?? execPath, args: [pnpmExecPath, ...args] }
    }
    if (pnpmExecPath !== undefined && /\.exe$/i.test(pnpmExecPath)) {
      return { command: pnpmExecPath, args: [...args] }
    }
    const executable = (internals.findExecutable ?? findWindowsExecutable)('pnpm')
    if (executable !== undefined) return { command: executable, args: [...args] }
    throw new Error(
      'shell-free pnpm execution on Windows requires pnpm to launch this script '
      + '(use pnpm run or pnpm exec) or an npm_execpath ending in pnpm.mjs, pnpm.cjs, or .exe',
    )
  }
  if (program === 'npm') {
    const node = environment.npm_node_execpath ?? execPath
    const npmCli = win32.join(win32.dirname(node), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    return { command: node, args: [npmCli, ...args] }
  }
  return { command: program, args: [...args] }
}

/** Run one argv-preserving native command without a shell or command interpreter. */
export function runNativeCommand(program, args, cwd, internals = {}) {
  const spawn = internals.spawnSync ?? spawnSync
  const invocation = resolveNativeInvocation(program, args, internals)
  const result = spawn(invocation.command, invocation.args, {
    cwd,
    shell: false,
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${program} ${args.join(' ')} failed with exit code ${String(result.status)}`)
  }
}
