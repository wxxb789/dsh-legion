import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { load as loadYaml } from 'js-yaml'
import z from '@deepseek-ai/schemastery'
import { materializeConfig, type Config as LegionConfig } from './config.ts'
import type { RuntimeSnapshot } from './compiler.ts'

export type InputErrorCode =
  | 'CLI_USAGE'
  | 'FORMAT_UNSUPPORTED'
  | 'READ_FAILED'
  | 'PARSE_FAILED'
  | 'CONFIG_INVALID'
  | 'SNAPSHOT_INVALID'

export class LegionInputError extends Error {
  readonly code: InputErrorCode
  readonly file: string

  constructor(code: InputErrorCode, file: string, message: string, cause?: unknown) {
    super(`dsh-legion: ${message}`, { cause })
    this.name = 'LegionInputError'
    this.code = code
    this.file = file
  }
}

export interface ProviderSnapshotFixtureV1 {
  readonly version: 1
  readonly kind: 'legion-provider-snapshot'
  readonly providers: RuntimeSnapshot['providers']
}

const CapabilitiesSchema = z.object({
  outputSchema: z.boolean().required(),
  depthLimit: z.boolean().required(),
  toolFilter: z.boolean().required(),
  persona: z.boolean().required(),
})

const ProviderFactsSchema = z.object({
  continuable: z.boolean().required(),
  capabilities: CapabilitiesSchema.required(),
})

const ProviderSnapshotSchema: z<ProviderSnapshotFixtureV1> = z.object({
  version: z.const(1 as const).required(),
  kind: z.const('legion-provider-snapshot' as const).required(),
  providers: z.dict(ProviderFactsSchema).required(),
})

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function assertKnownKeys(value: unknown, allowed: readonly string[], at: string): void {
  const source = record(value)
  if (source === undefined) return
  const known = new Set(allowed)
  const unknown = Object.keys(source).filter(key => !known.has(key))
  if (unknown.length > 0) {
    throw new Error(`${at} contains unknown field(s): ${unknown.sort().join(', ')}`)
  }
}

function assertKnownSnapshotKeys(input: unknown): void {
  assertKnownKeys(input, ['version', 'kind', 'providers'], 'snapshot')
  const providers = record(record(input)?.providers)
  if (providers === undefined) return
  for (const [name, provider] of Object.entries(providers)) {
    assertKnownKeys(provider, ['continuable', 'capabilities'], `providers.${name}`)
    assertKnownKeys(
      record(provider)?.capabilities,
      ['outputSchema', 'depthLimit', 'toolFilter', 'persona'],
      `providers.${name}.capabilities`,
    )
  }
}

export type ReadTextFile = (file: string) => Promise<string>

function parseDocument(file: string, source: string): unknown {
  const extension = extname(file).toLowerCase()
  try {
    switch (extension) {
      case '.json': return JSON.parse(source) as unknown
      case '.yaml':
      case '.yml': return loadYaml(source)
      default:
        throw new LegionInputError(
          'FORMAT_UNSUPPORTED',
          file,
          `unsupported input format "${extension || '<none>'}"; use .json, .yaml, or .yml`,
        )
    }
  } catch (error: unknown) {
    if (error instanceof LegionInputError) throw error
    throw new LegionInputError('PARSE_FAILED', file, `failed to parse ${file}: ${String(error)}`, error)
  }
}

/** Parse and runtime-validate one standalone Legion config document. */
export function parseConfigDocument(file: string, source: string): LegionConfig {
  const input = parseDocument(file, source)
  try {
    return materializeConfig(input)
  } catch (error: unknown) {
    throw new LegionInputError('CONFIG_INVALID', file, `invalid Legion config in ${file}: ${String(error)}`, error)
  }
}

/** Parse and runtime-validate one explicit provider snapshot fixture. */
export function parseProviderSnapshotDocument(file: string, source: string): ProviderSnapshotFixtureV1 {
  const input = parseDocument(file, source)
  try {
    assertKnownSnapshotKeys(input)
    const fixture = ProviderSnapshotSchema(input as ProviderSnapshotFixtureV1 | null | undefined)
    return {
      version: 1,
      kind: 'legion-provider-snapshot',
      providers: Object.fromEntries(Object.keys(fixture.providers).sort().map((name) => {
        const provider = fixture.providers[name]!
        return [name, {
          continuable: provider.continuable,
          capabilities: { ...provider.capabilities },
        }]
      })),
    }
  } catch (error: unknown) {
    throw new LegionInputError('SNAPSHOT_INVALID', file, `invalid provider snapshot in ${file}: ${String(error)}`, error)
  }
}

async function readInput(file: string, readTextFile: ReadTextFile): Promise<string> {
  try {
    return await readTextFile(file)
  } catch (error: unknown) {
    throw new LegionInputError('READ_FAILED', file, `failed to read ${file}: ${String(error)}`, error)
  }
}

export async function loadConfigFile(
  file: string,
  readTextFile: ReadTextFile = path => readFile(path, 'utf8'),
): Promise<LegionConfig> {
  return parseConfigDocument(file, await readInput(file, readTextFile))
}

export async function loadProviderSnapshotFile(
  file: string,
  readTextFile: ReadTextFile = path => readFile(path, 'utf8'),
): Promise<ProviderSnapshotFixtureV1> {
  return parseProviderSnapshotDocument(file, await readInput(file, readTextFile))
}
