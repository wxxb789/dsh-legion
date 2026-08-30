import { describe, expect, it } from 'vitest'
import { restoreProjectFiles, type SourceInstallIo } from '../scripts/source-install-restore.mjs'

const originals = [
  ['package.json', 'package'],
  ['packages/run-receipt-feed/package.json', 'companion-package'],
  ['pnpm-workspace.yaml', 'workspace'],
  ['pnpm-lock.yaml', 'lock'],
] as const

describe('source install restoration', () => {
  it('attempts and verifies every file when one restoration write fails', () => {
    const installError = new Error('install failed')
    const writes: string[] = []
    const io: SourceInstallIo = {
      writeFileSync(path) {
        writes.push(path)
        if (path === 'package.json') throw new Error('package restore failed')
      },
      readFileSync(path) {
        return originals.find(([candidate]) => candidate === path)?.[1] ?? ''
      },
    }

    let failure: unknown
    try { restoreProjectFiles(originals, installError, io) } catch (error) { failure = error }
    expect(writes).toEqual(originals.map(([path]) => path))
    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors).toHaveLength(1)
    expect((failure as Error & { cause?: unknown }).cause).toBe(installError)
  })

  it('rethrows the install failure after exact restoration', () => {
    const installError = new Error('install failed')
    const restored = new Map<string, string>()
    const io: SourceInstallIo = {
      writeFileSync: (path, source) => { restored.set(path, source) },
      readFileSync: path => restored.get(path) ?? '',
    }

    expect(() => restoreProjectFiles(originals, installError, io)).toThrow(installError)
  })
})
