import { describe, expect, it } from 'vitest'

import { collectUnboundColorLiteralClusters } from '@/mcp/tools/code/literal-clusters'
import { createSnapshot, createTree } from '@/tests/mcp/tools/code/test-helpers'

describe('mcp/code unbound literal clusters', () => {
  it('reports normalized repeated colors with concrete consumers and excludes non-evidence', () => {
    const first = createSnapshot({ id: 'first' })
    first.name = '  overview / title  '
    const second = createSnapshot({ id: 'second' })
    second.name = 'workspace / title'
    const third = createSnapshot({ id: 'third' })
    const tree = createTree([first, second, third])
    const styles = new Map<string, Record<string, string>>([
      [
        'first',
        {
          color: '#fff',
          'background-color': '#FFFFFF',
          'border-color': '#00000040',
          'outline-color': '#000'
        }
      ],
      [
        'second',
        {
          color: 'rgb(255, 255, 255)',
          'background-color': 'linear-gradient(#fff, #fff)',
          'border-color': 'var(--border)',
          'text-decoration-color': 'rgba(0, 0, 0, 0.25)'
        }
      ],
      ['third', { width: '#fff', color: '#123456' }]
    ])

    expect(collectUnboundColorLiteralClusters(styles, tree)).toEqual([
      {
        kind: 'color',
        value: '#FFFFFF',
        occurrences: 3,
        consumers: [
          {
            nodeId: 'first',
            nodeName: 'overview / title',
            properties: ['background-color', 'color']
          },
          {
            nodeId: 'second',
            nodeName: 'workspace / title',
            properties: ['color']
          }
        ]
      },
      {
        kind: 'color',
        value: '#00000040',
        occurrences: 2,
        consumers: [
          {
            nodeId: 'first',
            nodeName: 'overview / title',
            properties: ['border-color']
          },
          {
            nodeId: 'second',
            nodeName: 'workspace / title',
            properties: ['text-decoration-color']
          }
        ]
      }
    ])
  })

  it('bounds and deterministically orders clusters and sampled consumers', () => {
    const nodes = Array.from({ length: 5 }, (_, index) => createSnapshot({ id: `node-${index}` }))
    const tree = createTree(nodes)
    const properties = [
      'color',
      'background-color',
      'border-top-color',
      'border-right-color',
      'border-bottom-color',
      'border-left-color',
      'outline-color'
    ]
    const values = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777']
    const style = Object.fromEntries(
      properties.map((property, index) => [property, values[index]!])
    )
    const styles = new Map(nodes.map((node) => [node.id, { ...style }]))

    const clusters = collectUnboundColorLiteralClusters(styles, tree)

    expect(clusters).toHaveLength(6)
    expect(clusters?.map((cluster) => cluster.value)).toEqual(values.slice(0, 6))
    expect(clusters?.[0]).toMatchObject({
      occurrences: 5,
      omittedConsumers: 2,
      consumers: [
        { nodeId: 'node-0', properties: ['color'] },
        { nodeId: 'node-1', properties: ['color'] },
        { nodeId: 'node-2', properties: ['color'] }
      ]
    })
  })
})
