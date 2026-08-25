import { describe, expect, it } from 'vitest'

import { decodeImageDataUrl } from '../src/asset-data-url'

describe('generated image data URL import', () => {
  it('decodes supported content and returns a stable SHA-256 hash', () => {
    const result = decodeImageDataUrl('data:image/png;base64,aGVsbG8=')

    expect(result.bytes.toString()).toBe('hello')
    expect(result.mimeType).toBe('image/png')
    expect(result.hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  })

  it('rejects invalid, unsupported, empty, or oversized content', () => {
    expect(() => decodeImageDataUrl('data:image/webp;base64,aGVsbG8=')).toThrow(
      'Expected a base64 PNG, JPEG, or GIF data URL.'
    )
    expect(() => decodeImageDataUrl('data:image/png;base64,YQ')).toThrow('invalid base64 padding')
    expect(() => decodeImageDataUrl('data:image/png;base64,====')).toThrow(
      'Expected a base64 PNG, JPEG, or GIF data URL.'
    )
    expect(() => decodeImageDataUrl('data:image/png;base64,aGVsbG8=', 4)).toThrow(
      'exceeds the 4-byte asset limit'
    )
  })
})
