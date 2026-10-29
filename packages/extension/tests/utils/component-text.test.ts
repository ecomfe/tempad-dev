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

function renderMarkup(markup: string, lang: 'jsx' | 'tsx' | 'vue') {
  if (lang === 'vue') {
    const render = compile(markup) as (context: object, cache: unknown[]) => unknown
    return render({}, [])
  }
  const code = transformSync(markup, { loader: lang, jsxFactory: 'h' }).code
  const render = new Function('h', `return ${code}`)
  return render((_tag: string, props: unknown, ...children: unknown[]) => ({ props, children }))
}

function renderText(markup: string, lang: 'jsx' | 'tsx' | 'vue'): string {
  const text = collectText(renderMarkup(markup, lang))
  return lang === 'vue' ? text.trim() : text
}

describe.each(['jsx', 'tsx', 'vue'] as const)('%s literal component text', (lang) => {
  it('preserves significant whitespace and escaped characters in string props', () => {
    const props = { value: '  user input  ', title: ' "quoted" & <content> ' }
    const code = stringifyComponent({ name: 'input', props, children: [] }, lang)
    const result = renderMarkup(code, lang) as { props: typeof props }
    expect(result.props).toMatchObject(props)
  })

  it('round-trips own prototype-named keys inside object props', () => {
    const payload = JSON.parse('{"__proto__":{"label":"root"},"rows":[{"__proto__":"nested"}]}')
    const code = stringifyComponent({ name: 'input', props: { payload }, children: [] }, lang)
    const rendered = renderMarkup(code, lang) as { props: { payload: typeof payload } }
    const result = rendered.props.payload

    expect(result).toEqual(payload)
    expect(Object.hasOwn(result, '__proto__')).toBe(true)
    expect(Object.hasOwn(result.rows[0], '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect(Object.getPrototypeOf(result.rows[0])).toBe(Object.prototype)
  })

  it.each([
    ['string', ' &amp; value ', ' &amp; value '],
    ['object', { label: 'value', empty: { drop: undefined } }, { label: 'value' }],
    ['false', false, false],
    ['empty object', { drop: undefined }, undefined]
  ])('preserves a top-level prototype-named %s prop', (_name, value, expected) => {
    const props = { title: 'before', ['__proto__']: value, id: 'after' }
    const code = stringifyComponent({ name: 'input', props, children: [] }, lang)
    const rendered = renderMarkup(code, lang) as { props: Record<string, unknown> }

    expect(rendered.props.title).toBe('before')
    expect(rendered.props.id).toBe('after')
    expect(Object.hasOwn(rendered.props, '__proto__')).toBe(expected !== undefined)
    if (expected !== undefined) expect(rendered.props.__proto__).toEqual(expected)
    expect(Object.getPrototypeOf(rendered.props)).toBe(Object.prototype)
  })

  it('preserves entity-looking text inside object props', () => {
    const payload = { text: '&amp; &#123; <tag> "quoted"', nested: ['&lt;', '&#x41;'] }
    const code = stringifyComponent({ name: 'input', props: { payload }, children: [] }, lang)
    const rendered = renderMarkup(code, lang) as { props: { payload: typeof payload } }
    expect(rendered.props.payload).toEqual(payload)
  })

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

it('preserves entity-looking strings in authored Vue event expressions', () => {
  const text = '&amp; &#123; <tag> "quoted"'
  const code = stringifyComponent(
    { name: 'button', props: { onClick: `record(${JSON.stringify(text)})` }, children: [] },
    'vue'
  )
  let received: unknown
  const render = compile(code) as (context: object, cache: unknown[]) => unknown
  const rendered = render({ record: (value: unknown) => (received = value) }, []) as {
    props: { onClick: () => void }
  }
  rendered.props.onClick()
  expect(received).toBe(text)
})
