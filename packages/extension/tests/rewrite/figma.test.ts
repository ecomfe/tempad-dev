import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  GROUPS: [{ markers: ['x'], replacements: [{ pattern: 'x', replacer: 'y' }] }],
  rewriteCurrentScript: vi.fn()
}))

vi.mock('@/rewrite/config', () => ({
  GROUPS: mocks.GROUPS
}))

vi.mock('@/rewrite/runtime', () => ({
  rewriteCurrentScript: mocks.rewriteCurrentScript
}))

describe('rewrite/figma', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('runs script rewriting at module load using the configured groups', async () => {
    await import('@/rewrite/figma')

    expect(mocks.rewriteCurrentScript).toHaveBeenCalledTimes(1)
    expect(mocks.rewriteCurrentScript).toHaveBeenCalledWith(mocks.GROUPS)
  })
})
