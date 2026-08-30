import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const FIXTURES = join(ROOT, 'tests/fixtures/registry')

interface CompatibilityPolicy {
  schemaVersion: string
  dshPeerRange: string
  minimumDshVersion: string
  latestTestedDshVersion: string
  assessedDshVersions: string[]
  registryInstallPackageClosure: string[]
  dshPackageClosure: string[]
}

const POLICY = JSON.parse(
  readFileSync(join(ROOT, 'contracts/compatibility.json'), 'utf8'),
) as CompatibilityPolicy

const preflight = (args: string[]) => spawnSync(
  process.execPath,
  ['scripts/verify-dependency-preflight.mjs', ...args],
  { cwd: ROOT, encoding: 'utf8' },
)

const fixtureManifestArgs = [
  '--manifest', join(FIXTURES, 'host-line.workspace.package.json'),
]
const fixturePreflight = (args: string[]) => preflight([...args, ...fixtureManifestArgs])

/**
 * The loopback registry serves from this process, so the child must run
 * asynchronously: a synchronous spawn would block the very event loop that has
 * to answer its requests.
 */
const preflightAsync = (
  args: string[],
  environment: NodeJS.ProcessEnv = {},
) => new Promise<{ status: number | null; stdout: string }>(
  (resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/verify-dependency-preflight.mjs', ...args], {
      cwd: ROOT,
      env: { ...process.env, ...environment },
    })
    let stdout = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.on('error', reject)
    child.on('close', status => { resolve({ status, stdout }) })
  },
)

const fixture = (name: string) => join(FIXTURES, name)

/**
 * A registry that publishes exactly what the given policy declares, with every
 * package requiring its siblings at the same line. Built from the policy rather
 * than from a copied package list, so it keeps describing whatever closure the
 * contract declares.
 */
const satisfyingSnapshot = (policy: CompatibilityPolicy): {
  schemaVersion: string
  registry: string
  source: string
  recordedAt: string
  packages: Record<string, {
    versions: string[]
    distTags: Record<string, string>
    manifests: Record<string, unknown>
  }>
} => {
  const lines = [...new Set([
    policy.minimumDshVersion,
    policy.latestTestedDshVersion,
    ...policy.assessedDshVersions,
  ])]
  const scoped = policy.registryInstallPackageClosure.map(name => `@deepseek-ai/${name}`)
  return {
    schemaVersion: 'dsh-legion-registry-snapshot-v1',
    registry: 'https://registry.npmjs.org',
    source: 'recorded',
    recordedAt: '2026-08-23',
    packages: Object.fromEntries(scoped.map(name => [name, {
      versions: lines,
      distTags: { latest: policy.latestTestedDshVersion },
      manifests: Object.fromEntries(lines.map(line => [line, {
        dependencies: {},
        peerDependencies: Object.fromEntries(
          scoped.filter(other => other !== name).map(other => [other, line]),
        ),
      }])),
    }])),
  }
}

