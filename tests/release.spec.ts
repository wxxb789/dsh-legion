import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { load } from 'js-yaml'

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version as string

describe('reproducible CI and release contracts', () => {
  it('commits a pnpm v9 lockfile for every direct dependency', () => {
    const lock = load(readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8')) as {
      lockfileVersion?: string
      importers?: Record<string, {
        dependencies?: Record<string, unknown>
        devDependencies?: Record<string, unknown>
      }>
    }
    expect(lock.lockfileVersion).toBe('9.0')
    const importer = lock.importers?.['.']
    expect(importer?.dependencies).toHaveProperty('@deepseek-ai/schemastery')
    expect(importer?.dependencies).toHaveProperty('js-yaml')
    expect(importer?.devDependencies).toHaveProperty('@deepseek-ai/dsh-agent')
    expect(importer?.devDependencies).toHaveProperty('typescript')
  })

  it('pins lower-bound Windows quality and packed DSH compatibility matrices', () => {
    const workflow = readFileSync(join(ROOT, '.github/workflows/quality-gates.yml'), 'utf8')
    expect(() => load(workflow)).not.toThrow()
    expect(readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8'))
      .toContain('uses: ./.github/workflows/quality-gates.yml')
    expect(workflow).toContain('windows-latest')
    expect(workflow).toContain('22.19.0')
    expect(workflow).toContain('24.19.0')
    expect(workflow).toContain('pnpm install --frozen-lockfile')
    expect(workflow).toContain('channel: minimum')
    expect(workflow).toContain('channel: latest-tested')
    expect(workflow).not.toContain('>=0.1.0-rc.6 <0.2.0')
    expect(workflow).toContain('pnpm run test:packed-delegation')
    expect(workflow).toContain('DSH_LEGION_TARBALL')
    expect(workflow).toContain('DSH_COMPATIBILITY_RECEIPT')
    expect(workflow).toContain('actions/upload-artifact@')
    const canary = readFileSync(join(ROOT, '.github/workflows/compatibility-canary.yml'), 'utf8')
    expect(() => load(canary)).not.toThrow()
    expect(canary).toContain("DSH_VERSION: '>=0.1.0-rc.6 <0.2.0'")
    expect(canary).toContain('compatibility-rolling-compatible-24.19.0')
    for (const name of [
      'ci.yml', 'compatibility-canary.yml', 'lockfile.yml', 'quality-gates.yml', 'release.yml',
    ]) {
      const source = readFileSync(join(ROOT, '.github/workflows', name), 'utf8')
      const refs = [...source.matchAll(/uses:\s+([^\s#]+)/g)]
        .map(match => match[1])
        .filter(reference => !reference?.startsWith('./'))
      if (name !== 'ci.yml') expect(refs.length).toBeGreaterThan(0)
      expect(refs.every(reference => /@[a-f0-9]{40}$/.test(reference!))).toBe(true)
    }
  })

  it('resolves one exact DSH generation before installing every packed consumer dependency', () => {
    const script = readFileSync(join(ROOT, 'scripts/verify-packed-delegation.mjs'), 'utf8')
    expect(script).toContain('const dshVersion = resolveDshVersion(dshVersionSpec)')
    expect(script).toContain('].map(name => `${name}@${dshVersion}`)')
    expect(script).toContain("'@deepseek-ai/dsh-agent-loop-testkit'")
    expect(script).toContain("'@deepseek-ai/dsh-subagent-spawn-in-process'")
    const consumer = readFileSync(join(ROOT, 'scripts/packed-delegation-consumer.mjs'), 'utf8')
    expect(consumer).toContain('configVersion: 2')
    expect(consumer).toContain('enableStrategies: true')
    expect(consumer).toContain("kind: 'strategy'")
    expect(consumer).toContain("strategy: 'packed-strategy'")
    expect(script).toContain('await verifyDshGeneration(consumerDir, dshVersion)')
    expect(script).toContain("'verify-public-contract.mjs'")
  })

  it('gates tag releases on metadata, SBOM, checksums, attestation, and npm provenance', () => {
    const workflow = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8')
    expect(() => load(workflow)).not.toThrow()
    const parsed = load(workflow) as {
      permissions: Record<string, string>
      jobs: {
        gates: { needs: string; uses: string; with: Record<string, string> }
        release: { needs: string[]; permissions: Record<string, string>; steps: Array<Record<string, unknown>> }
      }
    }
    expect(parsed.permissions).toEqual({ contents: 'read' })
    expect(parsed.jobs.release.permissions).toMatchObject({
      contents: 'write', 'id-token': 'write', attestations: 'write',
    })
    expect(parsed.jobs.gates).toMatchObject({
      needs: 'pack',
      uses: './.github/workflows/quality-gates.yml',
      with: { 'tarball-artifact': 'package-tarball' },
    })
    expect(parsed.jobs.release.needs).toEqual(['pack', 'gates'])
    expect(parsed.jobs.release.steps.some(step =>
      step.uses === 'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093'
      && (step.with as { name?: string } | undefined)?.name === 'package-tarball')).toBe(true)
    expect(workflow).toContain("tags: ['v*']")
    expect(workflow).toContain('needs: [pack, gates]')
    expect(workflow).toContain('uses: ./.github/workflows/quality-gates.yml')
    expect(workflow).toContain('tarball-artifact: package-tarball')
    expect(workflow).toContain('name: package-tarball')
    expect(workflow).toContain('pattern: compatibility-*')
    expect(workflow).toContain('merge-multiple: true')
    const actionRefs = [...workflow.matchAll(/uses:\s+([^\s#]+)/g)]
      .map(match => match[1])
      .filter(reference => !reference?.startsWith('./'))
    expect(actionRefs.length).toBeGreaterThan(0)
    expect(actionRefs.every(reference => /@[a-f0-9]{40}$/.test(reference!))).toBe(true)
    expect(workflow).toContain('id-token: write')
    expect(workflow).toContain('node scripts/verify-release.mjs')
    expect(workflow).toContain('pnpm run verify:reproducible-pack -- --source=git dist')
    expect(workflow).not.toContain('npm pack --ignore-scripts --pack-destination dist')
    expect(workflow).toContain('runs-on: ubuntu-24.04')
    expect(workflow).toContain('node-version: 24.19.0')
    expect(workflow).toContain('test "${#tarballs[@]}" -eq 1')
    expect(workflow).toContain('node scripts/verify-compatibility-receipts.mjs dist')
    expect(workflow).toContain('tar -xzf "$RELEASE_TARBALL" -C dist/sbom-root')
    expect(workflow).toContain('path: dist/sbom-root/package')
    expect(workflow).toMatch(/anchore\/sbom-action@[a-f0-9]{40}/)
    expect(workflow).toContain('node scripts/hash-artifacts.mjs')
    expect(workflow).toMatch(/actions\/attest-build-provenance@[a-f0-9]{40}/)
    expect(workflow).toContain('subject-path: dist/*')
    expect(workflow).toContain('npm publish "$RELEASE_TARBALL" --access public --provenance')
    expect(workflow).not.toContain('NPM_TOKEN')
    expect(workflow).toContain('gh release create')
  })

  it('verifies release tag/version/changelog identity and rejects a mismatch', () => {
    const ok = spawnSync(process.execPath, ['scripts/verify-release.mjs', `v${VERSION}`], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    expect(ok.status).toBe(0)
    expect(ok.stdout).toContain(`release metadata is consistent for v${VERSION}`)

    const mismatch = spawnSync(process.execPath, ['scripts/verify-release.mjs', 'v9.9.9'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    expect(mismatch.status).not.toBe(0)
    expect(mismatch.stderr).toContain('does not match package version')

    const root = mkdtempSync(join(tmpdir(), 'dsh-legion-bad-date-'))
    try {
      writeFileSync(join(root, 'package.json'), JSON.stringify({
        version: '1.2.3',
        publishConfig: { access: 'public' },
      }))
      writeFileSync(join(root, 'CHANGELOG.md'), '## [1.2.3] - 2026-99-99\n')
      const badDate = spawnSync(process.execPath, [
        'scripts/verify-release.mjs', 'v1.2.3', '--root', root,
      ], { cwd: ROOT, encoding: 'utf8' })
      expect(badDate.status).not.toBe(0)
      expect(badDate.stderr).toContain('no valid dated [1.2.3] release heading')

      writeFileSync(join(root, 'package.json'), JSON.stringify({
        version: '1.2.3-..',
        publishConfig: { access: 'public' },
      }))
      writeFileSync(join(root, 'CHANGELOG.md'), '## [1.2.3-..] - 2026-08-15\n')
      const badSemver = spawnSync(process.execPath, [
        'scripts/verify-release.mjs', 'v1.2.3-..', '--root', root,
      ], { cwd: ROOT, encoding: 'utf8' })
      expect(badSemver.status).not.toBe(0)
      expect(badSemver.stderr).toContain('package version is not valid semver')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('creates deterministic SHA-256 release checksums', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-legion-release-'))
    try {
      writeFileSync(join(root, 'b.txt'), 'beta')
      writeFileSync(join(root, 'a.txt'), 'alpha')
      const result = spawnSync(process.execPath, ['scripts/hash-artifacts.mjs', root], {
        cwd: ROOT,
        encoding: 'utf8',
      })
      expect(result.status).toBe(0)
      const sums = readFileSync(join(root, 'SHA256SUMS'), 'utf8').trim().split('\n')
      expect(sums).toHaveLength(2)
      expect(sums[0]).toMatch(/^[a-f0-9]{64}  a\.txt$/)
      expect(sums[1]).toMatch(/^[a-f0-9]{64}  b\.txt$/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
