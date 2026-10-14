import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import type { SvgEntry } from '@/mcp/tools/code/assets/vector'

import { planAssets } from '@/mcp/tools/code/assets/plan'
import { createGetCodeCacheContext } from '@/mcp/tools/code/cache'
import { collectNodeData } from '@/mcp/tools/code/collect'
import { renderTree } from '@/mcp/tools/code/render'
import { sanitizeStyles } from '@/mcp/tools/code/sanitize'
import { buildLayoutStyles } from '@/mcp/tools/code/styles'
import { buildVisibleTree } from '@/mcp/tools/code/tree'
import { stringifyComponent } from '@/utils/component'

vi.mock('@/ui/state', () => ({ activePlugin: { value: undefined } }))

function node(
  id: string,
  type: SceneNode['type'],
  x: number,
  children: SceneNode[] = [],
  css: Record<string, string> = {}
): SceneNode {
  return {
    id,
    type,
    name: id,
    visible: true,
    x,
    y: 0,
    width: 100,
    height: 100,
    relativeTransform: [
      [1, 0, x],
      [0, 1, 0]
    ],
    absoluteBoundingBox: { x, y: 0, width: 100, height: 100 },
    absoluteRenderBounds: { x, y: 0, width: 100, height: 100 },
    children,
    fills: [],
    strokes: [],
    effects: [],
    opacity: 1,
    getCSSAsync: async () => ({ width: '100px', height: '100px', ...css })
  } as unknown as SceneNode
}

function dynamicGroup(id: string, children: SceneNode[], opacity = 'var(--alpha)') {
  const group = node(id, 'GROUP', 0, children, { opacity })
  Object.assign(group, {
    opacity: 0.5,
    blendMode: 'PASS_THROUGH',
    boundVariables: { opacity: { type: 'VARIABLE_ALIAS', id: 'opacity' } }
  })
  return group
}

async function pipeline(root: SceneNode, svgs = new Map<string, SvgEntry>()) {
  vi.stubGlobal('figma', {
    mixed: Symbol('mixed'),
    variables: { getVariableById: () => null },
    getStyleById: () => null
  })
  const attach = (parent: SceneNode) => {
    if ('children' in parent)
      for (const child of parent.children) {
        Object.assign(child, { parent })
        attach(child)
      }
  }
  attach(root)
  const config = { cssUnit: 'px', rootFontSize: 16, scale: 1 } as const
  const tree = buildVisibleTree([root])
  for (const snapshot of tree.nodes.values()) snapshot.dataHint = { 'data-hint-id': snapshot.id }
  const cache = createGetCodeCacheContext()
  const plan = planAssets(tree, undefined, cache)
  const collected = await collectNodeData(
    tree,
    config,
    new Map(),
    cache,
    plan.skippedIds,
    undefined,
    plan.vectorRoots
  )
  const originalStyles = new Map([...collected.styles].map(([id, style]) => [id, { ...style }]))
  sanitizeStyles(tree, collected.styles, plan.vectorRoots, cache)
  const rendered = await renderTree(root.id, tree, {
    ...collected,
    nodes: new Map([...tree.nodes].map(([id, snapshot]) => [id, snapshot.node])),
    layout: buildLayoutStyles(collected.styles, plan.vectorRoots),
    svgs,
    config,
    preferredLang: 'jsx'
  })
  if (!rendered || typeof rendered === 'string') throw new Error('Expected component tree')
  const host = document.createElement('div')
  const code = stringifyComponent(rendered, { lang: 'jsx' })
  host.innerHTML = code
  document.body.append(host)
  const element = (id: string) => host.querySelector<HTMLElement>(`[data-hint-id="${id}"]`)!
  const apply = (styles: Map<string, Record<string, string>>) => {
    for (const [id, style] of styles) {
      const target = element(id)
      if (target)
        target.style.cssText = Object.entries(style)
          .map(([key, value]) => `${key}:${value}`)
          .join(';')
    }
  }
  apply(collected.styles)
  return { host, code, element, apply, styles: collected.styles, originalStyles, plan }
}

async function screenshotPixels(element: HTMLElement, points: [number, number][]) {
  element.dataset.testid = 'paint-root'
  const screenshot = await page.getByTestId('paint-root').screenshot({ base64: true })
  const image = new Image()
  image.src = `data:image/png;base64,${screenshot.base64}`
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')!
  context.drawImage(image, 0, 0)
  return points.map(([x, y]) => [...context.getImageData(x, y, 1, 1).data])
}

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

