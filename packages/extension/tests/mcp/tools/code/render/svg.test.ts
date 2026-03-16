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

import { renderTree } from '@/mcp/tools/code/render'
import { createSnapshot, createTree } from '@/tests/mcp/tools/code/test-helpers'
import { stringifyComponent } from '@/utils/component'

describe('mcp/code render svg', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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
