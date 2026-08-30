import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const sha256 = (value: string | Buffer) => `sha256:${createHash('sha256').update(value).digest('hex')}`
const rootManifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  name: string
  version: string
}
const companionManifest = JSON.parse(
  readFileSync(join(ROOT, 'packages/run-receipt-feed/package.json'), 'utf8'),
) as { name: string; version: string }
const contract = JSON.parse(readFileSync(join(ROOT, 'contracts/v1.json'), 'utf8')) as {
  compatibilityReceiptVersion: string
}
const compatibilityPolicy = JSON.parse(
  readFileSync(join(ROOT, 'contracts/compatibility.json'), 'utf8'),
) as {
  minimumDshVersion: string
  latestTestedDshVersion: string
  registryInstallPackageClosure: string[]
  dshPackageClosure: string[]
}
const DSH_PACKAGES = [...new Set([
  ...compatibilityPolicy.registryInstallPackageClosure,
  ...compatibilityPolicy.dshPackageClosure,
])].sort()
const packageFile = (manifest: { name: string; version: string }) => `${manifest.name}-${manifest.version}.tgz`
const expectedPackages = [companionManifest, rootManifest]
  .sort((left, right) => left.name.localeCompare(right.name))
  .map(item => ({ name: item.name, version: item.version, tarballFile: packageFile(item) }))

function fixture(root: string): void {
  const receiptPackages = expectedPackages.map((item, index) => {
    const staging = join(root, `staging-${String(index)}`)
    mkdirSync(join(staging, 'package'), { recursive: true })
    writeFileSync(join(staging, 'package', 'package.json'), JSON.stringify({
      name: item.name,
      version: item.version,
      ...item.name === rootManifest.name
        ? { dependencies: { [companionManifest.name]: companionManifest.version } }
        : {},
    }))
    const tarball = join(root, item.tarballFile)
    const packed = spawnSync('tar', ['-czf', tarball, '-C', staging, 'package'], { encoding: 'utf8' })
    if (packed.status !== 0) throw new Error(packed.stderr)
    rmSync(staging, { recursive: true, force: true })
    return { ...item, tarballSha256: sha256(readFileSync(tarball)) }
  })
  for (const platform of ['linux', 'win32']) {
    for (const channel of ['minimum', 'latest-tested']) {
      for (const node of ['22.19.0', '24.19.0']) {
        const resolved = channel === 'minimum'
          ? compatibilityPolicy.minimumDshVersion
          : compatibilityPolicy.latestTestedDshVersion
        const lockfileName = `compatibility-${platform}-${channel}-${node}.lock.yaml`
        const lockfile = [
          "lockfileVersion: '9.0'",
          'importers:',
          "  .:",
          '    dependencies:',
          ...expectedPackages.flatMap(item => [
            `      ${item.name}:`,
            `        specifier: file:${item.tarballFile}`,
            `        version: file:${item.tarballFile}`,
          ]),
          'packages:',
          ...DSH_PACKAGES.map(name => `  '@deepseek-ai/${name}@${resolved}': {}`),
          '',
        ].join('\n')
        writeFileSync(join(root, lockfileName), lockfile)
        writeFileSync(join(root, `compatibility-${platform}-${channel}-${node}.json`), JSON.stringify({
          schemaVersion: contract.compatibilityReceiptVersion,
          matrixSlot: `${platform}-${channel}-${node}`,
          requestedDshVersion: resolved,
          resolvedDshVersion: resolved,
          platform,
          nodeVersion: `v${node}`,
          packages: receiptPackages,
          consumerLockfileFile: lockfileName,
          consumerLockfileSha256: sha256(lockfile),
          dshDependencies: DSH_PACKAGES.map(name => ({ name, version: resolved })),
          capabilityMode: 'rc6-replay-only-fail-closed',
          durableMutation: false,
          durableDiagnostics: [
            'LEGION_DURABLE_FLUSH_UNAVAILABLE',
            'LEGION_SESSION_PROJECTION_UNAVAILABLE',
            'LEGION_DURABLE_COORDINATION_UNAVAILABLE',
            'LEGION_GLOBAL_ADMISSION_UNAVAILABLE',
            'LEGION_DURABLE_CHILD_RECEIPT_UNAVAILABLE',
          ],
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
  it('binds eight exact compatibility runs to the release package pair', () => {
    const root = mkdtempSync(join(tmpdir(), 'legion-compatibility-'))
    try {
      fixture(root)
      const result = verify(root)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('verified exact release package pair')
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

  it('rejects missing, extra, mismatched, or digest-copied package artifacts', () => {
    for (const attack of ['missing', 'extra', 'mismatch', 'copied-digest'] as const) {
      const root = mkdtempSync(join(tmpdir(), `legion-compatibility-${attack}-`))
      try {
        fixture(root)
        const receiptPath = join(root, 'compatibility-linux-minimum-22.19.0.json')
        const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as {
          packages: Array<{ name: string; version: string; tarballFile: string; tarballSha256: string }>
        }
        if (attack === 'missing') rmSync(join(root, expectedPackages[0]!.tarballFile))
        if (attack === 'extra') writeFileSync(join(root, 'other-1.0.0.tgz'), 'other')
        if (attack === 'mismatch') receipt.packages[0]!.version = '9.9.9'
        if (attack === 'copied-digest') receipt.packages[0]!.tarballSha256 = receipt.packages[1]!.tarballSha256
        writeFileSync(receiptPath, JSON.stringify(receipt))
        expect(verify(root).status, attack).not.toBe(0)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
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

  it('rejects receipts that overclaim durable mutation capability', () => {
    const root = mkdtempSync(join(tmpdir(), 'legion-compatibility-capability-'))
    try {
      fixture(root)
      const path = join(root, 'compatibility-linux-minimum-22.19.0.json')
      const receipt = JSON.parse(readFileSync(path, 'utf8')) as { durableMutation: boolean }
      receipt.durableMutation = true
      writeFileSync(path, JSON.stringify(receipt))
      expect(verify(root).status).not.toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
