import { transformSync } from 'esbuild'
import { describe, expect, it } from 'vitest'
import { compile } from 'vue'

import { nativeSvgTemplate, nativeSvgText } from './native-svg-template-fixture'

function collectText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(collectText).join('')
  if (value && typeof value === 'object' && 'children' in value) return collectText(value.children)
  return ''
}

// The browser test asserts that the production XML path emits this exact fixture.
describe('serialized native SVG templates', () => {
  it.each(['jsx', 'tsx', 'vue'] as const)(
    'preserves XML text through the real %s compiler',
    (lang) => {
      let rendered: unknown
      if (lang === 'vue') {
        const render = compile(nativeSvgTemplate) as (context: object, cache: unknown[]) => unknown
        rendered = render({}, [])
      } else {
        const code = transformSync(nativeSvgTemplate, { loader: lang, jsxFactory: 'h' }).code
        rendered = new Function('h', `return ${code}`)(
          (_tag: string, _props: unknown, ...children: unknown[]) => children
        )
      }
      expect(collectText(rendered)).toBe(nativeSvgText)
    }
  )
})
