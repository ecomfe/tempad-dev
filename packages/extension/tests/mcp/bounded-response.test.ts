import { describe, expect, it, vi } from 'vitest'

import { readBoundedResponseBytes } from '@/mcp/bounded-response'

describe('bounded response reads', () => {
  it.each(['header', 'stream'] as const)(
    'cancels an oversized %s response and releases its reader',
    async (source) => {
      const cancel = vi.fn()
      const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
        controller.enqueue(new Uint8Array(5))
      })
      const body = new ReadableStream({ pull, cancel }, { highWaterMark: 0 })
      const response = new Response(body, {
        headers: source === 'header' ? { 'content-length': '5' } : {}
      })
      const error = new Error('Response exceeds the byte limit')

      await expect(readBoundedResponseBytes(response, 4, () => error)).rejects.toBe(error)

      expect(cancel).toHaveBeenCalledOnce()
      expect(body.locked).toBe(false)
      if (source === 'header') expect(pull).not.toHaveBeenCalled()
      const reader = body.getReader()
      expect(await reader.read()).toEqual({ done: true, value: undefined })
      reader.releaseLock()
    }
  )

  it('preserves the size error when cancelling an unread response fails', async () => {
    const cancel = vi.fn(() => Promise.reject(new Error('Producer cancellation failed')))
    const body = new ReadableStream({ cancel })
    const response = new Response(body, { headers: { 'content-length': '5' } })
    const error = new Error('Response exceeds the byte limit')

    await expect(readBoundedResponseBytes(response, 4, () => error)).rejects.toBe(error)
    expect(cancel).toHaveBeenCalledOnce()
    expect(body.locked).toBe(false)
    const reader = body.getReader()
    expect(await reader.read()).toEqual({ done: true, value: undefined })
    reader.releaseLock()
  })

  it('retains bytes at the limit and releases the completed reader', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(Uint8Array.of(1, 2))
        controller.enqueue(Uint8Array.of(3, 4))
        controller.close()
      },
      cancel
    })

    expect(
      await readBoundedResponseBytes(new Response(body), 4, () => new Error('Too large'))
    ).toEqual(Uint8Array.of(1, 2, 3, 4))
    expect(body.locked).toBe(false)
    expect(cancel).not.toHaveBeenCalled()
  })
})
