import {
  PROFILE_NAME,
  TEAM_RUN_OUTCOMES,
  LegionProfileSchema,
  ProfileName,
  TeamName,
  TeamRunId,
  TeamSpecSchema,
  acpCatalogLayer,
  acpProfile,
  assertAcpProfileCompatible,
  defineTeam,
  materializeConfig,
  type CompiledCatalog,
  type LegionProfile,
  type TeamRunOutcome,
  type TeamSpec,
} from 'dsh-legion'

const profile: LegionProfile = {
  description: 'Legacy compiled consumer.',
  subagentProvider: 'spawn',
  maxDepth: 1,
  defaultRunInBackground: false,
}
LegionProfileSchema(profile)
const team: TeamSpec = {
  description: 'Legacy Cohort spelling.',
  members: { worker: { specialist: 'legacy' } },
}
TeamSpecSchema(team)
defineTeam('legacy-team', team)
ProfileName('legacy')
TeamName('legacy-team')
TeamRunId('team-run-123e4567-e89b-42d3-a456-426614174000')
const acp = acpProfile({
  id: 'legacy-acp',
  title: 'Legacy ACP',
  description: 'Legacy ACP consumer.',
  command: 'legacy-acp',
  entrypoint: 'verified',
})
assertAcpProfileCompatible('legacy-acp', acp)
if (Object.keys(acpCatalogLayer([])).join(',') !== 'id,profiles') {
  throw new Error('legacy ACP Catalog Layer shape changed')
}
const config = materializeConfig({ profiles: { legacy: profile }, defaultProfile: 'legacy' })
if (config.configVersion !== 2 || config.defaultProfile !== 'legacy' || !PROFILE_NAME.test('legacy')) {
  throw new Error('legacy Config materialization changed')
}
if (TEAM_RUN_OUTCOMES.join(',') !== 'completed,degraded,cancelled,failed') {
  throw new Error('legacy Cohort Run outcomes changed')
}
void (undefined as CompiledCatalog | TeamRunOutcome | undefined)
