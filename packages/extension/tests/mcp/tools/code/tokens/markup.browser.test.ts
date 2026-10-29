import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderTree } from '@/mcp/tools/code/render'
import { mapTokenValues, nativeSvg } from '@/mcp/tools/code/tokens/markup'
import { rewriteTokenNamesInCode } from '@/mcp/tools/code/tokens/rewrite'
import { createSnapshot, createTree } from '@/tests/mcp/tools/code/test-helpers'
import { stringifyComponent } from '@/utils/component'
import { simplifyColorMixToRgba, stripFallback } from '@/utils/css'

import { nativeSvgSource, nativeSvgTemplate } from './native-svg-template-fixture'

const source = 'var(--brand, #fff)'
const transform = (value: string) =>
  rewriteTokenNamesInCode(stripFallback(value), new Map([['--brand', '--renamed']]))

afterEach(() => vi.restoreAllMocks())

describe('native SVG token values', () => {
  it('skips XML parsing across token passes for literal exported geometry', () => {
    const parse = vi.spyOn(DOMParser.prototype, 'parseFromString')
    const serialize = vi.spyOn(XMLSerializer.prototype, 'serializeToString')
    const content = '<svg viewBox="0 0 16 16"><path fill="#333" d="M0 0h16v16z"/></svg>'
    let component = nativeSvg(content, { className: 'text-(--brand)' })
    for (let pass = 0; pass < 4; pass++) component = mapTokenValues(component, transform)
    expect(component.props.content).toBe(content)
    expect(component.props.injectedProps).toEqual({ className: 'text-(--renamed)' })
    expect(parse).not.toHaveBeenCalled()
    expect(serialize).not.toHaveBeenCalled()
  })

  it('parses entity-encoded tokens and template delimiters before applying their semantics', () => {
    const content =
      '<svg><title>&#123;customer&#125;</title><path fill="&#118;ar(&#45;&#45;brand, #fff)"/></svg>'
    expect(mapTokenValues(nativeSvg(content), transform).props.content).toBe(
      '<svg><title>&#123;customer&#125;</title><path fill="var(--renamed)"/></svg>'
    )
  })

  it('still simplifies literal color-mix values without variable references', () => {
    const component = nativeSvg(
      '<svg><path fill="color-mix(in srgb, #F00 50%, transparent)"/></svg>'
    )
    expect(mapTokenValues(component, simplifyColorMixToRgba).props.content).toBe(
      '<svg><path fill="rgba(255, 0, 0, 0.5)"/></svg>'
    )
  })

  it.each(['jsx', 'vue'] as const)('serializes native XML text as literal %s text', (lang) => {
    const transformed = mapTokenValues(nativeSvg(nativeSvgSource), transform)
    expect(stringifyComponent(transformed, lang)).toBe(nativeSvgTemplate)
    expect(stringifyComponent(mapTokenValues(transformed, transform), lang)).toBe(nativeSvgTemplate)
  })

  it('keeps XML comments opaque while escaping template delimiters in text nodes', () => {
    const transformed = mapTokenValues(
      nativeSvg('<svg><!-- {customer} --><title>{customer}</title></svg>'),
      transform
    )
    expect(transformed.props.content).toBe(
      '<svg><!-- {customer} --><title>&#123;customer&#125;</title></svg>'
    )
  })

  it('keeps the native export boundary when the renderer falls back to inline SVG', async () => {
    const snapshot = createSnapshot({ id: 'icon', type: 'VECTOR' })
    const component = await renderTree(snapshot.id, createTree([snapshot]), {
      styles: new Map(),
      layout: new Map(),
      nodes: new Map([[snapshot.id, snapshot.node]]),
      svgs: new Map([
        [
          snapshot.id,
          {
            props: {},
            raw: `<svg><title>${source}</title><path fill="${source}" d="M0 0h16v16z"/></svg>`,
            presentationStyle: { color: 'var(--brand)' }
          }
        ]
      ]),
      textSegments: new Map(),
      config: { cssUnit: 'px', rootFontSize: 16, scale: 1 }
    })
    if (!component || typeof component === 'string') throw new Error('Expected SVG component')
    const code = stringifyComponent(mapTokenValues(component, transform), 'jsx')
    expect(code).toContain(`<title>${source}</title>`)
    expect(code).toContain('fill="var(--renamed)"')
    expect(code).toContain('className="text-(color:--renamed)"')
  })

  it('preserves XML text and literal attributes across multiple transform passes', () => {
    const content = `<svg><title>${source}</title><text fill="url(#--brand)" stroke-dasharray="${source}" font-size="${source}" aria-label="${source}">${source}</text></svg>`
    const first = mapTokenValues(
      nativeSvg(content, { className: 'text-(--brand)', strokeWidth: source }),
      transform
    )
    const second = mapTokenValues(first, (value) => value.replaceAll('--renamed', '--final'))
    expect(second.props.content).toBe(
      `<svg><title>${source}</title><text fill="url(#--brand)" stroke-dasharray="var(--final)" font-size="var(--final)" aria-label="${source}">${source}</text></svg>`
    )
    expect(second.props.injectedProps).toEqual({
      className: 'text-(--final)',
      strokeWidth: 'var(--final)'
    })
  })

  it('preserves entities and meaningful whitespace with and without a styling rewrite', () => {
    const content =
      '<svg xmlns="http://www.w3.org/2000/svg"><title> R&amp;D &lt; 3 </title>\n<text fill="var(--brand)"><tspan>A &amp; B</tspan> <tspan>C</tspan></text></svg>'
    expect(mapTokenValues(nativeSvg(content), (value) => value).props.content).toBe(content)
    const transformed = mapTokenValues(nativeSvg(content), transform).props.content as string
    const parsed = new DOMParser().parseFromString(transformed, 'image/svg+xml')
    expect(parsed.querySelector('title')?.textContent).toBe(' R&D < 3 ')
    expect(parsed.querySelector('text')?.textContent).toBe('A & B C')
    expect(parsed.querySelector('text')?.getAttribute('fill')).toBe('var(--renamed)')
  })

  it('leaves malformed native SVG content intact', () => {
    const content = `<svg><title>${source}`
    expect(mapTokenValues(nativeSvg(content), transform).props.content).toBe(content)
  })
})
