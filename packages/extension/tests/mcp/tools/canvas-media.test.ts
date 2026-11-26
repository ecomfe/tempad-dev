import { TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { handleApplyCanvas } from '@/mcp/tools/canvas'
import { createMediaState, importCanvasMedia } from '@/mcp/tools/canvas/media'

afterEach(() => vi.unstubAllGlobals())

describe('Canvas media import', () => {
  it.each([
    [{ type: 'VIDEO', videoUrl: 'http://example.com/video.mp4' }, 'public HTTPS'],
    [{ type: 'IMAGE', imageUrl: 'http://localhost/image.png' }, 'assetKey']
  ] as const)('rejects blocked media before importing a sibling image', async (source, message) => {
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
                { ...source, scaleMode: 'FILL' }
              ]
            }
          }
        }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_ABORTED,
      message: expect.stringContaining(message)
    })
    expect(createImageAsync).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('imports public HTTP images through Figma and checks the URL at native import', async () => {
    const createImageAsync = vi.fn().mockResolvedValue({ hash: 'native-image' })
    vi.stubGlobal('figma', { createImageAsync })
    const state = createMediaState(new Map())
    const publicUrl = 'http://media.example.com/image.png'
    state.imageUrls.set(publicUrl, 'cover')
    await importCanvasMedia(state)
    expect(state.imageHashes.get(publicUrl)).toBe('native-image')
    expect(createImageAsync).toHaveBeenCalledWith(publicUrl)
    state.imageUrls.clear()
    state.imageUrls.set('https://user@media.example.com/image.png', 'cover')
    await expect(importCanvasMedia(state)).rejects.toThrow('assetKey')
    expect(createImageAsync).toHaveBeenCalledTimes(1)
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
