import { TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { handleApplyCanvas } from '@/mcp/tools/canvas'
import { createMediaState, importCanvasMedia } from '@/mcp/tools/canvas/media'

afterEach(() => vi.unstubAllGlobals())

describe('Canvas video response cleanup', () => {
  it('rejects a blocked video before importing any sibling image', async () => {
    const createImageAsync = vi.fn()
    const fetch = vi.fn()
    vi.stubGlobal('window', { INITIAL_OPTIONS: { editor_type: 'design' } })
    vi.stubGlobal('figma', { createImageAsync })
    vi.stubGlobal('fetch', fetch)

    await expect(
      handleApplyCanvas({
        mode: 'create',
        markup: '<div data-key="root" class="w-20 h-20"/>',
        native: {
          root: {
            figma: {
              fills: [
                { type: 'IMAGE', imageUrl: 'https://example.com/image.png', scaleMode: 'FILL' },
                { type: 'VIDEO', videoUrl: 'http://example.com/video.mp4', scaleMode: 'FILL' }
              ]
            }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_ABORTED,
      message: expect.stringContaining('public HTTPS')
    })
    expect(createImageAsync).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('cancels a rejected HTTP response before native import', async () => {
    const cancel = vi.fn()
    const pull = vi.fn()
    const body = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 })
    const createVideoAsync = vi.fn()
    vi.stubGlobal('figma', { createVideoAsync })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 403 })))
    const state = createMediaState(new Map())
    state.videoUrls.add('https://media.example.com/video.mp4')

    await expect(importCanvasMedia(state)).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_ABORTED,
      message: expect.stringContaining('Video download failed')
    })

    expect(cancel).toHaveBeenCalledOnce()
    expect(pull).not.toHaveBeenCalled()
    expect(createVideoAsync).not.toHaveBeenCalled()
    expect(state.videoHashes.size).toBe(0)
  })
})
