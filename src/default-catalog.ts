import type { CatalogLayer } from './orchestration-contract.ts'

/** Curated defaults expressed only through the same public catalog data contract as user layers. */
export const DEFAULT_CATALOG_LAYER = {
  id: 'legion-defaults-v1',
  teams: {
    'independent-review': {
      description: 'One executor and one independent reviewer.',
      members: {
        executor: { profile: 'deep' },
        reviewer: { profile: 'review' },
      },
      limits: { maxMembers: 2, maxConcurrentMembers: 1 },
    },
    'research-panel': {
      description: 'Three independent researchers and one evidence synthesizer.',
      members: {
        researchers: {
          profile: 'quick',
          minParticipants: 2,
          maxParticipants: 3,
          tags: ['research'],
        },
        synthesizer: { profile: 'deep' },
      },
      limits: { maxMembers: 4, maxConcurrentMembers: 3 },
    },
    'plan-execute-review': {
      description: 'A planner/executor, independent reviewer, and bounded repair activation.',
      members: {
        planner: { profile: 'deep' },
        executor: { profile: 'deep' },
        reviewer: { profile: 'review' },
      },
      limits: { maxMembers: 3, maxConcurrentMembers: 1 },
    },
  },
  strategies: {
    'independent-review': {
      description: 'Execute once and independently review the produced evidence.',
      team: 'independent-review',
      stages: [
        {
          kind: 'delegate',
          id: 'execute',
          member: 'executor',
          inputs: [{ artifact: 'objective', contract: 'objective-v1' }],
          output: { artifact: 'execution', contract: 'text' },
          prompt: 'Execute the objective and return concrete evidence.',
        },
        {
          kind: 'delegate',
          id: 'review',
          member: 'reviewer',
          inputs: [
            { artifact: 'objective', contract: 'objective-v1' },
            { artifact: 'execution', contract: 'text' },
          ],
          output: { artifact: 'review', contract: 'review-v1' },
          prompt: 'Independently review the execution evidence and return the configured review contract.',
        },
      ],
      completion: { artifact: 'review', contract: 'review-v1' },
      limits: {
        maxAgents: 2,
        maxConcurrent: 1,
        maxRounds: 1,
        deadlineMs: 15 * 60_000,
        maxOutputBytes: 512 * 1024,
      },
      memberFailure: 'fail',
    },
    'research-panel': {
      description: 'Run independent research in parallel and deterministically synthesize the panel.',
      team: 'research-panel',
      stages: [
        {
          kind: 'fanout',
          id: 'research',
          member: 'researchers',
          count: 3,
          minSuccess: 2,
          allowDegraded: true,
          inputs: [{ artifact: 'objective', contract: 'objective-v1' }],
          output: { artifact: 'findings', contract: 'text' },
          prompt: 'Investigate independently and return source-grounded findings.',
        },
        {
          kind: 'synthesize',
          id: 'synthesis',
          member: 'synthesizer',
          inputs: [{ artifact: 'findings', contract: 'text', collection: true, optional: true }],
          output: { artifact: 'synthesis', contract: 'text' },
          prompt: 'Synthesize the panel in canonical member order and preserve disagreement.',
        },
      ],
      completion: { artifact: 'synthesis', contract: 'text' },
      limits: {
        maxAgents: 4,
        maxConcurrent: 3,
        maxRounds: 1,
        deadlineMs: 15 * 60_000,
        maxOutputBytes: 1024 * 1024,
      },
      memberFailure: 'allow-partial',
    },
    'plan-execute-review': {
      description: 'Plan, execute, review, then permit one bounded repair goal activation.',
      team: 'plan-execute-review',
      stages: [
        {
          kind: 'delegate',
          id: 'plan',
          member: 'planner',
          inputs: [{ artifact: 'objective', contract: 'objective-v1' }],
          output: { artifact: 'plan', contract: 'text' },
          prompt: 'Produce a bounded execution plan.',
        },
        {
          kind: 'delegate',
          id: 'execute',
          member: 'executor',
          inputs: [
            { artifact: 'objective', contract: 'objective-v1' },
            { artifact: 'plan', contract: 'text' },
          ],
          output: { artifact: 'execution', contract: 'text' },
          prompt: 'Execute the plan and return evidence.',
        },
        {
          kind: 'delegate',
          id: 'review',
          member: 'reviewer',
          inputs: [
            { artifact: 'plan', contract: 'text' },
            { artifact: 'execution', contract: 'text' },
          ],
          output: { artifact: 'review', contract: 'review-v1' },
          prompt: 'Review plan adherence and execution evidence.',
        },
        {
          kind: 'goal',
          id: 'repair',
          member: 'executor',
          maxRounds: 1,
          inputs: [
            { artifact: 'execution', contract: 'text' },
            { artifact: 'review', contract: 'review-v1' },
          ],
          output: { artifact: 'final', contract: 'text' },
          prompt: 'If required, perform at most one repair activation; otherwise preserve the evidence.',
        },
      ],
      completion: { artifact: 'final', contract: 'text' },
      limits: {
        maxAgents: 4,
        maxConcurrent: 1,
        maxRounds: 1,
        deadlineMs: 30 * 60_000,
        maxOutputBytes: 1024 * 1024,
      },
      memberFailure: 'fail',
    },
  },
} as const satisfies CatalogLayer<never>
