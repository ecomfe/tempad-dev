import { TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'
import { expect, it } from 'vitest'

import { handleApplyCanvas } from '@/mcp/tools/canvas'

import { createFixture } from '../../fakes/figma'

it.each([
  { type: 'GROUP', properties: { group: true } },
  { type: 'BOOLEAN_OPERATION', properties: { booleanOperation: 'UNION' } },
  { type: 'COMPONENT_SET', properties: { component: { type: 'COMPONENT_SET' } } }
] as const)(
  'adopts an unowned $type root without treating retained children as outgoing moves',
  async ({ type, properties }) => {
    const fixture = createFixture()
    const root = fixture.createNode(type)
    const children = Array.from({ length: 2 }, (_, index) => {
      const child = fixture.createNode(type === 'COMPONENT_SET' ? 'COMPONENT' : 'RECTANGLE')
      child.name = `State=${index}`
      root.appendChild(child)
      return child
    })
    const input = {
      mode: 'update' as const,
      targetNodeId: root.id,
      markup: `<div data-key="root" class="${type === 'COMPONENT_SET' ? 'flex flex-col w-80 h-80' : 'w-fit h-fit'}">${children
        .map(
          (child, index) =>
            `<div data-key="child${index}" data-node-id="${child.id}" class="${type === 'COMPONENT_SET' ? '' : 'absolute left-0 top-0 '}w-10 h-10"/>`
        )
        .join('')}</div>`,
      native: { root: { figma: properties } }
    }

    await expect(handleApplyCanvas(input)).resolves.toMatchObject({
      rootNodeId: root.id,
      createdNodeIds: [],
      verification: { status: 'passed' }
    })
    expect(root.children).toEqual(children)
    expect(root.removed).toBe(false)
    await expect(handleApplyCanvas(input)).resolves.toMatchObject({ mutationCount: 0 })
  }
)

it.each(['root', 'child'] as const)(
  'rejects an owned %s key change before creating resources or opening Undo',
  async (target) => {
    const fixture = createFixture()
    const root = fixture.createNode('FRAME')
    const child = fixture.createNode('FRAME')
    root.appendChild(child)
    root.setSharedPluginData('tempad_dev', 'canvas-key', 'root')
    child.setSharedPluginData('tempad_dev', 'canvas-key', 'child')

    await expect(
      handleApplyCanvas({
        mode: 'update',
        targetNodeId: root.id,
        markup: `<div data-key="${target === 'root' ? 'replacement' : 'root'}" class="flex flex-col w-80 h-80"><div data-key="${target === 'child' ? 'replacement' : 'child'}" data-node-id="${child.id}" class="w-10 h-10"/></div>`,
        styles: { unrelated: { type: 'PAINT', name: 'Unrelated' } }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: { code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC },
      message: expect.stringContaining(`already owned by canvas key "${target}"`)
    })
    expect(figma.createPaintStyle).not.toHaveBeenCalled()
    expect(fixture.commitUndo).not.toHaveBeenCalled()
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
    expect(root.getSharedPluginData('tempad_dev', 'canvas-key')).toBe('root')
    expect(child.getSharedPluginData('tempad_dev', 'canvas-key')).toBe('child')
  }
)
