import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { computed, nextTick, shallowRef, useTemplateRef, watch } from 'vue'

vi.mock('@/utils/codegen', async (original) => ({
  ...(await original<typeof import('@/utils/codegen')>()),
  codegen: vi.fn()
}))

import PluginsSection from '@/components/sections/PluginsSection.vue'
import { options, plugins, pluginStorageCorrupted } from '@/ui/state'
import { codegen } from '@/utils/codegen'

import { mount, unmountAll } from './mount'

const source = 'https://example.com/plugin.js'
const previous = { name: 'Previous', source, code: 'old code' }
const notify = vi.fn<(message: string) => { cancel: () => void }>(() => ({ cancel: vi.fn() }))

beforeEach(async () => {
  await navigator.locks.request('tempad-dev-plugins', () => undefined)
  localStorage.removeItem('tempad-dev-plugins')
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
  pluginStorageCorrupted.value = false
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

it.each(['{broken', '{"x":null}'])(
  'offers explicit corruption recovery for %s, retains failed resets, and permits a fresh install',
  async (record) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    localStorage.setItem('tempad-dev-plugins', record)
    options.value.activePluginSource = source
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'tempad-dev-plugins', storageArea: localStorage })
    )
    const host = mount(PluginsSection)
    await expect.poll(() => host.textContent).toContain('Stored plugin data is invalid.')
    expect(host.textContent).toContain('Resetting removes installed code-output plugins.')
    expect(localStorage.getItem('tempad-dev-plugins')).toBe(record)
    const nativeSetItem = Storage.prototype.setItem
    let rejectWrite = true
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'tempad-dev-plugins' && rejectWrite)
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
      nativeSetItem.call(this, key, value)
    })
    const reset = host.querySelector<HTMLButtonElement>('.tp-plugins-reset')!
    reset.click()
    await expect
      .poll(() => notify.mock.calls.map(([message]) => message))
      .toContain('Could not reset plugins. Browser storage may be full or unavailable.')
    expect(localStorage.getItem('tempad-dev-plugins')).toBe(record)
    expect(options.value.activePluginSource).toBe(source)
    expect(host.contains(reset)).toBe(true)
    rejectWrite = false
    reset.click()
    await expect.poll(() => localStorage.getItem('tempad-dev-plugins')).toBe('{}')
    await expect.poll(() => host.querySelector('.tp-plugins-reset')).toBeNull()
    expect(options.value.activePluginSource).toBeNull()

    host.querySelector<HTMLButtonElement>('.tp-plugins-add')!.click()
    await nextTick()
    const input = host.querySelector<HTMLInputElement>('input[type="text"]')!
    input.value = source
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    host.querySelector<HTMLButtonElement>('.tp-action-button')!.click()
    await expect.poll(() => plugins.value[source]?.name).toBe('New plugin')
    expect(options.value.activePluginSource).toBe(source)
  }
)

it('identifies corruption discovered during installation without replacing the invalid record', async () => {
  const host = mount(PluginsSection)
  host.querySelector<HTMLButtonElement>('.tp-plugins-add')!.click()
  await nextTick()
  const input = host.querySelector<HTMLInputElement>('input[type="text"]')!
  input.value = source
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  localStorage.setItem('tempad-dev-plugins', '{broken')
  host.querySelector<HTMLButtonElement>('.tp-action-button')!.click()
  await expect
    .poll(() => notify.mock.calls.map(([message]) => message))
    .toContain('Stored plugin data is invalid. Reset plugins to continue.')
  expect(localStorage.getItem('tempad-dev-plugins')).toBe('{broken')
  expect(host.querySelector('.tp-plugins-reset')).not.toBeNull()
  expect(options.value.activePluginSource).toBeNull()
})

it.each(['install', 'update', 'remove'] as const)(
  'preserves plugin and active state when %s cannot be saved, then retries durably',
  async (action) => {
    if (action !== 'install') {
      plugins.value = { [source]: previous }
      localStorage.setItem('tempad-dev-plugins', JSON.stringify(plugins.value))
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
