import { describe, expect, it } from 'vitest'

import type { ToolResponseLike } from '../../src/mcp/responses'
import type { ToolResultMap } from '../../src/mcp/tools'

import {
  buildApplyCanvasToolResult,
  buildGetCodeToolResult,
  buildGetDesignSystemToolResult,
  buildGetScreenshotToolResult,
  buildGetStructureToolResult,
  buildGetTokenDefsToolResult,
  measureCallToolResultBytes,
  utf8Bytes
} from '../../src/mcp/responses'

const ASSET_HASH = 'd'.repeat(64)

describe('mcp/responses helpers', () => {
  it('counts UTF-8 bytes for multibyte characters', () => {
    expect(utf8Bytes('abc')).toBe(3)
    expect(utf8Bytes('你好')).toBe(6)
    expect(utf8Bytes('🙂')).toBe(4)
  })

  it('measures CallToolResult bytes beyond the bare text payload', () => {
    const result: ToolResponseLike = {
      content: [{ type: 'text', text: 'hello' }],
      structuredContent: { code: 'hello' }
    }

    expect(measureCallToolResultBytes(result)).toBeGreaterThan(utf8Bytes('hello'))
  })

  it('builds code tool summaries from warning messages', () => {
    const payload: ToolResultMap['get_code'] = {
      code: '<div>Hello</div>',
      lang: 'jsx',
      codegen: {
        plugin: 'builtin',
        config: {
          cssUnit: 'px',
          rootFontSize: 16,
          scale: 1
        }
      },
      warnings: [
        {
          type: 'shell',
          message: 'Shell response: omitted direct child ids are listed in the inline comment.'
        }
      ]
    }

    const result = buildGetCodeToolResult(payload)
    expect(result.structuredContent).toEqual(payload)
    expect(result.content?.[0]?.text).toContain('Shell response')
    expect(result.content?.[0]?.text).not.toContain('Next: call get_code with')
  })

  it('builds structure and token tool summaries with structured content', () => {
    const structure = buildGetStructureToolResult({
      roots: [{ id: '1', name: 'Root', type: 'FRAME', x: 0, y: 0, width: 10, height: 10 }]
    })
    expect(structure.structuredContent).toEqual({
      roots: [{ id: '1', name: 'Root', type: 'FRAME', x: 0, y: 0, width: 10, height: 10 }]
    })
    expect(structure.content?.[0]?.text).toContain('Returned structure outline')

    const tokens = buildGetTokenDefsToolResult({
      '--color-primary': {
        kind: 'color',
        value: '#fff'
      }
    })
    expect(tokens.content?.[0]?.text).toContain('Resolved 1 token definition')
  })

  it('builds design-system and canvas-apply summaries', () => {
    const designSystem = buildGetDesignSystemToolResult({
      catalogId: 'ds_1',
      components: [
        {
          ref: 'c1',
          tag: 'Button',
          name: 'Button',
          props: {}
        }
      ],
      variables: [],
      collections: [],
      styles: [],
      shaders: [],
      nextCursor: 12,
      warnings: ['No variables were found.']
    })
    expect(designSystem.content?.[0]?.text).toContain(
      'Returned 1 component, 0 variables, 0 styles, 0 collections, and 0 shaders from catalog ds_1.'
    )
    expect(designSystem.content?.[0]?.text).toContain('Continue this catalog with cursor 12')
    expect(designSystem.content?.[0]?.text).toContain(
      'Read one bounded definition with this catalogId and a returned ref.'
    )
    expect(designSystem.content?.[0]?.text).toContain('No variables were found.')

    const applied = buildApplyCanvasToolResult({
      rootNodeId: '2:1',
      nodeIdsByKey: { root: '2:1' },
      createdNodeIds: ['2:1'],
      updatedNodeIds: [],
      removedNodeIds: ['2:2'],
      mutationCount: 2,
      verification: {
        status: 'warning',
        nodesChecked: 1,
        referencesChecked: 0,
        warnings: [
          {
            code: 'optional-property',
            key: 'root',
            message: 'One optional property was skipped.'
          }
        ]
      }
    })
    expect(applied.content?.[0]?.text).toContain('Applied 2 canvas mutations')
    expect(applied.content?.[0]?.text).toContain(
      '1 node created, 0 nodes updated, and 1 node removed'
    )
    expect(applied.content?.[0]?.text).toContain('One optional property was skipped.')
    expect(applied.content?.[0]?.text).toContain('Root node: 2:1')
    expect(applied.content?.[0]?.text).toContain('structuredContent.nodeIdsByKey')
    expect(applied.structuredContent).toEqual({
      rootNodeId: '2:1',
      nodeIdsByKey: { root: '2:1' },
      mutationCount: 2,
      nodeChanges: { created: 1, updated: 0, removed: 1 },
      verification: {
        status: 'warning',
        nodesChecked: 1,
        referencesChecked: 0,
        warnings: [
          {
            code: 'optional-property',
            key: 'root',
            message: 'One optional property was skipped.'
          }
        ]
      }
    })

    const removed = buildApplyCanvasToolResult({
      rootNodeId: '2:1',
      rootRemoved: true,
      nodeIdsByKey: {},
      createdNodeIds: [],
      updatedNodeIds: [],
      removedNodeIds: [],
      mutationCount: 0,
      verification: {
        status: 'passed',
        nodesChecked: 0,
        referencesChecked: 0,
        warnings: []
      }
    })
    expect(removed.content?.[0]?.text).toContain('Root node is absent: 2:1')
    expect(removed.content?.[0]?.text).not.toContain('Reuse nodeIdsByKey')
  })

  it('summarizes an exact design-system definition without discovery guidance', () => {
    const result = buildGetDesignSystemToolResult({
      catalogId: 'ds_1',
      components: [],
      variables: [],
      collections: [],
      styles: [],
      details: {
        ref: 's1',
        kind: 'style',
        definition: { type: 'PAINT' }
      }
    })

    expect(result.content?.[0]?.text).toBe(
      'Returned bounded style definition s1 from catalog ds_1.'
    )
  })

  it('links screenshot bytes without embedding them in structured content', () => {
    const payload: ToolResultMap['get_screenshot'] = {
      format: 'png',
      width: 320,
      height: 200,
      scale: 1,
      bytes: 1024,
      asset: {
        hash: ASSET_HASH,
        url: 'https://example.com/assets/deadbeef',
        mimeType: 'image/png',
        size: 1024
      }
    }

    const result = buildGetScreenshotToolResult(payload)

    expect(result.content).toEqual([
      {
        type: 'text',
        text: 'Screenshot 320x200 @1x (1.0 KB). Inspect the linked PNG for visual verification.'
      },
      {
        type: 'resource_link',
        uri: payload.asset.url,
        name: `Figma screenshot ${ASSET_HASH}.png`,
        description: '320x200 rendered Figma node',
        mimeType: 'image/png',
        size: 1024
      }
    ])
    expect(result.structuredContent).toEqual(payload)
  })
})
