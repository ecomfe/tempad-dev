import { expect, it } from 'vitest'

import { parseSvgXml, stringifySvgXml } from '@/mcp/tools/canvas/svg-xml'

it.each([
  '<svg xmlns="http://www.w3.org/2000/svg" aria-label="A&#10;B &amp; C"><defs><path id="shape" d="M0 0h10v10z"/></defs><use href="&#35;shape"/><text>A&amp;B &amp;lt; <![CDATA[&amp;<literal>]]> one]]&gt;two]]&gt;three</text></svg>',
  '<?xml version="1.0"?>\n<!-- before > <![CDATA[&unknown;]]> -->\n<svg xmlns="http://www.w3.org/2000/svg" aria-label="A > B"><text xml:space="preserve"><tspan>A</tspan> <tspan>B</tspan><!-- > <fake/> -->\n<![CDATA[ ]]></text></svg>\n<!-- after -->\n'
])('preserves native XML attribute and text meanings after SVG normalization', (source) => {
  const parse = (value: string) => new DOMParser().parseFromString(value, 'image/svg+xml')
  const original = parse(source)
  const output = parse(stringifySvgXml(parseSvgXml(source)))
  expect(output.querySelector('parsererror')).toBeNull()
  expect(output.documentElement.getAttribute('aria-label')).toBe(
    original.documentElement.getAttribute('aria-label')
  )
  expect(output.querySelector('use')?.getAttribute('href')).toBe(
    original.querySelector('use')?.getAttribute('href')
  )
  expect(output.querySelector('text')?.textContent).toBe(
    original.querySelector('text')?.textContent
  )
})
