export type SourceInstallOriginal = readonly [path: string, source: string]
export interface SourceInstallIo {
  readFileSync(path: string, encoding: 'utf8'): string
  writeFileSync(path: string, source: string): void
}
export declare function restoreProjectFiles(
  originals: readonly SourceInstallOriginal[],
  installError?: unknown,
  io?: SourceInstallIo,
): void
