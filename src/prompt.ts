import type { Config, LegionProfile } from './config.ts'

export interface CoordinatorProfile extends Omit<LegionProfile, 'toolFilter' | 'promptFiles'> {
  readonly toolFilter?: {
    readonly allow?: readonly string[]
    readonly deny?: readonly string[]
  }
  readonly promptFiles?: readonly Readonly<NonNullable<LegionProfile['promptFiles']>[number]>[]
  readonly allowedModes?: readonly ('foreground' | 'continuable')[]
}

export interface CoordinatorCatalog {
  readonly toolName: string
  readonly enableRunInBackground: boolean
  readonly defaultProfile?: string
  readonly guidance?: string
  readonly profiles: Readonly<Record<string, CoordinatorProfile>>
}

function routeLabel(profile: Pick<LegionProfile, 'agentOptions'>): string {
  const route = profile.agentOptions
  if (route?.provider !== undefined && route.model !== undefined) {
    return `${route.provider}/${route.model}`
  }
  if (route?.model !== undefined) return `inherited provider/${route.model}`
  if (route?.provider !== undefined) return `${route.provider}/inherited model`
  return 'parent model'
}

/** Render the stable coordinator guidance owned by the Legion tool. */
export function renderCoordinatorGuidance(config: Config): string
export function renderCoordinatorGuidance(config: CoordinatorCatalog): string
export function renderCoordinatorGuidance(config: CoordinatorCatalog): string {
  const lines = [
    `Use \`${config.toolName}\` to delegate focused work through semantic profiles.`,
    'Choose a profile by task fit; do not choose raw models in tool calls.',
    '',
    'Configured profiles:',
  ]

  for (const [name, profile] of Object.entries(config.profiles)) {
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

  if (config.defaultProfile !== undefined) {
    lines.push(`Omitting profile selects \`${config.defaultProfile}\`.`)
  }
  if (config.guidance?.trim()) lines.push('', config.guidance.trim())
  return lines.join('\n')
}
