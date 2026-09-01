import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'

const PACKAGE_ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
let root: string | undefined
let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('profile-local package distribution', () => {
  it('resolves dsh-legion from a profile node_modules when mounting a user preset', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-legion-profile-resolution-'))
    const profileDir = join(root, 'profiles', 'web')
    const packageDir = join(profileDir, 'node_modules', 'dsh-legion')
    const presetRoot = join(root, '.agent-presets')
    const presetDir = join(presetRoot, 'legion-resolution')
    await mkdir(dirname(packageDir), { recursive: true })
    await mkdir(presetDir, { recursive: true })
    await symlink(PACKAGE_ROOT, packageDir, process.platform === 'win32' ? 'junction' : 'dir')
    await writeFile(join(profileDir, 'cordis.yml'), '[]\n', 'utf8')
    await writeFile(join(presetDir, 'agent.cordis.yml'), [
      "- id: tool-legion",
      "  name: dsh-legion",
      "  config:",
      "    configVersion: 3",
      "    defaultSpecialist: quick",
      "    specialists:",
      "      quick:",
      "        description: Fast focused work.",
      "        defaultRunInBackground: false",
      '',
    ].join('\n'), 'utf8')

    ctx = new Context()
    ctx.baseUrl = pathToFileURL(profileDir).href + '/'
    await ctx.plugin(Loader)
    expect(ctx.loader.internal).toBeDefined()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(AgentPresets, {
      default: 'legion-resolution',
      roots: [{ path: presetRoot, trust: 'user' }],
      includeShippedRoot: false,
      includeUserRoot: false,
    })

    await expect(ctx.agentPresets.standingKeyFor('legion-resolution')).resolves.toBeDefined()
    expect((await ctx.agentPresets.resolve('legion-resolution')).broken).toBeUndefined()
  })
})
