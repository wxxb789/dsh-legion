import { createHash } from 'node:crypto'
import { lstat, open, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep, win32, posix } from 'node:path'
import type { CompiledConfig } from './config.ts'
import { materializeCompiledConfig } from './config.ts'
import { SpecialistName, ResourceDigest, type SpecialistName as SpecialistNameType, type ResourceDigest as ResourceDigestType } from './identity.ts'

export type ResourceErrorCode =
  | 'RESOURCE_ROOT_MISSING'
  | 'RESOURCE_ROOT_NOT_DIRECTORY'
  | 'RESOURCE_ROOT_DUPLICATE'
  | 'RESOURCE_ROOT_OUTSIDE_BASE'
  | 'RESOURCE_ROOT_LINK_UNSUPPORTED'
  | 'PROFILE_RESOURCE_PATH_INVALID'
  | 'PROFILE_RESOURCE_MISSING'
  | 'PROFILE_RESOURCE_OUTSIDE_ROOT'
  | 'PROFILE_RESOURCE_LINK_UNSUPPORTED'
  | 'PROFILE_RESOURCE_NOT_FILE'
  | 'PROFILE_RESOURCE_TOO_LARGE'
  | 'PROFILE_RESOURCE_CHANGED_DURING_READ'
  | 'PROFILE_RESOURCE_INVALID_UTF8'
  | 'PROFILE_RESOURCE_NUL'
  | 'PROFILE_RESOURCE_PROFILE_BUDGET_EXCEEDED'
  | 'PROFILE_RESOURCE_READ_FAILED'

export class SpecialistResourceError extends Error {
  readonly code: ResourceErrorCode
  readonly profile: SpecialistNameType | undefined
  readonly reference: string | undefined

  constructor(
    code: ResourceErrorCode,
    message: string,
    options: { profile?: SpecialistNameType; reference?: string; cause?: unknown } = {},
  ) {
    super(`dsh-legion: ${message}`, { cause: options.cause })
    this.name = 'ProfileResourceError'
    this.code = code
    this.profile = options.profile
    this.reference = options.reference
  }
}

/** @deprecated Use SpecialistResourceError. */
export const ProfileResourceError = SpecialistResourceError
/** @deprecated Use SpecialistResourceError. */
export type ProfileResourceError = SpecialistResourceError

export interface LoadedPromptFragment {
  readonly reference: string
  /** Raw source bytes, including an optional UTF-8 BOM. */
  readonly bytes: number
  readonly utf8Bom: boolean
  /** Digest of the exact UTF-8 content injected after optional BOM removal. */
  readonly digest: ResourceDigestType
  readonly content: string
}

/** Published V1 snapshot shape retained at the resource boundary. */
export interface ResourceSnapshot {
  readonly profiles: Readonly<Record<string, readonly LoadedPromptFragment[]>>
  readonly digest: ResourceDigestType
}

export interface ResourceLoadOptions {
  readonly baseDirectory: string
}

/** Create one detached resource snapshot and derive its envelope digest. */
export function createResourceSnapshot(
  input: Readonly<Record<string, readonly LoadedPromptFragment[]>>,
): ResourceSnapshot {
  const profiles = Object.freeze(Object.fromEntries(Object.keys(input).sort().map(name => [
    name,
    Object.freeze(input[name]!.map((fragment) => {
      const encoded = new TextEncoder().encode(fragment.content)
      if (typeof fragment.utf8Bom !== 'boolean'
        || fragment.bytes !== encoded.byteLength + (fragment.utf8Bom ? 3 : 0)
        || promptContentDigest(fragment.content) !== fragment.digest
        || fragment.content.includes('\0')) {
        throw new Error(`dsh-legion: invalid prompt fragment snapshot for profile "${name}"`)
      }
      return Object.freeze({ ...fragment })
    })),
  ])))
  return Object.freeze({ profiles, digest: snapshotDigest(profiles) })
}

export const EMPTY_RESOURCE_SNAPSHOT: ResourceSnapshot = createResourceSnapshot({})

function sha256(bytes: Uint8Array): ResourceDigestType {
  return ResourceDigest(`sha256:${createHash('sha256').update(bytes).digest('hex')}`)
}

export function promptContentDigest(content: string): ResourceDigestType {
  return sha256(new TextEncoder().encode(content))
}

