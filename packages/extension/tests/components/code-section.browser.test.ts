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

it('keeps the Code surface while loading and retries without changing selection', async () => {
  const generate = vi.mocked(generateCodeBlocksForNode)
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof generateCodeBlocksForNode>>>()
  generate.mockReturnValueOnce(pending.promise)
  generate.mockResolvedValueOnce({
    codeBlocks: [{ name: 'css', title: 'CSS', lang: 'css', code: 'retried' }]
  })
  const host = mount(CodeSection)
  selection.value = [{ id: 'slow' } as SceneNode]
  await nextTick()
  expect(host.querySelector('[role="status"]')?.textContent).toContain('Generating code')
  expect(host.querySelector('section')).not.toBeNull()
  pending.reject(new Error('temporary failure'))
  await expect.poll(() => host.querySelector('[role="alert"]')).not.toBeNull()
  host.querySelector<HTMLButtonElement>('.tp-code-retry')!.click()
  await expect.poll(() => host.textContent).toContain('retried')
  expect(generate).toHaveBeenCalledTimes(2)
})

it('keeps the previous content height without presenting stale code for the new selection', async () => {
  const generate = vi.mocked(generateCodeBlocksForNode)
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof generateCodeBlocksForNode>>>()
  generate.mockResolvedValueOnce({
    codeBlocks: [
      { name: 'css', title: 'CSS', lang: 'css', code: 'old-selection-code\n'.repeat(10) }
    ]
  })
  generate.mockReturnValueOnce(pending.promise)
  const host = mount(CodeSection)
  selection.value = [{ id: 'first' } as SceneNode]
  await expect.poll(() => host.textContent).toContain('old-selection-code')
  const section = host.querySelector('section')!
  const height = host.querySelector('[aria-busy]')!.getBoundingClientRect().height
  selection.value = [{ id: 'second' } as SceneNode]
  await nextTick()
  expect(host.querySelector('section')).toBe(section)
  expect(host.textContent).not.toContain('old-selection-code')
  expect(host.querySelector('[aria-busy]')!.getBoundingClientRect().height).toBeGreaterThanOrEqual(
    height
  )
  pending.resolve({
    codeBlocks: [{ name: 'css', title: 'CSS', lang: 'css', code: 'new-selection-code' }]
  })
  await expect.poll(() => host.textContent).toContain('new-selection-code')
})
