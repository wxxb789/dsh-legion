import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('built dsh-legion executable', () => {
  it('runs help and JSON doctor through Node', () => {
    const help = spawnSync(process.execPath, [join(ROOT, 'lib/bin.js'), '--help'], {
      encoding: 'utf8',
    })
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('dsh-legion doctor')
    expect(help.stderr).toBe('')

    const root = mkdtempSync(join(tmpdir(), 'dsh-legion-bin-'))
    roots.push(root)
    const config = join(root, 'legion.yml')
    mkdirSync(join(root, 'resources'), { recursive: true })
    writeFileSync(join(root, 'resources', 'quick.md'), 'Use the CLI resource.')
    writeFileSync(config, [
      'resourceRoots:',
      '  local: resources',
      'profiles:',
      '  quick:',
      '    description: Fast work.',
      '    subagentProvider: spawn',
      '    maxDepth: 2',
      '    defaultRunInBackground: true',
      '    promptFiles:',
      '      - root: local',
      '        path: quick.md',
      'defaultProfile: quick',
      '',
    ].join('\n'))
    const doctor = spawnSync(process.execPath, [join(ROOT, 'lib/bin.js'), 'doctor', config, '--json'], {
      encoding: 'utf8',
    })
    expect(doctor.status).toBe(0)
    expect(doctor.stderr).toBe('')
    expect(JSON.parse(doctor.stdout)).toMatchObject({
      version: 1,
      kind: 'legion-explain',
      source: { providerSnapshot: 'empty-fixture' },
      summary: { status: 'warnings' },
    })

    writeFileSync(config, readFileSync(config, 'utf8').replace('path: quick.md', 'path: missing.md'))
    const missing = spawnSync(process.execPath, [join(ROOT, 'lib/bin.js'), 'doctor', config], {
      encoding: 'utf8',
    })
    expect(missing.status).toBe(2)
    expect(missing.stderr).toContain('does not exist')
  })
})
