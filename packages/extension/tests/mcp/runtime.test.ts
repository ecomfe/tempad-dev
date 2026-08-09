import { TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  selection: {
    value: [] as Array<{ visible: boolean }>
  },
  runApplyCanvas: vi.fn(),
  runGetCode: vi.fn(),
  runGetDesignSystem: vi.fn(),
  runGetScreenshot: vi.fn(),
  runGetStructure: vi.fn(),
  runGetTokenDefs: vi.fn()
}))

vi.mock('@/ui/state', () => ({
  selection: mocks.selection
}))

vi.mock('@/mcp/tools/code', () => ({
  handleGetCode: mocks.runGetCode
}))

vi.mock('@/mcp/tools/canvas', () => ({
  handleApplyCanvas: mocks.runApplyCanvas
}))

vi.mock('@/mcp/tools/design-system', () => ({
  handleGetDesignSystem: mocks.runGetDesignSystem
}))

vi.mock('@/mcp/tools/screenshot', () => ({
  handleGetScreenshot: mocks.runGetScreenshot
}))

vi.mock('@/mcp/tools/structure', () => ({
  handleGetStructure: mocks.runGetStructure
}))

vi.mock('@/mcp/tools/token', () => ({
  handleGetTokenDefs: mocks.runGetTokenDefs
}))

function createSceneNode(id: string, visible = true): SceneNode {
  return {
    id,
    name: id,
    type: 'FRAME',
    visible
  } as unknown as SceneNode
}

function setFigmaGetNodeById(returnValue: BaseNode | null) {
  vi.stubGlobal('figma', {
    getNodeById: vi.fn().mockReturnValue(returnValue)
  } as unknown as PluginAPI)
}

async function importRuntime() {
  vi.resetModules()
  return import('@/mcp/runtime')
}

