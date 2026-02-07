import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  renderTextSegments: vi.fn()
}))

vi.mock('@/mcp/tools/code/text/render', () => ({
  renderTextSegments: mocks.renderTextSegments
}))

import * as textIndex from '@/mcp/tools/code/text/index'

describe('text/index exports', () => {
  it('re-exports text rendering entrypoint', () => {
    expect(textIndex.renderTextSegments).toBe(mocks.renderTextSegments)
  })
})
