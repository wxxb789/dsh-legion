import { describe, expect, it } from 'vitest'
import {
  createCoordinatorCatalog,
  renderCoordinatorGuidance,
  type CoordinatorCatalog,
} from '../src/prompt.ts'

describe('compiler-owned coordinator guidance', () => {
  const input = {
    toolName: 'legion',
    enableRunInBackground: false,
    specialists: {
      quick: {
        description: 'Quick work.',
        subagentProvider: 'spawn',
        maxDepth: 1,
        defaultRunInBackground: false,
        result: 'text' as const,
      },
    },
  }

  it('renders only a branded compiler-owned catalog', () => {
    const guidance = renderCoordinatorGuidance(createCoordinatorCatalog(input))
    expect(guidance).toContain('Configured Specialists:')
    expect(guidance).not.toMatch(/\b(?:profile|team)s?\b/iu)
    expect(() => renderCoordinatorGuidance(input as unknown as CoordinatorCatalog))
      .toThrow(/requires a compiler-owned catalog/)
  })
})
