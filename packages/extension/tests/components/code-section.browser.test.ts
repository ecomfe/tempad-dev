import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

vi.mock('@/utils/codegen', async (original) => ({
  ...(await original<typeof import('@/utils/codegen')>()),
  generateCodeBlocksForNode: vi.fn()
}))

import CodeSection from '@/components/sections/CodeSection.vue'
import { options, selection } from '@/ui/state'
import { generateCodeBlocksForNode } from '@/utils/codegen'

import { mount, unmountAll } from './mount'

afterEach(() => {
  unmountAll()
  selection.value = []
  vi.clearAllMocks()
})

it('keeps the latest selection code and does not regenerate when the panel moves', async () => {
  const generate = vi.mocked(generateCodeBlocksForNode)
  type Result = Awaited<ReturnType<typeof generateCodeBlocksForNode>>
  let finishFirst!: (result: Result) => void
  const result = (code: string) =>
    ({ codeBlocks: [{ name: 'css', title: 'CSS', lang: 'css', code }] }) as Result
  generate.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishFirst = resolve
      })
  )
  generate.mockResolvedValueOnce(result('latest-selection'))
  const host = mount(CodeSection)
  selection.value = [{ id: 'first' } as SceneNode]
  await nextTick()
  selection.value = [{ id: 'second' } as SceneNode]
  await expect.poll(() => host.textContent).toContain('latest-selection')
  finishFirst(result('outdated-selection'))
  await nextTick()
  expect(host.textContent).not.toContain('outdated-selection')
  options.value.panelPosition.left++
  await nextTick()
  expect(generate).toHaveBeenCalledTimes(2)
  selection.value = [selection.value[0]!, { id: 'third' } as SceneNode]
  // Section retains its leaving DOM for the 200 ms collapse transition.
  await expect.poll(() => host.textContent).not.toContain('latest-selection')
})

it('clears stale code and exposes generation errors', async () => {
  vi.mocked(generateCodeBlocksForNode).mockRejectedValueOnce(new Error('plugin failed'))
  const host = mount(CodeSection)
  selection.value = [{ id: 'failed' } as SceneNode]
  await expect
    .poll(() => host.querySelector('[role="alert"]')?.textContent)
    .toContain('Code generation failed')
})
