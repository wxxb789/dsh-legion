import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { load } from 'js-yaml'
import { publishPackageSet, publishRelease } from '../scripts/publish-release.mjs'

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  version: string
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  publishConfig: { access: string; registry: string }
}
const COMPANION_MANIFEST = JSON.parse(
  readFileSync(join(ROOT, 'packages/run-receipt-feed/package.json'), 'utf8'),
) as { name: string; version: string; publishConfig: { access: string; registry: string } }
const VERSION = MANIFEST.version
const RELEASE_REGISTRY = 'https://registry.npmjs.org'
const RELEASE_TARBALL_CONTENT = 'release tarball bytes'
const RELEASE_TARBALL_INTEGRITY = 'sha512-Xysim926SpeAdpnaAVBWlHKB4B0DT7o7E18RwCU0R+Uhn0jjNAC0d6g6GUpU6wMay3TRkaPiyAGFnLUBpdi3hg=='

function runReleasePublisher(view: { output?: string; absent?: boolean; checkOnly?: boolean }) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-legion-publish-'))
  const tarball = join(root, 'dsh-legion.tgz')
  const calls: string[][] = []
  writeFileSync(tarball, RELEASE_TARBALL_CONTENT)
  const execute = (args: string[]) => {
    calls.push(args)
    if (args[0] === 'view') {
      return view.absent === true
        ? { status: 1, stdout: '', stderr: 'npm error code E404\nnpm error 404 Not Found\n' }
        : { status: 0, stdout: view.output ?? '', stderr: '' }
    }
    if (args[0] === 'publish') return { status: 0, stdout: 'published\n', stderr: '' }
    return { status: 2, stdout: '', stderr: 'unexpected npm command\n' }
  }
  try {
    const result = publishRelease({
      tarball,
      packageSpec: `dsh-legion@${VERSION}`,
      registry: RELEASE_REGISTRY,
      execute,
      ...view.checkOnly === undefined ? {} : { checkOnly: view.checkOnly },
    })
    return { result, error: undefined, calls }
  } catch (error: unknown) {
    return { result: undefined, error, calls }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('reproducible CI and release contracts', () => {
  it('commits a pnpm v9 lockfile for every direct dependency', () => {
    const lock = load(readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8')) as {
      lockfileVersion?: string
      importers?: Record<string, {
        dependencies?: Record<string, { specifier?: string }>
        devDependencies?: Record<string, { specifier?: string }>
      }>
    }
    expect(lock.lockfileVersion).toBe('9.0')
    const importer = lock.importers?.['.']
    for (const [name, specifier] of Object.entries(MANIFEST.dependencies)) {
      expect(importer?.dependencies?.[name]?.specifier, name).toBe(specifier)
    }
    for (const [name, specifier] of Object.entries(MANIFEST.devDependencies)) {
      expect(importer?.devDependencies?.[name]?.specifier, name).toBe(specifier)
    }
  })

  it('pins lower-bound Windows quality and packed DSH compatibility matrices', () => {
    const workflow = readFileSync(join(ROOT, '.github/workflows/quality-gates.yml'), 'utf8')
    const parsedWorkflow = load(workflow) as {
      jobs: Record<'quality' | 'compatibility', {
        strategy: { matrix: { dsh?: unknown } }
        steps: Array<{ if?: string; run?: string }>
      }>
    }
    const sourceInstall = {
      if: "inputs.dsh-source-artifact != ''",
      run: 'pnpm exec node scripts/install-dsh-tarballs.mjs --from "${{ runner.temp }}/dsh-npm" --registry "${{ env.DSH_REGISTRY }}"',
    }
    for (const job of [parsedWorkflow.jobs.quality, parsedWorkflow.jobs.compatibility]) {
      expect(job.steps.filter(step => step.run?.includes('install-dsh-tarballs'))).toEqual([sourceInstall])
    }
    expect(parsedWorkflow.jobs.compatibility.strategy.matrix.dsh).toContain('minimum')
    expect(parsedWorkflow.jobs.compatibility.strategy.matrix.dsh).toContain('latest-tested')
    expect(readFileSync(join(ROOT, '.npmrc'), 'utf8').replace(/\r\n/g, '\n'))
      .toBe('registry=https://mirrors.cloud.tencent.com/npm/\nverify-deps-before-run=false\n')
    const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8')
    expect(() => load(ci)).not.toThrow()
    expect(ci).toContain('uses: ./.github/workflows/quality-gates.yml')
    expect(ci).toContain('repository: deepseek-ai/deepseek-harness')
    expect(ci).toContain('dsh-source-artifact: dsh-npm-source')
    expect(ci).toContain('dsh-pnpm-workspace.yaml')
    expect(ci).toContain('package_json_file: deepseek-harness/package.json')
    expect(workflow).toContain('pnpm exec node scripts/install-dsh-tarballs.mjs')
    expect((workflow.match(/--non-applicable "source installer rewrote every workspace DSH edge to supplied tarballs"/g) ?? []))
      .toHaveLength(2)
    expect(workflow).toContain("if: inputs.dsh-source-artifact == ''")
    expect(workflow).toContain('DSH_REGISTRY: https://registry.npmjs.org')
    expect(workflow).toContain("PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'false'")
    expect(workflow).toContain('windows-latest')
    expect(workflow).toContain('22.19.0')
    expect(workflow).toContain('24.19.0')
    expect(workflow).toContain('pnpm install --frozen-lockfile')
    expect(workflow).toContain('pnpm run verify:journal-contract')
    expect(workflow).toContain('pnpm run test:recovery')
    // Version values are resolved from the compatibility contract at runtime;
    // the workflow carries only stable channel names, never a duplicate literal.
    expect(workflow).toContain('DSH_VERSION_CHANNEL: ${{ matrix.dsh.channel }}')
    expect(workflow).not.toContain('matrix.dsh.version')
    expect(workflow).not.toContain('>=0.1.0-rc.6 <0.2.0')
    expect(workflow).toContain('pnpm run test:packed-delegation')
    expect(workflow).toContain('test:packed-delegation-supplied')
    expect(workflow).toContain('{ id: win32, os: windows-latest }')
    expect(workflow).toContain('DSH_COMPATIBILITY_RECEIPT')
    expect(workflow).toContain('actions/upload-artifact@')
    const canary = readFileSync(join(ROOT, '.github/workflows/compatibility-canary.yml'), 'utf8')
    expect(() => load(canary)).not.toThrow()
    // The rolling canary selects the peer-range channel; the packed verifier
    // reads the exact range from the compatibility contract.
    expect(canary).toContain('DSH_VERSION_CHANNEL: peer-range')
    expect(canary).toContain('DSH_REGISTRY: https://registry.npmjs.org')
    expect(canary).not.toContain('DSH_VERSION:')
    expect(canary).toContain('compatibility-rolling-compatible-24.19.0')
    for (const name of [
      'ci.yml', 'compatibility-canary.yml', 'lockfile.yml', 'quality-gates.yml', 'release.yml',
    ]) {
      const source = readFileSync(join(ROOT, '.github/workflows', name), 'utf8')
      expect(source).not.toMatch(/pnpm install[^\n]*--registry=https?:/)
      const refs = [...source.matchAll(/uses:\s+([^\s#]+)/g)]
        .map(match => match[1])
        .filter(reference => !reference?.startsWith('./'))
      if (name !== 'ci.yml') expect(refs.length).toBeGreaterThan(0)
      expect(refs.every(reference => /@[a-f0-9]{40}$/.test(reference!))).toBe(true)
    }
  })

  it('resolves one exact DSH generation before installing every packed consumer dependency', () => {
    const sourceInstaller = readFileSync(join(ROOT, 'scripts/install-dsh-tarballs.mjs'), 'utf8')
    expect(sourceInstaller).toContain('tarballs.set(manifest.name')
    expect(sourceInstaller).toContain('workspacePackage.manifest[group][name] = packed.specFor(workspacePackage.directory)')
    expect(sourceInstaller).toContain('restoreProjectFiles(originals, installError)')
    const sourceRestorer = readFileSync(join(ROOT, 'scripts/source-install-restore.mjs'), 'utf8')
    expect(sourceRestorer).toContain('throw new AggregateError')
    expect(sourceInstaller).not.toContain('0.1.2-alpha.1')
    const script = readFileSync(join(ROOT, 'scripts/verify-packed-delegation.mjs'), 'utf8')
    expect(script).toContain('const dshVersion = resolveDshVersion(dshVersionSpec)')
    expect(script).toContain('resolveNpmRegistry(projectRoot)')
    expect(script).not.toContain('registry.npmjs.org')
    expect(script).toContain('...compatibilityPolicy.registryInstallPackageClosure')
    expect(script).toContain('...compatibilityPolicy.dshPackageClosure')
    expect(script).toContain('const packageSet = readPackedPackageSet(packDir, workspacePackages)')
    expect(script).toContain('companionArtifact.tarball')
    expect(script).toContain('rootArtifact.tarball')
    const consumer = readFileSync(join(ROOT, 'scripts/packed-delegation-consumer.mjs'), 'utf8')
    expect(consumer).toContain('configVersion: 2')
    const profileInstaller = readFileSync(join(ROOT, 'scripts/verify-profile-install.mjs'), 'utf8')
    expect(profileInstaller).toContain('resolveNpmRegistry(projectRoot)')
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
        release: { environment: string; needs: string[]; permissions: Record<string, string>; steps: Array<Record<string, unknown>> }
      }
    }
    expect(parsed.permissions).toEqual({ contents: 'read' })
    expect(COMPANION_MANIFEST.version).toBe(VERSION)
    expect([MANIFEST.publishConfig, COMPANION_MANIFEST.publishConfig]).toEqual([
      { access: 'public', registry: 'https://registry.npmjs.org' },
      { access: 'public', registry: 'https://registry.npmjs.org' },
    ])
    expect(parsed.jobs.release.environment).toBe('npm')
    expect(parsed.jobs.release.permissions).toMatchObject({
      contents: 'write', 'id-token': 'write', attestations: 'write',
    })
    const compatibility = JSON.parse(
      readFileSync(join(ROOT, 'contracts/compatibility.json'), 'utf8'),
    ) as { npmTrustedPublisher: Record<string, string> }
    expect(compatibility.npmTrustedPublisher).toEqual({
      repository: 'wxxb789/dsh-legion',
      workflow: '.github/workflows/release.yml',
      environment: 'npm',
      status: 'prerequisite-deferred',
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
    expect(workflow).toContain('test "${#tarballs[@]}" -eq 2')
    expect(workflow).toContain('ROOT_TARBALL=')
    expect(workflow).toContain('COMPANION_TARBALL=')
    expect(workflow).toContain('node scripts/verify-compatibility-receipts.mjs dist')
    expect(workflow).toContain('tar -xzf "$ROOT_TARBALL" -C dist/sbom-root')
    expect(workflow).toContain('tar -xzf "$COMPANION_TARBALL" -C dist/sbom-companion')
    expect(workflow).toContain('output-file: dist/dsh-legion.spdx.json')
    expect(workflow).toContain('output-file: dist/dsh-legion-receipts.spdx.json')
    expect(workflow).toMatch(/anchore\/sbom-action@[a-f0-9]{40}/)
    expect(workflow).toContain('node scripts/hash-artifacts.mjs')
    expect(workflow).toMatch(/actions\/attest-build-provenance@[a-f0-9]{40}/)
    expect(workflow).toContain('subject-path: dist/*')
    expect(workflow).toContain('node scripts/publish-release.mjs "$COMPANION_TARBALL" "dsh-legion-receipts@$VERSION" "$DSH_REGISTRY" --check-only')
    expect(workflow).toContain('node scripts/publish-release.mjs "$ROOT_TARBALL" "dsh-legion@$VERSION" "$DSH_REGISTRY" --check-only')
    expect(workflow).toContain('node scripts/publish-release.mjs "$COMPANION_TARBALL" "dsh-legion-receipts@$VERSION" "$DSH_REGISTRY"')
    expect(workflow).toContain('node scripts/publish-release.mjs "$ROOT_TARBALL" "dsh-legion@$VERSION" "$DSH_REGISTRY"')
    expect(workflow.indexOf('node scripts/publish-release.mjs "$COMPANION_TARBALL" "dsh-legion-receipts@$VERSION" "$DSH_REGISTRY"'))
      .toBeLessThan(workflow.indexOf('node scripts/publish-release.mjs "$ROOT_TARBALL" "dsh-legion@$VERSION" "$DSH_REGISTRY"'))
    expect((workflow.match(/overwrite: true/g) ?? [])).toHaveLength(2)
    expect(readFileSync(join(ROOT, '.github/workflows/quality-gates.yml'), 'utf8'))
      .toContain('overwrite: true')
    expect(workflow.indexOf('Verify npm recovery identity before publishing release evidence'))
      .toBeLessThan(workflow.indexOf('actions/attest-build-provenance'))
    expect(workflow).not.toContain('NPM_TOKEN')
    expect(workflow).toContain('gh release create')
    expect(workflow).toContain('gh release upload "$GITHUB_REF_NAME" dist/* --clobber')
    expect(workflow).toContain('--draft --verify-tag')
    expect(workflow).not.toContain('npm view "dsh-legion@$VERSION" version')
    expect(workflow).toContain('gh release edit "$GITHUB_REF_NAME" --draft=false')
    expect(workflow.indexOf('Stage recoverable GitHub draft release'))
      .toBeLessThan(workflow.indexOf('Publish with npm Trusted Publishing and provenance'))
    expect(workflow.indexOf('Publish with npm Trusted Publishing and provenance'))
      .toBeLessThan(workflow.indexOf('Publish GitHub release after npm succeeds'))
  })

  it('skips an already-published byte-identical npm artifact without publishing again', () => {
    const outcome = runReleasePublisher({ output: JSON.stringify(RELEASE_TARBALL_INTEGRITY) })
    expect(outcome.error).toBeUndefined()
    expect(outcome.result).toEqual({
      kind: 'identical',
      message: `dsh-legion@${VERSION} is already published with identical content; skipping`,
    })
    expect(outcome.calls.map(call => call[0])).toEqual(['view'])
    expect(outcome.calls[0]).toContain('dist.integrity')
  })

  it('fails recovery when the published npm artifact differs from the release tarball', () => {
    const outcome = runReleasePublisher({ output: JSON.stringify('sha512-different') })
    expect(outcome.error).toBeInstanceOf(Error)
    expect((outcome.error as Error).message)
      .toContain(`dsh-legion@${VERSION} is already published with different content`)
    expect((outcome.error as Error).message).toContain('registry: sha512-different')
    expect((outcome.error as Error).message).toContain(`packed:   ${RELEASE_TARBALL_INTEGRITY}`)
    expect(outcome.calls.map(call => call[0])).toEqual(['view'])
  })

  it('fails recovery when npm omits published integrity evidence', () => {
    const outcome = runReleasePublisher({ output: 'null' })
    expect(outcome.error).toBeInstanceOf(Error)
    expect((outcome.error as Error).message)
      .toContain(`registry reported no dist.integrity for dsh-legion@${VERSION}`)
    expect(outcome.calls.map(call => call[0])).toEqual(['view'])
  })

  it('recovers when npm accepted identical bytes before publish returned an error', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-legion-publish-race-'))
    const tarball = join(root, 'dsh-legion.tgz')
    const calls: string[][] = []
    writeFileSync(tarball, RELEASE_TARBALL_CONTENT)
    try {
      const result = publishRelease({
        tarball,
        packageSpec: `dsh-legion@${VERSION}`,
        registry: RELEASE_REGISTRY,
        execute(args) {
          calls.push(args)
          if (args[0] === 'view') {
            return calls.filter(call => call[0] === 'view').length === 1
              ? { status: 1, stdout: '', stderr: 'npm error code E404\nnpm error 404 Not Found\n' }
              : { status: 0, stdout: JSON.stringify(RELEASE_TARBALL_INTEGRITY), stderr: '' }
          }
          return { status: 1, stdout: '', stderr: 'connection closed after upload\n' }
        },
      })
      expect(result).toEqual({
        kind: 'recovered',
        message: `dsh-legion@${VERSION} published identical content before npm returned an error; recovered`,
      })
      expect(calls.map(call => call[0])).toEqual(['view', 'publish', 'view'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('preflights an absent npm version without publishing or mutating release evidence', () => {
    const outcome = runReleasePublisher({ absent: true, checkOnly: true })
    expect(outcome.error).toBeUndefined()
    expect(outcome.result).toEqual({
      kind: 'absent',
      message: `dsh-legion@${VERSION} is not published; preflight passed`,
    })
    expect(outcome.calls.map(call => call[0])).toEqual(['view'])
  })

  it('publishes with provenance only when the npm version is absent', () => {
    const outcome = runReleasePublisher({ absent: true })
    expect(outcome.error).toBeUndefined()
    expect(outcome.result).toMatchObject({ kind: 'published', message: `dsh-legion@${VERSION} published` })
    expect(outcome.calls.map(call => call[0])).toEqual(['view', 'publish'])
    expect(outcome.calls[1]).toEqual([
      'publish', expect.stringMatching(/dsh-legion\.tgz$/), '--access', 'public', '--provenance',
      `--registry=${RELEASE_REGISTRY}`,
    ])
  })

  it('recovers a partial pair publication by skipping identical companion bytes and publishing root second', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-legion-publish-pair-'))
    const companionTarball = join(root, 'dsh-legion-receipts.tgz')
    const rootTarball = join(root, 'dsh-legion.tgz')
    writeFileSync(companionTarball, RELEASE_TARBALL_CONTENT)
    writeFileSync(rootTarball, RELEASE_TARBALL_CONTENT)
    const calls: string[][] = []
    const execute = (args: string[]) => {
      calls.push(args)
      if (args[0] === 'view') {
        return args[1]?.startsWith(`${COMPANION_MANIFEST.name}@`)
          ? { status: 0, stdout: JSON.stringify(RELEASE_TARBALL_INTEGRITY), stderr: '' }
          : { status: 1, stdout: '', stderr: 'npm error code E404\nnpm error 404 Not Found\n' }
      }
      return { status: 0, stdout: 'published\n', stderr: '' }
    }
    try {
      const result = publishPackageSet({
        packages: [
          { tarball: companionTarball, packageSpec: `${COMPANION_MANIFEST.name}@${VERSION}` },
          { tarball: rootTarball, packageSpec: `dsh-legion@${VERSION}` },
        ],
        registry: RELEASE_REGISTRY,
        execute,
      })
      expect(result.map(item => item.kind)).toEqual(['identical', 'published'])
      expect(calls.filter(call => call[0] === 'publish').map(call => call[1]))
        .toEqual([rootTarball])
      expect(calls.findIndex(call => call[1]?.startsWith(`${COMPANION_MANIFEST.name}@`)))
        .toBeLessThan(calls.findIndex(call => call[1]?.startsWith('dsh-legion@')))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('skips both package publications only when both registry artifacts are byte-identical', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-legion-publish-pair-identical-'))
    const companionTarball = join(root, 'dsh-legion-receipts.tgz')
    const rootTarball = join(root, 'dsh-legion.tgz')
    writeFileSync(companionTarball, RELEASE_TARBALL_CONTENT)
    writeFileSync(rootTarball, RELEASE_TARBALL_CONTENT)
    const calls: string[][] = []
    try {
      const result = publishPackageSet({
        packages: [
          { tarball: companionTarball, packageSpec: `${COMPANION_MANIFEST.name}@${VERSION}` },
          { tarball: rootTarball, packageSpec: `dsh-legion@${VERSION}` },
        ],
        registry: RELEASE_REGISTRY,
        execute(args) {
          calls.push(args)
          return { status: 0, stdout: JSON.stringify(RELEASE_TARBALL_INTEGRITY), stderr: '' }
        },
      })
      expect(result.map(item => item.kind)).toEqual(['identical', 'identical'])
      expect(calls.map(call => call[0])).toEqual(['view', 'view'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails the pair before publishing when either same-version artifact has different bytes', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-legion-publish-pair-mismatch-'))
    const companionTarball = join(root, 'dsh-legion-receipts.tgz')
    const rootTarball = join(root, 'dsh-legion.tgz')
    writeFileSync(companionTarball, RELEASE_TARBALL_CONTENT)
    writeFileSync(rootTarball, RELEASE_TARBALL_CONTENT)
    const calls: string[][] = []
    try {
      expect(() => publishPackageSet({
        packages: [
          { tarball: companionTarball, packageSpec: `${COMPANION_MANIFEST.name}@${VERSION}` },
          { tarball: rootTarball, packageSpec: `dsh-legion@${VERSION}` },
        ],
        registry: RELEASE_REGISTRY,
        execute(args) {
          calls.push(args)
          if (args[0] === 'view' && args[1]?.startsWith('dsh-legion@')) {
            return { status: 0, stdout: JSON.stringify('sha512-different'), stderr: '' }
          }
          return { status: 1, stdout: '', stderr: 'npm error code E404\nnpm error 404 Not Found\n' }
        },
      })).toThrow('dsh-legion@')
      expect(calls.some(call => call[0] === 'publish')).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
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
