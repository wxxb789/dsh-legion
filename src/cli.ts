import { dirname, resolve } from 'node:path'
import { compileCatalog } from './compiler.ts'
import { explainCatalog, renderExplainHuman, type ExplainViewV1 } from './explain.ts'
import { LegionInputError, loadConfigFile, loadProviderSnapshotFile } from './input.ts'
import { loadProfileResources } from './resources.ts'

export const EXIT_OK = 0
export const EXIT_DIAGNOSTICS = 1
export const EXIT_INPUT = 2

export interface CliWriter {
  write(text: string): void
}

export interface CliIo {
  readonly stdout: CliWriter
  readonly stderr: CliWriter
  readonly readTextFile: (file: string) => Promise<string>
}

type CliCommand =
  | { readonly kind: 'help' }
  | {
      readonly kind: 'doctor' | 'explain'
      readonly config: string
      readonly providers?: string
      readonly json: boolean
    }

const HELP = `dsh-legion doctor <config.yml|config.json> [--providers <snapshot.yml>] [--json]
dsh-legion explain <config.yml|config.json> [--providers <snapshot.yml>] [--json]

The provider snapshot is an explicit fixture. No live DSH process, credentials,
network, provider health, or model availability is queried.
`

function usage(message: string): never {
  throw new LegionInputError('CLI_USAGE', '<argv>', message)
}

function parseArgs(argv: readonly string[]): CliCommand {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') return { kind: 'help' }
  const kind = argv[0]
  if (kind !== 'doctor' && kind !== 'explain') usage(`unknown command "${String(kind)}"`)
  const config = argv[1]
  if (config === undefined || config.startsWith('-')) usage(`${kind} requires a config file`)
  let providers: string | undefined
  let json = false
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') {
      json = true
      continue
    }
    if (arg === '--providers') {
      const value = argv[++index]
      if (value === undefined || value.startsWith('-')) usage('--providers requires a fixture file')
      providers = value
      continue
    }
    usage(`unknown option "${String(arg)}"`)
  }
  return {
    kind,
    config,
    json,
    ...providers === undefined ? {} : { providers },
  }
}

function exitCode(view: ExplainViewV1): number {
  return view.summary.errors > 0 ? EXIT_DIAGNOSTICS : EXIT_OK
}

/** Run the CLI adapter without capturing Node globals, for deterministic tests. */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  let command: CliCommand
  try {
    command = parseArgs(argv)
    if (command.kind === 'help') {
      io.stdout.write(HELP)
      return EXIT_OK
    }
    const config = await loadConfigFile(command.config, io.readTextFile)
    const fixture = command.providers === undefined
      ? undefined
      : await loadProviderSnapshotFile(command.providers, io.readTextFile)
    const resources = await loadProfileResources(config, {
      baseDirectory: dirname(resolve(command.config)),
    })
    const catalog = compileCatalog(config, fixture ?? { providers: {} }, resources)
    const view = explainCatalog(catalog, {
      providerSnapshot: fixture === undefined ? 'empty-fixture' : 'fixture',
    })
    if (command.json) {
      io.stdout.write(JSON.stringify(view, null, 2) + '\n')
    } else {
      io.stdout.write(renderExplainHuman(view, {
        command: command.kind,
        detail: command.kind === 'explain' ? 'profiles' : 'summary',
      }))
    }
    return exitCode(view)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    io.stderr.write(message + '\n')
    return EXIT_INPUT
  }
}
