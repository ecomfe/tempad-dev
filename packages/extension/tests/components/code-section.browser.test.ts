import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

vi.mock('@/utils/codegen', async (original) => ({
  ...(await original<typeof import('@/utils/codegen')>()),
  generateCodeBlocksForNode: vi.fn()
}))

import CodeSection from '@/components/sections/CodeSection.vue'
import { activePlugin, options, plugins, selection, selectionRevision } from '@/ui/state'
import { generateCodeBlocksForNode } from '@/utils/codegen'

import { mount, unmountAll } from './mount'

afterEach(() => {
  unmountAll()
  selection.value = []
  options.value.cssUnit = 'px'
  options.value.activePluginSource = null
  plugins.value = {}
  vi.useRealTimers()
  vi.resetAllMocks()
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

it('retains identical same-selection code and its text selection without loading announcements', async () => {
  const generate = vi.mocked(generateCodeBlocksForNode)
  const result = {
    codeBlocks: [{ name: 'css', title: 'CSS', lang: 'css' as const, code: 'unchanged-code' }]
  }
  generate.mockResolvedValueOnce(result)
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof generateCodeBlocksForNode>>>()
  generate.mockReturnValueOnce(pending.promise)
  const host = mount(CodeSection)
  selection.value = [{ id: 'same' } as SceneNode]
  await expect.poll(() => host.textContent).toContain('unchanged-code')
  await expect.poll(() => host.querySelector('.tp-section-enter-active')).toBeNull()
  const block = host.querySelector('.tp-code-code')!
  const code = block.querySelector('code')!
  const range = document.createRange()
  range.selectNodeContents(code)
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
  expect(window.getSelection()!.toString()).toBe('unchanged-code')
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  selectionRevision.value++
  await nextTick()
  await vi.advanceTimersByTimeAsync(200)
  expect(host.querySelector('.tp-code-code')).toBe(block)
  expect(window.getSelection()!.toString()).toBe('unchanged-code')
  expect(host.querySelector('[role="status"]')?.textContent).toBe('')
  expect(host.querySelector('[aria-busy="true"]')).toBeNull()
  pending.resolve(structuredClone(result))
  await nextTick()
  expect(host.querySelector('.tp-code-code')).toBe(block)
  expect(window.getSelection()!.toString()).toBe('unchanged-code')
})

it('retains code and its text selection when plugin storage changes without changing active code', async () => {
  const source = 'https://example.com/plugin.js'
  const plugin = { source, name: 'Plugin', code: 'plugin-code' }
  plugins.value = { [source]: plugin }
  options.value.activePluginSource = source
  await expect.poll(() => activePlugin.value?.code).toBe(plugin.code)
  const generate = vi.mocked(generateCodeBlocksForNode)
  generate.mockResolvedValueOnce({
    codeBlocks: [{ name: 'css', title: 'CSS', lang: 'css', code: 'plugin-output' }]
  })
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof generateCodeBlocksForNode>>>()
  generate.mockReturnValue(pending.promise)
  const host = mount(CodeSection)
  selection.value = [{ id: 'same' } as SceneNode]
  await expect.poll(() => host.textContent).toContain('plugin-output')
  await expect.poll(() => host.querySelector('.tp-section-enter-active')).toBeNull()
  const block = host.querySelector('.tp-code-code')!
  const range = document.createRange()
  range.selectNodeContents(block.querySelector('code')!)
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)

  const records: (typeof plugins.value)[] = [
    { [source]: { ...plugin }, other: { source: 'other', name: 'Other', code: 'other-code' } },
    { [source]: { ...plugin, name: 'Renamed plugin' } }
  ]
  for (const record of records) {
    plugins.value = record
    await expect.poll(() => activePlugin.value).toBe(record[source])
    await nextTick()
    expect(generate).toHaveBeenCalledOnce()
    expect(host.querySelector('.tp-code-code')).toBe(block)
    expect(window.getSelection()!.toString()).toBe('plugin-output')
    expect(host.querySelector('[aria-busy="true"]')).toBeNull()
  }
  expect(host.textContent).toContain('Renamed plugin')

  plugins.value = { [source]: { ...plugin, code: 'changed-plugin-code' } }
  await expect.poll(() => generate.mock.calls.length).toBe(2)
  expect(host.textContent).not.toContain('plugin-output')
  expect(generate.mock.lastCall?.[2]).toBe('changed-plugin-code')
  pending.resolve({
    codeBlocks: [{ name: 'css', title: 'CSS', lang: 'css', code: 'changed-output' }]
  })
  await expect.poll(() => host.textContent).toContain('changed-output')
})

it('clears retained code if refreshing the same node fails', async () => {
  const generate = vi.mocked(generateCodeBlocksForNode)
  generate.mockResolvedValueOnce({
    codeBlocks: [{ name: 'css', title: 'CSS', lang: 'css', code: 'old-code' }]
  })
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof generateCodeBlocksForNode>>>()
  generate.mockReturnValueOnce(pending.promise)
  const host = mount(CodeSection)
  selection.value = [{ id: 'same' } as SceneNode]
  await expect.poll(() => host.textContent).toContain('old-code')
  selectionRevision.value++
  await nextTick()
  expect(host.textContent).toContain('old-code')
  pending.reject(new Error('Changed plugin failed'))
  await expect
    .poll(() => host.querySelector('[role="alert"]')?.textContent)
    .toContain('Code generation failed')
  expect(host.textContent).not.toContain('old-code')
})

it.each(['unit', 'plugin'] as const)(
  'does not offer previous code for copying while a new %s configuration is pending',
  async (setting) => {
    const generate = vi.mocked(generateCodeBlocksForNode)
    generate.mockResolvedValueOnce({
      codeBlocks: [{ name: 'css', title: 'CSS', lang: 'css', code: 'old-configuration' }]
    })
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof generateCodeBlocksForNode>>>()
    generate.mockReturnValueOnce(pending.promise)
    const host = mount(CodeSection)
    selection.value = [{ id: 'same' } as SceneNode]
    await expect.poll(() => host.textContent).toContain('old-configuration')
    if (setting === 'unit') {
      options.value.cssUnit = 'rem'
    } else {
      const source = 'https://example.com/new-plugin.js'
      plugins.value = { [source]: { source, name: 'New plugin', code: 'new-plugin' } }
      options.value.activePluginSource = source
      await expect.poll(() => activePlugin.value?.code).toBe('new-plugin')
    }
    await nextTick()
    expect(generate).toHaveBeenCalledTimes(2)
    expect(host.textContent).not.toContain('old-configuration')
    expect(host.querySelector('.tp-code [data-tooltip="Copy"]')).toBeNull()
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull()
    if (setting === 'plugin') expect(host.textContent).toContain('New plugin')
    pending.resolve({
      codeBlocks: [{ name: 'css', title: 'CSS', lang: 'css', code: 'new-configuration' }]
    })
    await expect.poll(() => host.textContent).toContain('new-configuration')
    expect(host.querySelector('.tp-code [data-tooltip="Copy"]')).not.toBeNull()
  }
)

it('keeps the Code surface while loading and retries without changing selection', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const generate = vi.mocked(generateCodeBlocksForNode)
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof generateCodeBlocksForNode>>>()
  generate.mockReturnValueOnce(pending.promise)
  generate.mockResolvedValueOnce({
    codeBlocks: [{ name: 'css', title: 'CSS', lang: 'css', code: 'retried' }]
  })
  const host = mount(CodeSection)
  selection.value = [{ id: 'slow' } as SceneNode]
  await nextTick()
  expect(host.querySelector('[aria-busy="true"]')).not.toBeNull()
  expect(host.querySelector('[role="status"]')?.textContent).toBe('')
  expect(host.querySelector('section')).not.toBeNull()
  await vi.advanceTimersByTimeAsync(149)
  expect(host.querySelector('[role="status"]')?.textContent).toBe('')
  await vi.advanceTimersByTimeAsync(1)
  const status = host.querySelector('[role="status"]')!
  expect(status.textContent).toContain('Generating code')
  expect(status.closest('[aria-busy="true"]')).toBeNull()
  pending.reject(new Error('temporary failure'))
  await expect.poll(() => host.querySelector('[role="alert"]')).not.toBeNull()
  expect(host.querySelector('[role="status"]')?.textContent).toBe('')
  host.querySelector<HTMLButtonElement>('.tp-code-retry')!.click()
  await expect.poll(() => host.textContent).toContain('retried')
  expect(generate).toHaveBeenCalledTimes(2)
})

