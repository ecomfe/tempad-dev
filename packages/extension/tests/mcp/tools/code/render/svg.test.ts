import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => ({
  styleToClassNames: vi.fn((style: Record<string, string>) => {
    const classes: string[] = []
    if (style.position === 'relative') classes.push('relative')
    if (style.color === 'var(--icon-color)') classes.push('text-[var(--icon-color)]')
    return classes
  })
}))

vi.mock('@/mcp/tools/code/styles', () => ({
  styleToClassNames: mocked.styleToClassNames
}))
vi.mock('@/mcp/assets', () => ({ ensureAssetUploaded: vi.fn() }))

import { ensureAssetUploaded } from '@/mcp/assets'
import { exportSvgEntry } from '@/mcp/tools/code/assets/vector'
import { renderTree } from '@/mcp/tools/code/render'
import { createSnapshot, createTree } from '@/tests/mcp/tools/code/test-helpers'
import { stringifyComponent } from '@/utils/component'

describe('mcp/code render svg', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(
    ['none', 'outside-stroke', 'shadow', 'rotation'].flatMap((effect) => [
      { effect, layout: { width: 'var(--icon-width)', height: 'var(--icon-height)' } },
      { effect, layout: { width: '100%', height: 'auto', 'align-self': 'stretch' } }
    ])
  )(
    'preserves flow sizing through export and render: $effect $layout',
    async ({ effect, layout }) => {
      const root = createSnapshot({ id: 'icon', type: 'VECTOR' })
      const rotated = effect === 'rotation'
      const transform: Transform = rotated
        ? [
            [0, -1, 48],
            [1, 0, 0]
          ]
        : [
            [1, 0, 0],
            [0, 1, 0]
          ]
      const bounds =
        effect === 'outside-stroke'
          ? { x: -12, y: -12, width: 88, height: 72 }
          : { x: 0, y: 0, width: 88, height: 68 }
      Object.assign(root.node, {
        width: 64,
        height: 48,
        relativeTransform: transform,
        absoluteTransform: transform,
        ...(effect === 'outside-stroke' || effect === 'shadow'
          ? { absoluteRenderBounds: bounds }
          : {}),
        exportAsync: async () =>
          new TextEncoder().encode('<svg viewBox="0 0 64 48"><path d="M0 0H64V48H0Z"/></svg>')
      })
      vi.mocked(ensureAssetUploaded).mockResolvedValue({
        hash: 'icon',
        url: 'https://assets.test/icon.svg',
        mimeType: 'image/svg+xml',
        size: 1
      })
      const config = { cssUnit: 'px', rootFontSize: 16, scale: 1 } as const
      const entry = await exportSvgEntry(root.node, config, new Map(), { flow: true })
      expect(Boolean(entry?.wrapper)).toBe(effect === 'outside-stroke' || effect === 'shadow')
      await renderTree(root.id, createTree([root]), {
        styles: new Map(),
        layout: new Map([[root.id, layout]]),
        nodes: new Map([[root.id, root.node]]),
        svgs: new Map([[root.id, entry]]),
        textSegments: new Map(),
        config,
        preferredLang: 'jsx'
      } as never)
      expect(mocked.styleToClassNames).toHaveBeenCalledWith(
        expect.objectContaining({
          ...layout,
          ...(rotated ? { width: '48px', height: '64px' } : {})
        }),
        config
      )
    }
  )

  it.each([false, true])(
    'preserves the layout box around an expanded SVG viewport (inline: %s)',
    async (inline) => {
      const root = createSnapshot({ id: 'rotated', type: 'VECTOR' })
      const tree = createTree([root])
      const config = { cssUnit: 'px', rootFontSize: 16, scale: 1 } as const
      const result = await renderTree(root.id, tree, {
        styles: new Map(),
        layout: new Map([[root.id, { position: 'absolute', left: '-30px', top: '-40px' }]]),
        nodes: new Map([[root.id, root.node]]),
        svgs: new Map([
          [
            root.id,
            {
              props: {
                width: '460px',
                height: '440px',
                viewBox: '-70 -100 460 440',
                'data-src': 'https://assets.test/rotated.svg'
              },
              wrapper: { width: '320px', height: '240px', left: '-70px', top: '-100px' },
              presentationStyle: {
                transform: 'matrix(0, 1, -1, 0, 0, 0)',
                'transform-origin': '0 0'
              },
              ...(inline
                ? {
                    raw: '<svg width="460px" height="440px" viewBox="-70 -100 460 440"><path d="M0 0H320V240Z"/></svg>'
                  }
                : {})
            }
          ]
        ]),
        textSegments: new Map(),
        config,
        preferredLang: 'vue'
      } as never)
      expect(mocked.styleToClassNames).toHaveBeenCalledWith(
        {
          position: 'absolute',
          left: '-30px',
          top: '-40px',
          width: '320px',
          height: '240px',
          transform: 'matrix(0, 1, -1, 0, 0, 0)',
          'transform-origin': '0 0'
        },
        config
      )
      expect(mocked.styleToClassNames).toHaveBeenCalledWith(
        { position: 'absolute', left: '-70px', top: '-100px' },
        config
      )
      const markup = stringifyComponent(result as never, { lang: 'vue' })
      expect(markup).toMatch(/^<div[\s>]/)
      expect(markup).toContain('width="460px"')
      expect(markup).toContain('viewBox="-70 -100 460 440"')
      expect(markup.includes('<path')).toBe(inline)
    }
  )

  it('renders vector placeholders as svg nodes with data-src and presentation color', async () => {
    const root = createSnapshot({ id: 'icon', type: 'VECTOR' })
    root.bounds = { x: 0, y: 0, width: 16, height: 16 }
    const tree = createTree([root])

    const rendered = await renderTree('icon', tree, {
      styles: new Map(),
      layout: new Map([['icon', { position: 'relative' }]]),
      nodes: new Map([['icon', root.node]]),
      svgs: new Map([
        [
          'icon',
          {
            props: {
              width: '16px',
              height: '16px',
              viewBox: '0 0 16 16',
              'data-src': 'https://assets.test/icon.svg'
            },
            presentationStyle: {
              color: 'var(--icon-color)'
            }
          }
        ]
      ]),
      textSegments: new Map(),
      config: { cssUnit: 'px', rootFontSize: 16, scale: 1 },
      preferredLang: 'jsx'
    } as never)

    const markup = stringifyComponent(rendered as never, { lang: 'jsx' })
    expect(markup).toContain('<svg')
    expect(markup).toContain('data-src="https://assets.test/icon.svg"')
    expect(markup).toContain('className="relative text-[var(--icon-color)]"')
    expect(markup).not.toContain('<img')
    expect(markup).toContain('viewBox="0 0 16 16"')
    const vueMarkup = stringifyComponent(rendered as never, { lang: 'vue' })
    expect(vueMarkup).toContain('viewBox="0 0 16 16"')
    expect(vueMarkup).not.toContain('view-box')
  })

  it('inlines raw svg fallback when asset-backed placeholder is unavailable', async () => {
    const root = createSnapshot({ id: 'icon-fallback', type: 'VECTOR' })
    root.bounds = { x: 0, y: 0, width: 16, height: 16 }
    const tree = createTree([root])

    const rendered = await renderTree('icon-fallback', tree, {
      styles: new Map(),
      layout: new Map([['icon-fallback', { position: 'relative' }]]),
      nodes: new Map([['icon-fallback', root.node]]),
      svgs: new Map([
        [
          'icon-fallback',
          {
            props: {
              width: '16px',
              height: '16px',
              viewBox: '0 0 16 16'
            },
            presentationStyle: {
              color: 'var(--icon-color)'
            },
            raw: '<svg width="16px" height="16px" viewBox="0 0 16 16"><path fill="currentColor" d="M0 0h16v16z"/></svg>'
          }
        ]
      ]),
      textSegments: new Map(),
      config: { cssUnit: 'px', rootFontSize: 16, scale: 1 },
      preferredLang: 'jsx'
    } as never)

    const markup = stringifyComponent(rendered as never, { lang: 'jsx' })
    expect(markup).toContain('<svg')
    expect(markup).toContain('fill="currentColor"')
    expect(markup).toContain('className="relative text-[var(--icon-color)]"')
    expect(markup).not.toContain('data-src=')
  })
})