const withTempDir = <T>(prefix: string, run: (dir: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  try {
    return run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const withTempDirAsync = async (prefix: string, run: (dir: string) => Promise<void>) => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  try {
    await run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('dependency availability preflight', () => {
  it('reports an unpublished declared line as an upstream publish gap, not a Legion defect', () => {
    const result = fixturePreflight([
      '--policy', fixture('host-line.policy.json'),
      '--snapshot', fixture('published-below-declared-line.snapshot.json'),
    ])
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('dependency preflight: upstream-publish-gap')
    // The package, the unsatisfiable line, and what the registry actually offers.
    expect(result.stdout).toContain('LEGION_DECLARED_LINE_UNPUBLISHED @deepseek-ai/dsh-agent')
    expect(result.stdout).toContain('does not publish the declared latest-tested/assessed line 0.1.1-rc.1')
    expect(result.stdout).toContain('7 published versions, highest 0.1.0-rc.6')
    // A dist-tag advertising a version the registry does not publish is the
    // recorded shape of the observed failure, and it names a declared line.
    expect(result.stdout).toContain('LEGION_DANGLING_DIST_TAG @deepseek-ai/dsh-agent')
    expect(result.stdout).toContain('advertises dist-tag latest as 0.1.1-rc.1, which the registry does not publish')
    expect(result.stdout).toContain('not a Legion defect')
    expect(result.stdout).not.toContain('local-regression')
  })

  it('catches an upstream package whose own sibling range no published version satisfies', () => {
    const result = fixturePreflight([
      '--policy', fixture('host-line.policy.json'),
      '--snapshot', fixture('prerelease-only-sibling.snapshot.json'),
    ])
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('dependency preflight: upstream-publish-gap')
    expect(result.stdout).toContain(
      '@deepseek-ai/dsh-agent@0.1.1-rc.1 (the declared latest-tested/assessed line)'
      + ' requires @deepseek-ai/dsh-typert-protocol@^0.1.1',
    )
    expect(result.stdout).toContain('no published version of @deepseek-ai/dsh-typert-protocol satisfies it')
  })

  it('checks the version the peer range resolves to, not only the declared lines', () => {
    const result = fixturePreflight([
      '--policy', fixture('host-line.policy.json'),
      '--snapshot', fixture('peer-range-top-unsatisfiable.snapshot.json'),
    ])
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('dependency preflight: upstream-publish-gap')
    // Every declared line is published here. What cannot install is the version
    // an unpinned consumer actually gets, which is the highest the declared
    // peer range admits.
    expect(result.stdout).not.toContain('LEGION_DECLARED_LINE_UNPUBLISHED')
    expect(result.stdout).toContain(
      '@deepseek-ai/dsh-agent@0.1.1-rc.2 (the highest version the declared peer range admits)'
      + ' requires @deepseek-ai/dsh-typert-protocol@^0.1.1',
    )
  })

  it('follows the resolution walk past the declared closure', () => {
    const result = fixturePreflight([
      '--policy', fixture('host-line.policy.json'),
      '--snapshot', fixture('transitive-gap.snapshot.json'),
    ])
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('dependency preflight: upstream-publish-gap')
    // The failing package is not in the declared closure at all: an install
    // reaches it through a declared line, and so does the preflight.
    expect(result.stdout).toContain(
      '@deepseek-ai/dsh-session-projection@0.1.1-rc.1'
      + ' (required by @deepseek-ai/dsh-agent@0.1.1-rc.1)'
      + ' requires @deepseek-ai/dsh-invariants@^0.1.1',
    )
  })

  it('classifies a self-contradicting contract as a local regression instead', () => {
    const result = fixturePreflight([
      '--policy', fixture('contradictory.policy.json'),
      '--snapshot', fixture('prerelease-only-sibling.snapshot.json'),
    ])
    expect(result.status).toBe(2)
    expect(result.stdout).toContain('dependency preflight: local-regression')
    expect(result.stdout).toContain('LEGION_DECLARED_LINE_OUTSIDE_PEER_RANGE')
    expect(result.stdout).toContain('local regression in this repository, not an upstream publish gap')
  })

  it('detects drift when the registry has moved past the declared latest-tested line', () => {
    const result = fixturePreflight([
      '--policy', fixture('host-line.policy.json'),
      '--snapshot', fixture('newer-line-published.snapshot.json'),
    ])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('dependency preflight: satisfied')
    expect(result.stdout).toContain('LEGION_HOST_LINE_DRIFT')
    expect(result.stdout).toContain('host line drift: behind')
    expect(result.stdout).toContain('0.1.1-rc.2 is resolvable across the registry-install closure')
    // A line that exists only as prereleases resolves as published and can
    // still defeat an installer that asks for a stable floor of it.
    expect(result.stdout).toContain('LEGION_PRERELEASE_ONLY_RESOLUTION')
    expect(result.stdout).toContain('resolves only to prereleases (highest 0.1.1-rc.2)')
  })

  it('passes the shipped contract against a registry that publishes what it declares', () => {
    withTempDir('legion-preflight-satisfied-', (dir) => {
      const snapshot = join(dir, 'snapshot.json')
      writeFileSync(snapshot, JSON.stringify(satisfyingSnapshot(POLICY)))
      const result = preflight(['--snapshot', snapshot])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('dependency preflight: satisfied')
      expect(result.stdout).toContain(`registry-install closure: ${POLICY.registryInstallPackageClosure.length} packages`)
      expect(result.stdout).toContain(`runtime-compatibility closure: ${POLICY.dshPackageClosure.length} packages`)
      expect(result.stdout).toContain('host line drift: current')
    })
  })

  it('resolves the closure the contract declares rather than a list of its own', () => {
    withTempDir('legion-preflight-closure-', (dir) => {
      const policy = {
        ...POLICY,
        registryInstallPackageClosure: [...POLICY.registryInstallPackageClosure, 'dsh-not-published'],
      }
      const snapshot = satisfyingSnapshot(POLICY)
      // The registry answered for the extra package and published nothing.
      snapshot.packages['@deepseek-ai/dsh-not-published'] = {
        versions: [],
        distTags: {},
        manifests: {},
      }
      const policyPath = join(dir, 'policy.json')
      const snapshotPath = join(dir, 'snapshot.json')
      writeFileSync(policyPath, JSON.stringify(policy))
      writeFileSync(snapshotPath, JSON.stringify(snapshot))
      const result = preflight(['--policy', policyPath, '--snapshot', snapshotPath, '--json'])
      expect(result.status).toBe(1)
      const report = JSON.parse(result.stdout) as {
        findings: Array<{ code: string; package?: string; range?: string; offers?: string[] }>
      }
      expect(report.findings).toContainEqual(expect.objectContaining({
        code: 'LEGION_PACKAGE_UNPUBLISHED',
        package: '@deepseek-ai/dsh-not-published',
        range: POLICY.dshPeerRange,
        offers: [],
      }))
    })
  })

  it('reports a declared package the snapshot never recorded as missing evidence, not as a pass', () => {
    withTempDir('legion-preflight-evidence-', (dir) => {
      const policy = {
        ...POLICY,
        registryInstallPackageClosure: [...POLICY.registryInstallPackageClosure, 'dsh-never-queried'],
      }
      const policyPath = join(dir, 'policy.json')
      const snapshot = join(dir, 'snapshot.json')
      writeFileSync(policyPath, JSON.stringify(policy))
      writeFileSync(snapshot, JSON.stringify(satisfyingSnapshot(POLICY)))
      const result = preflight(['--policy', policyPath, '--snapshot', snapshot])
      expect(result.status).toBe(3)
      expect(result.stdout).toContain('dependency preflight: incomplete-evidence')
      expect(result.stdout).toContain('LEGION_REGISTRY_COVERAGE_INCOMPLETE @deepseek-ai/dsh-never-queried')
      expect(result.stdout).toContain('neither a proven gap nor a passing line')
    })
  })

  it.each([
    ['missing', 'missing-versions.snapshot.json', 'records no versions'],
    ['non-array', 'non-array-versions.snapshot.json', 'expected an array'],
    ['mixed', 'mixed-versions.snapshot.json', 'every entry must be a string'],
  ])('treats %s versions evidence as incomplete coverage', (_kind, snapshot, detail) => {
    const result = fixturePreflight([
      '--policy', fixture('host-line.policy.json'),
      '--snapshot', fixture(snapshot),
      '--json',
    ])
    expect(result.status).toBe(3)
    const report = JSON.parse(result.stdout) as {
      status: string
      findings: Array<{ code: string; classification: string; detail: string }>
    }
    expect(report.status).toBe('incomplete-evidence')
    expect(report.findings).toContainEqual(expect.objectContaining({
      code: 'LEGION_REGISTRY_COVERAGE_INCOMPLETE',
      classification: 'coverage',
      detail: expect.stringContaining(detail),
    }))
    expect(report.findings).not.toContainEqual(expect.objectContaining({
      code: 'LEGION_PACKAGE_UNPUBLISHED',
    }))
    expect(report.findings.some(item => item.classification === 'upstream-publish-gap')).toBe(false)
  })

  it('emits a typed non-applicable artifact without acquiring registry evidence', () => {
    withTempDir('legion-preflight-not-applicable-', (dir) => {
      const output = join(dir, 'report.json')
      const result = preflight([
        '--non-applicable', 'source-tarball',
        '--output', output,
        '--json',
      ])
      expect(result.status).toBe(0)
      const report = JSON.parse(result.stdout) as Record<string, unknown>
      expect(report).toEqual({
        schemaVersion: 'dsh-legion-dependency-preflight-v1',
        status: 'not-applicable',
        reason: 'source-tarball',
        registryResolution: false,
      })
      expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual(report)
    })
  })

  it('separates a registry it cannot reach from a package the registry does not publish', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end('{"error":"boom"}')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const port = (server.address() as AddressInfo).port
      const result = await preflightAsync([
        '--policy', fixture('host-line.policy.json'),
        '--registry', `http://127.0.0.1:${String(port)}`,
        ...fixtureManifestArgs,
      ])
      expect(result.status).toBe(3)
      expect(result.stdout).toContain('dependency preflight: acquisition-failure')
      expect(result.stdout).toContain('could not query')
      expect(result.stdout).not.toContain('LEGION_PACKAGE_UNPUBLISHED')
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close(error => (error === undefined ? resolve() : reject(error)))
      })
    }
  })

  it('writes typed acquisition failure before the overall live deadline expires', async () => {
    const server = createServer(() => {})
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const port = (server.address() as AddressInfo).port
      await withTempDirAsync('legion-preflight-deadline-', async (dir) => {
        const output = join(dir, 'report.json')
        const result = await preflightAsync([
          '--policy', fixture('host-line.policy.json'),
          '--registry', `http://127.0.0.1:${String(port)}`,
          '--output', output,
          '--json',
          ...fixtureManifestArgs,
        ], { LEGION_PREFLIGHT_ACQUISITION_TIMEOUT_MS: '100' })
        expect(result.status).toBe(3)
        const report = JSON.parse(result.stdout) as { status: string; error: string }
        expect(report).toMatchObject({
          status: 'acquisition-failure',
          error: expect.stringContaining('live registry acquisition deadline exceeded after 100ms'),
        })
        expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual(report)
        expect(result.stdout).not.toContain('LEGION_PACKAGE_UNPUBLISHED')
      })
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close(error => (error === undefined ? resolve() : reject(error)))
      })
    }
  })

  it('records what it queried so a live gap can be replayed offline', async () => {
    const packuments: Record<string, unknown> = {
      '@deepseek-ai/dsh-agent': {
        'dist-tags': { latest: '0.1.1-rc.1' },
        versions: {
          '0.1.0-rc.6': { peerDependencies: { '@deepseek-ai/dsh-invariants': '0.1.0-rc.6', '@deepseek-ai/dsh-typert-protocol': '0.1.0-rc.6' } },
          // Discovered one hop out: a sibling the declared closure never names.
          '0.1.1-rc.1': { peerDependencies: { '@deepseek-ai/dsh-invariants': '0.1.1-rc.1', '@deepseek-ai/dsh-typert-protocol': '0.1.1-rc.1', '@deepseek-ai/dsh-brand': '^0.1.1' } },
        },
      },
      '@deepseek-ai/dsh-invariants': {
        'dist-tags': { latest: '0.1.1-rc.1' },
        versions: { '0.1.0-rc.6': {}, '0.1.1-rc.1': {} },
      },
      '@deepseek-ai/dsh-typert-protocol': {
        'dist-tags': { latest: '0.1.1-rc.1' },
        versions: { '0.1.0-rc.6': {}, '0.1.1-rc.1': {} },
      },
      '@deepseek-ai/dsh-brand': {
        'dist-tags': { latest: '0.1.0-rc.6' },
        versions: { '0.1.0-rc.6': {}, '0.1.1-rc.1': {} },
      },
    }
    const server = createServer((request, response) => {
      const name = decodeURIComponent((request.url ?? '').replace(/^\//, ''))
      const packument = packuments[name]
      response.writeHead(packument === undefined ? 404 : 200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(packument ?? { error: 'Not found' }))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const port = (server.address() as AddressInfo).port
      await withTempDirAsync('legion-preflight-record-', async (dir) => {
        const recorded = join(dir, 'recorded.json')
        const live = await preflightAsync([
          '--policy', fixture('host-line.policy.json'),
          '--registry', `http://127.0.0.1:${String(port)}`,
          '--record', recorded,
          ...fixtureManifestArgs,
        ])
        // dsh-agent at the latest-tested line requires a sibling range that the
        // served registry cannot satisfy, exactly as the packed install found.
        expect(live.status).toBe(1)
        expect(live.stdout).toContain('requires @deepseek-ai/dsh-brand@^0.1.1')
        const snapshot = JSON.parse(readFileSync(recorded, 'utf8')) as {
          schemaVersion: string
          source: string
          packages: Record<string, { versions: string[] }>
        }
        expect(snapshot.schemaVersion).toBe('dsh-legion-registry-snapshot-v1')
        expect(snapshot.source).toBe('live')
        expect(Object.keys(snapshot.packages)).toContain('@deepseek-ai/dsh-brand')
        const replayed = await preflightAsync([
          '--policy', fixture('host-line.policy.json'),
          '--snapshot', recorded,
          ...fixtureManifestArgs,
        ])
        expect(replayed.status).toBe(1)
        expect(replayed.stdout).toContain('requires @deepseek-ai/dsh-brand@^0.1.1')
      })
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close(error => (error === undefined ? resolve() : reject(error)))
      })
    }
  })

  it('does not report drift when a common generation has incomplete manifest evidence', () => {
    const result = fixturePreflight([
      '--policy', fixture('host-line.policy.json'),
      '--snapshot', fixture('incomplete-common-generation.snapshot.json'),
    ])
    expect(result.status).toBe(3)
    expect(result.stdout).toContain('dependency preflight: incomplete-evidence')
    expect(result.stdout).toContain('LEGION_REGISTRY_COVERAGE_INCOMPLETE')
    expect(result.stdout).not.toContain('LEGION_HOST_LINE_DRIFT')
    expect(result.stdout).toContain('host line drift: unknown')
  })

  it('uses a successful full resolution walk to classify common generations', () => {
    const behind = fixturePreflight([
      '--policy', fixture('host-line.policy.json'),
      '--snapshot', fixture('satisfiable.snapshot.json'),
    ])
    expect(behind.status).toBe(0)
    expect(behind.stdout).toContain('LEGION_HOST_LINE_DRIFT')
    expect(behind.stdout).toContain('host line drift: behind')
    expect(behind.stdout).toContain('highest resolvable 0.1.1-rc.2')

    withTempDir('legion-preflight-current-', (dir) => {
      const policy = {
        ...JSON.parse(readFileSync(fixture('host-line.policy.json'), 'utf8')) as CompatibilityPolicy,
        latestTestedDshVersion: '0.1.1-rc.2',
        assessedDshVersions: ['0.1.0-rc.6', '0.1.1-rc.1', '0.1.1-rc.2'],
      }
      const policyPath = join(dir, 'policy.json')
      writeFileSync(policyPath, JSON.stringify(policy))
      const current = fixturePreflight([
        '--policy', policyPath,
        '--snapshot', fixture('satisfiable.snapshot.json'),
      ])
      expect(current.status).toBe(0)
      expect(current.stdout).toContain('host line drift: current')
      expect(current.stdout).not.toContain('LEGION_HOST_LINE_DRIFT')
    })
  })

  it('does not call a shared version resolvable when its dependency walk fails', () => {
    const result = fixturePreflight([
      '--policy', fixture('host-line.policy.json'),
      '--snapshot', fixture('split-generation.snapshot.json'),
      '--json',
    ])
    expect(result.status).toBe(1)
    const report = JSON.parse(result.stdout) as {
      drift: { highestResolvable: string | null }
      findings: Array<{ code: string; range?: string }>
    }
    expect(report.drift.highestResolvable).toBe('0.1.1-rc.1')
    expect(report.findings).toContainEqual(expect.objectContaining({
      code: 'LEGION_REQUIRED_RANGE_UNSATISFIABLE',
      range: '^0.1.2',
    }))
  })

  it('rejects every direct DSH manifest field omitted from the registry-install closure', () => {
    withTempDir('legion-preflight-manifests-', (dir) => {
      const packages = {
        dependencies: '@deepseek-ai/dsh-direct',
        peerDependencies: '@deepseek-ai/dsh-peer',
        peerDependenciesMeta: '@deepseek-ai/dsh-optional-peer',
        devDependencies: '@deepseek-ai/dsh-dev',
      } as const
      const rootManifestPath = join(dir, 'root.package.json')
      const companionManifestPath = join(dir, 'companion.package.json')
      writeFileSync(rootManifestPath, JSON.stringify({
        name: 'preflight-root-fixture',
        dependencies: { [packages.dependencies]: '0.1.1-rc.1' },
        peerDependencies: { [packages.peerDependenciesMeta]: '>=0.1.0-rc.6 <0.2.0' },
        peerDependenciesMeta: { [packages.peerDependenciesMeta]: { optional: true } },
      }))
      writeFileSync(companionManifestPath, JSON.stringify({
        name: 'preflight-companion-fixture',
        peerDependencies: { [packages.peerDependencies]: '>=0.1.0-rc.6 <0.2.0' },
        devDependencies: { [packages.devDependencies]: '0.1.1-rc.1' },
      }))
      const owners = {
        dependencies: rootManifestPath,
        peerDependencies: companionManifestPath,
        peerDependenciesMeta: rootManifestPath,
        devDependencies: companionManifestPath,
      }
      const all = Object.values(packages).map(name => name.slice('@deepseek-ai/'.length))
      const policy = { ...POLICY, registryInstallPackageClosure: all, dshPackageClosure: all }
      const snapshot = satisfyingSnapshot(policy)
      const snapshotPath = join(dir, 'snapshot.json')
      writeFileSync(snapshotPath, JSON.stringify(snapshot))
      for (const [field, name] of Object.entries(packages)) {
        const policyPath = join(dir, `${field}.policy.json`)
        writeFileSync(policyPath, JSON.stringify({
          ...policy,
          registryInstallPackageClosure: all.filter(item => item !== name.slice('@deepseek-ai/'.length)),
        }))
        const result = preflight([
          '--policy', policyPath,
          '--snapshot', snapshotPath,
          '--manifest', rootManifestPath,
          '--manifest', companionManifestPath,
          '--json',
        ])
        expect(result.status, field).toBe(2)
        const report = JSON.parse(result.stdout) as {
          findings: Array<{ code: string; importer?: string; manifestField?: string; package?: string }>
        }
        expect(report.findings, field).toContainEqual(expect.objectContaining({
          code: 'LEGION_REGISTRY_INSTALL_CLOSURE_INCOMPLETE',
          importer: owners[field as keyof typeof owners],
          manifestField: field,
          package: name,
        }))
      }
    })
  })

  it('makes an install-free preflight job dominate every registry-backed workflow job', () => {
    interface WorkflowJob {
      needs?: string | string[]
      steps?: Array<{ if?: string; run?: string; uses?: string; with?: { path?: string } }>
    }
    interface Workflow { jobs: Record<string, WorkflowJob> }
    const workflow = (name: string) => load(
      readFileSync(join(ROOT, '.github/workflows', name), 'utf8'),
    ) as Workflow
    const dependencies = (job: WorkflowJob) => job.needs === undefined
      ? []
      : Array.isArray(job.needs) ? job.needs : [job.needs]
    const dependsOn = (jobs: Record<string, WorkflowJob>, jobName: string, target: string): boolean => {
      const direct = dependencies(jobs[jobName]!)
      return direct.includes(target) || direct.some(name => dependsOn(jobs, name, target))
    }
    const runs = (job: WorkflowJob) => (job.steps ?? []).map(step => step.run ?? '').join('\n')
    const registryWork = /pnpm(?:\s+--dir\s+\S+)?\s+install|test:profile-install|test:packed-delegation/u

    for (const [name, expectedJobs] of [
      ['quality-gates.yml', ['quality', 'compatibility']],
      ['compatibility-canary.yml', ['rolling-compatible']],
      ['release.yml', ['pack']],
    ] as const) {
      const parsed = workflow(name)
      const discovered = Object.entries(parsed.jobs)
        .filter(([, job]) => registryWork.test(runs(job)))
        .map(([jobName]) => jobName)
      expect(discovered, name).toEqual(expectedJobs)
      for (const jobName of discovered) {
        expect(dependsOn(parsed.jobs, jobName, 'dependency-preflight'), `${name}:${jobName}`).toBe(true)
      }
      const preflight = parsed.jobs['dependency-preflight']!
      expect(runs(preflight), name).toContain('node scripts/verify-dependency-preflight.mjs')
      expect(runs(preflight), name).not.toMatch(/pnpm\s+install/u)
      expect(preflight.steps?.some(step => step.uses?.startsWith('pnpm/action-setup@')), name).toBe(false)
      expect(preflight.steps?.some(step =>
        step.uses?.startsWith('actions/upload-artifact@')
        && step.with?.path?.includes('dependency-preflight-report.json')), name).toBe(true)
    }

    const ci = workflow('ci.yml')
    const sourcePreflight = ci.jobs['dependency-preflight']!
    expect(dependsOn(ci.jobs, 'dsh-source', 'dependency-preflight')).toBe(true)
    expect(runs(sourcePreflight)).toContain('--non-applicable source-tarball')
    expect(runs(sourcePreflight)).not.toMatch(/pnpm\s+install/u)
    expect(sourcePreflight.steps?.some(step =>
      step.uses?.startsWith('actions/upload-artifact@')
      && step.with?.path?.includes('dependency-preflight-report.json'))).toBe(true)
    expect(runs(ci.jobs['dsh-source']!)).toContain('pnpm --dir deepseek-harness install')
    const qualityPreflight = runs(workflow('quality-gates.yml').jobs['dependency-preflight']!)
    expect(qualityPreflight).not.toContain('--non-applicable')
    expect(qualityPreflight).toContain('--record dependency-preflight-snapshot.json')
  })
})