it('does not show stale loading hints for quick or replaced generations', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const generate = vi.mocked(generateCodeBlocksForNode)
  const first = Promise.withResolvers<Awaited<ReturnType<typeof generateCodeBlocksForNode>>>()
  generate.mockReturnValueOnce(first.promise)
  generate.mockImplementation(() => new Promise(() => undefined))
  const host = mount(CodeSection)
  selection.value = [{ id: 'quick' } as SceneNode]
  await nextTick()
  await vi.advanceTimersByTimeAsync(100)
  first.resolve({ codeBlocks: [{ name: 'css', title: 'CSS', lang: 'css', code: 'quick-code' }] })
  await vi.advanceTimersByTimeAsync(100)
  expect(host.textContent).toContain('quick-code')
  expect(host.querySelector('[role="status"]')?.textContent).toBe('')
  selection.value = [{ id: 'replaced' } as SceneNode]
  await nextTick()
  await vi.advanceTimersByTimeAsync(100)
  selection.value = [{ id: 'current' } as SceneNode]
  await nextTick()
  await vi.advanceTimersByTimeAsync(50)
  expect(host.querySelector('[role="status"]')?.textContent).toBe('')
  await vi.advanceTimersByTimeAsync(100)
  expect(host.querySelector('[role="status"]')?.textContent).toContain('Generating code')
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
  const height = host.querySelector('.tp-code-content')!.getBoundingClientRect().height
  selection.value = [{ id: 'second' } as SceneNode]
  await nextTick()
  expect(host.querySelector('section')).toBe(section)
  expect(host.textContent).not.toContain('old-selection-code')
  expect(
    host.querySelector('.tp-code-content')!.getBoundingClientRect().height
  ).toBeGreaterThanOrEqual(height)
  pending.resolve({
    codeBlocks: [{ name: 'css', title: 'CSS', lang: 'css', code: 'new-selection-code' }]
  })
  await expect.poll(() => host.textContent).toContain('new-selection-code')
})
