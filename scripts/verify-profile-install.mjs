import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import { trustedTempRoot } from './trusted-temp-root.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'))
const canonicalTempRoot = trustedTempRoot()
const sandboxRoot = await mkdtemp(join(canonicalTempRoot, 'dsh-legion-packed-profile-'))
const relativeSandbox = relative(canonicalTempRoot, resolve(sandboxRoot))
if (relativeSandbox.startsWith('..') || relativeSandbox === '') {
  throw new Error(`refusing to use unexpected temporary path: ${sandboxRoot}`)
}

const run = (program, args, cwd) => {
  const command = process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : program
  const commandArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', program, ...args]
    : args
  const result = spawnSync(command, commandArgs, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${program} ${args.join(' ')} failed with exit code ${String(result.status)}`)
  }
}

const runNode = (args, cwd) => {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`node ${args.join(' ')} failed with exit code ${String(result.status)}`)
  }
}

let ctx
try {
  const packDir = join(sandboxRoot, 'pack')
  const profileDir = join(sandboxRoot, 'profiles', 'web')
  const presetRoot = join(sandboxRoot, '.agent-presets')
  const presetDir = join(presetRoot, 'legion-packed')
  await mkdir(packDir, { recursive: true })
  await mkdir(profileDir, { recursive: true })
  await mkdir(join(presetDir, 'resources'), { recursive: true })

  run('npm', ['pack', '--ignore-scripts', '--pack-destination', packDir], projectRoot)
  const tarball = join(packDir, `dsh-legion-${String(manifest.version)}.tgz`)
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-legion-packed-profile-test',
    private: true,
  }, null, 2) + '\n')
  run('pnpm', [
    'add',
    '--config.ignore-scripts=true',
    '--registry=https://registry.npmjs.org',
    tarball,
  ], profileDir)
  runNode([join(profileDir, 'node_modules', 'dsh-legion', 'lib', 'bin.js'), '--help'], profileDir)

  await writeFile(join(profileDir, 'cordis.yml'), '[]\n')
  await writeFile(join(presetDir, 'resources', 'quick.md'), 'Use the packed prompt resource.\n')
  await writeFile(join(presetDir, 'agent.cordis.yml'), [
    '- id: tool-legion',
    '  name: dsh-legion',
    '  config:',
    '    defaultProfile: quick',
    '    resourceRoots:',
    '      local: resources',
    '    profiles:',
    '      quick:',
    '        description: Packed profile worker.',
    '        defaultRunInBackground: false',
    '        promptFiles:',
    '          - root: local',
    '            path: quick.md',
    '',
  ].join('\n'))

  ctx = new Context()
  ctx.baseUrl = pathToFileURL(profileDir).href + '/'
  await ctx.plugin(Loader)
  if (ctx.loader.internal === undefined) throw new Error('real Loader internal resolver is unavailable')
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(AgentPresets, {
    default: 'legion-packed',
    roots: [{ path: presetRoot, trust: 'user' }],
    includeUserRoot: false,
  })
  const standingKey = await ctx.agentPresets.standingKeyFor('legion-packed')
  ctx.subagents.registerProvider({
    name: 'spawn',
    capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    inheritsParentContext: false,
    async start() { throw new Error('packed profile smoke does not execute a child') },
    async prepareContinuable() { return {} },
  })
  if (!ctx.tools.schemas(standingKey).some(schema => schema.name === 'legion')) {
    throw new Error('packed Legion plugin mounted but did not register its tool in the preset scope')
  }
  process.stdout.write('packed profile preset mounted and registered the Legion tool successfully\n')
} finally {
  await ctx?.fiber.dispose()
  await rm(sandboxRoot, { recursive: true, force: true })
}
