import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  string: { stringify: vi.fn() },
  keyboard: { setLockMetaKey: vi.fn() },
  figma: { getCanvas: vi.fn() },
  css: { preprocessCssValue: vi.fn() },
  number: { toDecimalPlace: vi.fn() },
  color: { rgbToHex: vi.fn() },
  tempad: { getTemPadComponent: vi.fn() },
  module: { evaluate: vi.fn() },
  codegen: { codegen: vi.fn() },
  component: { stringifyComponent: vi.fn() },
  mcp: { MCP_SERVER: { name: 'tempad-dev' } }
}))

vi.mock('@/utils/string', () => mocks.string)
vi.mock('@/utils/keyboard', () => mocks.keyboard)
vi.mock('@/utils/figma', () => mocks.figma)
vi.mock('@/utils/css', () => mocks.css)
vi.mock('@/utils/number', () => mocks.number)
vi.mock('@/utils/color', () => mocks.color)
vi.mock('@/utils/tempad', () => mocks.tempad)
vi.mock('@/utils/module', () => mocks.module)
vi.mock('@/utils/codegen', () => mocks.codegen)
vi.mock('@/utils/component', () => mocks.component)
vi.mock('@/mcp', () => mocks.mcp)

describe('utils/index', () => {
  it('re-exports utility modules and mcp contracts', async () => {
    const utils = await import('@/utils')

    expect(utils.stringify).toBe(mocks.string.stringify)
    expect(utils.setLockMetaKey).toBe(mocks.keyboard.setLockMetaKey)
    expect(utils.getCanvas).toBe(mocks.figma.getCanvas)
    expect(utils.preprocessCssValue).toBe(mocks.css.preprocessCssValue)
    expect(utils.toDecimalPlace).toBe(mocks.number.toDecimalPlace)
    expect(utils.rgbToHex).toBe(mocks.color.rgbToHex)
    expect(utils.getTemPadComponent).toBe(mocks.tempad.getTemPadComponent)
    expect(utils.evaluate).toBe(mocks.module.evaluate)
    expect(utils.codegen).toBe(mocks.codegen.codegen)
    expect(utils.stringifyComponent).toBe(mocks.component.stringifyComponent)
    expect(utils.MCP_SERVER).toBe(mocks.mcp.MCP_SERVER)
  })
})