it.each([false, true])(
  'preserves structural group paint order, hit testing, and inherited events (nested=%s)',
  async (nested) => {
    const a = node('a', 'FRAME', 0, [], { 'background-color': 'red' })
    const b = node('b', 'FRAME', 0, [], { 'background-color': 'blue' })
    const c = node('c', 'FRAME', 50, [], { 'background-color': 'green' })
    const first = node('first', 'GROUP', 0, nested ? [node('inner', 'GROUP', 0, [a])] : [a])
    const last = node('last', 'GROUP', 50, [c])
    const root = node('root', 'FRAME', 0, [first, b, last], { width: '300px', height: '200px' })
    Object.assign(root, { layoutMode: 'NONE', width: 300, height: 200 })
    const result = await pipeline(root)
    expect(result.plan.vectorRoots.size).toBe(0)
    const bounds = result.element('root').getBoundingClientRect()
    const hit = (x: number) =>
      document.elementFromPoint(bounds.x + x, bounds.y + 25)?.getAttribute('data-hint-id')
    expect(hit(25)).toBe('b')
    expect(hit(75)).toBe('c')
    expect(getComputedStyle(result.element('last')).display).toBe('contents')
    expect(result.element('last').getAttribute('classname')).toContain('contents')
    result.element('root').style.color = 'rgb(10, 20, 30)'
    expect(getComputedStyle(result.element('c')).color).toBe('rgb(10, 20, 30)')
    result.element('last').style.pointerEvents = 'none'
    expect(hit(75)).toBe('b')
    result.element('c').style.pointerEvents = 'auto'
    expect(hit(75)).toBe('c')
    expect(result.element('last').contains(result.element('c'))).toBe(true)
    const bubbled = vi.fn()
    result.element('last').addEventListener('click', bubbled)
    result.element('c').click()
    expect(bubbled).toHaveBeenCalledOnce()
  }
)

it.each(['flow', 'inferred', 'vector'] as const)(
  'keeps the %s group representation',
  async (mode) => {
    const child = node('child', mode === 'vector' ? 'RECTANGLE' : 'FRAME', 10)
    const group = node('group', 'GROUP', 0, [child])
    const root = node('root', 'FRAME', 0, [group, node('sibling', 'FRAME', 50)])
    Object.assign(root, { layoutMode: mode === 'flow' ? 'HORIZONTAL' : 'NONE' })
    if (mode === 'inferred')
      Object.assign(root, { inferredAutoLayout: { layoutMode: 'HORIZONTAL' } })
    const result = await pipeline(root)
    expect(result.styles.get('group')?.display).not.toBe('contents')
    if (mode === 'vector') expect(result.plan.vectorRoots.has('group')).toBe(true)
    else expect(result.styles.get('group')?.position).toBe('relative')
  }
)

it.each([
  { name: 'opacity', native: { opacity: 0.5 }, css: { opacity: '.5' } },
  { name: 'explicit z-index', native: {}, css: { 'z-index': '9' } },
  {
    name: 'transform',
    native: {
      relativeTransform: [
        [0, -1, 100],
        [1, 0, 0]
      ]
    },
    css: { transform: 'rotate(90deg)' }
  },
  { name: 'filter', native: {}, css: { filter: 'blur(1px)' } },
  { name: 'clip', native: { clipsContent: true }, css: { overflow: 'hidden' } },
  {
    name: 'effect',
    native: { effects: [{ type: 'LAYER_BLUR', radius: 2, visible: true }] },
    css: {}
  },
  { name: 'group blend', native: { blendMode: 'NORMAL' }, css: {} }
])('keeps a group with $name as a box', async ({ native, css }) => {
  const group = node(
    'group',
    'GROUP',
    0,
    [node('child', 'FRAME', 0)],
    css as Record<string, string>
  )
  Object.assign(group, native)
  const root = node('root', 'FRAME', 0, [group, node('sibling', 'FRAME', 0)])
  Object.assign(root, { layoutMode: 'NONE' })
  const result = await pipeline(root)
  expect(result.styles.get('group')?.display).not.toBe('contents')
})

