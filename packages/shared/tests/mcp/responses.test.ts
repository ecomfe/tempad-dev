import { describe, expect, it } from 'vitest'

import type { ToolResponseLike } from '../../src/mcp/responses'
import type { ToolResultMap } from '../../src/mcp/tools'

import {
  buildGetCodeToolResult,
  buildGetStructureToolResult,
  buildGetTokenDefsToolResult,
  measureCallToolResultBytes,
  utf8Bytes
} from '../../src/mcp/responses'

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
})
