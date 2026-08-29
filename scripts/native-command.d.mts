export interface SpawnResult {
  readonly status: number | null
  readonly error?: Error
}

export interface SpawnOptions {
  readonly cwd: string
  readonly shell: false
  readonly stdio: 'inherit'
  readonly windowsHide: true
}

export type SpawnSync = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => SpawnResult

export interface NativeCommandInternals {
  readonly spawnSync?: SpawnSync
  readonly platform?: NodeJS.Platform
  readonly env?: NodeJS.ProcessEnv
  readonly execPath?: string
  readonly findExecutable?: (program: string) => string | undefined
}

export interface NativeInvocation {
  readonly command: string
  readonly args: readonly string[]
}

export function resolveNativeInvocation(
  program: string,
  args: readonly string[],
  internals?: NativeCommandInternals,
): NativeInvocation

export function runNativeCommand(
  program: string,
  args: readonly string[],
  cwd: string,
  internals?: NativeCommandInternals,
): void