it.each(['transform', 'filter', 'backdrop-filter'] as const)(
  'orders compositing groups without moving descendants when %s already establishes their containing block',
  async (property) => {
    const css: Record<string, string> =
      property === 'transform' ? { transform: 'rotate(10deg)' } : { [property]: 'blur(1px)' }
    const a = node('a', 'FRAME', 0, [], { 'background-color': 'red' })
    const b = node('b', 'FRAME', 0, [], { 'background-color': 'blue' })
    const c = node('c', 'FRAME', 0, [], { 'background-color': 'green' })
    const first = node('first', 'GROUP', 0, [a], css)
    const last = node('last', 'GROUP', 0, [c], css)
    for (const group of [first, last]) {
      Object.assign(
        group,
        property === 'transform'
          ? {
              relativeTransform: [
                [Math.cos(Math.PI / 18), -Math.sin(Math.PI / 18), 0],
                [Math.sin(Math.PI / 18), Math.cos(Math.PI / 18), 0]
              ]
            }
          : {
              effects: [
                {
                  type: property === 'filter' ? 'LAYER_BLUR' : 'BACKGROUND_BLUR',
                  radius: 1,
                  visible: true
                }
              ]
            }
      )
    }
    const root = node('root', 'FRAME', 0, [first, b, last], { height: '300px' })
    Object.assign(root, { layoutMode: 'NONE', height: 300 })
    const result = await pipeline(root)
    const bounds = () =>
      ['a', 'b', 'c'].map((id) => result.element(id).getBoundingClientRect().toJSON())
    result.apply(result.originalStyles)
    const original = bounds()
    result.apply(result.styles)
    expect(bounds()).toEqual(original)
    const frame = result.element('root').getBoundingClientRect()
    expect(document.elementFromPoint(frame.left + 50, frame.top + 50)).toBe(result.element('b'))
    expect(result.styles.get('first')?.display).not.toBe('contents')
    expect(result.styles.get('first')?.[property]).toBe(css[property])
    expect(['first', 'b', 'last'].map((id) => result.styles.get(id)?.['z-index'])).toEqual([
      '0',
      '1',
      '2'
    ])
    expect(result.styles.get('first')?.position).toBe('relative')
    expect(await screenshotPixels(result.element('root'), [[50, 50]])).toEqual([[0, 0, 255, 255]])
  }
)

it.each(['opacity', 'isolation'] as const)(
  'preserves interleaved %s groups without rebasing absolute descendants',
  async (compositing) => {
    const style: Record<string, string> =
      compositing === 'opacity' ? { opacity: '.5' } : { isolation: 'isolate' }
    const first = node('first', 'GROUP', 0, [node('a', 'FRAME', 0, [], { background: 'red' })], {
      ...style
    })
    const last = node('last', 'GROUP', 50, [node('c', 'FRAME', 50, [], { background: 'green' })], {
      ...style
    })
    for (const group of [first, last])
      Object.assign(group, compositing === 'opacity' ? { opacity: 0.5 } : { blendMode: 'NORMAL' })
    const root = node(
      'root',
      'FRAME',
      0,
      [first, node('b', 'FRAME', 0, [], { background: 'blue' }), last],
      {
        width: '300px',
        height: '200px'
      }
    )
    Object.assign(root, { layoutMode: 'NONE', width: 300, height: 200 })
    const result = await pipeline(root)
    const bounds = () =>
      ['a', 'b', 'c'].map((id) => result.element(id).getBoundingClientRect().toJSON())
    result.apply(result.originalStyles)
    const before = bounds()
    result.apply(result.styles)
    expect(bounds()).toEqual(before)
    expect(getComputedStyle(result.element('first')).position).toBe('static')
    expect(getComputedStyle(result.element('last')).position).toBe('static')
    const frame = result.element('root').getBoundingClientRect()
    expect(document.elementFromPoint(frame.x + 25, frame.y + 25)).toBe(result.element('b'))
    expect(document.elementFromPoint(frame.x + 75, frame.y + 25)).toBe(result.element('c'))
    expect(
      await screenshotPixels(result.element('root'), [
        [25, 25],
        [75, 25]
      ])
    ).toEqual([[0, 0, 255, 255], compositing === 'opacity' ? [0, 64, 127, 255] : [0, 128, 0, 255]])
  }
)

