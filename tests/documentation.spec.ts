import { describe, expect, it } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const RETIRED_NOUN = /\b(?:profile|profiles|team|teams)\b/gi
const DOCUMENT_EXTENSIONS = new Set(['.json', '.md', '.yaml', '.yml'])
const HISTORICAL_DOC_PREFIXES = [
  'docs/design/',
  'docs/notes/',
  'docs/research/',
]
const HISTORICAL_DOCS = new Set([
  'CHANGELOG.md',
  'docs/adr/0022-legion-nouns-do-not-reuse-host-vocabulary.md',
  'docs/legion-v2-plan.md',
])
const MACHINE_DOC_PREFIXES = [
  '.github/',
  'benchmarks/',
  'contracts/',
  'tests/fixtures/',
]
const MACHINE_DOCS = new Set([
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
])
const CURRENT_YAML_PREFIXES = ['examples/', 'presets/']
const CURRENT_YAML_DOCS = new Set(['cordis.patch.yml'])
const RENAMED_ADRS = [
  'docs/adr/0001-semantic-profile-router.md',
  'docs/adr/0002-effective-profile-compiler.md',
  'docs/adr/0003-customization-first-defaults-as-data.md',
  'docs/adr/0004-type-driven-contracts.md',
  'docs/adr/0006-confined-prompt-resource-snapshots.md',
  'docs/adr/0007-pre-start-exact-route-plans.md',
  'docs/adr/0008-versioned-config-and-rollback.md',
  'docs/adr/0010-declarative-team-strategy-ir.md',
  'docs/adr/0012-model-strategy-exposure-is-explicit-authority.md',
  'docs/adr/0013-aggregate-budgets-require-host-admission-authority.md',
  'docs/adr/0014-v1-deep-modules-own-lifecycle-and-publication.md',
  'docs/adr/0015-journal-native-durable-strategy-runs.md',
  'docs/adr/0016-evolving-dag-and-validated-plan-deltas.md',
  'docs/adr/0018-ordered-context-manifests-and-cache-stable-arenas.md',
  'docs/adr/0020-host-coordination-and-admission-authority.md',
  'docs/adr/0021-optional-host-settings-as-a-configuration-source.md',
  'docs/adr/0022-host-plane-settings-row.md',
]

function nameOf(path: string): string {
  return relative(ROOT, path).replaceAll('\\', '/')
}

async function repositoryDocuments(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      if (['.git', '.tmp', 'coverage', 'lib', 'node_modules'].includes(entry.name)) return []
      return repositoryDocuments(path)
    }
    return entry.isFile() && DOCUMENT_EXTENSIONS.has(extname(entry.name).toLowerCase()) ? [path] : []
  }))
  return files.flat()
}

function historicalMarkdown(name: string): boolean {
  return HISTORICAL_DOCS.has(name)
    || HISTORICAL_DOC_PREFIXES.some(prefix => name.startsWith(prefix))
}

function currentMarkdown(path: string): boolean {
  const name = nameOf(path)
  return name.endsWith('.md') && !historicalMarkdown(name)
}

function currentYaml(path: string): boolean {
  const name = nameOf(path)
  return CURRENT_YAML_DOCS.has(name)
    || CURRENT_YAML_PREFIXES.some(prefix => name.startsWith(prefix))
}

function machineDocument(name: string): boolean {
  return MACHINE_DOCS.has(name)
    || MACHINE_DOC_PREFIXES.some(prefix => name.startsWith(prefix))
}

function proseViolations(name: string, source: string): string[] {
  let fenced = false
  const violations: string[] = []
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    if (/^\s*(?:~~~|\x60{3})/.test(rawLine)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    if (name === 'CONTEXT.md' && rawLine.startsWith('_Avoid_:')) continue
    const line = rawLine
      .replace(/\]\([^)]*\)/g, ']')
      .replace(/(?:href|src)="[^"]*"/g, '')
      .replace(/\x60[^\x60]*\x60/g, '')
      .replace(/https?:\/\/\S+/g, '')
    for (const match of line.matchAll(RETIRED_NOUN)) {
      violations.push(name + ':' + (index + 1) + ': ' + match[0] + ': ' + rawLine.trim())
    }
  }
  return violations
}

describe('repository vocabulary', () => {
  it('classifies every repository document as current prose or explicitly allowed machine/history data', async () => {
    const unclassified = (await repositoryDocuments(ROOT)).filter((path) => {
      const name = nameOf(path)
      const extension = extname(name).toLowerCase()
      if (extension === '.md') return !currentMarkdown(path) && !historicalMarkdown(name)
      if (extension === '.yaml' || extension === '.yml') return !currentYaml(path) && !machineDocument(name)
      if (extension === '.json') return name !== 'package.json' && !machineDocument(name)
      return true
    }).map(nameOf)

    expect(unclassified).toEqual([])
  })

  it('uses Specialist and Cohort in current prose', async () => {
    const files = (await repositoryDocuments(ROOT)).filter(currentMarkdown)
    const violations = (await Promise.all(files.map(async (path) => {
      return proseViolations(nameOf(path), await readFile(path, 'utf8'))
    }))).flat()

    expect(violations).toEqual([])
  })

  it('marks decision records whose original vocabulary was renamed', async () => {
    const missing = await Promise.all(RENAMED_ADRS.map(async (name) => {
      const source = await readFile(resolve(ROOT, name), 'utf8')
      return source.includes('Terminology: ADR 0022') ? undefined : name
    }))
    expect(missing.filter(Boolean)).toEqual([])
  })

  it('ships current Config Document namespace spellings', async () => {
    const yaml = (await repositoryDocuments(ROOT)).filter(currentYaml)
    const files = [resolve(ROOT, 'README.md'), resolve(ROOT, 'README.zh-cn.md'), ...yaml]
    const violations = (await Promise.all(files.map(async (path) => {
      const name = nameOf(path)
      const source = await readFile(path, 'utf8')
      return source.split(/\r?\n/)
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => /^\s*(?:profiles|teams):/.test(line))
        .map(({ line, index }) => name + ':' + (index + 1) + ':' + line.trim())
    }))).flat()
    expect(violations).toEqual([])
  })

  it('uses current nouns in shipped YAML prose', async () => {
    const files = (await repositoryDocuments(ROOT)).filter(currentYaml)
    const violations = (await Promise.all(files.map(async (path) => {
      const name = nameOf(path)
      const source = await readFile(path, 'utf8')
      const prose = name.endsWith('preset.yml')
        ? source
        : source.split(/\r?\n/).map(line => /^\s*#/.test(line) ? line : '').join('\n')
      return proseViolations(name, prose)
    }))).flat()
    expect(violations).toEqual([])
  })

  it('uses current nouns in package metadata', async () => {
    const manifest = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8')) as { description?: string }
    expect(manifest.description).not.toMatch(RETIRED_NOUN)
  })
})
