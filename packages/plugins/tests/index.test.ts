import { describe, expect, it } from 'vitest'

import {
  RAW_TAG_NAME,
  definePlugin,
  findAll,
  findChild,
  findChildren,
  findOne,
  h,
  queryAll,
  queryOne,
  raw,
  type DesignComponent,
  type DesignNode,
  type FrameNode,
  type GroupNode,
  type TextNode,
  type VectorNode
} from '../src/index'

function text(name: string, characters: string, visible = true): TextNode {
  return { type: 'TEXT', name, visible, characters }
}

function vector(name: string, visible = true): VectorNode {
  return { type: 'VECTOR', name, visible, fills: [{ color: '#000' }] }
}

function group(name: string, children: DesignNode[], visible = true): GroupNode {
  return { type: 'GROUP', name, visible, children }
}

function frame(name: string, children: DesignNode[], visible = true): FrameNode {
  return { type: 'FRAME', name, visible, children }
}

function component(name: string, children: DesignNode[] = []): DesignComponent {
  return {
    type: 'INSTANCE',
    name,
    visible: true,
    properties: { variant: 'primary' },
    children,
    mainComponent: { id: 'main-1', name: 'MainButton' }
  }
}

describe('plugins sdk helpers', () => {
  it('creates RAW nodes with injected props', () => {
    expect(raw('<Button />')).toEqual({
      name: RAW_TAG_NAME,
      props: { content: '<Button />', injectedProps: undefined },
      children: []
    })

    expect(raw('<Button />', { role: 'button' }).props).toEqual({
      content: '<Button />',
      injectedProps: { role: 'button' }
    })
  })

  it('returns plugin identity through definePlugin', () => {
    const plugin = {
      name: 'demo',
      code: {
        css: { lang: 'css' as const },
        custom: false
      }
    }

    expect(definePlugin(plugin)).toBe(plugin)
  })

  it('supports h overloads for name/children/props', () => {
    expect(h('Button')).toEqual({ name: 'Button', props: {}, children: [] })
    expect(h('Text', 'Hello')).toEqual({ name: 'Text', props: {}, children: ['Hello'] })
    expect(h('Box', ['A', 'B'])).toEqual({ name: 'Box', props: {}, children: ['A', 'B'] })

    const icon = h('Icon')
    expect(h('Button', icon)).toEqual({ name: 'Button', props: {}, children: [icon] })

    expect(h('Button', { size: 'lg' })).toEqual({
      name: 'Button',
      props: { size: 'lg' },
      children: []
    })

    expect(h('Button', { size: 'lg' }, 'Save')).toEqual({
      name: 'Button',
      props: { size: 'lg' },
      children: ['Save']
    })

    expect(h('Box', undefined as unknown as string)).toEqual({
      name: 'Box',
      props: {},
      children: []
    })
  })

  it('finds direct children with property and predicate queries', () => {
    const node = frame('Root', [text('Title', 'Hello'), vector('Icon', false), vector('Icon 2')])

    expect(findChild(node, { type: 'TEXT' })?.name).toBe('Title')
    expect(findChild(node, { name: /icon/i })?.name).toBe('Icon 2')
    expect(findChildren(node, { type: 'VECTOR' }).map((n) => n.name)).toEqual(['Icon 2'])
    expect(
      findChild(node, (candidate) => candidate.type === 'VECTOR' && !candidate.visible)
    ).toEqual(node.children[1])
  })

  it('supports deep queries with findOne/findAll', () => {
    const root = frame('Page', [
      group('Header', [text('Title', 'Dashboard'), component('Logo')]),
      group('Body', [frame('Card', [text('CTA', 'Submit'), vector('Arrow')])])
    ])

    expect(findOne(root, { name: 'CTA' })?.type).toBe('TEXT')
    expect(findOne(root, { type: 'INSTANCE', name: ['Logo', 'Button'] })?.name).toBe('Logo')
    expect(findOne(root, { name: 'Missing' })).toBeNull()

    expect(findAll(root, { type: 'TEXT' }).map((n) => n.name)).toEqual(['Title', 'CTA'])
    expect(findAll(root, (node) => node.type === 'VECTOR').map((n) => n.name)).toEqual(['Arrow'])
  })

  it('runs chained queryAll/queryOne pipelines and deduplicates', () => {
    const duplicate = text('Duplicated Label', 'Same')
    const panel = group('Panel', [duplicate, duplicate, text('Hint', 'x', false)])
    const root = frame('Root', [group('Header', [text('Title', 'T')]), panel])

    const all = queryAll(root, [
      { query: 'children', type: 'GROUP' },
      { query: 'all', type: 'TEXT', visible: true }
    ])

    expect(all.map((n) => n.name)).toEqual(['Title', 'Duplicated Label'])

    const first = queryOne(root, [
      { query: 'one', name: /panel/i },
      { query: 'child', type: 'TEXT' }
    ])
    expect(first?.name).toBe('Duplicated Label')

    expect(queryAll(root, [])).toEqual([])
    expect(queryOne(root, [{ query: 'child', name: 'missing' }])).toBeNull()

    expect(
      queryAll(root, [
        { query: 'all', type: 'TEXT' },
        { query: 'child', name: 'irrelevant' }
      ])
    ).toEqual([])
  })
})
