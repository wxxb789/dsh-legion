export interface NpmCommandResult {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
  readonly error?: Error
}

export interface PublishReleaseOptions {
  readonly tarball: string
  readonly packageSpec: string
  readonly registry: string
  readonly execute?: (args: string[]) => NpmCommandResult
  readonly checkOnly?: boolean
}

export type PublishReleaseResult =
  | { readonly kind: 'identical' | 'absent'; readonly message: string }
  | {
      readonly kind: 'published'
      readonly message: string
      readonly stdout: string
      readonly stderr: string
    }

export function integrityOf(filename: string): string
export function publishRelease(options: PublishReleaseOptions): PublishReleaseResult
