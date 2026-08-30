import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as legion from '../src/index.ts'

let root: string | undefined
let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('Cordis Loader composition', () => {
  it('loads the package module namespace as an agent-plane plugin row', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-legion-loader-'))
    const configPath = join(root, 'agent.cordis.yml')
    await writeFile(configPath, [
      "- id: agents",
      "  name: '@deepseek-ai/dsh-agent'",
      "- id: system-prompt",
      "  name: '@deepseek-ai/dsh-system-prompt'",
      "- id: tools",
      "  name: '@deepseek-ai/dsh-tools'",
      "- id: subagents",
      "  name: '@deepseek-ai/dsh-subagent'",
      "- id: legion",
      "  name: 'dsh-legion'",
      "  config:",
      "    defaultProfile: quick",
      "    profiles:",
      "      quick:",
      "        description: Fast focused work.",
      "        defaultRunInBackground: false",
      '',
    ].join('\n'), 'utf8')

    ctx = new Context()
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-agent', AgentRegistry],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-subagent', SubagentRuntime],
      ['dsh-legion', legion],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        const loaded = modules.get(specifier)
        if (loaded === undefined) throw new Error(`unexpected Loader import: ${specifier}`)
        return loaded
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>

    await ctx.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await ctx.loader.await()

    const inactive = [...ctx.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(inactive).toEqual([])
    expect(ctx.tools.schemas().map(schema => schema.name)).not.toContain('legion')
    ctx.subagents.registerProvider({
      name: 'spawn',
      capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
      inheritsParentContext: false,
      async start() { throw new Error('not used by this composition test') },
      async prepareContinuable() { return {} },
    })
    expect(ctx.tools.schemas().map(schema => schema.name)).toContain('legion')
    const prompt = await ctx.systemPrompt.assemble()
    expect(prompt.sections.find(section => section.name === 'tool:legion')?.text)
      .toContain('`quick`: Fast focused work.')
  })
})
