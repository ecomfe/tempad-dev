import { useStorage } from '@vueuse/core'
import { afterEach, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'

import { createPreferenceStorage } from '@/ui/preference-storage'

const key = 'tempad-preference-test'
afterEach(() => {
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
          createPreferenceStorage(localStorage),
          { listenToStorageChanges: false }
        )
      )
    )!
    tabs[0]!.value.cssUnit = 'rem'
    await nextTick()
    tabs[1]!.value.panelPosition.left = 30
    await nextTick()
    tabs[0]!.value.minimized = true
    await nextTick()
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

it('does not forget an unpersisted edit after a storage failure', () => {
  localStorage.setItem(key, JSON.stringify({ cssUnit: 'px', minimized: false }))
  const storage = createPreferenceStorage(localStorage)
  storage.getItem(key)
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
    throw new DOMException('Quota exceeded', 'QuotaExceededError')
  })
  const next = JSON.stringify({ cssUnit: 'rem', minimized: false })
  expect(() => storage.setItem(key, next)).toThrow('Quota exceeded')
  write.mockRestore()
  localStorage.setItem(key, JSON.stringify({ cssUnit: 'px', minimized: true }))
  storage.setItem(key, next)
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ cssUnit: 'rem', minimized: true })
})
