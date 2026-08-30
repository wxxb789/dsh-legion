import { describe, expect, it } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const RETIRED_NOUN = /\b(?:profile|profiles|team|teams)\b/gi
const DOCUMENT_EXTENSIONS = new Set(['.json', '.md', '.yaml', '.yml'])
const HISTORICAL_DOC_ALLOWLIST = [
  { prefix: 'docs/design/', reason: 'Superseded design records retain the vocabulary they evaluated.' },
  { prefix: 'docs/notes/', reason: 'Versioned source audits quote historical Host and Legion contracts.' },
  { prefix: 'docs/plans/', reason: 'Accepted implementation plans are immutable decision history.' },
  { prefix: 'docs/research/', reason: 'Research records quote compared projects and pre-ADR terminology.' },
] as const
const HISTORICAL_DOCS = new Map([
  ['docs/adr/0022-legion-nouns-do-not-reuse-host-vocabulary.md', 'The naming ADR must quote the retired nouns it replaces.'],
  ['docs/legion-v2-plan.md', 'The accepted comparison plan quotes retired Legion and Host competitor vocabulary.'],
])
const MACHINE_DOC_ALLOWLIST = [
  { prefix: '.github/', reason: 'Workflow and issue metadata are machine contracts, not current product prose.' },
  { prefix: 'benchmarks/', reason: 'Frozen evidence fixtures retain versioned field names.' },
  { prefix: 'contracts/', reason: 'Published machine contracts retain explicit compatibility fields.' },
  { prefix: 'tests/fixtures/', reason: 'Frozen compatibility fixtures preserve historical wire bytes.' },
] as const
const MACHINE_DOCS = new Map([
  ['pnpm-lock.yaml', 'Package-manager state is generated machine data.'],
  ['pnpm-workspace.yaml', 'Workspace composition is machine data.'],
  ['tsconfig.json', 'TypeScript project metadata is machine data.'],
])
const CURRENT_YAML_PREFIXES = ['examples/', 'presets/']
const CURRENT_YAML_DOCS = new Set(['cordis.patch.yml'])
const PUBLIC_VOCABULARY_SOURCE = [
  'src/index.ts',
  'src/compiler.ts',
  'src/orchestration.ts',
  'src/explain.ts',
  'src/execution.ts',
  'src/prompt.ts',
  'src/client/index.ts',
  'src/client/LegionCard.ts',
  'src/client/locales.ts',
] as const
const PROSE_COMPATIBILITY_ALLOWLIST = [
  {
    path: 'CHANGELOG.md',
    match: /packed profile install/u,
    reason: 'This names the DSH launcher-profile installation gate, not a Legion domain concept.',
  },
  {
    path: 'CHANGELOG.md',
    match: /Agent Teams packages/u,
    reason: 'This names the Host-owned Agent Teams package family assessed in that release note.',
  },
] as const
const SOURCE_COMPATIBILITY_ALLOWLIST = [
  {
    path: 'src/index.ts',
    match: /input\.profile|deprecated profile|profile must be|value\.profile|profile: plan\.specialist|['"]profile['"]/u,
    reason: 'The hidden 1.x request parser and published direct-result field remain compatible.',
  },
  {
    path: 'src/compiler.ts',
    match: /Legacy|deprecated profile|source\.profile|invocation\.profile|['"]profile['"]/u,
    reason: 'The public compiler accepts the non-advertised 1.x invocation alias and preserves V1 diagnostics.',
  },
  {
    path: 'src/orchestration.ts',
    match: /defineProperty\([^\n]*['"](?:profile|team)['"]/u,
    reason: 'Non-enumerable and digest-only fields preserve durable V1 compiled-plan bytes.',
  },
  {
    path: 'src/explain.ts',
    match: /ProfileExplainView|active-profile|inactive-profile|configuredDefaultProfile|activeDefaultProfile|profiles|diagnostic\.profile|['"]profile['"]/u,
    reason: 'ExplainViewV1 is a versioned wire contract and cannot be renamed in place.',
  },
  {
    path: 'src/execution.ts',
    match: /team-run-/u,
    reason: 'CohortRunId retains the published 1.x identity prefix.',
  },
] as const
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
  'docs/adr/0023-host-plane-settings-row.md',
]
const U10_ACCEPTANCE_EVIDENCE = [
  {
    id: 'AE1',
    command: 'pnpm run test:composition',
    files: [
      ['tests/run-receipt-telemetry.spec.ts', 'publishes the complete frozen graph before the first child starts without a Session event'],
      ['tests/loader-smoke.spec.ts', "from '@deepseek-ai/dsh-loader-smoke'"],
      ['tests/fixtures/loader-smoke-driver.mjs', "from '@deepseek-ai/dsh-llm-replay'"],
    ],
  },
  {
    id: 'AE2',
    command: 'pnpm run test:unit',
    files: [
      ['packages/run-receipt-feed/tests/client-overlay.spec.ts', 'recreates the Client plugin generation and recovers the same active Host baseline'],
      ['tests/run-receipt-telemetry.spec.ts', 'reuses unchanged token evidence across status edges and recovers from capability loss'],
    ],
  },
  {
    id: 'AE3',
    command: 'pnpm run test:unit',
    files: [['tests/run-receipt-telemetry.spec.ts', 'binds remote lifecycle start and end that both arrive before the returned run is observed']],
  },
  {
    id: 'AE4',
    command: 'pnpm run test:unit',
    files: [['tests/run-receipt-telemetry.spec.ts', 'accounts only post-seed complete retry attempts plus reported compaction usage']],
  },
  {
    id: 'AE5',
    command: 'pnpm run test:unit',
    files: [
      ['packages/run-receipt-feed/tests/host-feed.spec.ts', 'retains all active Receipts plus the latest terminal and direct-clear removes only terminal'],
      ['packages/run-receipt-feed/tests/client-overlay.spec.ts', 'selects concurrent runs deterministically, retains a valid selection'],
      ['tests/run-receipt-telemetry.spec.ts', 'keeps interleaved Strategy and direct starts isolated by returned child identity'],
    ],
  },
  {
    id: 'AE6',
    command: 'pnpm run test:packed-delegation',
    files: [
      ['scripts/packed-delegation-consumer.mjs', "receipt.feed?.status !== 'unavailable'"],
      ['scripts/verify-packed-delegation.mjs', "join(projectRoot, 'tests', 'fixtures', 'packed-legacy-consumer.ts')"],
    ],
  },
  {
    id: 'AE7',
    command: 'pnpm run test:packed-delegation',
    files: [
      ['tests/config-version.spec.ts', 'materializes the current v3 top-level and nested dialect without warnings'],
      ['tests/fixtures/packed-legacy-consumer.ts', 'materializeConfigWithDiagnostics'],
    ],
  },
  {
    id: 'AE8',
    command: 'pnpm run test:unit',
    files: [['tests/dependency-preflight.spec.ts', 'does not report drift when a common generation has incomplete manifest evidence']],
  },
  {
    id: 'AE9',
    command: 'pnpm run test:unit',
    files: [['tests/dependency-preflight.spec.ts', 'makes an install-free preflight job dominate every registry-backed workflow job']],
  },
  {
    id: 'AE10',
    command: 'pnpm run test:profile-install',
    files: [
      ['tests/loader-smoke.spec.ts', 'packed package pair through official DSH smoke seams'],
      ['packages/run-receipt-feed/tests/security.spec.ts', 'rejects sensitive canaries and never exposes their bytes'],
      ['packages/run-receipt-feed/tests/host-feed.spec.ts', 'rejects every cap explicitly without changing delegation-facing state'],
      ['tests/contract.spec.ts', 'unchangedCompatibilitySurfaces'],
    ],
  },
  {
    id: 'AE11',
    command: 'pnpm run test:unit',
    files: [['packages/run-receipt-feed/tests/client-overlay.spec.ts', "from '@deepseek-ai/dsh-client-test-runtime'"]],
  },
] as const

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

let repositoryDocumentInventoryPromise: Promise<string[]> | undefined

function repositoryDocumentInventory(): Promise<string[]> {
  return repositoryDocumentInventoryPromise ??= repositoryDocuments(ROOT).catch((error: unknown) => {
    repositoryDocumentInventoryPromise = undefined
    throw error
  })
}

function historicalMarkdown(name: string): boolean {
  return HISTORICAL_DOCS.has(name)
    || HISTORICAL_DOC_ALLOWLIST.some(entry => name.startsWith(entry.prefix))
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
    || MACHINE_DOC_ALLOWLIST.some(entry => name.startsWith(entry.prefix))
    || /(?:^|\/)tsconfig(?:\.[^/]+)?\.json$/u.test(name)
    || /(?:^|\/)package\.json$/u.test(name)
    || /(?:^|\/)pnpm-lock\.yaml$/u.test(name)
}

function proseViolations(name: string, source: string): string[] {
  let fenced = false
  const violations: string[] = []
  const lines = source.split(/\r?\n/)
  const historicalRelease = name === 'CHANGELOG.md'
    ? lines.findIndex(line => /^## \[\d/u.test(line))
    : -1
  const currentLines = historicalRelease === -1 ? lines : lines.slice(0, historicalRelease)
  for (const [index, rawLine] of currentLines.entries()) {
    if (/^\s*(?:~~~|\x60{3})/.test(rawLine)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    if (name === 'CONTEXT.md' && rawLine.startsWith('_Avoid_:')) continue
    if (PROSE_COMPATIBILITY_ALLOWLIST.some(entry =>
      entry.path === name && entry.match.test(rawLine))) continue
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

function contextDefinition(source: string, term: string): string {
  const marker = `**${term}**:`
  const start = source.indexOf(marker)
  if (start === -1) throw new Error(`missing context term: ${term}`)
  const following = source.slice(start + marker.length)
  const end = following.search(/\r?\n\*\*[^\n]+\*\*:/)
  return end === -1 ? following : following.slice(0, end)
}

function levelTwoSection(source: string, title: string): string {
  const marker = `## ${title}`
  const start = source.indexOf(marker)
  if (start === -1) throw new Error(`missing level-two section: ${title}`)
  const following = source.slice(start + marker.length)
  const end = following.search(/\r?\n## /)
  return end === -1 ? following : following.slice(0, end)
}

describe('repository vocabulary', () => {
  it('classifies every repository document as current prose or explicitly allowed machine/history data', async () => {
    const unclassified = (await repositoryDocumentInventory()).filter((path) => {
      const name = nameOf(path)
      const extension = extname(name).toLowerCase()
      if (extension === '.md') return !currentMarkdown(path) && !historicalMarkdown(name)
      if (extension === '.yaml' || extension === '.yml') return !currentYaml(path) && !machineDocument(name)
      if (extension === '.json') return name !== 'package.json' && !machineDocument(name)
      return true
    }).map(nameOf)

    expect(unclassified).toEqual([])
  })

  it('keeps every compatibility/history classifier explicit and reasoned', () => {
    const reasons = [
      ...HISTORICAL_DOC_ALLOWLIST.map(entry => entry.reason),
      ...HISTORICAL_DOCS.values(),
      ...MACHINE_DOC_ALLOWLIST.map(entry => entry.reason),
      ...MACHINE_DOCS.values(),
      ...PROSE_COMPATIBILITY_ALLOWLIST.map(entry => entry.reason),
      ...SOURCE_COMPATIBILITY_ALLOWLIST.map(entry => entry.reason),
    ]
    expect(reasons.every(reason => reason.trim().length > 20)).toBe(true)
  })

  it('rejects stale prose compatibility allowances', async () => {
    const stale = await Promise.all(PROSE_COMPATIBILITY_ALLOWLIST.map(async (entry) => {
      const source = await readFile(resolve(ROOT, entry.path), 'utf8')
      return entry.match.test(source) ? undefined : entry.path + ': ' + entry.reason
    }))
    expect(stale.filter(Boolean)).toEqual([])
  })

  it('uses Specialist and Cohort in current prose', async () => {
    const files = (await repositoryDocumentInventory()).filter(currentMarkdown)
    const violations = (await Promise.all(files.map(async (path) => {
      return proseViolations(nameOf(path), await readFile(path, 'utf8'))
    }))).flat()

    expect(violations).toEqual([])
  })

  it('allows retired nouns in public source only for explicit compatibility contracts', async () => {
    const used = new Set<number>()
    const violations: string[] = []
    for (const name of PUBLIC_VOCABULARY_SOURCE) {
      const source = await readFile(resolve(ROOT, name), 'utf8')
      for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
        const literals = [
          ...rawLine.matchAll(/'(?:\\.|[^'\\])*'/gu),
          ...rawLine.matchAll(/"(?:\\.|[^"\\])*"/gu),
          ...rawLine.matchAll(/`(?:\\.|[^`\\])*`/gu),
        ].map(match => match[0]?.slice(1, -1) ?? '')
        const comment = /^\s*(?:\/[/\*]|\*)/u.test(rawLine) ? rawLine : ''
        const surfaceLine = [...literals, comment].join(' ').replace(/\$\{[^}]*\}/gu, '')
        RETIRED_NOUN.lastIndex = 0
        if (!RETIRED_NOUN.test(surfaceLine)) continue
        const allowance = SOURCE_COMPATIBILITY_ALLOWLIST.findIndex(entry =>
          entry.path === name && entry.match.test(rawLine))
        if (allowance === -1) violations.push(`${name}:${String(index + 1)}: ${rawLine.trim()}`)
        else used.add(allowance)
      }
    }

    expect(violations).toEqual([])
    expect(SOURCE_COMPATIBILITY_ALLOWLIST.filter((_entry, index) => !used.has(index))).toEqual([])
  })

  it('marks decision records whose original vocabulary was renamed', async () => {
    const missing = await Promise.all(RENAMED_ADRS.map(async (name) => {
      const source = await readFile(resolve(ROOT, name), 'utf8')
      return source.includes('Terminology: ADR 0022') ? undefined : name
    }))
    expect(missing.filter(Boolean)).toEqual([])
  })

  it('keeps ADR numbers unique and reserves 0022 for the nouns decision', async () => {
    const names = (await readdir(resolve(ROOT, 'docs/adr')))
      .filter(name => /^\d{4}-.+\.md$/.test(name))
      .sort()
    const numbers = names.map(name => name.slice(0, 4))
    const duplicates = [...new Set(numbers.filter((number, index) => numbers.indexOf(number) !== index))]

    expect(duplicates).toEqual([])
    expect(names.filter(name => name.startsWith('0022-'))).toEqual([
      '0022-legion-nouns-do-not-reuse-host-vocabulary.md',
    ])
    expect(names).toContain('0023-host-plane-settings-row.md')
    expect(names).toContain('0024-run-receipt-live-feed.md')
  })

  it('uses the renamed Settings ADR path and resolves every ADR 0023 link', async () => {
    const files = (await repositoryDocumentInventory()).filter((path) => {
      const name = nameOf(path)
      return name.endsWith('.md') && !name.startsWith('docs/plans/')
    })
    const stale: string[] = []
    const broken: string[] = []
    let references = 0

    await Promise.all(files.map(async (path) => {
      const name = nameOf(path)
      const source = await readFile(path, 'utf8')
      if (source.includes('0022-host-plane-settings-row.md')) stale.push(name)
      for (const match of source.matchAll(/\[ADR 0023\]\(([^)]+)\)/g)) {
        references += 1
        const target = match[1]?.split('#', 1)[0]
        if (target === undefined || !target.endsWith('0023-host-plane-settings-row.md')) {
          broken.push(`${name}: ${match[1]}`)
          continue
        }
        try {
          await readFile(resolve(dirname(path), target), 'utf8')
        }
        catch {
          broken.push(`${name}: ${target}`)
        }
      }
    }))

    expect(stale.sort()).toEqual([])
    expect(references).toBeGreaterThan(0)
    expect(broken.sort()).toEqual([])
  })

  it('documents the live Receipt companion without durable, event, or monetary claims', async () => {
    const [context, publicContract, decision] = await Promise.all([
      readFile(resolve(ROOT, 'CONTEXT.md'), 'utf8'),
      readFile(resolve(ROOT, 'docs/public-contract-v1.md'), 'utf8'),
      readFile(resolve(ROOT, 'docs/adr/0024-run-receipt-live-feed.md'), 'utf8'),
    ])
    const runReceipt = contextDefinition(context, 'Run Receipt')
    const companion = contextDefinition(context, 'Run Receipt Companion')
    const publicVocabulary = levelTwoSection(publicContract, 'Stable authored data')
    const publicReceipt = levelTwoSection(publicContract, 'Run Receipt observation')
    const canonical = [runReceipt, companion, publicReceipt, decision].join('\n')

    expect(runReceipt).toContain('live observation')
    expect(runReceipt).not.toMatch(/\b(?:durable|persistent|persisted|restart-safe)\b/i)
    expect(publicVocabulary).toContain('Specialist and Cohort are canonical')
    expect(publicVocabulary).toContain('non-advertised compatibility exceptions')
    expect(runReceipt).toContain('bounded terminal summary')
    expect(publicReceipt).toContain('`dsh-legion-receipts`')
    expect(publicReceipt).toContain('official DSH Typert/Gateway')
    expect(publicReceipt).toContain('baseline followed by complete replacements')
    expect(publicReceipt).toContain('Host restart')
    expect(publicReceipt).toContain('explicitly unavailable')
    expect(publicReceipt).toContain('no execution authority')
    expect(publicReceipt).toContain('unchanged compatibility surfaces')
    expect(decision).toContain('appends no custom Session event')
    expect(decision).toContain('writes no Receipt facts to storage')
    expect(decision).toContain('requires no DSH core change')
    expect(decision).toContain('bounded tool summary remains')
    expect(canonical).not.toContain('legion/run-receipt')
    expect(canonical).not.toMatch(/\b(?:price|cost|money|currency|monetary)\b/i)
    expect(canonical).not.toMatch(/\b(?:durable|persistent|persisted|restart-safe)\b[^\n.]{0,80}\b(?:full (?:Run )?Receipt facts?|Run Receipt|Receipt facts?)\b/i)
    expect(canonical).not.toMatch(/\b(?:full (?:Run )?Receipt facts?|Run Receipt|Receipt facts?)\b[^\n.]{0,80}\b(?:durable|persistent|persisted|restart-safe)\b/i)
    expect(canonical).not.toMatch(/\b(?:append(?:s|ed)?|publish(?:es|ed)?|deliver(?:s|ed)?|transport(?:s|ed)?|project(?:s|ed)?)\s+(?!no\b)[^\n.]{0,80}\bcustom Session event\b/i)
  })

  it('maps every U10 acceptance example to deterministic existing evidence', async () => {
    const guide = await readFile(resolve(ROOT, 'docs/run-receipts.md'), 'utf8')
    const rows = guide.split(/\r?\n/).filter(line => /^\| AE(?:[1-9]|1[01]) \|/u.test(line))
    const ids = rows.map(line => line.split('|')[1]?.trim())
    expect(ids).toEqual(U10_ACCEPTANCE_EVIDENCE.map(entry => entry.id))

    for (const entry of U10_ACCEPTANCE_EVIDENCE) {
      const row = rows.find(line => line.startsWith(`| ${entry.id} |`))
      expect(row, entry.id).toContain(`\`${entry.command}\``)
      for (const [path, marker] of entry.files) {
        expect(row, `${entry.id}:${path}`).toContain(`\`${path}\``)
        expect(await readFile(resolve(ROOT, path), 'utf8'), `${entry.id}:${path}`).toContain(marker)
      }
    }
    expect(guide).toContain('Cross-cutting R5 evidence')
    expect(await readFile(resolve(ROOT, 'tests/run-receipt-telemetry.spec.ts'), 'utf8'))
      .toContain('derives settlement from the plan without publishing child lastAssistantMessage')
  })

  it('ships only the canonical Config v3 dialect in current README and YAML examples', async () => {
    const yaml = (await repositoryDocumentInventory()).filter(currentYaml)
    const files = [resolve(ROOT, 'README.md'), resolve(ROOT, 'README.zh-cn.md'), ...yaml]
    const retiredKey = /(?:^|[{,\s])(?:profiles|defaultProfile|teams|profile|team):(?:\s|$)/u
    const violations = (await Promise.all(files.map(async (path) => {
      const name = nameOf(path)
      const source = await readFile(path, 'utf8')
      return source.split(/\r?\n/)
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => retiredKey.test(line) || /^\s*configVersion:\s*[12]\s*$/u.test(line))
        .map(({ line, index }) => name + ':' + (index + 1) + ':' + line.trim())
    }))).flat()
    expect(violations).toEqual([])
  })

  it('uses current nouns in shipped YAML prose', async () => {
    const files = (await repositoryDocumentInventory()).filter(currentYaml)
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
