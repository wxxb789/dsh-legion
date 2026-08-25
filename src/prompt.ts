import type { SpecialistSpec } from './config.ts'

const coordinatorCatalogBrand: unique symbol = Symbol('dsh-legion.coordinator-catalog')

export interface CoordinatorSpecialist extends Omit<SpecialistSpec, 'routes' | 'toolFilter' | 'promptFiles'> {
  readonly routes?: readonly Readonly<NonNullable<SpecialistSpec['routes']>[number]>[]
  readonly toolFilter?: {
    readonly allow?: readonly string[]
    readonly deny?: readonly string[]
  }
  readonly promptFiles?: readonly Readonly<NonNullable<SpecialistSpec['promptFiles']>[number]>[]
  readonly allowedModes?: readonly ('foreground' | 'continuable')[]
}

export interface CoordinatorCatalog {
  readonly [coordinatorCatalogBrand]: true
  readonly toolName: string
  readonly enableRunInBackground: boolean
  readonly defaultSpecialist?: string
  readonly guidance?: string
  readonly specialists: Readonly<Record<string, CoordinatorSpecialist>>
}

type CoordinatorCatalogInput = Omit<CoordinatorCatalog, typeof coordinatorCatalogBrand>

/** Internal constructor for the compiler-owned guidance view. */
export function createCoordinatorCatalog(input: CoordinatorCatalogInput): CoordinatorCatalog {
  const catalog = { ...input } as CoordinatorCatalog
  Object.defineProperty(catalog, coordinatorCatalogBrand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  })
  return Object.freeze(catalog)
}

function routeLabel(profile: Pick<CoordinatorSpecialist, 'agentOptions' | 'routes'>): string {
  if (profile.routes !== undefined) {
    return profile.routes.map(route => `${route.id}=${route.provider}/${route.model}`).join(' -> ')
  }
  const route = profile.agentOptions
  if (route?.provider !== undefined && route.model !== undefined) {
    return `${route.provider}/${route.model}`
  }
  if (route?.model !== undefined) return `inherited provider/${route.model}`
  if (route?.provider !== undefined) return `${route.provider}/inherited model`
  return 'parent model'
}

/** Render the stable coordinator guidance owned by the Legion tool. */
export function renderCoordinatorGuidance(config: CoordinatorCatalog): string {
  if (config[coordinatorCatalogBrand] !== true) {
    throw new Error('dsh-legion: coordinator guidance requires a compiler-owned catalog')
  }
  const lines = [
    `Use \`${config.toolName}\` to delegate focused work through semantic profiles.`,
    'Choose a profile by task fit; do not choose raw models in tool calls.',
    '',
    'Configured profiles:',
  ]

  for (const [name, profile] of Object.entries(config.specialists)) {
    const background = profile.allowedModes === undefined
      ? !config.enableRunInBackground
        ? 'foreground only'
        : profile.defaultRunInBackground ? 'background by default' : 'foreground by default'
      : profile.allowedModes.length === 1
        ? `${profile.allowedModes[0]} only`
        : `${profile.defaultRunInBackground ? 'background' : 'foreground'} by default; foreground/background allowed`
    const fragments = profile.promptFiles?.length ?? 0
    lines.push(
      `- \`${name}\`: ${profile.description} `
      + `(backend: ${profile.subagentProvider}; model: ${routeLabel(profile)}; result: ${profile.result}; ${background}`
      + `${fragments === 0 ? '' : `; instructions: ${String(fragments)} fragment(s)`})`,
    )
  }

  lines.push(
    '',
    'Start independent delegations together and continue useful work while background children run.',
    'Use foreground execution only when the next action depends on the child result.',
    'A profile is a fixed capability policy: do not ask a child to widen its tools, model route, or depth.',
  )

  if (config.defaultSpecialist !== undefined) {
    lines.push(`Omitting profile selects \`${config.defaultSpecialist}\`.`)
  }
  if (config.guidance?.trim()) lines.push('', config.guidance.trim())
  return lines.join('\n')
}