it('preserves descendant blending and interleaved painting across opacity token changes', async () => {
  const paint = node('paint', 'FRAME', 0, [], {
    background: 'red',
    'mix-blend-mode': 'multiply',
    width: '200px'
  })
  const a = node('a', 'FRAME', 0, [paint], { width: '200px' })
  const first = dynamicGroup('first', [a])
  const c = node('c', 'FRAME', 50, [], { background: 'green' })
  const last = dynamicGroup('last', [c])
  const root = node(
    'root',
    'FRAME',
    0,
    [first, node('b', 'FRAME', 0, [], { background: 'blue' }), last],
    { width: '300px', height: '300px', background: 'blue' }
  )
  Object.assign(root, { layoutMode: 'NONE', width: 300, height: 300 })
  const result = await pipeline(root)
  const bounds = () =>
    ['a', 'paint', 'b', 'c'].map((id) => result.element(id).getBoundingClientRect().toJSON())
  result.apply(result.originalStyles)
  const before = bounds()
  result.apply(result.styles)
  expect(bounds()).toEqual(before)
  for (const alpha of ['.5', '1', 'invalid', '.5']) {
    result.element('root').style.setProperty('--alpha', alpha)
    const box = result.element('root').getBoundingClientRect()
    expect.soft(document.elementFromPoint(box.x + 25, box.y + 25)).toBe(result.element('b'))
    expect.soft(document.elementFromPoint(box.x + 75, box.y + 25)).toBe(result.element('c'))
    const pixels = await screenshotPixels(result.element('root'), [
      [25, 25],
      [75, 25],
      [175, 25]
    ])

    expect
      .soft(pixels)
      .toEqual([
        [0, 0, 255, 255],
        alpha !== '.5' ? [0, 128, 0, 255] : [0, 64, 127, 255],
        alpha !== '.5' ? [0, 0, 0, 255] : [128, 0, 126, 255]
      ])
  }
})

it('retains pass-through blending across nested bound-opacity groups', async () => {
  const first = dynamicGroup('first', [
    node('a', 'FRAME', 0, [], { background: 'red', width: '200px', 'mix-blend-mode': 'multiply' }),
    dynamicGroup(
      'inner',
      [node('middle', 'FRAME', 50, [], { background: 'green', width: '100px' })],
      'var(--inner)'
    ),
    node('c', 'FRAME', 100, [], { background: 'yellow', width: '50px' })
  ])
  const root = node(
    'root',
    'FRAME',
    0,
    [
      first,
      node('b', 'FRAME', 0, [], { background: 'blue' }),
      dynamicGroup('last', [node('d', 'FRAME', 50, [], { background: 'lime', width: '50px' })])
    ],
    { width: '300px', height: '300px', background: 'blue' }
  )
  Object.assign(root, { layoutMode: 'NONE', width: 300, height: 300 })
  const result = await pipeline(root)
  const bounds = () =>
    ['a', 'middle', 'c', 'b', 'd'].map((id) => result.element(id).getBoundingClientRect().toJSON())
  result.apply(result.originalStyles)
  const before = bounds()
  result.apply(result.styles)
  const styles = result.styles
  expect(styles.get('first')?.isolation).toBeUndefined()
  expect(styles.get('inner')?.isolation).toBeUndefined()
  expect(bounds()).toEqual(before)
  for (const alpha of ['.5', '1']) {
    result.element('root').style.setProperty('--alpha', alpha)
    result.element('root').style.setProperty('--inner', alpha)
    const box = result.element('root').getBoundingClientRect()
    expect.soft(document.elementFromPoint(box.x + 25, box.y + 25)).toBe(result.element('b'))
    expect.soft(document.elementFromPoint(box.x + 75, box.y + 25)).toBe(result.element('d'))
    const pixels = await screenshotPixels(result.element('root'), [
      [25, 25],
      [75, 25],
      [125, 25],
      [175, 25]
    ])

    expect
      .soft(pixels)
      .toEqual([
        [0, 0, 255, 255],
        alpha !== '.5' ? [0, 255, 0, 255] : [0, 128, 127, 255],
        alpha !== '.5' ? [255, 255, 0, 255] : [128, 128, 126, 255],
        alpha !== '.5' ? [0, 0, 0, 255] : [128, 0, 126, 255]
      ])
  }
})

