/** Run Receipt companion dictionaries. */
export const RECEIPT_LOCALE_NS = 'legion.run-receipts'

export type ReceiptLocaleKey =
  | 'title' | 'launcher' | 'move' | 'dock' | 'dismiss' | 'selectRun'
  | 'opening' | 'readyEmpty' | 'active' | 'partial' | 'reconnecting'
  | 'feedUnavailable' | 'invalidFrame' | 'streamError' | 'settled'
  | 'directClearEmpty' | 'directClearActive' | 'newInstanceEmpty'
  | 'feed' | 'available' | 'unavailable' | 'stale' | 'outcome' | 'elapsed'
  | 'stages' | 'stageOverview' | 'participants' | 'availability'
  | 'details' | 'provider' | 'source' | 'timingSource' | 'tokenSource'
  | 'tokens' | 'totalTokens' | 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'
  | 'total' | 'knownSubtotal' | 'coverageComplete' | 'coveragePartial' | 'coverageUnavailable'
  | 'reported' | 'provisional' | 'truncated' | 'none' | 'rootStage' | 'after'
  | 'announceReconnect' | 'announceFeedError' | 'announceTerminal'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Copy owned by the independently mounted Run Receipt companion. */
    'legion.run-receipts': ReceiptLocaleKey
  }
}

export const en: Record<ReceiptLocaleKey, string> = {
  title: 'Run Receipt',
  launcher: 'Open Run Receipts',
  move: 'Drag to move Run Receipt',
  dock: 'Dock Run Receipt',
  dismiss: 'Dismiss Run Receipt',
  selectRun: 'Choose Run Receipt',
  opening: 'Loading the live Run Receipt feed…',
  readyEmpty: 'No Cohort Run exists in this live Session.',
  active: 'Live Cohort Run',
  partial: 'Known facts are partial; unavailable values are not counted as zero.',
  reconnecting: 'Reconnecting. The displayed same-Session facts are stale.',
  feedUnavailable: 'Run Receipt feed is unavailable. Delegation remains available in conversation results.',
  invalidFrame: 'A feed update was invalid. The last valid same-Session facts remain visible.',
  streamError: 'The feed stopped. The last valid same-Session facts remain visible.',
  settled: 'This Cohort Run has settled.',
  directClearEmpty: 'The latest delegation was direct; no retained Cohort Run remains.',
  directClearActive: 'The latest delegation was direct; active Cohort Runs remain available below.',
  newInstanceEmpty: 'Full facts ended with the prior companion instance. The bounded summary remains in conversation history.',
  feed: 'Feed',
  available: 'Available',
  unavailable: 'Unavailable',
  stale: 'Stale',
  outcome: 'Outcome',
  elapsed: 'Elapsed',
  stages: 'Stages',
  stageOverview: 'Stage overview',
  participants: 'Participants',
  availability: 'Availability',
  details: 'Token and source details',
  provider: 'Provider',
  source: 'Source',
  timingSource: 'Timing source',
  tokenSource: 'Token source',
  tokens: 'Token account',
  totalTokens: 'All tokens',
  inputTokens: 'Input',
  outputTokens: 'Output',
  cacheReadTokens: 'Cache read',
  cacheWriteTokens: 'Cache write',
  total: 'Total',
  knownSubtotal: 'Known subtotal',
  coverageComplete: 'Complete coverage',
  coveragePartial: 'Partial coverage',
  coverageUnavailable: 'Coverage unavailable',
  reported: 'Reported',
  provisional: 'Provisional',
  truncated: 'Truncated',
  none: 'None',
  rootStage: 'Starts immediately',
  after: 'After',
  announceReconnect: 'Run Receipt feed reconnecting.',
  announceFeedError: 'Run Receipt feed error.',
  announceTerminal: 'Run Receipt outcome: {outcome}.',
}

export const zh: Record<ReceiptLocaleKey, string> = {
  title: '运行回执',
  launcher: '打开运行回执',
  move: '拖动运行回执',
  dock: '停靠运行回执',
  dismiss: '关闭运行回执',
  selectRun: '选择运行回执',
  opening: '正在载入实时运行回执 feed…',
  readyEmpty: '当前实时 Session 中没有 Cohort Run。',
  active: '实时 Cohort Run',
  partial: '已知事实不完整；不可用值不会按零计算。',
  reconnecting: '正在重新连接。显示的同一 Session 事实已过时。',
  feedUnavailable: '运行回执 feed 不可用。仍可从对话结果使用委派。',
  invalidFrame: 'Feed 更新无效。最后有效的同一 Session 事实仍然可见。',
  streamError: 'Feed 已停止。最后有效的同一 Session 事实仍然可见。',
  settled: '此 Cohort Run 已结束。',
  directClearEmpty: '最近一次委派为直接委派；没有保留的 Cohort Run。',
  directClearActive: '最近一次委派为直接委派；下方仍可查看活动中的 Cohort Run。',
  newInstanceEmpty: '完整事实已随上一个 companion 实例结束；有界摘要仍保留在对话历史中。',
  feed: 'Feed',
  available: '可用',
  unavailable: '不可用',
  stale: '过时',
  outcome: '结果',
  elapsed: '耗时',
  stages: '阶段',
  stageOverview: '阶段概览',
  participants: '参与者',
  availability: '可用性',
  details: 'Token 与来源详情',
  provider: 'Provider',
  source: '来源',
  timingSource: '计时来源',
  tokenSource: 'Token 来源',
  tokens: 'Token 账户',
  totalTokens: '全部 Token',
  inputTokens: '输入',
  outputTokens: '输出',
  cacheReadTokens: '缓存读取',
  cacheWriteTokens: '缓存写入',
  total: '总计',
  knownSubtotal: '已知小计',
  coverageComplete: '覆盖完整',
  coveragePartial: '覆盖不完整',
  coverageUnavailable: '覆盖不可用',
  reported: '已报告',
  provisional: '暂定',
  truncated: '已截断',
  none: '无',
  rootStage: '立即开始',
  after: '依赖',
  announceReconnect: '运行回执 feed 正在重新连接。',
  announceFeedError: '运行回执 feed 出错。',
  announceTerminal: '运行回执结果：{outcome}。',
}
