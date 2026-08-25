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
    expect(renderCoordinatorGuidance(createCoordinatorCatalog(input)))
      .toContain('Configured profiles:')
    expect(() => renderCoordinatorGuidance(input as unknown as CoordinatorCatalog))
      .toThrow(/requires a compiler-owned catalog/)
  })
})
