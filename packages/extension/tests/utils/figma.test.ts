import { afterEach, describe, expect, it, vi } from 'vitest'

import { getCanvas, getLeftPanel } from '@/utils/figma'

describe('utils/figma', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('queries the canvas using the expected selector', () => {
    const canvas = { id: 'canvas' } as unknown as HTMLElement
    const querySelector = vi.fn().mockReturnValue(canvas)
    vi.stubGlobal('document', { querySelector })

    const result = getCanvas()

    expect(querySelector).toHaveBeenCalledWith('#fullscreen-root .gpu-view-content canvas')
    expect(result).toBe(canvas)
  })

  it('prefers left-panel-container and falls back to island container selector', () => {
    const primary = { id: 'left-panel' } as unknown as HTMLElement
    const querySelectorPrimary = vi.fn().mockReturnValueOnce(primary)
    vi.stubGlobal('document', { querySelector: querySelectorPrimary })

    expect(getLeftPanel()).toBe(primary)
    expect(querySelectorPrimary).toHaveBeenCalledTimes(1)
    expect(querySelectorPrimary).toHaveBeenCalledWith('#left-panel-container')

    const fallback = { id: 'fallback-panel' } as unknown as HTMLElement
    const querySelectorFallback = vi.fn().mockReturnValueOnce(null).mockReturnValueOnce(fallback)
    vi.stubGlobal('document', { querySelector: querySelectorFallback })

    expect(getLeftPanel()).toBe(fallback)
    expect(querySelectorFallback).toHaveBeenNthCalledWith(1, '#left-panel-container')
    expect(querySelectorFallback).toHaveBeenNthCalledWith(
      2,
      '[class*="left_panel_island_container"]'
    )
  })
})
