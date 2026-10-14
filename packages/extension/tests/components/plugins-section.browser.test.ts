import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { computed, nextTick, shallowRef, useTemplateRef, watch } from 'vue'

vi.mock('@/utils/codegen', async (original) => ({
  ...(await original<typeof import('@/utils/codegen')>()),
  codegen: vi.fn()
}))

import PluginsSection from '@/components/sections/PluginsSection.vue'
import { options, plugins } from '@/ui/state'
import { codegen } from '@/utils/codegen'

import { mount, unmountAll } from './mount'

const source = 'https://example.com/plugin.js'
const previous = { name: 'Previous', source, code: 'old code' }
const notify = vi.fn<(message: string) => { cancel: () => void }>(() => ({ cancel: vi.fn() }))

beforeEach(async () => {
  for (const [name, value] of Object.entries({
    computed,
    nextTick,
    shallowRef,
    useTemplateRef,
    watch
  })) {
    vi.stubGlobal(name, value)
  }
  plugins.value = {}
  options.value.activePluginSource = null
  await nextTick()
  notify.mockClear()
  vi.stubGlobal('figma', { notify })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('new code'))
  )
  vi.mocked(codegen).mockResolvedValue({ pluginName: 'New plugin' } as Awaited<
    ReturnType<typeof codegen>
  >)
})

afterEach(() => {
  unmountAll()
  vi.unstubAllGlobals()
})

it.each(['install', 'update', 'remove'] as const)(
  'preserves plugin and active state when %s cannot be saved, then retries durably',
  async (action) => {
    if (action !== 'install') {
      plugins.value = { [source]: previous }
      options.value.activePluginSource = source
    }
    await nextTick()
    const stored = localStorage.getItem('tempad-dev-plugins')
    const host = mount(PluginsSection)
    if (action === 'install') {
      host.querySelector<HTMLButtonElement>('.tp-plugins-add')!.click()
      await nextTick()
      const input = host.querySelector<HTMLInputElement>('input[type="text"]')!
      input.value = source
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await nextTick()
    }
    const nativeSetItem = Storage.prototype.setItem
    let rejectWrite = true
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key,
      value
    ) {
      if (key === 'tempad-dev-plugins' && rejectWrite) {
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
      }
      nativeSetItem.call(this, key, value)
    })
    const click = () =>
      host
        .querySelector<HTMLButtonElement>(
          action === 'install'
            ? '.tp-action-button'
            : `[aria-label="${action === 'update' ? 'Update' : 'Remove'}"]`
        )!
        .click()
    click()
    await expect
      .poll(() => notify.mock.calls.map(([message]) => message))
      .toContain(
        action === 'remove'
          ? 'Could not save plugin removal. Browser storage may be full or unavailable.'
          : 'Could not save plugin. Browser storage may be full or unavailable.'
      )
    expect(plugins.value).toEqual(action === 'install' ? {} : { [source]: previous })
    expect(options.value.activePluginSource).toBe(action === 'install' ? null : source)
    expect(localStorage.getItem('tempad-dev-plugins')).toBe(stored)
    expect(notify.mock.calls.some(([message]) => message.includes('successfully'))).toBe(false)
    if (action === 'install') expect(host.querySelector('input[type="text"]')).not.toBeNull()

    rejectWrite = false
    write.mockClear()
    click()
    await expect
      .poll(() => (action === 'remove' ? plugins.value[source] : plugins.value[source]?.name))
      .toBe(action === 'remove' ? undefined : 'New plugin')
    await nextTick()
    expect(JSON.parse(localStorage.getItem('tempad-dev-plugins')!)).toEqual(plugins.value)
    expect(write.mock.calls.filter(([key]) => key === 'tempad-dev-plugins')).toHaveLength(1)
    expect(options.value.activePluginSource).toBe(action === 'remove' ? null : source)
    if (action !== 'remove') {
      expect(notify).toHaveBeenLastCalledWith(
        `Plugin "New plugin" ${action === 'update' ? 'updated' : 'installed'} successfully.`
      )
    }
  }
)
