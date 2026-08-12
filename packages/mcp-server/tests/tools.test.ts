import type { ToolResultMap } from '@tempad-dev/shared'

import { TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'
import { describe, expect, it } from 'vitest'

import {
  TOOL_DEFS,
  coercePayloadToToolResponse,
  createApplyCanvasToolResponse,
  createAssetsToolResponse,
  createCodeToolResponse,
  createDesignSystemToolResponse,
  createInlineBudgetExceededToolResponse,
  createScreenshotToolResponse,
  createStructureToolResponse,
  createTokenDefsToolResponse,
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
const ASSET_HASH = 'a'.repeat(64)
const SCREENSHOT_HASH = 'd'.repeat(64)

function textContent(block: unknown): string {
  expect(block).toMatchObject({ type: 'text' })
  return (block as { type: 'text'; text: string }).text
}

describe('tools response helpers', () => {
  it('exposes result-oriented canvas authoring tools', () => {
    expect(
      new Set(TOOL_DEFS.filter((tool) => tool.exposed !== false).map((tool) => tool.name))
    ).toEqual(
      new Set(['get_code', 'get_design_system', 'apply_canvas', 'get_screenshot', 'get_structure'])
    )
  })

  it('keeps canvas authoring outcome-focused and catalog-optional', () => {
    const designSystem = TOOL_DEFS.find((tool) => tool.name === 'get_design_system')
    const applyCanvas = TOOL_DEFS.find((tool) => tool.name === 'apply_canvas')
    const getStructure = TOOL_DEFS.find((tool) => tool.name === 'get_structure')

    expect(designSystem?.description).toContain('reuse is permitted and relevant')
    expect(designSystem?.description).toContain('limits design evidence to the current page')
    expect(applyCanvas?.description).toContain('declarative desired Figma result')
    expect(applyCanvas?.description).toContain('Markup serializes ordinary layers as Canvas HTML')
    expect(applyCanvas?.description).toContain('typed fields express selected Figma capabilities')
    expect(applyCanvas?.description).toContain('Create auto-places the new root')
    expect(applyCanvas?.description).toContain('preserves omitted live state')
    expect(getStructure?.description).toContain("relative to the node's actual Figma parent")
    expect(getStructure?.description).toContain('only page children are page-relative')
    expect(designSystem?.parameters.parse({})).toEqual({})
    expect(
      applyCanvas?.parameters.parse({
        mode: 'create',
        markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>'
      })
    ).not.toHaveProperty('catalogId')
  })

  it('declares read and write behavior for every tool', () => {
    const applyCanvas = TOOL_DEFS.find((tool) => tool.name === 'apply_canvas')
    expect(applyCanvas?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true
    })

    for (const tool of TOOL_DEFS.filter((definition) => definition.name !== 'apply_canvas')) {
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      })
    }
  })

  it('formats code tool responses with summaries, warnings, assets and tokens', () => {
    const payload: ToolResultMap['get_code'] = {
      ...codePayload,
      warnings: [{ type: 'depth-cap', message: 'Depth capped.' }],
      tokens: {
        '--color-primary': {
          kind: 'color',
          value: '#6699CC'
        }
      },
      assets: [
        {
          hash: ASSET_HASH,
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

  it('surfaces shell warnings in code tool summaries', () => {
    const payload: ToolResultMap['get_code'] = {
      ...codePayload,
      warnings: [
        {
          type: 'shell',
          message:
            'Shell response: omitted direct children ids are listed in the inline comment. Call get_code for each id in that order, then fill the results back into this shell without re-guessing parent layout.'
        }
      ]
    }

    const result = createCodeToolResponse(payload)
    const summaryText = textContent(result.content[0])

    expect(summaryText).toContain('Shell response')
    expect(summaryText).toContain('inline comment')
  })

  it('formats code tool responses with no assets', () => {
    const result = createCodeToolResponse(codePayload)
    expect(result.content).toHaveLength(1)
    expect(textContent(result.content[0])).toContain('No binary assets were attached')
  })

  it('formats structure and token tool responses with structured content summaries', () => {
    const structurePayload: ToolResultMap['get_structure'] = {
      roots: [{ id: '1', name: 'Root', type: 'FRAME', x: 0, y: 0, width: 10, height: 10 }]
    }
    const structureResult = createStructureToolResponse(structurePayload)
    expect(structureResult.structuredContent).toEqual(structurePayload)
    expect(textContent(structureResult.content[0])).toContain('Returned structure outline')

    const tokenPayload: ToolResultMap['get_token_defs'] = {
      '--color-primary': {
        kind: 'color',
        value: '#6699CC'
      }
    }
    const tokenResult = createTokenDefsToolResponse(tokenPayload)
    expect(tokenResult.structuredContent).toEqual(tokenPayload)
    expect(textContent(tokenResult.content[0])).toContain('Resolved 1 token definition')
  })

  it('formats design-system discovery and canvas apply responses', () => {
    const designSystemPayload: ToolResultMap['get_design_system'] = {
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
      styles: [
        {
          ref: 's1',
          name: 'Heading',
          type: 'paint',
          signature: 'solid'
        }
      ],
      shaders: [{ ref: 'h1', name: 'Aurora', type: 'effect' }]
    }
    const designSystemResult = createDesignSystemToolResponse(designSystemPayload)
    expect(designSystemResult.structuredContent).toEqual(designSystemPayload)
    expect(textContent(designSystemResult.content[0])).toContain('1 component')
    expect(textContent(designSystemResult.content[0])).toContain('1 style')
    expect(textContent(designSystemResult.content[0])).toContain('1 shader')

    const applyPayload: ToolResultMap['apply_canvas'] = {
      rootNodeId: '2:1',
      nodeIdsByKey: { root: '2:1' },
      createdNodeIds: [],
      updatedNodeIds: ['2:1'],
      removedNodeIds: [],
      mutationCount: 1,
      verification: {
        status: 'passed',
        nodesChecked: 1,
        referencesChecked: 0,
        warnings: []
      }
    }
    const applyResult = createApplyCanvasToolResponse(applyPayload)
    expect(applyResult.structuredContent).toEqual({
      rootNodeId: '2:1',
      nodeIdsByKey: { root: '2:1' },
      mutationCount: 1,
      nodeChanges: { created: 0, updated: 1, removed: 0 },
      verification: applyPayload.verification
    })
    expect(textContent(applyResult.content[0])).toContain('Applied 1 canvas mutation')
    expect(textContent(applyResult.content[0])).toContain('structuredContent.nodeIdsByKey')

    const warningResult = createApplyCanvasToolResponse({
      ...applyPayload,
      verification: {
        status: 'warning',
        nodesChecked: 1,
        referencesChecked: 1,
        warnings: [
          {
            code: 'layout-affecting-visibility-property',
            key: 'nav/indicator',
            message: 'Hiding it can move siblings.'
          }
        ]
      }
    })
    expect(textContent(warningResult.content[0])).toContain(
      'layout-affecting-visibility-property (nav/indicator): Hiding it can move siblings.'
    )

    const removalResult = createApplyCanvasToolResponse({
      rootNodeId: '2:1',
      rootRemoved: true,
      nodeIdsByKey: {},
      createdNodeIds: [],
      updatedNodeIds: [],
      removedNodeIds: ['2:1'],
      mutationCount: 1,
      verification: {
        status: 'passed',
        nodesChecked: 0,
        referencesChecked: 0,
        warnings: []
      }
    })
    expect(textContent(removalResult.content[0])).toContain('Root node is absent')
    expect(textContent(removalResult.content[0])).not.toContain('Reuse nodeIdsByKey')
  })

  it('formats screenshot tool responses with a bounded image resource link', () => {
    const payload: ToolResultMap['get_screenshot'] = {
      format: 'png',
      width: 100,
      height: 80,
      scale: 2,
      bytes: 2 * 1024 * 1024,
      asset: {
        hash: SCREENSHOT_HASH,
        url: 'https://assets.example.com/d4c3b2a1.png',
        localPath: '/tmp/tempad-dev/assets/d4c3b2a1.png',
        mimeType: 'image/png',
        size: 2 * 1024 * 1024
      }
    }

    const result = createScreenshotToolResponse(payload)
    expect(result.structuredContent).toEqual(payload)
    expect(textContent(result.content[0])).toBe(
      'Screenshot 100x80 @2x (2.0 MB). Open the local PNG directly with an image viewer: /tmp/tempad-dev/assets/d4c3b2a1.png. Receiving the asset reference alone is not visual verification. If this is a representative-screen check, inspect it before applying dependent screens.'
    )
    expect(result.content[1]).toEqual({
      type: 'resource_link',
      uri: 'https://assets.example.com/d4c3b2a1.png',
      name: `Figma screenshot ${SCREENSHOT_HASH}.png`,
      description: '100x80 rendered Figma node',
      mimeType: 'image/png',
      size: 2 * 1024 * 1024
    })
    expect(result.content).toHaveLength(2)
  })

  it('formats asset tool responses with summary text and structured content', () => {
    const payload: ToolResultMap['get_assets'] = {
      assets: [
        {
          hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          url: 'https://assets.example.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png',
          mimeType: 'image/png',
          size: 1024
        }
      ],
      missing: ['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']
    }

    const result = createAssetsToolResponse(payload)
    expect(result.structuredContent).toEqual(payload)
    expect(textContent(result.content[0])).toContain('Resolved 1 asset')
    expect(textContent(result.content[0])).toContain(
      'Missing: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    )
  })

  it('formats inline budget errors with retry guidance', () => {
    const result = createInlineBudgetExceededToolResponse('get_token_defs', 70000)
    expect(result.isError).toBe(true)
    expect(textContent(result.content[0])).toContain('64 KiB inline budget')
    expect(textContent(result.content[0])).toContain('split them into smaller batches')

    expect(
      textContent(createInlineBudgetExceededToolResponse('apply_canvas', 70000).content[0])
    ).toContain('smaller desired subtree')
    expect(
      textContent(createInlineBudgetExceededToolResponse('get_design_system', 70000).content[0])
    ).toContain('catalog cursor')
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
    expect(textContent(connectivityError.content[0])).toContain('enable the MCP server')

    const selectionError = createToolErrorResponse('get_code', {
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_SELECTION },
      message: 'Select exactly one visible node.'
    })
    expect(selectionError.isError).toBe(true)
    expect(textContent(selectionError.content[0])).toContain('[INVALID_SELECTION]')
    expect(textContent(selectionError.content[0])).toContain('Tip: Select exactly one visible node')

    const verificationError = createToolErrorResponse('apply_canvas', {
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: 'Verification failed for "root": direct effect 0 does not match.'
    })
    expect(textContent(verificationError.content[0])).toContain(
      'TemPad rolls verification failures back'
    )
    expect(textContent(verificationError.content[0])).toContain(
      'preserving unrelated design intent'
    )

    const unknownError = createToolErrorResponse('get_assets', 42)
    expect(unknownError.isError).toBe(true)
    expect(textContent(unknownError.content[0])).toBe(
      'Tool "get_assets" failed: Unknown error occurred.'
    )

    const missingCode = createToolErrorResponse('get_assets', { cause: { code: 123 } })
    expect(textContent(missingCode.content[0])).toBe(
      'Tool "get_assets" failed: Unknown error occurred.'
    )

    const unknownCode = createToolErrorResponse('get_assets', {
      code: 'NOT_A_TEMPAD_ERROR',
      message: 'failed'
    })
    expect(textContent(unknownCode.content[0])).toBe('Tool "get_assets" failed: failed')

    const nonObjectCause = createToolErrorResponse('get_assets', {
      cause: 'timeout',
      message: 'websocket connection failed'
    })
    expect(textContent(nonObjectCause.content[0])).toContain('websocket connection failed')
    expect(textContent(nonObjectCause.content[0])).toContain('Troubleshooting:')

    const stableKeyError = createToolErrorResponse('apply_canvas', {
      code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC,
      message: 'Canvas key "websocket" is duplicated inside the update scope.'
    })
    expect(textContent(stableKeyError.content[0])).toContain('Canvas key "websocket"')
    expect(textContent(stableKeyError.content[0])).not.toContain('Troubleshooting:')

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
    expect(() =>
      createStructureToolResponse({ roots: null } as unknown as ToolResultMap['get_structure'])
    ).toThrow(/Invalid get_structure payload/)
    expect(() =>
      createTokenDefsToolResponse({ '--x': null } as unknown as ToolResultMap['get_token_defs'])
    ).toThrow(/Invalid get_token_defs payload/)
    expect(() =>
      createDesignSystemToolResponse({
        catalogId: null
      } as unknown as ToolResultMap['get_design_system'])
    ).toThrow(/Invalid get_design_system payload/)
    expect(() =>
      createDesignSystemToolResponse({
        catalogId: 'ds_1',
        components: [{ ref: 'c1' }],
        variables: [],
        collections: [],
        styles: []
      } as unknown as ToolResultMap['get_design_system'])
    ).toThrow(/Invalid get_design_system payload/)
    expect(() =>
      createDesignSystemToolResponse({
        catalogId: 'ds_1',
        components: [],
        variables: [],
        collections: [],
        styles: {}
      } as unknown as ToolResultMap['get_design_system'])
    ).toThrow(/Invalid get_design_system payload/)
    expect(() =>
      createDesignSystemToolResponse({
        catalogId: 'ds_1',
        components: [],
        variables: [],
        collections: [],
        styles: [],
        shaders: {}
      } as unknown as ToolResultMap['get_design_system'])
    ).toThrow(/Invalid get_design_system payload/)
    expect(() =>
      createDesignSystemToolResponse(null as unknown as ToolResultMap['get_design_system'])
    ).toThrow(/Invalid get_design_system payload/)
    expect(() =>
      createApplyCanvasToolResponse({
        rootNodeId: '1:1',
        nodeIdsByKey: {},
        createdNodeIds: [],
        updatedNodeIds: [],
        mutationCount: 0
      } as unknown as ToolResultMap['apply_canvas'])
    ).toThrow(/Invalid apply_canvas payload/)
    expect(() =>
      createApplyCanvasToolResponse(null as unknown as ToolResultMap['apply_canvas'])
    ).toThrow(/Invalid apply_canvas payload/)
    expect(() =>
      createApplyCanvasToolResponse({
        rootNodeId: '1:1',
        nodeIdsByKey: { root: 1 },
        createdNodeIds: [],
        updatedNodeIds: [],
        removedNodeIds: [],
        mutationCount: 0,
        verification: {
          status: 'passed',
          nodesChecked: 1,
          referencesChecked: 0,
          warnings: []
        }
      } as unknown as ToolResultMap['apply_canvas'])
    ).toThrow(/Invalid apply_canvas payload/)
    expect(() =>
      createApplyCanvasToolResponse({
        rootNodeId: '1:1',
        rootRemoved: false,
        nodeIdsByKey: {},
        createdNodeIds: [],
        updatedNodeIds: [],
        removedNodeIds: [],
        mutationCount: 0
      } as unknown as ToolResultMap['apply_canvas'])
    ).toThrow(/Invalid apply_canvas payload/)
    expect(() =>
      createApplyCanvasToolResponse(
        Object.assign([], {
          rootNodeId: '1:1',
          nodeIdsByKey: {},
          createdNodeIds: [],
          updatedNodeIds: [],
          removedNodeIds: [],
          mutationCount: 0
        }) as unknown as ToolResultMap['apply_canvas']
      )
    ).toThrow(/Invalid apply_canvas payload/)
  })
})
