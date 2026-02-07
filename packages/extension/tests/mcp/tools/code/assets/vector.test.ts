import { afterEach, describe, expect, it, vi } from 'vitest'

import { ensureAssetUploaded } from '@/mcp/assets'
import {
  exportSvgEntry,
  extractSvgAttributes,
  transformSvgAttributes
} from '@/mcp/tools/code/assets/vector'
import { logger } from '@/utils/log'
import { toDecimalPlace } from '@/utils/number'

vi.mock('@/mcp/assets', () => ({
  ensureAssetUploaded: vi.fn()
}))

vi.mock('@/utils/log', () => ({
  logger: {
    warn: vi.fn()
  }
}))

const remConfig = {
  cssUnit: 'rem',
  rootFontSize: 16,
  scale: 1
} as const

const pxConfig = {
  cssUnit: 'px',
  rootFontSize: 16,
  scale: 1
} as const

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('assets/vector', () => {
  it('exports svg entry and uploads svg asset with normalized dimensions', async () => {
    const svg = '<svg width="16" height="32px" viewBox="0 0 16 32"></svg>'
    const bytes = new TextEncoder().encode(svg)
    const node = {
      width: 16,
      height: 32,
      exportAsync: vi.fn(async () => bytes)
    } as unknown as SceneNode

    const asset = {
      hash: 'asset-hash',
      resourceUri: 'mcp-asset://hash',
      mimeType: 'image/svg+xml',
      url: 'http://assets.test/hash.svg',
      size: bytes.byteLength
    }
    vi.mocked(ensureAssetUploaded).mockResolvedValue(asset)

    const registry = new Map<string, typeof asset | unknown>()
    const result = await exportSvgEntry(node, remConfig, registry as Map<string, never>)

    expect(result).toEqual({
      props: {
        width: '1rem',
        height: '2rem',
        viewBox: '0 0 16 32',
        'data-resource-uri': 'mcp-asset://hash'
      }
    })
    expect(ensureAssetUploaded).toHaveBeenCalledWith(bytes, 'image/svg+xml', {
      width: 16,
      height: 32
    })
    expect(registry.get('asset-hash')).toEqual(asset)
  })

  it('inlines raw svg when no root attributes are parsed (TextDecoder fallback path)', async () => {
    vi.stubGlobal('TextDecoder', undefined)

    const bytes = Uint8Array.from([60, 115, 118, 103, 62, 60, 47, 115, 118, 103, 62]) // <svg></svg>
    const node = {
      width: 10,
      height: 20,
      exportAsync: vi.fn(async () => bytes)
    } as unknown as SceneNode

    const result = await exportSvgEntry(node, pxConfig, new Map())

    expect(result).toEqual({
      props: {},
      raw: '<svg></svg>'
    })
    expect(ensureAssetUploaded).not.toHaveBeenCalled()
  })

  it('falls back to raw svg when uploading vector asset fails', async () => {
    const svg = '<svg width="20" height="10"></svg>'
    const bytes = new TextEncoder().encode(svg)
    const node = {
      width: 20,
      height: 10,
      exportAsync: vi.fn(async () => bytes)
    } as unknown as SceneNode

    vi.mocked(ensureAssetUploaded).mockRejectedValue(new Error('upload failed'))
    const result = await exportSvgEntry(node, pxConfig, new Map())

    expect(result).toEqual({
      props: {
        width: '20px',
        height: '10px'
      },
      raw: '<svg width="20px" height="10px"></svg>'
    })
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to upload vector asset; inlining raw SVG.',
      expect.any(Error)
    )
  })

  it('returns minimal fallback when exporting svg throws', async () => {
    const node = {
      width: 10.456,
      height: 20.123,
      exportAsync: vi.fn(async () => {
        throw new Error('export failed')
      })
    } as unknown as SceneNode

    const result = await exportSvgEntry(node, pxConfig, new Map())

    expect(result).toEqual({
      props: {
        width: `${toDecimalPlace(10.456)}px`,
        height: `${toDecimalPlace(20.123)}px`
      },
      raw: '<svg></svg>'
    })
    expect(logger.warn).toHaveBeenCalledWith('Failed to export vector node:', expect.any(Error))
  })

  it('normalizes width and height attributes with configured css units', () => {
    const svg = '<svg width="16" height="32px" preserveAspectRatio="none"></svg>'

    expect(transformSvgAttributes(svg, remConfig)).toBe(
      '<svg width="1rem" height="2rem" preserveAspectRatio="none"></svg>'
    )
  })

  it('extracts svg attributes and handles non-svg inputs', () => {
    expect(extractSvgAttributes("<svg width='12px' height=\"24px\" role='img'></svg>")).toEqual({
      width: '12px',
      height: '24px',
      role: 'img'
    })
    expect(extractSvgAttributes('<div></div>')).toEqual({})
  })
})
