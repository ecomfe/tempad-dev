import type { ToolResultMap } from '@tempad-dev/shared'

import { TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'
import { describe, expect, it } from 'vitest'

import {
  coercePayloadToToolResponse,
  createCodeToolResponse,
  createScreenshotToolResponse,
  createToolErrorResponse
} from '../src/tools'

const codePayload: ToolResultMap['get_code'] = {
  code: '<div>Hello</div>',
  lang: 'jsx',
  codegen: {
    plugin: 'builtin',
    config: {
      cssUnit: 'px',
      rootFontSize: 16,
      scale: 1
    }
  }
}

function textContent(block: unknown): string {
  expect(block).toMatchObject({ type: 'text' })
  return (block as { type: 'text'; text: string }).text
}

describe('tools response helpers', () => {
  it('formats code tool responses with summaries, warnings, assets and tokens', () => {
    const payload: ToolResultMap['get_code'] = {
      ...codePayload,
      warnings: [{ type: 'truncated', message: 'Depth capped.' }],
      tokens: {
        '--color-primary': {
          kind: 'color',
          value: '#6699CC'
        }
      },
      assets: [
        {
          hash: 'a1b2c3d4',
          url: 'https://assets.example.com/a1b2c3d4.png',
          mimeType: 'image/png',
          size: 2048,
          width: 20,
          height: 10
        }
      ]
    }

    const result = createCodeToolResponse(payload)
    expect(result.structuredContent).toEqual(payload)
    const summaryText = textContent(result.content[0])
    expect(summaryText).toContain('Generated `jsx` snippet')
    expect(summaryText).toContain('Depth capped.')
    expect(summaryText).toContain('Assets attached: 1')
    expect(summaryText).toContain('Token references included: 1')
    expect(result.content).toHaveLength(1)
  })

  it('formats code tool responses with no assets', () => {
    const result = createCodeToolResponse(codePayload)
    expect(result.content).toHaveLength(1)
    expect(textContent(result.content[0])).toContain('No binary assets were attached')
  })

  it('formats screenshot tool responses with summary text only', () => {
    const payload: ToolResultMap['get_screenshot'] = {
      format: 'png',
      width: 100,
      height: 80,
      scale: 2,
      bytes: 2 * 1024 * 1024,
      asset: {
        hash: 'd4c3b2a1',
        url: 'https://assets.example.com/d4c3b2a1.png',
        mimeType: 'image/png',
        size: 2 * 1024 * 1024
      }
    }

    const result = createScreenshotToolResponse(payload)
    expect(result.structuredContent).toEqual(payload)
    expect(textContent(result.content[0])).toBe(
      'Screenshot 100x80 @2x (2.0 MB) - Download: https://assets.example.com/d4c3b2a1.png'
    )
    expect(result.content).toHaveLength(1)
  })

  it('coerces payloads to MCP CallToolResult', () => {
    const passthrough = { content: [{ type: 'text' as const, text: 'ok' }] }
    expect(coercePayloadToToolResponse(passthrough)).toBe(passthrough)

    expect(coercePayloadToToolResponse('plain')).toEqual({
      content: [{ type: 'text', text: 'plain' }]
    })

    expect(coercePayloadToToolResponse({ a: 1 })).toEqual({
      content: [{ type: 'text', text: '{\n  "a": 1\n}' }]
    })

    expect(coercePayloadToToolResponse(undefined)).toEqual({
      content: [{ type: 'text', text: undefined }]
    })
  })

  it('formats tool errors with troubleshooting hints', () => {
    const connectivityError = createToolErrorResponse('get_code', {
      code: TEMPAD_MCP_ERROR_CODES.NO_ACTIVE_EXTENSION,
      message: 'No active TemPad Dev extension.'
    })

    expect(connectivityError.isError).toBe(true)
    expect(textContent(connectivityError.content[0])).toContain('Tool "get_code" failed')
    expect(textContent(connectivityError.content[0])).toContain('[NO_ACTIVE_EXTENSION]')
    expect(textContent(connectivityError.content[0])).toContain('Troubleshooting:')
    expect(textContent(connectivityError.content[0])).toContain('enable MCP')

    const selectionError = createToolErrorResponse('get_code', {
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_SELECTION },
      message: 'Select exactly one visible node.'
    })
    expect(selectionError.isError).toBe(true)
    expect(textContent(selectionError.content[0])).toContain('[INVALID_SELECTION]')
    expect(textContent(selectionError.content[0])).toContain('Tip: Select exactly one visible node')

    const unknownError = createToolErrorResponse('get_assets', 42)
    expect(unknownError.isError).toBe(true)
    expect(textContent(unknownError.content[0])).toBe(
      'Tool "get_assets" failed: Unknown error occurred.'
    )

    const missingCode = createToolErrorResponse('get_assets', { cause: { code: 123 } })
    expect(textContent(missingCode.content[0])).toBe(
      'Tool "get_assets" failed: Unknown error occurred.'
    )

    const nonObjectCause = createToolErrorResponse('get_assets', {
      cause: 'timeout',
      message: 'websocket connection failed'
    })
    expect(textContent(nonObjectCause.content[0])).toContain('websocket connection failed')
    expect(textContent(nonObjectCause.content[0])).toContain('Troubleshooting:')

    const emptyErrorMessage = createToolErrorResponse('get_assets', new Error(''))
    expect(textContent(emptyErrorMessage.content[0])).toBe(
      'Tool "get_assets" failed: Unknown error occurred.'
    )

    const stringError = createToolErrorResponse('get_assets', 'asset server url is not configured')
    expect(textContent(stringError.content[0])).toContain('asset server url is not configured')
    expect(textContent(stringError.content[0])).toContain('Troubleshooting:')
  })

  it('throws when payload shape is invalid', () => {
    expect(() => createCodeToolResponse({} as ToolResultMap['get_code'])).toThrow(
      /Invalid get_code payload/
    )
    expect(() => createCodeToolResponse(null as unknown as ToolResultMap['get_code'])).toThrow(
      /Invalid get_code payload/
    )
    expect(() =>
      createScreenshotToolResponse({ format: 'png' } as ToolResultMap['get_screenshot'])
    ).toThrow(/Invalid get_screenshot payload/)
    expect(() =>
      createScreenshotToolResponse(null as unknown as ToolResultMap['get_screenshot'])
    ).toThrow(/Invalid get_screenshot payload/)
  })
})
