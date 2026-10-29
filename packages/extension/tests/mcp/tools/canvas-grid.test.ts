import { expect, it, vi } from 'vitest'

import { applyResolvedCanvas } from '@/mcp/tools/canvas'

import { createFixture } from '../../fakes/figma'

it.each(
  (['gridColumnSizes', 'gridRowSizes'] as const).flatMap((tracks) =>
    (['type', 'value'] as const).map((field) => ({ tracks, field }))
  )
)('rejects an ignored $tracks $field write', async ({ tracks, field }) => {
  const fixture = createFixture()
  vi.mocked(figma.createFrame).mockImplementationOnce(() => {
    const node = fixture.createNode('FRAME') as unknown as FrameNode
    Object.defineProperty(node[tracks][0]!, field, {
      get: () => (field === 'type' ? 'FLEX' : 1),
      set: () => {}
    })
    return node
  })

  await expect(
    applyResolvedCanvas({
      mode: 'create',
      markup: '<div data-key="grid" class="grid grid-cols-[20.3px] grid-rows-[20.3px] w-40 h-40"/>'
    })
  ).rejects.toThrow(`${tracks} track 0 does not match`)
  expect(fixture.page.children).toEqual([])
})
