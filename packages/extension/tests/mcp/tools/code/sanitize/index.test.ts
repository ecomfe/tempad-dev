import { describe, expect, it, vi } from 'vitest'

import type { VisibleTree } from '@/mcp/tools/code/model'

const mocks = vi.hoisted(() => ({
  patchNegativeGapStyles: vi.fn(),
  ensureRelativeForAbsoluteChildren: vi.fn(),
  applyAbsoluteStackingOrder: vi.fn()
}))

vi.mock('@/mcp/tools/code/sanitize/negative-gap', () => ({
  patchNegativeGapStyles: mocks.patchNegativeGapStyles
}))

vi.mock('@/mcp/tools/code/sanitize/relative-parent', () => ({
  ensureRelativeForAbsoluteChildren: mocks.ensureRelativeForAbsoluteChildren
}))

vi.mock('@/mcp/tools/code/sanitize/stacking', () => ({
  applyAbsoluteStackingOrder: mocks.applyAbsoluteStackingOrder
}))

import { sanitizeStyles } from '@/mcp/tools/code/sanitize'

describe('sanitize/index sanitizeStyles', () => {
  it('applies all style patches in declared order', () => {
    const tree = { nodes: new Map(), order: [] } as unknown as VisibleTree
    const styles = new Map<string, Record<string, string>>()
    const svgRoots = new Set<string>(['svg-root'])

    sanitizeStyles(tree, styles, svgRoots)

    expect(mocks.patchNegativeGapStyles).toHaveBeenCalledWith(tree, styles, svgRoots)
    expect(mocks.ensureRelativeForAbsoluteChildren).toHaveBeenCalledWith(tree, styles, svgRoots)
    expect(mocks.applyAbsoluteStackingOrder).toHaveBeenCalledWith(tree, styles, svgRoots)

    expect(mocks.patchNegativeGapStyles.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.ensureRelativeForAbsoluteChildren.mock.invocationCallOrder[0]
    )
    expect(mocks.ensureRelativeForAbsoluteChildren.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.applyAbsoluteStackingOrder.mock.invocationCallOrder[0]
    )
  })

  it('passes undefined svg roots through to every patch', () => {
    const tree = { nodes: new Map(), order: [] } as unknown as VisibleTree
    const styles = new Map<string, Record<string, string>>()

    sanitizeStyles(tree, styles)

    expect(mocks.patchNegativeGapStyles).toHaveBeenLastCalledWith(tree, styles, undefined)
    expect(mocks.ensureRelativeForAbsoluteChildren).toHaveBeenLastCalledWith(
      tree,
      styles,
      undefined
    )
    expect(mocks.applyAbsoluteStackingOrder).toHaveBeenLastCalledWith(tree, styles, undefined)
  })
})
