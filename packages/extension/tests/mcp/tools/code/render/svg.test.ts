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

  it('applies vector presentation color on the emitted svg root markup', async () => {
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
    expect(markup).toContain('className="relative text-[var(--icon-color)]"')
  })
})
