import type { CanvasResolvedApplyParameters } from '@tempad-dev/shared'

import { expect, it, vi } from 'vitest'

import { applyResolvedCanvas } from '@/mcp/tools/canvas'

import { createFixture } from '../../fakes/figma'

function svgRequest(): CanvasResolvedApplyParameters {
  return {
    mode: 'create',
    markup:
      '<div data-key="root" class="w-80 h-40"><div data-key="icon" class="absolute left-0 top-0 size-6"/><div data-key="later" class="absolute left-10 top-0 size-6"/></div>',
    assets: { icon: { type: 'SVG', svg: '<svg viewBox="0 0 24 24"><path d="M0 0h1"/></svg>' } },
    bindings: { icon: { figma: { svg: { assetKey: 'icon' } } } }
  }
}

it.each(['metadata', 'placement'] as const)(
  'cleans up a replacement SVG import after %s fails and preserves its prior child',
  async (failure) => {
    const fixture = createFixture()
    const input = svgRequest()
    const created = await applyResolvedCanvas(input)
    const root = fixture.getNode(created.rootNodeId!)
    const wrapper = fixture.getNode(created.nodeIdsByKey.icon!)
    const previous = wrapper.children[0]!
    let imported: FrameNode | undefined
    fixture.createNodeFromSvg.mockImplementationOnce(() => {
      imported = fixture.createNode('FRAME') as unknown as FrameNode
      imported.resize(48, 48)
      vi.spyOn(
        imported,
        failure === 'metadata' ? 'setSharedPluginData' : 'rescale'
      ).mockImplementation(() => {
        throw new Error(`Rejected SVG ${failure}`)
      })
      return imported
    })

    await expect(
      applyResolvedCanvas({
        ...input,
        mode: 'update',
        targetNodeId: root.id,
        assets: { icon: { type: 'SVG', svg: '<svg viewBox="0 0 24 24"><path d="M0 0h2"/></svg>' } }
      })
    ).rejects.toThrow(`Rejected SVG ${failure}`)

    expect(imported?.removed).toBe(true)
    expect(wrapper.children).toEqual([previous])
    expect(fixture.page.children).toEqual([root])
  }
)

it('reports a repaired SVG child and converges without reimporting it', async () => {
  const fixture = createFixture()
  const input = svgRequest()
  const created = await applyResolvedCanvas(input)
  const wrapper = fixture.getNode(created.nodeIdsByKey.icon!)
  const child = wrapper.children[0]!
  expect(created.createdNodeIds).toContain(child.id)
  expect(created.updatedNodeIds).toEqual([])
  expect(Object.values(created.nodeIdsByKey)).not.toContain(child.id)
  child.x = -10
  const update = { ...input, mode: 'update' as const, targetNodeId: created.rootNodeId! }

  await expect(applyResolvedCanvas(update)).resolves.toMatchObject({
    mutationCount: 1,
    updatedNodeIds: [child.id]
  })
  expect(child.x).toBe(0)
  await expect(applyResolvedCanvas(update)).resolves.toMatchObject({ mutationCount: 0 })
  expect(fixture.createNodeFromSvg).toHaveBeenCalledOnce()
})

it('tracks an SVG placement repair when a later write fails', async () => {
  const fixture = createFixture()
  const input = svgRequest()
  const created = await applyResolvedCanvas(input)
  const child = fixture.getNode(created.nodeIdsByKey.icon!).children[0]!
  child.x = -10
  Object.defineProperty(fixture.getNode(created.nodeIdsByKey.later!), 'fills', {
    get: () => [],
    set: () => {
      throw new Error('Rejected later paint')
    }
  })
  fixture.triggerUndo.mockClear()
  fixture.triggerUndo.mockImplementationOnce(() => {
    child.x = -10
  })

  await expect(
    applyResolvedCanvas({
      ...input,
      mode: 'update',
      targetNodeId: created.rootNodeId!,
      bindings: {
        ...input.bindings,
        later: { figma: { fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }] } }
      }
    })
  ).rejects.toThrow('Rejected later paint')
  expect(fixture.triggerUndo).toHaveBeenCalledOnce()
  expect(child.x).toBe(-10)
})
