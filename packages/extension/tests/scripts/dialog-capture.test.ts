import type { CDPSession } from 'playwright'

import { describe, expect, it, vi } from 'vitest'

import { captureDialogPng } from '../../screenshots/dialog-capture.mjs'

const clip = { x: 0, y: 0, width: 600, height: 480, scale: 1 }

describe('transparent dialog capture', () => {
  it('returns the native PNG and restores the page after capture', async () => {
    const send = vi.fn(async (method: string) =>
      method === 'Page.captureScreenshot' ? { data: 'native-png' } : {}
    )
    await expect(captureDialogPng(send as CDPSession['send'], clip)).resolves.toEqual({
      data: 'native-png'
    })
    expect(send).toHaveBeenCalledWith('Emulation.setDefaultBackgroundColorOverride', {
      color: { r: 0, g: 0, b: 0, a: 0 }
    })
    expect(send.mock.calls.at(-2)).toEqual([
      'Runtime.evaluate',
      { expression: "document.querySelector('#tempad-dialog-capture')?.remove()" }
    ])
    expect(send).toHaveBeenLastCalledWith('Emulation.setDefaultBackgroundColorOverride', {})
  })

  it('restores both overrides when screenshot capture fails', async () => {
    const send = vi.fn(async (method: string) => {
      if (method === 'Page.captureScreenshot') throw new Error('Capture failed')
      return {}
    })
    await expect(captureDialogPng(send as CDPSession['send'], clip)).rejects.toThrow(
      'Capture failed'
    )
    expect(send.mock.calls.at(-2)?.[0]).toBe('Runtime.evaluate')
    expect(send).toHaveBeenLastCalledWith('Emulation.setDefaultBackgroundColorOverride', {})
  })

  it('still restores the transparent surface if removing capture styles fails', async () => {
    const send = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === 'Runtime.evaluate' && String(params.expression).includes('?.remove()')) {
        throw new Error('Page detached')
      }
      return {}
    })
    await expect(captureDialogPng(send as CDPSession['send'], clip)).rejects.toThrow(
      'Page detached'
    )
    expect(send).toHaveBeenLastCalledWith('Emulation.setDefaultBackgroundColorOverride', {})
  })
})
