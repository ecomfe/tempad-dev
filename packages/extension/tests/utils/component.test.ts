import { RAW_TAG_NAME } from '@tempad-dev/plugins'
import { describe, expect, it, vi } from 'vitest'

import {
  getDesignComponent,
  mergeAttributes,
  serializeComponent,
  stringifyComponent
} from '@/utils/component'

function createNode(
  type: SceneNode['type'],
  id: string,
  overrides: Record<string, unknown> = {},
  children?: SceneNode[]
): SceneNode {
  const base: Record<string, unknown> = {
    id,
    name: id,
    type,
    visible: true,
    ...overrides
  }
  if (children) {
    base.children = children
  }
  return base as unknown as SceneNode
}

describe('utils/component', () => {
  it('returns null for nodes without component properties', () => {
    const frame = createNode('FRAME', 'frame-1')
    expect(getDesignComponent(frame)).toBeNull()
  })

  it('extracts design component data with instance swap and vector fills', () => {
    const getNodeById = vi.fn((id: string) => {
      if (id === 'swap-target') {
        return { type: 'COMPONENT', name: 'Icon/Arrow' }
      }
      return null
    })
    const getVariableById = vi.fn((id: string) => {
      if (id === 'var-color') {
        return { name: 'color/brand' }
      }
      return null
    })
    ;(globalThis as unknown as { figma: PluginAPI }).figma = {
      getNodeById,
      variables: { getVariableById }
    } as unknown as PluginAPI

    const vector = createNode('VECTOR', 'vector-1', {
      fills: [
        {
          type: 'SOLID',
          color: { r: 1, g: 0, b: 0 },
          boundVariables: { color: { id: 'var-color' } }
        },
        {
          type: 'GRADIENT_LINEAR'
        }
      ]
    })
    const text = createNode('TEXT', 'text-1', { characters: 'Hello' })
    const group = createNode('GROUP', 'group-1', {}, [text, vector])

    const instance = createNode(
      'INSTANCE',
      'instance-1',
      {
        componentProperties: {
          size: { type: 'VARIANT', value: 'Large' },
          enabled: { type: 'BOOLEAN', value: true },
          swap: { type: 'INSTANCE_SWAP', value: 'swap-target' }
        },
        mainComponent: { id: 'main-1', name: 'Button' }
      },
      [group]
    )

    const result = getDesignComponent(instance)

    expect(result).toMatchObject({
      name: 'instance-1',
      type: 'INSTANCE',
      mainComponent: { id: 'main-1', name: 'Button' }
    })
    expect(result?.properties.size).toBe('Large')
    expect(result?.properties.enabled).toBe(true)
    expect(result?.properties.swap).toEqual({
      name: 'Icon/Arrow',
      type: 'INSTANCE',
      properties: {},
      children: [],
      visible: true
    })
    expect(result?.children[0]).toMatchObject({ name: 'group-1', type: 'GROUP' })

    const groupNode = result?.children[0] as unknown as { children: Array<Record<string, unknown>> }
    const extractedVector = groupNode.children[1]
    expect(extractedVector).toEqual({
      name: 'vector-1',
      type: 'VECTOR',
      visible: true,
      fills: [{ color: { name: 'color/brand', value: '#ff0000' } }]
    })
  })

  it('stringifies component trees for vue/jsx and supports compact raw tags', () => {
    const vue = stringifyComponent(
      {
        name: 'Button',
        props: {
          className: 'primary',
          onClick: 'submit()',
          disabled: false,
          active: true,
          payload: { visible: true, hidden: undefined }
        },
        children: ['Run']
      },
      { lang: 'vue' }
    )
    expect(vue).toContain('<Button')
    expect(vue).toContain('class="primary"')
    expect(vue).toContain('@click="submit()"')
    expect(vue).toContain(':disabled="false"')
    expect(vue).toContain('active')
    expect(vue).toContain(':payload="')
    expect(vue).toContain('visible: true')

    const jsx = stringifyComponent(
      {
        name: 'Button',
        props: { onClick: 'submit()', disabled: false },
        children: ['Run']
      },
      { lang: 'jsx' }
    )
    expect(jsx).toContain('onClick="{submit()}"')
    expect(jsx).toContain('disabled={false}')

    const raw = stringifyComponent(
      {
        name: RAW_TAG_NAME,
        props: {
          content: '<span class="a">X</span>',
          injectedProps: { class: 'b', id: 'raw-id' }
        },
        children: []
      },
      'jsx'
    )
    expect(raw).toBe('<span class="a b" id="raw-id">X</span>')
  })

  it('serializes with transform hook outputs and falls back to empty string', () => {
    const component = {
      name: 'Button',
      type: 'INSTANCE',
      visible: true,
      properties: {},
      children: []
    } as unknown as Parameters<typeof serializeComponent>[0]

    const fromString = serializeComponent(
      component,
      { lang: 'jsx' },
      {
        transformComponent: () => '<Custom />'
      }
    )
    expect(fromString).toBe('<Custom />')

    const fromObject = serializeComponent(
      component,
      { lang: 'vue' },
      {
        transformComponent: () => ({ name: 'div', props: {}, children: ['ok'] })
      }
    )
    expect(fromObject).toContain('<div>')
    expect(fromObject).toContain('ok')

    const empty = serializeComponent(component, { lang: 'jsx' })
    expect(empty).toBe('')
  })

  it('merges and injects attributes for quoted, boolean and self-closing tags', () => {
    const mergedClass = mergeAttributes('<div CLASS="one"></div>', { class: 'two' })
    expect(mergedClass).toBe('<div CLASS="one two"></div>')

    const mergedBooleanAndInserted = mergeAttributes('<img class="a" disabled/>', {
      class: 'b',
      disabled: 'false',
      alt: 'cover'
    })
    expect(mergedBooleanAndInserted).toContain('class="a b"')
    expect(mergedBooleanAndInserted).toContain('disabled="false"')
    expect(mergedBooleanAndInserted).toContain(' alt="cover"')
    expect(mergedBooleanAndInserted).toContain('/>')
  })
})
