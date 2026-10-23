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
  it.each([
    '<svg xmlns:s="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><s:script>ignored()</s:script></svg>',
    '<svg viewBox="0 0 1 1"><g xmlns="http://www.w3.org/1999/xhtml"><div/></g></svg>',
    '<svg viewBox="0 0 1 1"><unknown:path/></svg>'
  ])('validates expanded element names before native import: %s', async (svg) => {
    await expect(resolveCanvasAssets(svgAssets(svg), colors())).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.SVG_INVALID
    })
  })

  it('checks cycles through namespaced SVG use elements', async () => {
    await expect(
      resolveCanvasAssets(
        svgAssets(
          '<svg xmlns:s="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><g id="a"><s:use href="#a"/></g></svg>'
        ),
        colors()
      )
    ).rejects.toMatchObject({ code: TEMPAD_MCP_ERROR_CODES.SVG_TOO_COMPLEX })
  })

  it.each([
    String.raw`u\72l(https://example.com/paint.svg#p)`,
    'u&#114;l(https://example.com/paint.svg#p)'
  ])('rejects external CSS URLs after decoding syntax: %s', async (fill) => {
    await expect(
      resolveCanvasAssets(
        svgAssets(`<svg viewBox="0 0 1 1"><path fill="${fill}"/></svg>`),
        colors()
      )
    ).rejects.toMatchObject({ code: TEMPAD_MCP_ERROR_CODES.SVG_EXTERNAL_REFERENCE })
  })

  it.each(['current&#67;olor', String.raw`curr\65 ntColor`])(
    'preserves local references and resolves %s once',
    async (fill) => {
      const assets = await resolveCanvasAssets(
        svgAssets(
          `<svg xmlns:s="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><defs><path id="shape" fill="${fill}"/></defs><s:use href="&#35;shape"/></svg>`
        ),
        colors('#336699')
      )
      expect(resolvedSvgAsset(assets, 'icon', '#336699')?.svg).toContain('href="#shape"')
      expect(resolvedSvgAsset(assets, 'icon', '#336699')?.svg).toContain('fill="#336699"')
    }
  )

  it('keeps an escaped local CSS URL available to the SVG importer', async () => {
    const source = String.raw`<svg viewBox="0 0 1 1"><defs><linearGradient id="g"/></defs><path fill="u\72l(#g)"/></svg>`
    const assets = await resolveCanvasAssets(svgAssets(source), colors())
    expect(resolvedSvgAsset(assets, 'icon', undefined)?.svg).toContain(String.raw`fill="u\72l(#g)"`)
  })

  it('bounds repeated and cyclic use expansion before native import', async () => {
    const repeated = `<svg viewBox="0 0 1 1"><defs><g id="a"><path d="M0 0z"/></g><g id="b">${'<use href="#a"/>'.repeat(20)}</g></defs>${'<use href="#b"/>'.repeat(20)}</svg>`
    for (const svg of [repeated, '<svg viewBox="0 0 1 1"><g id="a"><use href="#a"/></g></svg>']) {
      await expect(resolveCanvasAssets(svgAssets(svg), colors())).rejects.toMatchObject({
        code: TEMPAD_MCP_ERROR_CODES.SVG_TOO_COMPLEX
      })
    }
    await expect(
      resolveCanvasAssets(
        svgAssets(
          '<svg viewBox="0 0 1 1"><defs><path id="p" d="M0 0z"/></defs><use href="#p"/></svg>'
        ),
        colors()
      )
    ).resolves.toBeInstanceOf(Map)
  })
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

  it('leaves currentColor substrings in identifiers and references unchanged', async () => {
    const assets = await resolveCanvasAssets(
      svgAssets(
        '<svg viewBox="0 0 24 24"><defs><linearGradient id="currentColor-gradient"><stop stop-color="#112233"/></linearGradient></defs><path id="currentColor-path" aria-label="currentColor icon" fill="url(#currentColor-gradient)" d="M0 0h24v24z"/></svg>'
      ),
      colors()
    )
    const resolved = resolvedSvgAsset(assets, 'icon', undefined)

    expect(resolved?.svg).toContain('id="currentColor-gradient"')
    expect(resolved?.svg).toContain('id="currentColor-path"')
    expect(resolved?.svg).toContain('aria-label="currentColor icon"')
    expect(resolved?.svg).toContain('fill="url(#currentColor-gradient)"')
  })

  it('validates every prefix bound to the XLink namespace', async () => {
    await expect(
      resolveCanvasAssets(
        svgAssets(
          '<svg xmlns:link="http://www.w3.org/1999/xlink" viewBox="0 0 1 1"><use link:href="https://example.com/icon.svg#shape"/></svg>'
        ),
        colors()
      )
    ).rejects.toMatchObject({ code: TEMPAD_MCP_ERROR_CODES.SVG_EXTERNAL_REFERENCE })

    await expect(
      resolveCanvasAssets(
        svgAssets(
          '<svg xmlns:link="http://www.w3.org/1999/xlink" viewBox="0 0 1 1"><defs><path id="shape" d="M0 0z"/></defs><use link:href="#shape"/></svg>'
        ),
        colors()
      )
    ).resolves.toBeInstanceOf(Map)
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
