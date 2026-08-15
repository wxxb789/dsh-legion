import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as legion from '../lib/index.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const contract = JSON.parse(await readFile(resolve(root, 'contracts/v1.json'), 'utf8'))
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const checks = [
  ['configVersion', contract.configVersion, legion.CURRENT_CONFIG_VERSION],
  ['resultContracts', contract.resultContracts, legion.RESULT_CONTRACTS],
  ['artifactContracts', contract.artifactContracts, legion.ARTIFACT_CONTRACTS],
  ['strategyStageKinds', contract.strategyStageKinds, legion.STRATEGY_STAGE_KINDS],
  ['strategyLimitFields', contract.strategyLimitFields, legion.STRATEGY_LIMIT_FIELDS],
  ['teamRunOutcomes', contract.teamRunOutcomes, legion.TEAM_RUN_OUTCOMES],
]
for (const [name, expected, actual] of checks) {
  if (!equal(expected, actual)) {
    throw new Error(`public contract ${name} drifted: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}
const migrated = legion.materializeConfig({
  profiles: {
    contract: {
      description: 'Contract verification.',
      subagentProvider: 'spawn',
      maxDepth: 1,
      defaultRunInBackground: false,
    },
  },
})
if (migrated.enableStrategies !== contract.modelStrategyExposureDefault) {
  throw new Error('public contract model Strategy exposure default drifted')
}
process.stdout.write('dsh-legion public contract v1 candidate verified\n')