afterEach(() => {
  mocks.selection.value = []
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('mcp/runtime', () => {
  it('loads in node runtime without window global', async () => {
    setFigmaGetNodeById(null)
    const runtime = await importRuntime()

    expect(new Set(Object.keys(runtime.MCP_TOOL_HANDLERS))).toEqual(
      new Set([
        'apply_canvas',
        'get_code',
        'get_design_system',
        'get_token_defs',
        'get_screenshot',
        'get_structure'
      ])
    )
    expect(typeof (globalThis as { window?: unknown }).window).toBe('undefined')
  }, 15000)

  it('merges tool handlers onto existing window.tempadTools when window exists', async () => {
    const existing = vi.fn()
    vi.stubGlobal('window', { tempadTools: { existing } } as unknown as Window)
    setFigmaGetNodeById(null)

    const runtime = await importRuntime()
    const tools = (window as Window & { tempadTools: Record<string, unknown> }).tempadTools

    expect(tools).toEqual({ existing, ...runtime.WINDOW_TEMPAD_TOOL_HANDLERS })
  }, 15000)

  it('initializes window.tempadTools when window exists without existing tools', async () => {
    vi.stubGlobal('window', {} as Window)
    setFigmaGetNodeById(null)

    const runtime = await importRuntime()
    const tools = (window as Window & { tempadTools: Record<string, unknown> }).tempadTools

    expect(tools).toEqual(runtime.WINDOW_TEMPAD_TOOL_HANDLERS)
  })

  it('routes get_code to tool implementation with resolved node and options', async () => {
    const node = createSceneNode('node-1')
    setFigmaGetNodeById(node)
    mocks.runGetCode.mockResolvedValue({ blocks: [] })

    const runtime = await importRuntime()
    const result = await runtime.MCP_TOOL_HANDLERS.get_code({
      nodeId: 'node-1',
      preferredLang: 'jsx',
      resolveTokens: true,
      vectorMode: 'snapshot'
    })

    expect(mocks.runGetCode).toHaveBeenCalledWith([node], 'jsx', true, 'snapshot', undefined)
    expect(result).toEqual({ blocks: [] })
  })

  it('routes browser bridge calls through the runtime dispatcher', async () => {
    const node = createSceneNode('node-1')
    setFigmaGetNodeById(node)
    mocks.runGetCode.mockResolvedValue({ blocks: [] })

    const runtime = await importRuntime()
    const result = await runtime.runMcpTool('get_code', {
      nodeId: 'node-1',
      preferredLang: 'jsx'
    })

    expect(mocks.runGetCode).toHaveBeenCalledWith([node], 'jsx', undefined, undefined, undefined)
    expect(result).toEqual({ blocks: [] })
  })

  it.each(['missing', 'toString'])(
    'rejects unknown bridge tool name "%s" at the runtime boundary',
    async (name) => {
      setFigmaGetNodeById(null)
      const runtime = await importRuntime()

      await expect(runtime.runMcpTool(name, {})).rejects.toThrow(
        `No handler registered for tool "${name}".`
      )
    }
  )

  it('routes window get_code debug overrides only through tempadTools exposure', async () => {
    const node = createSceneNode('node-1')
    vi.stubGlobal('window', {} as Window)
    setFigmaGetNodeById(node)
    mocks.runGetCode.mockResolvedValue({ blocks: [] })

    await importRuntime()
    const tools = (
      window as Window & {
        tempadTools: Record<string, (args?: unknown) => Promise<unknown>>
      }
    ).tempadTools

    expect(tools.get_code).toBeDefined()
    await tools.get_code?.({
      nodeId: 'node-1',
      preferredLang: 'jsx',
      _unbounded: true
    })

    expect(mocks.runGetCode).toHaveBeenCalledWith([node], 'jsx', undefined, undefined, {
      unbounded: true
    })
  })

  it('distinguishes missing, unsupported, and hidden node ids', async () => {
    setFigmaGetNodeById(null)
    const runtime = await importRuntime()

    await expect(runtime.MCP_TOOL_HANDLERS.get_code({ nodeId: 'missing' })).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.NODE_NOT_VISIBLE,
      message: expect.stringContaining('does not exist')
    })

    setFigmaGetNodeById({ id: 'document', type: 'DOCUMENT' } as unknown as BaseNode)
    await expect(runtime.MCP_TOOL_HANDLERS.get_code({ nodeId: 'document' })).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.NODE_NOT_VISIBLE,
      message: expect.stringContaining('not a supported scene node')
    })

    setFigmaGetNodeById(createSceneNode('hidden', false))
    await expect(runtime.MCP_TOOL_HANDLERS.get_code({ nodeId: 'hidden' })).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.NODE_NOT_VISIBLE,
      message: expect.stringContaining('is hidden')
    })
  })

  it('throws coded error for invalid current selection (empty or invisible)', async () => {
    setFigmaGetNodeById(null)
    const runtime = await importRuntime()

    mocks.selection.value = []
    await expect(runtime.MCP_TOOL_HANDLERS.get_code()).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_SELECTION
    })

    mocks.selection.value = [createSceneNode('hidden', false)]
    await expect(runtime.MCP_TOOL_HANDLERS.get_code()).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.INVALID_SELECTION
    })
  })

  it('uses current visible selection when nodeId is omitted', async () => {
    const selected = createSceneNode('selected')
    mocks.selection.value = [selected]
    setFigmaGetNodeById(null)
    mocks.runGetCode.mockResolvedValue({ blocks: [{ lang: 'jsx', code: '<div />' }] })

    const runtime = await importRuntime()
    await runtime.MCP_TOOL_HANDLERS.get_code({ preferredLang: 'jsx' })
    await runtime.MCP_TOOL_HANDLERS.get_code()

    expect(mocks.runGetCode).toHaveBeenCalledWith(
      [selected],
      'jsx',
      undefined,
      undefined,
      undefined
    )
    expect(mocks.runGetCode).toHaveBeenLastCalledWith(
      [selected],
      undefined,
      undefined,
      undefined,
      undefined
    )
  })

  it('validates get_token_defs input and forwards includeAllModes', async () => {
    setFigmaGetNodeById(null)
    mocks.runGetTokenDefs.mockResolvedValue({ defs: [] })
    const runtime = await importRuntime()

    await expect(runtime.MCP_TOOL_HANDLERS.get_token_defs()).rejects.toThrow(
      'names is required and must include at least one canonical token name.'
    )

    await runtime.MCP_TOOL_HANDLERS.get_token_defs({
      names: ['color-primary'],
      includeAllModes: true
    })
    expect(mocks.runGetTokenDefs).toHaveBeenCalledWith(['color-primary'], true)
  })

  it('routes screenshot and structure calls with node resolution and depth options', async () => {
    const node = createSceneNode('node-2')
    setFigmaGetNodeById(node)
    mocks.selection.value = [node]
    mocks.runGetScreenshot.mockResolvedValue({ imageData: 'data:image/png;base64,AA==' })
    mocks.runGetStructure.mockResolvedValue({ nodes: [] })

    const runtime = await importRuntime()

    await runtime.MCP_TOOL_HANDLERS.get_screenshot({ nodeId: 'node-2' })
    expect(mocks.runGetScreenshot).toHaveBeenCalledWith(node)

    await runtime.MCP_TOOL_HANDLERS.get_structure({
      nodeId: 'node-2',
      options: { depth: 3, native: true }
    })
    expect(mocks.runGetStructure).toHaveBeenCalledWith([node], 3, true)

    await runtime.MCP_TOOL_HANDLERS.get_structure()
    expect(mocks.runGetStructure).toHaveBeenLastCalledWith([node], undefined, undefined)
  })
})
