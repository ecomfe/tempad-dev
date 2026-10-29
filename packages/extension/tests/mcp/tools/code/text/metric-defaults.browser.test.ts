import { afterEach, expect, it, vi } from 'vitest'

import { renderTree } from '@/mcp/tools/code/render'
import { createStyleVarResolver, resolveStyleMap } from '@/mcp/tools/code/tokens/resolve'
import { createSnapshot, createTree } from '@/tests/mcp/tools/code/test-helpers'
import { stringifyComponent } from '@/utils/component'

vi.mock('@/ui/state', () => ({ activePlugin: { value: undefined }, options: { value: {} } }))

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

it.each([
  'ancestor',
  'node',
  'single-ancestor',
  'single-node',
  'hoisted',
  'token',
  'resolved-token',
  'none',
  'defaults',
  'keyword-defaults'
] as const)('preserves default text metrics with %s inheritance', async (source) => {
  vi.stubGlobal('figma', {
    mixed: Symbol('mixed'),
    variables: { getVariableById: () => null },
    getStyleById: () => null
  })
  const parent = createSnapshot({ id: 'parent', children: ['text'] })
  const text = createSnapshot({ id: 'text', type: 'TEXT', parentId: 'parent' })
  const labels = source.startsWith('single-')
    ? ['B']
    : [source === 'hoisted' ? 'AAAAA' : 'A', 'B', 'C']
  Object.assign(text.node, { characters: labels.join('\n') })
  let start = 0
  const segments = labels.map((label, index) => {
    const characters = label + (index < labels.length - 1 ? '\n' : '')
    const segment = {
      characters,
      start,
      end: start + characters.length,
      fontSize: 16,
      lineHeight: label === 'B' ? { unit: 'AUTO' } : { unit: 'PIXELS', value: index ? 22 : 40 },
      letterSpacing: { unit: 'PIXELS', value: label === 'B' ? 0 : index ? 22 : 40 },
      fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }],
      listOptions: { type: 'NONE' },
      paragraphSpacing: 0,
      paragraphIndent: 0
    }
    start = segment.end
    return segment as StyledTextSegment
  })
  const metrics = { 'line-height': '40px', 'letter-spacing': '40px' }
  const styles = new Map<string, Record<string, string>>()
  if (source === 'ancestor' || source === 'single-ancestor') styles.set('parent', metrics)
  if (source === 'node' || source === 'single-node') styles.set('text', metrics)
  if (source === 'defaults') {
    styles.set('parent', { 'line-height': 'normal', 'letter-spacing': '0px' })
  }
  if (source === 'keyword-defaults') {
    styles.set('parent', { 'line-height': 'normal', 'letter-spacing': 'normal' })
  }
  if (source === 'token' || source === 'resolved-token') {
    styles.set('parent', {
      'line-height': 'var(--Metric)',
      'letter-spacing': 'var(--Metric)'
    })
  }
  const config = { cssUnit: 'px', rootFontSize: 16, scale: 1 } as const
  const nodes = new Map([
    ['parent', parent.node],
    ['text', text.node]
  ])
  const resolveStyleVars =
    source === 'resolved-token'
      ? createStyleVarResolver(
          new Map([['--Metric', 'metric']]),
          new Map([
            [
              'metric',
              {
                id: 'metric',
                name: 'Metric',
                resolveForConsumer: () => ({ value: 40, resolvedType: 'FLOAT' })
              } as unknown as Variable
            ]
          ]),
          config
        )
      : undefined
  const rendered = await renderTree('parent', createTree([parent, text]), {
    config,
    nodes,
    styles: resolveStyleVars ? resolveStyleMap(styles, nodes, resolveStyleVars) : styles,
    layout: new Map(),
    svgs: new Map(),
    textSegments: new Map([['text', segments]]),
    resolveStyleVars
  })
  if (!rendered || typeof rendered === 'string') throw new Error('Expected component tree')
  const code = stringifyComponent(rendered, { lang: 'vue' })
  const needsReset = !['none', 'defaults', 'keyword-defaults'].includes(source)
  expect.soft(code.includes('leading-[normal]')).toBe(needsReset)
  expect.soft(code.includes('tracking-[0]')).toBe(needsReset)

  const stylesheet = document.createElement('style')
  const rules = [
    ['leading-[40px]', 'line-height:40px'],
    ['leading-[22px]', 'line-height:22px'],
    ['leading-[normal]', 'line-height:normal'],
    ['leading-(--Metric)', 'line-height:var(--Metric)'],
    ['tracking-[40px]', 'letter-spacing:40px'],
    ['tracking-[22px]', 'letter-spacing:22px'],
    ['tracking-[0]', 'letter-spacing:0'],
    ['tracking-(--Metric)', 'letter-spacing:var(--Metric)']
  ].map(([name, declaration]) => `.${CSS.escape(name!)}{${declaration}}`)
  const host = document.createElement('div')
  host.style.setProperty('--Metric', '40px')
  host.innerHTML = code
  document.body.append(stylesheet, host)
  for (const order of [rules, [...rules].reverse()]) {
    stylesheet.textContent = order.join('')
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
    const metricsByLabel: Record<string, { lineHeight: string; letterSpacing: number }> = {}
    while (walker.nextNode()) {
      const label = walker.currentNode.textContent?.trim()
      if (!label) continue
      const computed = getComputedStyle(walker.currentNode.parentElement!)
      metricsByLabel[label] = {
        lineHeight: computed.lineHeight,
        letterSpacing: parseFloat(computed.letterSpacing) || 0
      }
    }
    expect(metricsByLabel.B).toEqual({ lineHeight: 'normal', letterSpacing: 0 })
    if (labels.length > 1) {
      expect(metricsByLabel[labels[0]!]).toEqual({ lineHeight: '40px', letterSpacing: 40 })
      expect(metricsByLabel.C).toEqual({ lineHeight: '22px', letterSpacing: 22 })
    }
  }
})