it.each([false, true])(
  'preserves inferred FRAME ranks and explicit outer ranks below a bound-opacity group (%s)',
  async (explicit) => {
    const late = node('late', 'FRAME', 50, [], {
      background: 'red',
      width: '200px',
      'grid-area': '1 / 1'
    })
    const innerAbsolute = node('inner-absolute', 'FRAME', 0, [], {
      background: 'magenta',
      width: '200px'
    })
    Object.assign(innerAbsolute, { layoutPositioning: 'ABSOLUTE' })
    const early = node('early', 'FRAME', 0, [], {
      background: 'yellow',
      width: '200px',
      'grid-area': '1 / 1'
    })
    const frame = node('frame', 'FRAME', 0, [late, innerAbsolute, early], {
      width: '200px',
      display: 'grid'
    })
    Object.assign(frame, { layoutMode: 'NONE', inferredAutoLayout: { layoutMode: 'HORIZONTAL' } })
    const first = node('outer', 'GROUP', 0, [dynamicGroup('bound', [frame])])
    const b = node('b', 'FRAME', 0, [], {
      background: 'blue',
      ...(explicit ? { 'z-index': '9' } : {})
    })
    const last = node('last', 'GROUP', 50, [
      node('c', 'FRAME', 50, [], { background: 'lime', width: '50px' })
    ])
    Object.assign(last, { blendMode: 'NORMAL' })
    const root = node('root', 'FRAME', 0, [first, b, last], {
      width: '300px',
      height: '300px',
      background: 'blue'
    })
    Object.assign(root, { layoutMode: 'NONE', width: 300, height: 300 })
    const result = await pipeline(root)
    expect(
      [...result.element('frame').children].map((child) => child.getAttribute('data-hint-id'))
    ).toEqual(['early', 'inner-absolute', 'late'])
    const ranks = ['late', 'inner-absolute', 'early'].map(
      (id) => result.styles.get(id)?.['z-index']
    )
    expect(ranks).toEqual(['0', '1', '2'])
    expect(result.styles.get('frame')?.isolation).toBe('isolate')
    const bounds = () =>
      ['frame', 'late', 'inner-absolute', 'early', 'b', 'c'].map((id) =>
        result.element(id).getBoundingClientRect().toJSON()
      )
    result.apply(result.originalStyles)
    const before = bounds()
    result.apply(result.styles)
    const styles = result.styles
    expect(bounds()).toEqual(before)
    expect(['late', 'inner-absolute', 'early'].map((id) => styles.get(id)?.['z-index'])).toEqual(
      ranks
    )
    if (explicit) expect(styles.get('b')?.['z-index']).toBe('9')
    for (const alpha of ['.5', '1']) {
      result.element('root').style.setProperty('--alpha', alpha)
      const box = result.element('root').getBoundingClientRect()
      expect.soft(document.elementFromPoint(box.x + 25, box.y + 25)).toBe(result.element('b'))
      expect
        .soft(document.elementFromPoint(box.x + 75, box.y + 25))
        .toBe(result.element(explicit ? 'b' : 'c'))
      expect.soft(document.elementFromPoint(box.x + 125, box.y + 25)).toBe(result.element('early'))
      const pixels = await screenshotPixels(result.element('root'), [
        [75, 25],
        [125, 25]
      ])

      expect
        .soft(pixels)
        .toEqual([
          explicit ? [0, 0, 255, 255] : [0, 255, 0, 255],
          alpha === '1' ? [255, 255, 0, 255] : [128, 128, 126, 255]
        ])
    }
  }
)

