import { describe, expect, it } from 'vitest'
import { EXIT_DIAGNOSTICS, EXIT_INPUT, EXIT_OK, runCli, type CliIo } from '../src/cli.ts'

function io(files: Record<string, string>): {
  io: CliIo
  stdout: string[]
  stderr: string[]
} {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    stdout,
    stderr,
    io: {
      stdout: { write: value => stdout.push(value) },
      stderr: { write: value => stderr.push(value) },
      readTextFile: async (file) => {
        const value = files[file]
        if (value === undefined) throw new Error(`missing ${file}`)
        return value
      },
    },
  }
}

const config = `
configVersion: 3
toolName: legion
defaultSpecialist: quick
enableRunInBackground: true
specialists:
  quick:
    description: Fast work.
    subagentProvider: spawn
    maxDepth: 2
    defaultRunInBackground: true
`

const retiredConfig = `
configVersion: 2
toolName: legion
defaultProfile: quick
enableRunInBackground: true
profiles:
  quick:
    description: Fast work.
    subagentProvider: spawn
    maxDepth: 2
    defaultRunInBackground: true
teams:
  workers:
    description: Workers.
    members:
      worker:
        profile: quick
strategies:
  work:
    description: Work.
    team: workers
    stages:
      - kind: delegate
        id: work
        member: worker
        inputs: [{ artifact: objective, contract: objective-v1 }]
        output: { artifact: result, contract: text }
        prompt: Work.
    completion: { artifact: result, contract: text }
    limits: { maxAgents: 1, maxConcurrent: 1, deadlineMs: 60000, maxOutputBytes: 64000 }
    memberFailure: fail
`

const providers = `
version: 1
kind: legion-provider-snapshot
providers:
  spawn:
    continuable: true
    capabilities:
      outputSchema: true
      depthLimit: true
      toolFilter: true
      persona: true
`

describe('dsh-legion CLI', () => {
  it('prints help without reading files', async () => {
    const state = io({})
    expect(await runCli(['--help'], state.io)).toBe(EXIT_OK)
    expect(state.stdout.join('')).toContain('dsh-legion doctor')
    expect(state.stderr).toEqual([])
  })

  it('renders compact doctor output from an explicit fixture', async () => {
    const state = io({ 'legion.yml': config, 'providers.yml': providers })
    const code = await runCli([
      'doctor', 'legion.yml', '--providers', 'providers.yml',
    ], state.io)

    expect(code).toBe(EXIT_OK)
    expect(state.stdout.join('')).toContain('dsh-legion doctor')
    expect(state.stdout.join('')).toContain('Provider evidence: fixture')
    expect(state.stdout.join('')).toContain('Profiles: 1 configured, 1 active, 0 inactive')
    expect(state.stdout.join('')).toContain('Result: ok')
    expect(state.stderr).toEqual([])
  })

  it('renders profile detail for explain and one clean JSON document for --json', async () => {
    const human = io({ 'legion.yml': config, 'providers.yml': providers })
    expect(await runCli(['explain', 'legion.yml', '--providers', 'providers.yml'], human.io))
      .toBe(EXIT_OK)
    expect(human.stdout.join('')).toContain('dsh-legion explain')
    expect(human.stdout.join('')).toContain('allowed modes: foreground, continuable')

    const json = io({ 'legion.yml': config, 'providers.yml': providers })
    expect(await runCli([
      'explain', 'legion.yml', '--providers', 'providers.yml', '--json',
    ], json.io)).toBe(EXIT_OK)
    expect(json.stderr).toEqual([])
    const document = JSON.parse(json.stdout.join('')) as {
      version: number
      source: { providerSnapshot: string }
      configDiagnostics?: unknown
    }
    expect(document).toMatchObject({ version: 1, source: { providerSnapshot: 'fixture' } })
    expect(document.configDiagnostics).toBeUndefined()
    expect(human.stdout.join('')).not.toContain('Config diagnostics:')
  })

  it('renders every retired Config path in human and JSON doctor output', async () => {
    const human = io({ 'legion.yml': retiredConfig, 'providers.yml': providers })
    expect(await runCli(['doctor', 'legion.yml', '--providers', 'providers.yml'], human.io))
      .toBe(EXIT_OK)
    expect(human.stderr).toEqual([])
    expect(human.stdout.join('')).toContain('Config diagnostics:')
    for (const path of [
      'config.profiles',
      'config.defaultProfile',
      'config.teams',
      'config.teams.workers.members.worker.profile',
      'config.strategies.work.team',
    ]) {
      expect(human.stdout.join('')).toContain(path)
    }
    expect(human.stdout.join('')).toContain('remove in 2.0.0')

    const json = io({ 'legion.yml': retiredConfig, 'providers.yml': providers })
    expect(await runCli([
      'doctor', 'legion.yml', '--providers', 'providers.yml', '--json',
    ], json.io)).toBe(EXIT_OK)
    expect(json.stderr).toEqual([])
    const document = JSON.parse(json.stdout.join('')) as {
      configDiagnostics: Array<{ path: string; replacement: string; removalVersion: string }>
    }
    expect(document.configDiagnostics.map(item => ({
      path: item.path,
      replacement: item.replacement,
      removalVersion: item.removalVersion,
    }))).toEqual([
      { path: 'config.profiles', replacement: 'config.specialists', removalVersion: '2.0.0' },
      {
        path: 'config.defaultProfile',
        replacement: 'config.defaultSpecialist',
        removalVersion: '2.0.0',
      },
      { path: 'config.teams', replacement: 'config.cohorts', removalVersion: '2.0.0' },
      {
        path: 'config.teams.workers.members.worker.profile',
        replacement: 'config.teams.workers.members.worker.specialist',
        removalVersion: '2.0.0',
      },
      {
        path: 'config.strategies.work.team',
        replacement: 'config.strategies.work.cohort',
        removalVersion: '2.0.0',
      },
    ])
  })

  it('returns warning success for an empty fixture and diagnostics failure for explicit incompatibility', async () => {
    const warning = io({ 'legion.yml': config })
    expect(await runCli(['doctor', 'legion.yml', '--json'], warning.io)).toBe(EXIT_OK)
    expect(JSON.parse(warning.stdout.join(''))).toMatchObject({
      summary: { status: 'warnings', errors: 0 },
      source: { providerSnapshot: 'empty-fixture' },
    })

    const structured = config.replace(
      'description: Fast work.',
      'description: Fast work.\n    defaultRunInBackground: false\n    result: review-v1',
    ).replace('    defaultRunInBackground: true\n', '')
    const incompatibleProviders = providers.replace('outputSchema: true', 'outputSchema: false')
    const failure = io({ 'legion.yml': structured, 'providers.yml': incompatibleProviders })
    expect(await runCli([
      'doctor', 'legion.yml', '--providers', 'providers.yml', '--json',
    ], failure.io)).toBe(EXIT_DIAGNOSTICS)
    expect(JSON.parse(failure.stdout.join(''))).toMatchObject({ summary: { status: 'errors', errors: 1 } })
  })

  it('returns input failure for usage, read, and parse errors', async () => {
    for (const [args, files] of [
      [['unknown'], {}],
      [['doctor', 'missing.yml'], {}],
      [['doctor', 'bad.json'], { 'bad.json': '{' }],
    ] as const) {
      const state = io(files)
      expect(await runCli(args, state.io)).toBe(EXIT_INPUT)
      expect(state.stdout).toEqual([])
      expect(state.stderr.join('')).toContain('dsh-legion:')
    }
  })
})

