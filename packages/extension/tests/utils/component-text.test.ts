import { RAW_TAG_NAME } from '@tempad-dev/plugins'
import { transformSync } from 'esbuild'
import { describe, expect, it } from 'vitest'
import { compile } from 'vue'

import { serializeComponent, stringifyComponent } from '@/utils/component'

const text = 'Hello {customer}; {{customer}}; &amp; < " > }'
const instance = {
  name: 'Label',
  type: 'INSTANCE' as const,
  visible: true,
  properties: {},
  children: []
}

function collectText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(collectText).join('')
  if (value && typeof value === 'object' && 'children' in value) return collectText(value.children)
  return ''
}

function renderText(markup: string, lang: 'jsx' | 'tsx' | 'vue'): string {
  if (lang === 'vue') {
    const render = compile(markup) as (context: object, cache: unknown[]) => unknown
    return collectText(render({}, [])).trim()
  }
  const code = transformSync(markup, { loader: lang, jsxFactory: 'h' }).code
  const render = new Function('h', `return ${code}`)
  return collectText(render((_tag: string, _props: unknown, ...children: unknown[]) => children))
}

describe.each(['jsx', 'tsx', 'vue'] as const)('%s literal component text', (lang) => {
  it.each([false, true])('renders design text without evaluating it (compact: %s)', (compact) => {
    const code = stringifyComponent(
      {
        name: 'div',
        props: {},
        children: [{ name: 'span', props: { title: '{customer}' }, children: [text] }]
      },
      { lang, isInline: () => compact }
    )
    expect(renderText(code, lang)).toBe(text)
    expect(code).toContain('title="{customer}"')
  })

  it('preserves literal text returned as a plugin component tree', () => {
    const code = serializeComponent(
      instance,
      { lang },
      { transformComponent: () => ({ name: 'span', props: {}, children: [text] }) }
    )
    expect(renderText(code, lang)).toBe(text)
  })

  it('keeps deliberately authored raw plugin templates unchanged', () => {
    const raw = lang === 'vue' ? '<span>{{customer}}</span>' : '<span>{customer}</span>'
    expect(
      stringifyComponent({ name: RAW_TAG_NAME, props: { content: raw }, children: [] }, lang)
    ).toBe(raw)
    expect(serializeComponent(instance, { lang }, { transformComponent: () => raw })).toBe(raw)
  })
})
