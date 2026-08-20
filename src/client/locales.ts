/** Copy for Legion's settings card. */

/** Dictionary keys the card resolves. */
export type LegionCardKey =
  | 'title' | 'description'
  | 'expand' | 'collapse' | 'unsaved' | 'readOnly'
  | 'toolName' | 'toolNameHint'
  | 'defaultProfile' | 'defaultProfileHint'
  | 'maxResourceBytes' | 'maxResourceBytesHint'
  | 'enableRunInBackground' | 'enableRunInBackgroundHint'
  | 'enableStrategies' | 'enableStrategiesHint'
  | 'inherit' | 'on' | 'off'
  | 'overridden' | 'reset'
  | 'invalidText' | 'invalidBytes'
  | 'save' | 'saving' | 'discard' | 'saveFailed'

/** English copy. */
export const en: Record<LegionCardKey, string> = {
  title: 'Legion',
  description: 'Delegation policy. Profiles, Teams, and Strategies stay in the configuration document.',
  expand: 'Expand',
  collapse: 'Collapse',
  unsaved: 'Unsaved',
  readOnly: 'This configuration document is read-only, so these controls cannot be saved.',
  toolName: 'Tool name',
  toolNameHint: 'The single model-facing delegation tool. Renaming it republishes the tool.',
  defaultProfile: 'Default profile',
  defaultProfileHint: 'Profile used when a call omits one. Leave empty to require an explicit choice.',
  maxResourceBytes: 'Prompt fragment budget',
  maxResourceBytesHint: 'Maximum combined prompt-fragment bytes loaded for one profile, from 1 to 4194304.',
  enableRunInBackground: 'Background delegation',
  enableRunInBackgroundHint: 'Whether the tool accepts run_in_background and returns a durable child id.',
  enableStrategies: 'Model-callable Strategies',
  enableStrategiesHint: 'Explicit authority gate. Off by default; enable only for benchmarked Strategies.',
  inherit: 'Inherit',
  on: 'On',
  off: 'Off',
  overridden: 'Overridden',
  reset: 'Reset',
  invalidText: 'This value cannot be saved.',
  invalidBytes: 'Enter a whole number of bytes between 1 and 4194304.',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  saveFailed: 'The last save did not land. Retry, or discard to reload what the Host holds.',
}

/** Simplified Chinese copy. */
export const zh: Record<LegionCardKey, string> = {
  title: 'Legion',
  description: '委派策略。Profile、Team 与 Strategy 仍由配置文档管理。',
  expand: '展开',
  collapse: '收起',
  unsaved: '未保存',
  readOnly: '当前配置文档为只读，这些设置无法保存。',
  toolName: '工具名称',
  toolNameHint: '面向模型的唯一委派工具。重命名后会重新发布该工具。',
  defaultProfile: '默认 Profile',
  defaultProfileHint: '调用未指定 Profile 时使用。留空则要求显式选择。',
  maxResourceBytes: 'Prompt 片段预算',
  maxResourceBytesHint: '单个 Profile 载入的 prompt 片段字节上限，取值 1 至 4194304。',
  enableRunInBackground: '后台委派',
  enableRunInBackgroundHint: '是否接受 run_in_background 并立即返回持久子代理 id。',
  enableStrategies: '模型可调用的 Strategy',
  enableStrategiesHint: '显式授权开关。默认关闭，仅在已完成基准验证后开启。',
  inherit: '继承',
  on: '开',
  off: '关',
  overridden: '已覆盖',
  reset: '重置',
  invalidText: '该值无法保存。',
  invalidBytes: '请输入 1 至 4194304 之间的整数字节数。',
  save: '保存',
  saving: '保存中…',
  discard: '放弃',
  saveFailed: '上次保存未生效。请重试，或放弃以重新读取 Host 的当前值。',
}