it.each([
  { property: 'filter', ancestor: false },
  { property: 'backdrop-filter', ancestor: false },
  { property: 'transform', ancestor: false },
  { property: 'filter', ancestor: true }
] as const)(
  'keeps bound opacity and native $property compositing in natural paint order (ancestor: $ancestor)',
  async ({ property, ancestor }) => {
    const paint = node('paint', 'FRAME', 0, [], {
      background: 'red',
      'mix-blend-mode': 'multiply',
      width: '200px'
    })
    const bound = dynamicGroup(
      'bound',
      [node('a', 'FRAME', 0, [paint], { width: '200px' })],
      'calc(var(--alpha) / 100)'
    )
    const outer = node('outer', 'GROUP', 0, [bound])
    const composited = ancestor ? outer : bound
    const effect = property === 'transform' ? 'rotate(5deg)' : 'blur(var(--radius))'
    const getCSS = composited.getCSSAsync.bind(composited)
    Object.assign(composited, {
      getCSSAsync: async () => ({
        ...(await getCSS()),
        [property]: effect,
        left: '70px',
        'z-index': '9'
      }),
      ...(property === 'transform'
        ? {
            relativeTransform: [
              [Math.cos(Math.PI / 36), -Math.sin(Math.PI / 36), 0],
              [Math.sin(Math.PI / 36), Math.cos(Math.PI / 36), 0]
            ]
          }
        : {
            effects: [
              {
                type: property === 'filter' ? 'LAYER_BLUR' : 'BACKGROUND_BLUR',
                radius: 1,
                visible: true,
                boundVariables: { radius: { type: 'VARIABLE_ALIAS', id: 'radius' } }
              }
            ]
          })
    })
    const last = node('last', 'GROUP', 50, [node('c', 'FRAME', 50, [], { background: 'green' })])
    Object.assign(last, { blendMode: 'NORMAL' })
    const root = node(
      'root',
      'FRAME',
      0,
      [outer, node('b', 'FRAME', 0, [], { background: 'blue' }), last],
      {
        width: '300px',
        height: '300px',
        background: 'blue'
      }
    )
    Object.assign(root, { layoutMode: 'NONE', width: 300, height: 300 })
    const result = await pipeline(root)
    expect(result.styles.get(composited.id)?.[property]).toBe(effect)
    expect(result.styles.get(composited.id)?.['z-index']).toBe('9')
    expect(result.styles.get(composited.id)?.left).toBe('70px')
    for (const id of ['outer', 'bound']) {
      expect(result.styles.get(id)?.display).not.toBe('contents')
      expect(result.styles.get(id)?.isolation).toBeUndefined()
      expect(getComputedStyle(result.element(id)).position).toBe('static')
    }
    for (const radius of property === 'transform' ? ['1px'] : ['1px', '0px', '']) {
      for (const alpha of ['50', '100']) {
        const measure = (styles: Map<string, Record<string, string>>) => {
          result.apply(styles)
          result.element('root').style.setProperty('--alpha', alpha)
          result.element('root').style.setProperty('--radius', radius)
          return ['outer', 'bound', 'a', 'paint', 'b', 'c'].map((id) =>
            result.element(id).getBoundingClientRect().toJSON()
          )
        }
        const before = measure(result.originalStyles)
        expect(measure(result.styles)).toEqual(before)
        const box = result.element('root').getBoundingClientRect()
        expect.soft(document.elementFromPoint(box.x + 25, box.y + 25)).toBe(result.element('b'))
        expect.soft(document.elementFromPoint(box.x + 75, box.y + 25)).toBe(result.element('c'))
        const [covered, blended] = await screenshotPixels(result.element('root'), [
          [25, 25],
          [175, 25]
        ])
        expect(covered).toEqual([0, 0, 255, 255])
        const expected =
          alpha === '50' ? [128, 0, 127, 255] : radius ? [255, 0, 0, 255] : [0, 0, 0, 255]
        // Filter and backdrop-filter use slightly different half-opacity rounding.
        for (let channel = 0; channel < 4; channel++)
          expect(Math.abs(blended![channel]! - expected[channel]!)).toBeLessThanOrEqual(
            alpha === '50' ? 2 : 0
          )
      }
    }
  }
)

it('keeps the outer backdrop available when natural ordering needs no parent isolation', async () => {
  const bound = dynamicGroup('bound', [
    node('paint', 'FRAME', 0, [], { background: 'red', 'mix-blend-mode': 'multiply' })
  ])
  const root = node(
    'root',
    'FRAME',
    0,
    [bound, node('last', 'FRAME', 250, [], { width: '10px' })],
    { width: '300px', height: '200px' }
  )
  Object.assign(root, { layoutMode: 'NONE', width: 300, height: 200, blendMode: 'PASS_THROUGH' })
  const result = await pipeline(root)
  result.host.style.background = 'blue'
  result.element('root').style.setProperty('--alpha', '1')
  expect.soft(result.styles.get('root')?.isolation).toBeUndefined()
  expect(await screenshotPixels(result.element('root'), [[25, 25]])).toEqual([[0, 0, 0, 255]])
})

it.each(['NORMAL', 'PASS_THROUGH'] as const)(
  'preserves native %s group blending without creating a containing block',
  async (blendMode) => {
    const child = node('child', 'FRAME', 20, [], {
      background: 'red',
      'mix-blend-mode': 'multiply'
    })
    const group = node('group', 'GROUP', 20, [child])
    Object.assign(group, { blendMode })
    const root = node('root', 'FRAME', 0, [group], {
      background: 'blue',
      width: '200px'
    })
    Object.assign(root, { layoutMode: 'NONE', width: 200 })
    const result = await pipeline(root)
    const bounds = () => result.element('child').getBoundingClientRect().toJSON()
    result.apply(result.originalStyles)
    const before = bounds()
    result.apply(result.styles)
    expect(bounds()).toEqual(before)
    expect.soft(getComputedStyle(result.element('group')).position).toBe('static')
    expect
      .soft(result.styles.get('group')?.isolation)
      .toBe(blendMode === 'NORMAL' ? 'isolate' : undefined)
    const frame = result.element('root').getBoundingClientRect()
    expect(document.elementFromPoint(frame.x + 30, frame.y + 25)).toBe(result.element('child'))
    expect(
      await screenshotPixels(result.element('root'), [
        [10, 25],
        [30, 25]
      ])
    ).toEqual([[0, 0, 255, 255], blendMode === 'NORMAL' ? [255, 0, 0, 255] : [0, 0, 0, 255]])
  }
)

