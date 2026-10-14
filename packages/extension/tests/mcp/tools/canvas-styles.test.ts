import { describe, expect, it, vi } from 'vitest'

import { getLocalStyles } from '@/mcp/local-resources'
import { createStyleState, resolveStyle } from '@/mcp/tools/canvas/styles'

vi.mock('@/mcp/local-resources', () => ({ getLocalStyles: vi.fn() }))

describe('canvas style indexing', () => {
  const style = {
    id: 'style:1',
    key: 'published-key',
    getSharedPluginData: () => 'surface'
  } as unknown as PaintStyle

  it('shares a pending index between concurrent lookups', async () => {
    const pending = Promise.withResolvers<PaintStyle[]>()
    vi.mocked(getLocalStyles).mockReturnValueOnce(pending.promise)
    const state = createStyleState()
    const first = resolveStyle({ styleKey: 'surface' }, state)
    const second = resolveStyle({ styleKey: 'surface' }, state)
    pending.resolve([style])
    await expect(Promise.all([first, second])).resolves.toEqual([style, style])
  })

  it('retries indexing after a transient read failure', async () => {
    vi.mocked(getLocalStyles)
      .mockRejectedValueOnce(new Error('temporarily unavailable'))
      .mockResolvedValueOnce([style])
    const state = createStyleState()
    await expect(resolveStyle({ styleKey: 'surface' }, state)).rejects.toThrow(
      'temporarily unavailable'
    )
    await expect(resolveStyle({ styleKey: 'surface' }, state)).resolves.toBe(style)
  })
})
