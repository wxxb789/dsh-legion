import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { trustedTempRoot } from '../scripts/trusted-temp-root.mjs'

describe('trusted temporary root', () => {
  it('honors the standard platform temp environment and rejects relative roots', () => {
    const previous = {
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      TMPDIR: process.env.TMPDIR,
      DSH_LEGION_TEMP_ROOT: process.env.DSH_LEGION_TEMP_ROOT,
    }
    const root = mkdtempSync(join(tmpdir(), 'dsh-legion-temp-root-'))
    const setPlatformTemp = (value: string) => {
      process.env.TEMP = value
      process.env.TMP = value
      process.env.TMPDIR = value
    }
    try {
      setPlatformTemp(root)
      expect(trustedTempRoot()).toBe(realpathSync(root))
      setPlatformTemp('relative-temp')
      expect(() => trustedTempRoot()).toThrow(/must be absolute/)
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
      rmSync(root, { recursive: true, force: true })
    }
  })
})
