import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  layoutOnly: vi.fn(),
  prepareStyles: vi.fn()
}))

vi.mock('@/mcp/tools/code/styles/normalize', () => ({
  layoutOnly: mocks.layoutOnly
}))

vi.mock('@/mcp/tools/code/styles/prepare', () => ({
  prepareStyles: mocks.prepareStyles
}))

import * as stylesIndex from '@/mcp/tools/code/styles/index'

describe('styles/index exports', () => {
  it('re-exports style normalize and prepare helpers', () => {
    expect(stylesIndex.layoutOnly).toBe(mocks.layoutOnly)
    expect(stylesIndex.prepareStyles).toBe(mocks.prepareStyles)
  })
})
