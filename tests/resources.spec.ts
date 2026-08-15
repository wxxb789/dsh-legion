import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { materializeConfig, type Config } from '../src/config.ts'
import {
  ProfileResourceError,
  assertResourceSnapshot,
  createResourceSnapshot,
  loadProfileResources,
  promptContentDigest,
  renderPromptFragments,
} from '../src/resources.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function project(): { root: string; resources: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-legion-resources-'))
  roots.push(root)
  const resources = join(root, 'resources')
  mkdirSync(join(resources, 'prompts'), { recursive: true })
  return { root, resources }
}

function config(paths: string[], maxResourceBytes = 65536): Config {
  return {
    toolName: 'legion',
    enableRunInBackground: true,
    resourceRoots: { local: 'resources' },
    maxResourceBytes,
    defaultProfile: 'quick',
    profiles: {
      quick: {
        description: 'Fast work.',
        subagentProvider: 'spawn',
        maxDepth: 2,
        defaultRunInBackground: true,
        promptFiles: paths.map(path => ({ root: 'local', path })),
      },
    },
  }
}

async function expectResourceError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise
    throw new Error(`expected ${code}`)
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ProfileResourceError)
    expect((error as ProfileResourceError).code).toBe(code)
  }
}

describe('profile prompt resource loader', () => {
  it('loads deterministic, detached UTF-8 fragments and changes digest with content', async () => {
    const { root, resources } = project()
    const file = join(resources, 'prompts', 'quick.md')
    writeFileSync(file, Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('Use concise evidence.\n')]))

    const first = await loadProfileResources(config(['prompts/quick.md']), { baseDirectory: root })
    expect(first.profiles.quick).toEqual([expect.objectContaining({
      reference: 'local:prompts/quick.md',
      content: 'Use concise evidence.\n',
      bytes: 25,
      digest: expect.stringMatching(/^sha256:/),
    })])
    expect(renderPromptFragments(first.profiles.quick!)).toContain('## Legion profile instruction: local:prompts/quick.md')

    writeFileSync(file, 'Use detailed evidence.\n')
    const second = await loadProfileResources(config(['prompts/quick.md']), { baseDirectory: root })
    expect(second.digest).not.toBe(first.digest)
    expect(second.profiles.quick?.[0]?.content).toBe('Use detailed evidence.\n')
  })

  it('does not probe configured roots that no profile references', async () => {
    const { root, resources } = project()
    writeFileSync(join(resources, 'prompts', 'quick.md'), 'Use evidence.')
    const authored = {
      ...config(['prompts/quick.md']),
      resourceRoots: { local: 'resources', unused: 'missing-directory' },
    }
    const snapshot = await loadProfileResources(authored, { baseDirectory: root })
    expect(snapshot.profiles.quick?.[0]?.content).toBe('Use evidence.')
  })

  it('binds fragment content to its digest and deep-freezes the published generation', () => {
    const input = [{
      reference: 'local:quick.md',
      bytes: 8,
      utf8Bom: false,
      digest: promptContentDigest('original'),
      content: 'original',
    }]
    const snapshot = createResourceSnapshot({ quick: input })
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.profiles)).toBe(true)
    expect(Object.isFrozen(snapshot.profiles.quick)).toBe(true)
    expect(Object.isFrozen(snapshot.profiles.quick?.[0])).toBe(true)
    input[0]!.content = 'mutated'
    expect(snapshot.profiles.quick?.[0]?.content).toBe('original')
    expect(() => {
      ;(snapshot.profiles.quick![0] as { content: string }).content = 'changed'
    }).toThrow(TypeError)

    expect(() => createResourceSnapshot({
      quick: [{
        reference: 'local:quick.md',
        bytes: 8,
        utf8Bom: false,
        digest: promptContentDigest('original'),
        content: 'tampered',
      }],
    })).toThrow(/invalid prompt fragment snapshot/)

    const forged = {
      profiles: {
        quick: [{
          ...snapshot.profiles.quick![0]!,
          content: 'replaced',
        }],
      },
      digest: snapshot.digest,
    }
    expect(() => assertResourceSnapshot(
      materializeConfig(config(['quick.md'])),
      forged,
    )).toThrow(/content metadata|content digest/)
  })

  it.each([
    '../secret.md',
    './quick.md',
    'prompts//quick.md',
    '/etc/passwd',
    'C:\\secret.md',
  ])('rejects non-canonical reference %s', async (path) => {
    const { root } = project()
    await expect(loadProfileResources(config([path]), { baseDirectory: root }))
      .rejects.toThrow(/slash-separated relative path/)
  })

  it('rejects missing, non-file, oversized, invalid UTF-8, and NUL resources', async () => {
    const { root, resources } = project()
    await expectResourceError(
      loadProfileResources(config(['prompts/missing.md']), { baseDirectory: root }),
      'PROFILE_RESOURCE_MISSING',
    )

    mkdirSync(join(resources, 'prompts', 'directory'))
    await expectResourceError(
      loadProfileResources(config(['prompts/directory']), { baseDirectory: root }),
      'PROFILE_RESOURCE_NOT_FILE',
    )

    writeFileSync(join(resources, 'prompts', 'large.md'), '1234567')
    await expectResourceError(
      loadProfileResources(config(['prompts/large.md'], 6), { baseDirectory: root }),
      'PROFILE_RESOURCE_TOO_LARGE',
    )

    writeFileSync(join(resources, 'prompts', 'invalid.md'), Buffer.from([0xc3, 0x28]))
    await expectResourceError(
      loadProfileResources(config(['prompts/invalid.md']), { baseDirectory: root }),
      'PROFILE_RESOURCE_INVALID_UTF8',
    )

    writeFileSync(join(resources, 'prompts', 'nul.md'), Buffer.from([0x61, 0x00, 0x62]))
    await expectResourceError(
      loadProfileResources(config(['prompts/nul.md']), { baseDirectory: root }),
      'PROFILE_RESOURCE_NUL',
    )
  })

  it('rejects aggregate profile budget overflow', async () => {
    const { root, resources } = project()
    writeFileSync(join(resources, 'prompts', 'a.md'), '1234')
    writeFileSync(join(resources, 'prompts', 'b.md'), '5678')
    await expectResourceError(
      loadProfileResources(config(['prompts/a.md', 'prompts/b.md'], 6), { baseDirectory: root }),
      'PROFILE_RESOURCE_PROFILE_BUDGET_EXCEEDED',
    )
  })

  it('rejects a resource root that is itself a symlink or junction', async () => {
    const { root } = project()
    const outside = join(root, 'outside-root')
    mkdirSync(outside)
    writeFileSync(join(outside, 'prompt.md'), 'secret')
    symlinkSync(outside, join(root, 'linked-root'), process.platform === 'win32' ? 'junction' : 'dir')
    const linked = { ...config(['prompt.md']), resourceRoots: { local: 'linked-root' } }
    await expectResourceError(
      loadProfileResources(linked, { baseDirectory: root }),
      'RESOURCE_ROOT_LINK_UNSUPPORTED',
    )
  })

  it('rejects symlink or junction traversal even when the target is readable', async () => {
    const { root, resources } = project()
    const outside = join(root, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'secret.md'), 'secret')
    symlinkSync(outside, join(resources, 'link'), process.platform === 'win32' ? 'junction' : 'dir')

    await expectResourceError(
      loadProfileResources(config(['link/secret.md']), { baseDirectory: root }),
      'PROFILE_RESOURCE_LINK_UNSUPPORTED',
    )
  })

  it('rejects root authority expansion, unknown roots, and duplicate references during config materialization', async () => {
    const { root } = project()
    await expect(loadProfileResources({
      ...config([]),
      resourceRoots: { local: '../outside' },
    }, { baseDirectory: root })).rejects.toThrow(/resource root.*relative path/)
    await expect(loadProfileResources({
      ...config([]),
      profiles: {
        quick: {
          ...config([]).profiles.quick!,
          promptFiles: [{ root: 'missing', path: 'prompt.md' }],
        },
      },
    }, { baseDirectory: root })).rejects.toThrow(/unknown root/)
    await expect(loadProfileResources(config(['prompts/a.md', 'prompts/a.md']), { baseDirectory: root }))
      .rejects.toThrow(/repeats prompt file/)
  })
})
