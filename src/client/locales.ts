/** Copy for Legion's settings card. */

/** Dictionary keys the card resolves. */
export type LegionCardKey =
  | 'title' | 'description'
  | 'toolName' | 'toolNameHint'
  | 'defaultProfile' | 'defaultProfileHint'
  | 'enableRunInBackground' | 'enableRunInBackgroundHint'
  | 'enableStrategies' | 'enableStrategiesHint'
  | 'overridden' | 'reset' | 'save' | 'discard' | 'saveFailed'

/** English copy. */
export const en: Record<LegionCardKey, string> = {
  title: 'Legion',
  description: 'Delegation policy. Profiles, Teams, and Strategies stay in the configuration document.',
  toolName: 'Tool name',
  toolNameHint: 'The single model-facing delegation tool. Renaming it republishes the tool.',
  defaultProfile: 'Default profile',
  defaultProfileHint: 'Profile used when a call omits one. Leave empty to require an explicit choice.',
  enableRunInBackground: 'Background delegation',
  enableRunInBackgroundHint: 'Whether the tool accepts run_in_background and returns a durable child id.',
  enableStrategies: 'Model-callable Strategies',
  enableStrategiesHint: 'Explicit authority gate. Off by default; enable only for benchmarked Strategies.',
  overridden: 'overridden',
  reset: 'Reset',
  save: 'Save',
  discard: 'Discard',
  saveFailed: 'The last save did not land. Retry, or discard to reload what the Host holds.',
}

/** Simplified Chinese copy. */
export const zh: Record<LegionCardKey, string> = {
  title: 'Legion',
  description: '委派策略。Profile、Team 与 Strategy 仍由配置文档管理。',
  toolName: '工具名称',
  toolNameHint: '面向模型的唯一委派工具。重命名后会重新发布该工具。',
  defaultProfile: '默认 Profile',
  defaultProfileHint: '调用未指定 Profile 时使用。留空则要求显式选择。',
  enableRunInBackground: '后台委派',
  enableRunInBackgroundHint: '是否接受 run_in_background 并立即返回持久子代理 id。',
  enableStrategies: '模型可调用的 Strategy',
  enableStrategiesHint: '显式授权开关。默认关闭，仅在已完成基准验证后开启。',
  overridden: '已覆盖',
  reset: '重置',
  save: '保存',
  discard: '放弃',
  saveFailed: '上次保存未生效。请重试，或放弃以重新读取 Host 的当前值。',
}
