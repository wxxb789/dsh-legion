import type { Config, LegionProfile } from './config.ts'

function routeLabel(profile: LegionProfile): string {
  const route = profile.agentOptions
  if (route?.provider !== undefined && route.model !== undefined) {
    return `${route.provider}/${route.model}`
  }
  if (route?.model !== undefined) return `inherited provider/${route.model}`
  if (route?.provider !== undefined) return `${route.provider}/inherited model`
  return 'parent model'
}

/** Render the stable coordinator guidance owned by the Legion tool. */
export function renderCoordinatorGuidance(config: Config): string {
  const lines = [
    `Use \`${config.toolName}\` to delegate focused work through semantic profiles.`,
    'Choose a profile by task fit; do not choose raw models in tool calls.',
    '',
    'Configured profiles:',
  ]

  for (const [name, profile] of Object.entries(config.profiles)) {
    const background = !config.enableRunInBackground
      ? 'foreground only'
      : profile.defaultRunInBackground ? 'background by default' : 'foreground by default'
    lines.push(
      `- \`${name}\`: ${profile.description} `
      + `(backend: ${profile.subagentProvider}; model: ${routeLabel(profile)}; ${background})`,
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