describe('replay command', () => {
  const runId = 'run-cli'
  const record = {
    schemaVersion: 1,
    runId,
    anchorSessionId: 'session-cli',
    strategyName: 'synthetic',
    strategyPlanDigest: `sha256:${'b'.repeat(64)}`,
    catalogDigest: `sha256:${'c'.repeat(64)}`,
    goalVersion: 1,
    goal: {
      version: 1,
      statement: 'Replay the exported history.',
      acceptance: [],
      constraints: [],
      nonGoals: [],
      authorityDigest: `sha256:${'d'.repeat(64)}`,
    },
    currentPlanVersion: 1,
    status: 'created',
    environmentDigest: `sha256:${'a'.repeat(64)}`,
    createdAt: 1,
    updatedAt: 1,
  }
  const source = JSON.stringify({
    type: 'legion/run-state',
    seq: 0,
    time: 1,
    data: {
      schemaVersion: 1,
      runId,
      planVersion: 1,
      correlationId: 'correlation-cli',
      record,
    },
  })

  it('renders JSON from an explicit exported event stream', async () => {
    const state = io({ 'events.jsonl': source })
    const code = await runCli(
      ['replay', '--input', 'events.jsonl', '--run', runId, '--json'],
      state.io,
    )
    expect(code).toBe(EXIT_OK)
    expect(JSON.parse(state.stdout.join(''))).toMatchObject({
      found: true,
      run: { status: 'created' },
    })
  })

  it('renders stable human output and rejects malformed input', async () => {
    const human = io({ 'events.jsonl': source })
    expect(await runCli(
      ['replay', '--input', 'events.jsonl', '--run', runId],
      human.io,
    )).toBe(EXIT_OK)
    expect(human.stdout.join('')).toContain('Durable Strategy Run run-cli')

    const malformed = io({ 'bad.jsonl': '{' })
    expect(await runCli(
      ['replay', '--input', 'bad.jsonl', '--run', runId],
      malformed.io,
    )).toBe(EXIT_INPUT)
    expect(malformed.stderr.join('')).toContain('line 1')
  })
})
