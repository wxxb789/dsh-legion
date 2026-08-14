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
toolName: legion
defaultProfile: quick
enableRunInBackground: true
profiles:
  quick:
    description: Fast work.
    subagentProvider: spawn
    maxDepth: 2
    defaultRunInBackground: true
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
    const document = JSON.parse(json.stdout.join('')) as { version: number; source: { providerSnapshot: string } }
    expect(document).toMatchObject({ version: 1, source: { providerSnapshot: 'fixture' } })
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
