import { useStorage } from '@vueuse/core'
import { afterEach, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'

import { PLUGIN_STORAGE_KEY } from '@/ui/plugin-storage'
import { createPreferenceStorage } from '@/ui/preference-storage'

const key = 'tempad-preference-test'
async function flushStorage() {
  await nextTick()
  await navigator.locks.request(PLUGIN_STORAGE_KEY, () => undefined)
}
afterEach(async () => {
  await flushStorage()
  localStorage.removeItem(key)
  vi.restoreAllMocks()
})

it('merges independent tab edits without moving another open panel or reverting shared preferences', async () => {
  const scope = effectScope()
  try {
    const tabs = scope.run(() =>
      [0, 1].map(() =>
        useStorage(
          key,
          {
            cssUnit: 'px',
            panelPosition: { left: 1, top: 2 },
            minimized: false
          },
          createPreferenceStorage(localStorage, navigator.locks),
          { listenToStorageChanges: false }
        )
      )
    )!
    tabs[0]!.value.cssUnit = 'rem'
    await flushStorage()
    tabs[1]!.value.panelPosition.left = 30
    await flushStorage()
    tabs[0]!.value.minimized = true
    await flushStorage()
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({
      cssUnit: 'rem',
      panelPosition: { left: 30, top: 2 },
      minimized: true
    })
    expect(tabs[0]!.value.panelPosition.left).toBe(1)
    expect(tabs[1]!.value.minimized).toBe(false)
  } finally {
    scope.stop()
  }
})

it('does not forget an unpersisted edit after a storage failure', async () => {
  localStorage.setItem(key, JSON.stringify({ cssUnit: 'px', minimized: false }))
  const onError = vi.fn()
  const storage = createPreferenceStorage(localStorage, navigator.locks, onError)
  storage.getItem(key)
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
    throw new DOMException('Quota exceeded', 'QuotaExceededError')
  })
  const next = JSON.stringify({ cssUnit: 'rem', minimized: false })
  await storage.setItem(key, next)
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Quota exceeded' }))
  write.mockRestore()
  localStorage.setItem(key, JSON.stringify({ cssUnit: 'px', minimized: true }))
  await storage.setItem(key, next)
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ cssUnit: 'rem', minimized: true })
})

it.each(['initial', 'later'])(
  'recovers from %s malformed preference JSON through useStorage',
  async (when) => {
    localStorage.setItem(
      key,
      when === 'initial' ? '{broken' : JSON.stringify({ cssUnit: 'px', mcpOn: false })
    )
    const scope = effectScope()
    const onError = vi.fn()
    try {
      const preferences = scope.run(() =>
        useStorage(
          key,
          { cssUnit: 'px', mcpOn: false },
          createPreferenceStorage(localStorage, navigator.locks, onError),
          {
            mergeDefaults: true,
            listenToStorageChanges: false,
            onError
          }
        )
      )!
      await flushStorage()
      if (when === 'later') localStorage.setItem(key, '{broken')
      preferences.value.cssUnit = 'rem'
      await flushStorage()
      expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ cssUnit: 'rem', mcpOn: false })
      expect(onError).not.toHaveBeenCalled()
    } finally {
      scope.stop()
    }
  }
)

it('advances a tab baseline when another tab already persisted the same local edit', async () => {
  localStorage.setItem(key, JSON.stringify({ cssUnit: 'px', mcpOn: false }))
  const scope = effectScope()
  try {
    const [a, b] = scope.run(() =>
      [0, 1].map(() =>
        useStorage(
          key,
          { cssUnit: 'px', mcpOn: false },
          createPreferenceStorage(localStorage, navigator.locks),
          {
            mergeDefaults: true,
            listenToStorageChanges: false
          }
        )
      )
    )!
    await flushStorage()
    b!.value.cssUnit = 'rem'
    await flushStorage()
    const write = vi.spyOn(Storage.prototype, 'setItem')
    a!.value.cssUnit = 'rem'
    await flushStorage()
    expect(write).not.toHaveBeenCalled()
    b!.value.cssUnit = 'px'
    await flushStorage()
    a!.value.mcpOn = true
    await flushStorage()
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ cssUnit: 'px', mcpOn: true })
    expect(a!.value.cssUnit).toBe('rem')
  } finally {
    scope.stop()
  }
})

it('preserves another tab edit after merging defaults into an older record', async () => {
  localStorage.setItem(key, JSON.stringify({ cssUnit: 'px' }))
  const scope = effectScope()
  try {
    const [a, b] = scope.run(() =>
      [0, 1].map(() =>
        useStorage(
          key,
          { cssUnit: 'px', mcpOn: false },
          createPreferenceStorage(localStorage, navigator.locks),
          {
            mergeDefaults: true,
            listenToStorageChanges: false
          }
        )
      )
    )!
    b!.value.mcpOn = true
    await flushStorage()
    a!.value.cssUnit = 'rem'
    await flushStorage()
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ cssUnit: 'rem', mcpOn: true })
    expect(a!.value.mcpOn).toBe(false)
  } finally {
    scope.stop()
  }
})

it('retries a failed useStorage write without losing remote or unknown fields', async () => {
  localStorage.setItem(key, JSON.stringify({ cssUnit: 'px', mcpOn: false }))
  const scope = effectScope()
  const onError = vi.fn()
  try {
    const preferences = scope.run(() =>
      useStorage(
        key,
        { cssUnit: 'px', mcpOn: false, minimized: false },
        createPreferenceStorage(localStorage, navigator.locks, onError),
        { mergeDefaults: true, listenToStorageChanges: false, onError }
      )
    )!
    await flushStorage()
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })
    preferences.value.cssUnit = 'rem'
    await flushStorage()
    expect(onError).toHaveBeenCalledOnce()
    write.mockRestore()
    localStorage.setItem(
      key,
      JSON.stringify({ cssUnit: 'px', mcpOn: true, minimized: false, future: { option: 1 } })
    )
    preferences.value.minimized = true
    await flushStorage()
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({
      cssUnit: 'rem',
      mcpOn: true,
      minimized: true,
      future: { option: 1 }
    })
    expect(preferences.value.mcpOn).toBe(false)
  } finally {
    scope.stop()
  }
})
