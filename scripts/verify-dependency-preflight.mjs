#!/usr/bin/env node
// Dependency-availability preflight gate.
//
// Reads the declared Host package closure and version lines from the
// compatibility policy contract, resolves each declared package against a
// registry, and reports any gap by naming the package, the unsatisfiable
// range, and what the registry actually publishes. It classifies the outcome
// as an upstream publish gap or as a local regression so a red branch cannot
// misattribute blame, and it is meant to run ahead of the packed profile
// install, where the same condition costs minutes and arrives as a raw
// package-manager error.
//
// Usage:
//   node scripts/verify-dependency-preflight.mjs [options]
//     --policy <path>     compatibility policy contract (default contracts/compatibility.json)
//     --snapshot <path>   evaluate a recorded registry snapshot instead of the network
//     --registry <url>    registry to query live (default project .npmrc)
//     --record <path>     write the queried snapshot for later offline replay
//     --json              print the report as JSON instead of text
//
// Exit codes: 0 satisfied, 1 upstream publish gap, 2 local regression,
// 3 the evidence could not be established (registry unreachable, unreadable
// input, or a declared package the snapshot does not record). An unreachable
// registry is never reported as an unpublished package.

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveNpmRegistry } from './registry-config.mjs'
import {
  DSH_SCOPE,
  REGISTRY_SNAPSHOT_SCHEMA_VERSION,
  evaluateDependencyPreflight,
  renderDependencyPreflightReport,
} from './dependency-preflight.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`--${name} requires a value`)
  return value
}
const policyPath = resolve(option('policy', resolve(root, 'contracts/compatibility.json')))
const snapshotPath = option('snapshot', undefined)
const recordPath = option('record', undefined)
const registryUrl = resolveNpmRegistry(root, option('registry', undefined))
const asJson = argv.includes('--json')

const scopedDependencies = (value) => Object.fromEntries(
  Object.entries(typeof value === 'object' && value !== null ? value : {})
    .filter(([name]) => name.startsWith(`${DSH_SCOPE}/dsh-`)),
)

const fetchPackument = async (name) => {
  const url = `${registryUrl}/${name.replace('/', '%2f')}`
  let lastError
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/vnd.npm.install-v1+json' },
        signal: AbortSignal.timeout(30_000),
      })
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`registry answered ${String(response.status)}`)
      return await response.json()
    } catch (error) {
      lastError = error
    }
  }
  // A registry that cannot be reached is a gate failure, never a publish gap:
  // reporting an unreachable registry as an unpublished package would be the
  // same misattribution this preflight exists to prevent.
  throw new Error(`could not query ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

const recordLiveSnapshot = async (packages) => {
  const recorded = {}
  const queued = new Set(packages)
  const pending = [...packages]
  while (pending.length > 0) {
    const batch = pending.splice(0, 8)
    const answers = await Promise.all(batch.map(async name => [name, await fetchPackument(name)]))
    for (const [name, packument] of answers) {
      const versions = Object.keys(packument?.versions ?? {})
      // Every version's requirements are recorded, because the resolution walk
      // follows ranges to whatever version satisfies them: the gap that broke
      // the packed install sat on a version no declaration names, reached from
      // one that does.
      const manifests = {}
      for (const line of versions) {
        const manifest = packument?.versions?.[line]
        if (manifest === undefined || manifest === null) continue
        const dependencies = scopedDependencies(manifest.dependencies)
        const peerDependencies = scopedDependencies(manifest.peerDependencies)
        const peerDependenciesMeta = Object.fromEntries(
          Object.entries(scopedDependencies(manifest.peerDependenciesMeta))
            .filter(([, meta]) => typeof meta === 'object' && meta !== null),
        )
        manifests[line] = { dependencies, peerDependencies, peerDependenciesMeta }
        for (const target of [...Object.keys(dependencies), ...Object.keys(peerDependencies)]) {
          if (queued.has(target)) continue
          queued.add(target)
          pending.push(target)
        }
      }
      recorded[name] = {
        versions,
        distTags: packument?.['dist-tags'] ?? {},
        manifests,
      }
    }
  }
  return {
    schemaVersion: REGISTRY_SNAPSHOT_SCHEMA_VERSION,
    registry: registryUrl,
    source: 'live',
    recordedAt: new Date().toISOString(),
    packages: Object.fromEntries(Object.keys(recorded).sort().map(name => [name, recorded[name]])),
  }
}

const loadSnapshot = async (path) => {
  const value = JSON.parse(await readFile(resolve(path), 'utf8'))
  if (value?.schemaVersion !== REGISTRY_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(`${path} is not a ${REGISTRY_SNAPSHOT_SCHEMA_VERSION} document`)
  }
  return value
}

// Reading the contract, reaching the registry, and writing the recording are
// acquisition, not evidence. Failing any of them means the preflight reached no
// verdict at all, which must not be reported as either a gap or a pass.
let acquired
try {
  const policy = JSON.parse(await readFile(policyPath, 'utf8'))
  const closure = Array.isArray(policy?.dshPackageClosure) ? policy.dshPackageClosure : []
  const snapshot = snapshotPath === undefined
    ? await recordLiveSnapshot(closure.map(name => `${DSH_SCOPE}/${name}`))
    : await loadSnapshot(snapshotPath)
  if (recordPath !== undefined) {
    await writeFile(resolve(recordPath), `${JSON.stringify(snapshot, null, 2)}\n`)
  }
  acquired = { policy, snapshot }
} catch (error) {
  process.stdout.write([
    'dependency preflight: acquisition-failure',
    `  ${error instanceof Error ? error.message : String(error)}`,
    'verdict: the preflight established no evidence, so it reports neither a publish gap'
      + ' nor a passing line. Fix the input or the registry connection and run it again.',
    '',
  ].join('\n'))
  process.exitCode = 3
}

if (acquired !== undefined) {
  const report = evaluateDependencyPreflight(acquired)
  process.stdout.write(asJson
    ? `${JSON.stringify(report, null, 2)}\n`
    : renderDependencyPreflightReport(report))
  process.exitCode = report.status === 'satisfied'
    ? 0
    : report.status === 'upstream-publish-gap'
      ? 1
      : report.status === 'local-regression' ? 2 : 3
}