it.each(['multiply', 'screen', 'plus-lighter'] as const)(
  'preserves interleaved %s group compositing and hit order at the static paint level',
  async (blendMode) => {
    const first = node('first', 'GROUP', 0, [node('a', 'FRAME', 0, [], { background: 'red' })], {
      'mix-blend-mode': blendMode
    })
    const last = node('last', 'GROUP', 50, [node('c', 'FRAME', 50, [], { background: 'green' })], {
      'mix-blend-mode': blendMode
    })
    const root = node(
      'root',
      'FRAME',
      0,
      [first, node('b', 'FRAME', 0, [], { background: 'blue' }), last],
      { width: '300px', height: '200px', background: 'white' }
    )
    Object.assign(root, { layoutMode: 'NONE', width: 300, height: 200 })
    const result = await pipeline(root)
    const bounds = () =>
      ['a', 'b', 'c'].map((id) => result.element(id).getBoundingClientRect().toJSON())
    result.apply(result.originalStyles)
    const before = bounds()
    result.apply(result.styles)
    expect(bounds()).toEqual(before)
    expect(getComputedStyle(result.element('first')).position).toBe('static')
    expect(getComputedStyle(result.element('last')).position).toBe('static')
    const frame = result.element('root').getBoundingClientRect()
    expect.soft(document.elementFromPoint(frame.x + 25, frame.y + 25)).toBe(result.element('b'))
    expect.soft(document.elementFromPoint(frame.x + 75, frame.y + 25)).toBe(result.element('c'))
    expect(
      await screenshotPixels(result.element('root'), [
        [25, 25],
        [75, 25]
      ])
    ).toEqual([[0, 0, 255, 255], blendMode === 'multiply' ? [0, 0, 0, 255] : [0, 128, 255, 255]])
  }
)

it.each(['normal', 'filter'] as const)(
  'orders transparent descendants across a %s group while retaining flow boxes and pass-through blending',
  async (compositing) => {
    const a = node('a', 'FRAME', 0, [], {
      width: '200px',
      background: 'red',
      'mix-blend-mode': 'multiply'
    })
    Object.assign(a, { width: 200 })
    const inner = node('inner', 'GROUP', 0, [a])
    const first = node('first', 'GROUP', 0, [inner])
    for (const group of [first, inner]) Object.assign(group, { blendMode: 'PASS_THROUGH' })
    const last = node(
      'last',
      'GROUP',
      50,
      [node('c', 'FRAME', 50, [], { background: 'green' })],
      compositing === 'filter' ? { filter: 'blur(1px)' } : {}
    )
    Object.assign(
      last,
      compositing === 'normal'
        ? { blendMode: 'NORMAL' }
        : {
            effects: [{ type: 'LAYER_BLUR', radius: 1, visible: true }]
          }
    )
    const root = node(
      'root',
      'FRAME',
      0,
      [first, node('b', 'FRAME', 0, [], { background: 'blue' }), last],
      { width: '300px', height: '250px', background: 'blue' }
    )
    Object.assign(root, { layoutMode: 'NONE', width: 300, height: 250 })
    const result = await pipeline(root)
    const bounds = () =>
      ['first', 'last', 'a', 'b', 'c'].map((id) =>
        result.element(id).getBoundingClientRect().toJSON()
      )
    result.apply(result.originalStyles)
    const before = bounds()
    result.apply(result.styles)
    expect(bounds()).toEqual(before)
    expect(result.styles.get('first')?.display).not.toBe('contents')
    for (const id of ['first', 'inner']) {
      expect(result.styles.get(id)?.isolation).toBeUndefined()
      expect(getComputedStyle(result.element(id)).position).toBe('static')
    }
    const frame = result.element('root').getBoundingClientRect()
    const c = result.element('c').getBoundingClientRect()
    expect.soft(document.elementFromPoint(frame.x + 25, frame.y + 25)).toBe(result.element('b'))
    expect.soft(document.elementFromPoint(c.x + 25, c.y + 25)).toBe(result.element('c'))
    expect(
      await screenshotPixels(result.element('root'), [
        [25, 25],
        [c.x - frame.x + 25, c.y - frame.y + 25],
        [175, 25]
      ])
    ).toEqual([
      [0, 0, 255, 255],
      [0, 128, 0, 255],
      [0, 0, 0, 255]
    ])
  }
)

