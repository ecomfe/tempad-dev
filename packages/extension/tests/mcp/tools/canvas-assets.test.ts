import type { CanvasAssets } from '@tempad-dev/shared'

import { TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'
import { describe, expect, it } from 'vitest'

import { resolveCanvasAssets, resolvedSvgAsset } from '@/mcp/tools/canvas/assets'

function svgAssets(svg: string): CanvasAssets {
  return { icon: { type: 'SVG', svg } }
}

function colors(color?: string): Map<string, Set<string | undefined>> {
  return new Map([['icon', new Set([color])]])
}

describe('mcp/tools/canvas SVG assets', () => {
  it('keeps local SVG structure while resolving currentColor deterministically', async () => {
    const assets = await resolveCanvasAssets(
      svgAssets(
        '<svg viewBox="0 0 24 24"><defs><linearGradient id="g"><stop stop-color="currentColor"/></linearGradient></defs><path fill="url(#g)" d="M0 0h24v24z"/></svg>'
      ),
      colors('#336699')
    )
    const resolved = resolvedSvgAsset(assets, 'icon', '#336699')

    expect(resolved).toMatchObject({ height: 24, type: 'SVG', width: 24 })
    expect(resolved?.svg).toContain('stop-color="#336699"')
    expect(resolved?.svg).toContain('fill="url(#g)"')
    expect(resolved?.digest).toMatch(/^[a-f0-9]{64}$/)
  })

  it.each([
    ['<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>', TEMPAD_MCP_ERROR_CODES.SVG_INVALID],
    [
      '<svg viewBox="0 0 1 1"><image href="https://example.com/a.png"/></svg>',
      TEMPAD_MCP_ERROR_CODES.SVG_INVALID
    ],
    [
      '<svg viewBox="0 0 1 1"><use href="https://example.com/a.svg#x"/></svg>',
      TEMPAD_MCP_ERROR_CODES.SVG_EXTERNAL_REFERENCE
    ],
    [
      '<svg viewBox="0 0 1 1"><path style="fill:red" d="M0 0z"/></svg>',
      TEMPAD_MCP_ERROR_CODES.SVG_INVALID
    ],
    ['<svg viewBox="0 0 0 1"><path d="M0 0z"/></svg>', TEMPAD_MCP_ERROR_CODES.SVG_INVALID]
  ])('rejects unsafe or invalid SVG input', async (svg, code) => {
    await expect(resolveCanvasAssets(svgAssets(svg), colors())).rejects.toMatchObject({ code })
  })

  it('rejects unresolved currentColor and excessive element counts', async () => {
    await expect(
      resolveCanvasAssets(
        svgAssets('<svg viewBox="0 0 1 1"><path fill="currentColor" d="M0 0z"/></svg>'),
        colors()
      )
    ).rejects.toMatchObject({ code: TEMPAD_MCP_ERROR_CODES.SVG_INVALID })

    await expect(
      resolveCanvasAssets(
        svgAssets(`<svg viewBox="0 0 1 1">${'<path d="M0 0z"/>'.repeat(500)}</svg>`),
        colors()
      )
    ).rejects.toMatchObject({ code: TEMPAD_MCP_ERROR_CODES.SVG_TOO_COMPLEX })
  })

  it('does not sanitize SVG declarations that are outside the referenced result', async () => {
    const assets = await resolveCanvasAssets(
      svgAssets('<svg viewBox="0 0 1 1"><path fill="currentColor" d="M0 0z"/></svg>'),
      new Map()
    )

    expect(resolvedSvgAsset(assets, 'icon', undefined)).toBeUndefined()
  })
})
