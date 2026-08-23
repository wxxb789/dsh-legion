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

/**
 * The loopback registry serves from this process, so the child must run
 * asynchronously: a synchronous spawn would block the very event loop that has
 * to answer its requests.
 */
const preflightAsync = (args: string[]) => new Promise<{ status: number | null; stdout: string }>(
  (resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/verify-dependency-preflight.mjs', ...args], {
      cwd: ROOT,
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
  const scoped = policy.dshPackageClosure.map(name => `@deepseek-ai/${name}`)
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
    const result = preflight([
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
    const result = preflight([
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
    const result = preflight([
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
    const result = preflight([
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
    const result = preflight([
      '--policy', fixture('contradictory.policy.json'),
      '--snapshot', fixture('prerelease-only-sibling.snapshot.json'),
    ])
    expect(result.status).toBe(2)
    expect(result.stdout).toContain('dependency preflight: local-regression')
    expect(result.stdout).toContain('LEGION_DECLARED_LINE_OUTSIDE_PEER_RANGE')
    expect(result.stdout).toContain('local regression in this repository, not an upstream publish gap')
  })

  it('detects drift when the registry has moved past the declared latest-tested line', () => {
    const result = preflight([
      '--policy', fixture('host-line.policy.json'),
      '--snapshot', fixture('newer-line-published.snapshot.json'),
    ])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('dependency preflight: satisfied')
    expect(result.stdout).toContain('LEGION_HOST_LINE_DRIFT')
    expect(result.stdout).toContain('host line drift: behind')
    expect(result.stdout).toContain('0.1.1-rc.2 is resolvable across the declared closure')
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
      expect(result.stdout).toContain(`declared closure: ${POLICY.dshPackageClosure.length} packages`)
      expect(result.stdout).toContain('host line drift: current')
    })
  })

  it('resolves the closure the contract declares rather than a list of its own', () => {
    withTempDir('legion-preflight-closure-', (dir) => {
      const policy = { ...POLICY, dshPackageClosure: [...POLICY.dshPackageClosure, 'dsh-not-published'] }
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
      const result = preflight(['--policy', policyPath, '--snapshot', snapshotPath])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('LEGION_PACKAGE_UNPUBLISHED @deepseek-ai/dsh-not-published')
    })
  })

  it('reports a declared package the snapshot never recorded as missing evidence, not as a pass', () => {
    withTempDir('legion-preflight-evidence-', (dir) => {
      const policy = { ...POLICY, dshPackageClosure: [...POLICY.dshPackageClosure, 'dsh-never-queried'] }
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

  it('runs in the gate ahead of the packed profile install', () => {
    const steps = (path: string, job: string) => {
      const workflow = load(readFileSync(join(ROOT, path), 'utf8')) as {
        jobs: Record<string, { steps: Array<{ run?: string }> }>
      }
      return workflow.jobs[job]!.steps.map(step => step.run ?? '')
    }
    const preflightStep = 'pnpm run verify:dependency-preflight'
    const quality = steps('.github/workflows/quality-gates.yml', 'quality')
    expect(quality.findIndex(step => step.includes(preflightStep))).toBeGreaterThan(-1)
    expect(quality.findIndex(step => step.includes(preflightStep)))
      .toBeLessThan(quality.findIndex(step => step.includes('pnpm run test:profile-install')))
    // The rolling canary resolves the highest Host the peer range admits, so it
    // is the gate where drift and a fresh publish gap show up first.
    const canary = steps('.github/workflows/compatibility-canary.yml', 'rolling-compatible')
    expect(canary.findIndex(step => step.includes(preflightStep))).toBeGreaterThan(-1)
    expect(canary.findIndex(step => step.includes(preflightStep)))
      .toBeLessThan(canary.findIndex(step => step.includes('pnpm run test:packed-delegation')))
  })
})