function snapshotDigest(specialists: Readonly<Record<string, readonly LoadedPromptFragment[]>>): ResourceDigestType {
  const identity = {
    version: 1,
    kind: 'legion-profile-resources',
    profiles: Object.fromEntries(Object.keys(specialists).sort().map(name => [
      name,
      specialists[name]!.map(fragment => ({
        reference: fragment.reference,
        bytes: fragment.bytes,
        utf8Bom: fragment.utf8Bom,
        digest: fragment.digest,
      })),
    ])),
  }
  return ResourceDigest(`sha256:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`)
}

function contained(root: string, child: string): boolean {
  const path = relative(root, child)
  return path === '' || !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`)
}

function referenceSegments(path: string, profile: SpecialistNameType, reference: string): string[] {
  if (path.length === 0
    || path.includes('\0')
    || path.includes('\\')
    || isAbsolute(path)
    || posix.isAbsolute(path)
    || win32.isAbsolute(path)) {
    throw new SpecialistResourceError(
      'PROFILE_RESOURCE_PATH_INVALID',
      `profile "${profile}" prompt file "${reference}" must use a slash-separated relative path`,
      { profile, reference },
    )
  }
  const segments = path.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new SpecialistResourceError(
      'PROFILE_RESOURCE_PATH_INVALID',
      `profile "${profile}" prompt file "${reference}" contains an invalid path segment`,
      { profile, reference },
    )
  }
  return segments
}

async function canonicalRoots(
  config: CompiledConfig,
  baseDirectory: string,
  requiredRoots: ReadonlySet<string>,
): Promise<Record<string, string>> {
  const roots: Record<string, string> = {}
  const seen = new Map<string, string>()
  const canonicalBase = await realpath(baseDirectory).catch((error: unknown) => {
    throw new SpecialistResourceError(
      'RESOURCE_ROOT_MISSING',
      'profile resource base directory does not exist',
      { cause: error },
    )
  })
  for (const name of [...requiredRoots].sort()) {
    const authored = config.resourceRoots[name]!
    let current = canonicalBase
    try {
      for (const segment of authored.split('/')) {
        current = resolve(current, segment)
        if ((await lstat(current)).isSymbolicLink()) {
          throw new SpecialistResourceError(
            'RESOURCE_ROOT_LINK_UNSUPPORTED',
            `resource root "${name}" crosses a symbolic link or junction`,
            { reference: name },
          )
        }
      }
    } catch (error: unknown) {
      if (error instanceof SpecialistResourceError) throw error
      throw new SpecialistResourceError(
        'RESOURCE_ROOT_MISSING',
        `resource root "${name}" does not exist`,
        { reference: name, cause: error },
      )
    }
    const canonical = await realpath(current)
    if (!contained(canonicalBase, canonical)) {
      throw new SpecialistResourceError(
        'RESOURCE_ROOT_OUTSIDE_BASE',
        `resource root "${name}" resolves outside the profile base`,
        { reference: name },
      )
    }
    if (!(await stat(canonical)).isDirectory()) {
      throw new SpecialistResourceError(
        'RESOURCE_ROOT_NOT_DIRECTORY',
        `resource root "${name}" is not a directory`,
        { reference: name },
      )
    }
    const duplicate = seen.get(canonical)
    if (duplicate !== undefined) {
      throw new SpecialistResourceError(
        'RESOURCE_ROOT_DUPLICATE',
        `resource roots "${duplicate}" and "${name}" resolve to the same directory`,
        { reference: name },
      )
    }
    seen.set(canonical, name)
    roots[name] = canonical
  }
  return roots
}

async function assertNoLinkedSegments(
  root: string,
  segments: readonly string[],
  profile: SpecialistNameType,
  reference: string,
): Promise<string> {
  let current = root
  for (const segment of segments) {
    current = resolve(current, segment)
    let info
    try {
      info = await lstat(current)
    } catch (error: unknown) {
      throw new SpecialistResourceError(
        'PROFILE_RESOURCE_MISSING',
        `profile "${profile}" prompt file "${reference}" does not exist`,
        { profile, reference, cause: error },
      )
    }
    if (info.isSymbolicLink()) {
      throw new SpecialistResourceError(
        'PROFILE_RESOURCE_LINK_UNSUPPORTED',
        `profile "${profile}" prompt file "${reference}" crosses a symbolic link or junction`,
        { profile, reference },
      )
    }
  }
  const physical = await realpath(current)
  if (!contained(root, physical)) {
    throw new SpecialistResourceError(
      'PROFILE_RESOURCE_OUTSIDE_ROOT',
      `profile "${profile}" prompt file "${reference}" resolves outside its configured root`,
      { profile, reference },
    )
  }
  return physical
}

function decodeUtf8(
  bytes: Uint8Array,
  profile: SpecialistNameType,
  reference: string,
): { content: string; utf8Bom: boolean } {
  if (bytes.length >= 2
    && (bytes[0] === 0xff && bytes[1] === 0xfe || bytes[0] === 0xfe && bytes[1] === 0xff)) {
    throw new SpecialistResourceError(
      'PROFILE_RESOURCE_INVALID_UTF8',
      `profile "${profile}" prompt file "${reference}" uses an unsupported UTF-16 BOM`,
      { profile, reference },
    )
  }
  const utf8Bom = bytes.length >= 3
    && bytes[0] === 0xef
    && bytes[1] === 0xbb
    && bytes[2] === 0xbf
  const body = utf8Bom ? bytes.subarray(3) : bytes
  let content: string
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(body)
  } catch (error: unknown) {
    throw new SpecialistResourceError(
      'PROFILE_RESOURCE_INVALID_UTF8',
      `profile "${profile}" prompt file "${reference}" is not valid UTF-8`,
      { profile, reference, cause: error },
    )
  }
  if (content.includes('\0')) {
    throw new SpecialistResourceError(
      'PROFILE_RESOURCE_NUL',
      `profile "${profile}" prompt file "${reference}" contains NUL`,
      { profile, reference },
    )
  }
  return { content, utf8Bom }
}

async function loadFragment(
  root: string,
  path: string,
  maxBytes: number,
  profile: SpecialistNameType,
  rootName: string,
): Promise<LoadedPromptFragment> {
  const reference = `${rootName}:${path}`
  const segments = referenceSegments(path, profile, reference)
  const physical = await assertNoLinkedSegments(root, segments, profile, reference)
  const handle = await open(physical, 'r').catch((error: unknown) => {
    throw new SpecialistResourceError(
      'PROFILE_RESOURCE_READ_FAILED',
      `failed to open profile "${profile}" prompt file "${reference}"`,
      { profile, reference, cause: error },
    )
  })
  try {
    const before = await handle.stat()
    const canonicalAfterOpen = await realpath(physical)
    const pathBefore = await stat(physical)
    if (!contained(root, canonicalAfterOpen)
      || pathBefore.dev !== before.dev
      || pathBefore.ino !== before.ino) {
      throw new SpecialistResourceError(
        'PROFILE_RESOURCE_CHANGED_DURING_READ',
        `profile "${profile}" prompt file "${reference}" changed before reading`,
        { profile, reference },
      )
    }
    if (!before.isFile()) {
      throw new SpecialistResourceError(
        'PROFILE_RESOURCE_NOT_FILE',
        `profile "${profile}" prompt file "${reference}" is not a regular file`,
        { profile, reference },
      )
    }
    if (before.size > maxBytes) {
      throw new SpecialistResourceError(
        'PROFILE_RESOURCE_TOO_LARGE',
        `profile "${profile}" prompt file "${reference}" exceeds ${String(maxBytes)} bytes`,
        { profile, reference },
      )
    }
    const buffer = await handle.readFile()
    const after = await handle.stat()
    const canonicalAfterRead = await realpath(physical)
    const pathAfter = await stat(physical)
    if (buffer.byteLength > maxBytes) {
      throw new SpecialistResourceError(
        'PROFILE_RESOURCE_TOO_LARGE',
        `profile "${profile}" prompt file "${reference}" exceeded ${String(maxBytes)} bytes while reading`,
        { profile, reference },
      )
    }
    if (!contained(root, canonicalAfterRead)
      || pathAfter.dev !== after.dev
      || pathAfter.ino !== after.ino
      || before.dev !== after.dev
      || before.ino !== after.ino
      || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs
      || buffer.byteLength !== after.size) {
      throw new SpecialistResourceError(
        'PROFILE_RESOURCE_CHANGED_DURING_READ',
        `profile "${profile}" prompt file "${reference}" changed while reading`,
        { profile, reference },
      )
    }
    const decoded = decodeUtf8(buffer, profile, reference)
    return {
      reference,
      bytes: buffer.byteLength,
      utf8Bom: decoded.utf8Bom,
      digest: promptContentDigest(decoded.content),
      content: decoded.content,
    }
  } catch (error: unknown) {
    if (error instanceof SpecialistResourceError) throw error
    throw new SpecialistResourceError(
      'PROFILE_RESOURCE_READ_FAILED',
      `failed to read profile "${profile}" prompt file "${reference}"`,
      { profile, reference, cause: error },
    )
  } finally {
    await handle.close()
  }
}

/** Verify that one detached resource snapshot exactly satisfies authored references. */
export function assertResourceSnapshot(
  config: CompiledConfig,
  snapshot: ResourceSnapshot,
): void {
  ResourceDigest(snapshot.digest)
  const knownProfiles = new Set(Object.keys(config.specialists))
  for (const name of Object.keys(snapshot.profiles)) {
    if (!knownProfiles.has(name)) {
      throw new Error(`dsh-legion: resource snapshot contains unknown profile "${name}"`)
    }
  }
  for (const name of Object.keys(config.specialists)) {
    const expected = (config.specialists[name]!.promptFiles ?? [])
      .map(reference => `${reference.root}:${reference.path}`)
    const fragments = snapshot.profiles[name] ?? []
    let bytes = 0
    for (const fragment of fragments) {
      ResourceDigest(fragment.digest)
      const encoded = new TextEncoder().encode(fragment.content)
      const expectedBytes = encoded.byteLength + (fragment.utf8Bom ? 3 : 0)
      if (typeof fragment.utf8Bom !== 'boolean'
        || !Number.isSafeInteger(fragment.bytes)
        || fragment.bytes !== expectedBytes
        || fragment.content.includes('\0')) {
        throw new Error(`dsh-legion: resource snapshot has invalid content metadata for profile "${name}"`)
      }
      if (promptContentDigest(fragment.content) !== fragment.digest) {
        throw new Error(`dsh-legion: resource snapshot content digest mismatch for profile "${name}"`)
      }
      bytes += fragment.bytes
    }
    if (bytes > config.maxResourceBytes) {
      throw new Error(`dsh-legion: resource snapshot exceeds profile "${name}" byte budget`)
    }
    const actual = fragments.map(fragment => fragment.reference)
    if (expected.length !== actual.length
      || expected.some((reference, index) => reference !== actual[index])) {
      throw new Error(`dsh-legion: resource snapshot does not satisfy profile "${name}" references`)
    }
  }
  if (snapshotDigest(snapshot.profiles) !== snapshot.digest) {
    throw new Error('dsh-legion: resource snapshot digest does not match its fragment identities')
  }
}

/** Load immutable prompt-fragment snapshots before entering the pure catalog compiler. */
export async function loadSpecialistResources(
  input: unknown,
  options: ResourceLoadOptions,
): Promise<ResourceSnapshot> {
  const config = materializeCompiledConfig(input)
  const hasReferences = Object.values(config.specialists).some(profile => (profile.promptFiles?.length ?? 0) > 0)
  if (!hasReferences) return EMPTY_RESOURCE_SNAPSHOT
  const requiredRoots = new Set(
    Object.values(config.specialists).flatMap(profile => (profile.promptFiles ?? []).map(reference => reference.root)),
  )
  const roots = await canonicalRoots(config, resolve(options.baseDirectory), requiredRoots)
  const specialists: Record<string, readonly LoadedPromptFragment[]> = {}
  for (const name of Object.keys(config.specialists).sort()) {
    const profile = SpecialistName(name)
    const loaded: LoadedPromptFragment[] = []
    let bytes = 0
    for (const reference of config.specialists[name]!.promptFiles ?? []) {
      const root = roots[reference.root]
      if (root === undefined) {
        throw new SpecialistResourceError(
          'RESOURCE_ROOT_MISSING',
          `profile "${profile}" references unavailable root "${reference.root}"`,
          { profile, reference: reference.root },
        )
      }
      const fragment = await loadFragment(
        root,
        reference.path,
        config.maxResourceBytes,
        profile,
        reference.root,
      )
      bytes += fragment.bytes
      if (bytes > config.maxResourceBytes) {
        throw new SpecialistResourceError(
          'PROFILE_RESOURCE_PROFILE_BUDGET_EXCEEDED',
          `profile "${profile}" prompt fragments exceed ${String(config.maxResourceBytes)} bytes`,
          { profile, reference: fragment.reference },
        )
      }
      loaded.push(fragment)
    }
    if (loaded.length > 0) specialists[name] = loaded
  }
  return createResourceSnapshot(specialists)
}

/** @deprecated Use loadSpecialistResources. */
export const loadProfileResources = loadSpecialistResources

/** Render Specialist fragments as one deterministic child system-instruction append. */
export function renderPromptFragments(fragments: readonly LoadedPromptFragment[]): string {
  return fragments.map(fragment => [
    `## Legion profile instruction: ${fragment.reference}`,
    fragment.content,
  ].join('\n')).join('\n\n')
}
