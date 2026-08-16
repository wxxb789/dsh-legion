import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const sha256 = (value: string | Buffer) => `sha256:${createHash('sha256').update(value).digest('hex')}`
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }
const contract = JSON.parse(readFileSync(join(ROOT, 'contracts/v1.json'), 'utf8')) as {
  compatibilityReceiptVersion: string
}
const compatibilityPolicy = JSON.parse(
  readFileSync(join(ROOT, 'contracts/compatibility.json'), 'utf8'),
) as {
  minimumDshVersion: string
  latestTestedDshVersion: string
  dshPackageClosure: string[]
}
const DSH_PACKAGES = compatibilityPolicy.dshPackageClosure

function fixture(root: string): void {
  const tarball = Buffer.from('exact release tarball')
  writeFileSync(join(root, `dsh-legion-${manifest.version}.tgz`), tarball)
  const tarballSha256 = `sha256:${createHash('sha256').update(tarball).digest('hex')}`
  for (const platform of ['linux', 'win32']) {
    for (const channel of ['minimum', 'latest-tested']) {
      for (const node of ['22.19.0', '24.19.0']) {
      const resolved = channel === 'minimum'
        ? compatibilityPolicy.minimumDshVersion
        : compatibilityPolicy.latestTestedDshVersion
      const lockfileName = `compatibility-${platform}-${channel}-${node}.lock.yaml`
      const lockfile = [
        "lockfileVersion: '9.0'",
        'packages:',
        ...DSH_PACKAGES.map(name => `  '@deepseek-ai/${name}@${resolved}': {}`),
        '',
      ].join('\n')
      writeFileSync(join(root, lockfileName), lockfile)
      writeFileSync(join(root, `compatibility-${platform}-${channel}-${node}.json`), JSON.stringify({
        schemaVersion: contract.compatibilityReceiptVersion,
        requestedDshVersion: resolved,
        resolvedDshVersion: resolved,
        platform,
        nodeVersion: `v${node}`,
        packageVersion: manifest.version,
        tarballSha256,
        consumerLockfileFile: lockfileName,
        consumerLockfileSha256: sha256(lockfile),
        dshDependencies: DSH_PACKAGES.map(name => ({ name, version: resolved })),
        status: 'passed',
      }))
      }
    }
  }
}

function verify(root: string) {
  return spawnSync(process.execPath, ['scripts/verify-compatibility-receipts.mjs', root], {
    cwd: ROOT,
    encoding: 'utf8',
  })
}

describe('release compatibility receipt verifier', () => {
  it('binds eight exact compatibility runs to one release tarball', () => {
    const root = mkdtempSync(join(tmpdir(), 'legion-compatibility-'))
    try {
      fixture(root)
      const result = verify(root)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('verified exact release tarball')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects copied receipts that do not match their matrix slot', () => {
    const root = mkdtempSync(join(tmpdir(), 'legion-compatibility-copied-'))
    try {
      fixture(root)
      const copied = readFileSync(join(root, 'compatibility-linux-minimum-22.19.0.json'))
      writeFileSync(join(root, 'compatibility-win32-latest-tested-24.19.0.json'), copied)
      expect(verify(root).status).not.toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects extra DSH dependencies even when they are added to the captured lockfile', () => {
    const root = mkdtempSync(join(tmpdir(), 'legion-compatibility-closure-'))
    try {
      fixture(root)
      const path = join(root, 'compatibility-linux-minimum-22.19.0.json')
      const receipt = JSON.parse(readFileSync(path, 'utf8')) as {
        resolvedDshVersion: string
        consumerLockfileFile: string
        consumerLockfileSha256: string
        dshDependencies: Array<{ name: string; version: string }>
      }
      const lockfilePath = join(root, receipt.consumerLockfileFile)
      const lockfile = readFileSync(lockfilePath, 'utf8')
        + `  '@deepseek-ai/dsh-evil-extra@${receipt.resolvedDshVersion}': {}\n`
      writeFileSync(lockfilePath, lockfile)
      receipt.consumerLockfileSha256 = sha256(lockfile)
      receipt.dshDependencies.push({ name: 'dsh-evil-extra', version: receipt.resolvedDshVersion })
      writeFileSync(path, JSON.stringify(receipt))
      expect(verify(root).status).not.toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails closed for multiple tarballs or a mismatched receipt digest', () => {
    const root = mkdtempSync(join(tmpdir(), 'legion-compatibility-invalid-'))
    try {
      fixture(root)
      writeFileSync(join(root, 'other.tgz'), 'other')
      expect(verify(root).status).not.toBe(0)
      rmSync(join(root, 'other.tgz'), { force: true })
      const receipt = join(root, 'compatibility-linux-minimum-22.19.0.json')
      const value = JSON.parse(readFileSync(receipt, 'utf8')) as { tarballSha256: string }
      value.tarballSha256 = `sha256:${'b'.repeat(64)}`
      writeFileSync(receipt, JSON.stringify(value))
      expect(verify(root).status).not.toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
