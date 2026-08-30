export interface WorkspacePackage {
  readonly name: string
  readonly version: string
  readonly manifest: Record<string, unknown> & {
    readonly scripts?: Record<string, string>
  }
  readonly manifestPath: string
  readonly directory: string
  readonly relativeDirectory: string
}

export declare function readWorkspacePackages(root: string): WorkspacePackage[]

export declare function resolveWorkspaceInstalledPackage(
  root: string,
  workspacePackages: readonly WorkspacePackage[],
  packageName: string,
  expectedVersion?: string,
): string

export declare function workspaceDependencyGroups(): string[]