it('retains a transparent group box when removing it would move a compositing flow sibling', async () => {
  const first = node('first', 'GROUP', 0, [node('a', 'FRAME', 0)])
  const last = node('last', 'GROUP', 0, [node('c', 'FRAME', 0)], { filter: 'blur(1px)' })
  const root = node('root', 'FRAME', 0, [first, node('b', 'FRAME', 0), last])
  Object.assign(root, { layoutMode: 'NONE' })
  const result = await pipeline(root)
  const bounds = () => result.element('c').getBoundingClientRect().toJSON()
  result.apply(result.originalStyles)
  const original = bounds()
  result.apply(result.styles)
  expect(bounds()).toEqual(original)
  expect(result.styles.get('first')?.display).not.toBe('contents')
  expect(result.styles.get('last')?.position).toBe('relative')
})

it('keeps SVG overflow placement inside a boxless group in the original layout coordinates', async () => {
  const vector = node('vector', 'VECTOR', 40)
  const group = node('group', 'GROUP', 40, [node('frame', 'FRAME', 0), vector])
  const root = node('root', 'FRAME', 0, [group, node('sibling', 'FRAME', 0)])
  Object.assign(root, { layoutMode: 'NONE' })
  const result = await pipeline(
    root,
    new Map([
      [
        'vector',
        {
          props: {
            width: '120px',
            height: '120px',
            viewBox: '0 0 120 120',
            'data-src': 'overflow.svg'
          },
          wrapper: { width: '100px', height: '100px', left: '-10px', top: '-10px' }
        }
      ]
    ])
  )
  expect(result.styles.get('group')?.display).toBe('contents')
  const svg = result.host.querySelector('svg')!
  const wrapper = svg.parentElement!
  expect(wrapper.parentElement).toBe(result.element('group'))
  expect(wrapper.getAttribute('classname')).toContain('left-[40px]')
  expect(wrapper.getAttribute('classname')).toContain('absolute')
  expect(svg.getAttribute('classname')).toContain('-left-[10px]')
  expect(svg.getAttribute('width')).toBe('120px')
  expect(result.styles.get('vector')?.left).toBe('40px')
})

it.each(
  (['MIN', 'MAX', 'STRETCH', 'SCALE'] as const).flatMap((constraint) =>
    ['matrix(1, .2, .3, 1, 0, 0)', 'rotate(30deg)'].map((transform) => ({ constraint, transform }))
  )
)(
  'keeps nested $constraint constraints and $transform across parent resizing',
  async ({ constraint, transform }) => {
    const child = node('child', 'FRAME', 40, [], {
      transform,
      'transform-origin': '0 0',
      ...(constraint === 'STRETCH' || constraint === 'SCALE'
        ? { width: 'auto', height: 'auto' }
        : {})
    })
    Object.assign(child, { constraints: { horizontal: constraint, vertical: constraint } })
    const inner = node('inner', 'GROUP', 40, [child])
    const group = node('group', 'GROUP', 40, [inner])
    const root = node('root', 'FRAME', 0, [group, node('sibling', 'FRAME', 0)], {
      width: '300px',
      height: '200px'
    })
    Object.assign(root, { layoutMode: 'NONE', width: 300, height: 200 })
    const result = await pipeline(root)
    const measure = (styles: Map<string, Record<string, string>>) => {
      result.apply(styles)
      result.element('root').style.position = 'relative'
      return [300, 500].map((width) => {
        Object.assign(result.element('root').style, {
          width: `${width}px`,
          height: `${width - 100}px`
        })
        return result.element('child').getBoundingClientRect().toJSON()
      })
    }
    expect(measure(result.styles)).toEqual(measure(result.originalStyles))
    expect(result.styles.get('group')?.display).toBe('contents')
    expect(result.styles.get('inner')?.display).toBe('contents')
  }
)
