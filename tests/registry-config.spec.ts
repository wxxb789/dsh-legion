import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveNpmRegistry } from '../scripts/registry-config.mjs'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('npm registry configuration', () => {
  it('reads the last project registry entry and normalizes its trailing slash', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-legion-registry-'))
    await writeFile(join(root, '.npmrc'), [
      'registry=https://first.invalid/',
      '# the nearest active value wins',
      'registry=https://mirror.example.test/npm/',
      '',
    ].join('\n'))

    expect(resolveNpmRegistry(root, null)).toBe('https://mirror.example.test/npm')
  })

  it('uses an explicit registry without reading project config', () => {
    expect(resolveNpmRegistry('missing-root', 'https://override.example.test/'))
      .toBe('https://override.example.test')
  })

  it('rejects absent and non-HTTP registry values', async () => {
    const emptyRoot = await mkdtemp(join(tmpdir(), 'dsh-legion-registry-'))
    root = emptyRoot
    expect(() => resolveNpmRegistry(emptyRoot, '')).toThrow(/not configured/)
    expect(() => resolveNpmRegistry(emptyRoot, 'file:///registry')).toThrow(/http or https/)
  })
})
