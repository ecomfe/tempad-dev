import { useStorage } from '@vueuse/core'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'

import {
  CorruptPluginStorageError,
  createPluginStorage,
  PLUGIN_STORAGE_KEY
} from '@/ui/plugin-storage'
import { createPreferenceStorage } from '@/ui/preference-storage'

const plugin = (name: string) => ({ name, source: name, code: `${name} code` })

function resetFixture() {
  localStorage.removeItem(PLUGIN_STORAGE_KEY)
  localStorage.removeItem('tempad-dev')
  document.body.replaceChildren()
}

beforeEach(resetFixture)
afterEach(resetFixture)

it('serializes concurrent changes across browser contexts without reviving deleted plugins', async () => {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  const remote = frame.contentWindow!
  const first = createPluginStorage(localStorage, navigator.locks)
  const second = createPluginStorage(remote.localStorage, remote.navigator.locks)
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const held = navigator.locks.request(PLUGIN_STORAGE_KEY, () => {
    entered.resolve()
    return release.promise
  })
  await entered.promise
  const a = first.save('a', plugin('a'))
  const b = second.save('b', plugin('b'))
  const whileLocked = localStorage.getItem(PLUGIN_STORAGE_KEY)
  release.resolve()
  await Promise.all([held, a, b])
  expect(whileLocked).toBeNull()
  expect(first.read().plugins).toEqual({ a: plugin('a'), b: plugin('b') })

  await Promise.all([first.save('a', null), second.save('c', plugin('c'))])
  expect(first.read().plugins).toEqual({ b: plugin('b'), c: plugin('c') })
  await second.save('b', { ...plugin('b'), code: 'updated' })
  expect(first.read().plugins).toEqual({
    b: { ...plugin('b'), code: 'updated' },
    c: plugin('c')
  })
})

it('serializes legacy migration with edits and never reapplies a stale legacy backup', async () => {
  localStorage.setItem('tempad-dev', JSON.stringify({ plugins: { old: plugin('old') } }))
  const first = createPluginStorage(localStorage, navigator.locks)
  const second = createPluginStorage(localStorage, navigator.locks)
  await Promise.all([first.migrate(), second.save('old', null), first.save('new', plugin('new'))])
  expect(second.read().plugins).toEqual({ new: plugin('new') })
  await second.migrate()
  expect(second.read().plugins).toEqual({ new: plugin('new') })
})

it.each(['{broken', '[]', 'null'])(
  'preserves invalid persisted data (%s) until explicit recovery',
  async (record) => {
    localStorage.setItem(PLUGIN_STORAGE_KEY, record)
    const storage = createPluginStorage(localStorage, navigator.locks)
    expect(() => storage.read()).toThrow(CorruptPluginStorageError)
    await expect(storage.migrate()).rejects.toThrow(CorruptPluginStorageError)
    await expect(storage.save('new', plugin('new'))).rejects.toThrow(CorruptPluginStorageError)
    expect(localStorage.getItem(PLUGIN_STORAGE_KEY)).toBe(record)
    await expect(storage.resetCorruptRecord()).resolves.toBe(true)
    expect(storage.read().plugins).toEqual({})
  }
)

it.each(['canonical', 'legacy'] as const)(
  'preserves malformed %s plugin entries until explicit recovery',
  async (location) => {
    const invalid = [
      null,
      [],
      { x: null },
      { x: [] },
      { x: { name: 'x', source: 'x' } },
      { x: { ...plugin('x'), code: 42 } },
      { x: { ...plugin('x'), source: 'other' } },
      { x: { ...plugin('x'), integrity: null } },
      { x: { ...plugin('x'), resolvedUrl: false } }
    ]
    const storage = createPluginStorage(localStorage, navigator.locks)
    for (const plugins of invalid) {
      localStorage.removeItem(PLUGIN_STORAGE_KEY)
      localStorage.removeItem('tempad-dev')
      const key = location === 'canonical' ? PLUGIN_STORAGE_KEY : 'tempad-dev'
      const record = JSON.stringify(
        location === 'canonical' ? plugins : { minimized: true, plugins }
      )
      localStorage.setItem(key, record)
      expect(() => storage.read()).toThrow(CorruptPluginStorageError)
      await expect(storage.migrate()).rejects.toThrow(CorruptPluginStorageError)
      await expect(storage.save('new', plugin('new'))).rejects.toThrow(CorruptPluginStorageError)
      expect(localStorage.getItem(key)).toBe(record)
      await expect(storage.resetCorruptRecord()).resolves.toBe(true)
      expect(storage.read().plugins).toEqual({})
      if (location === 'legacy')
        expect(JSON.parse(localStorage.getItem('tempad-dev')!)).toEqual({ minimized: true })
    }
  }
)

it('keeps valid install metadata and additional stored fields through migration', async () => {
  const plugins = {
    x: {
      ...plugin('x'),
      integrity: 'sha256-verified',
      resolvedUrl: 'https://example.com/plugin.js',
      additional: 'retained'
    }
  }
  localStorage.setItem('tempad-dev', JSON.stringify({ plugins }))
  const storage = createPluginStorage(localStorage, navigator.locks)
  await storage.migrate()
  expect(storage.read().plugins).toEqual(plugins)
  await expect(storage.resetCorruptRecord()).resolves.toBe(false)
})

it('serializes recovery with installation and prevents a legacy backup from returning', async () => {
  localStorage.setItem(PLUGIN_STORAGE_KEY, '{broken')
  localStorage.setItem(
    'tempad-dev',
    JSON.stringify({ minimized: true, plugins: { old: plugin('old') } })
  )
  const frame = document.createElement('iframe')
  document.body.append(frame)
  const remote = frame.contentWindow!
  const first = createPluginStorage(localStorage, navigator.locks)
  const second = createPluginStorage(remote.localStorage, remote.navigator.locks)
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const held = navigator.locks.request(PLUGIN_STORAGE_KEY, () => {
    entered.resolve()
    return release.promise
  })
  await entered.promise
  const reset = first.resetCorruptRecord()
  expect(
    (await navigator.locks.query()).pending?.some(({ name }) => name === PLUGIN_STORAGE_KEY)
  ).toBe(true)
  const install = second.save('new', plugin('new'))
  const whileLocked = localStorage.getItem(PLUGIN_STORAGE_KEY)
  release.resolve()
  await Promise.all([held, reset, install])
  expect(whileLocked).toBe('{broken')
  expect(first.read().plugins).toEqual({ new: plugin('new') })
  expect(JSON.parse(localStorage.getItem('tempad-dev')!)).toEqual({ minimized: true })
  // A stale recovery action must not clear the other tab's newly installed plugin.
  await expect(first.resetCorruptRecord()).resolves.toBe(false)
  expect(first.read().plugins).toEqual({ new: plugin('new') })
})

it('keeps a retained legacy backup fenced when its cleanup is unavailable', async () => {
  localStorage.setItem(PLUGIN_STORAGE_KEY, '{broken')
  const legacy = JSON.stringify({ plugins: { old: plugin('old') } })
  localStorage.setItem('tempad-dev', legacy)
  const nativeSetItem = Storage.prototype.setItem
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key === 'tempad-dev') throw new DOMException('Storage unavailable', 'SecurityError')
    nativeSetItem.call(this, key, value)
  })
  const storage = createPluginStorage(localStorage, navigator.locks)
  await expect(storage.resetCorruptRecord()).resolves.toBe(true)
  await storage.migrate()
  expect(localStorage.getItem('tempad-dev')).toBe(legacy)
  expect(storage.read().plugins).toEqual({})
})

it('does not classify inaccessible storage as corruption or reset it', async () => {
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('Storage unavailable', 'SecurityError')
  })
  const write = vi.spyOn(Storage.prototype, 'setItem')
  const storage = createPluginStorage(localStorage, navigator.locks)
  await expect(storage.resetCorruptRecord()).rejects.toThrow('Storage unavailable')
  expect(write).not.toHaveBeenCalled()
  read.mockRestore()
})

it('keeps legacy deletions durable when another tab persists stale preferences under quota pressure', async () => {
  const original = { a: plugin('a'), b: plugin('b') }
  localStorage.setItem('tempad-dev', JSON.stringify({ minimized: false, plugins: original }))
  const frame = document.createElement('iframe')
  document.body.append(frame)
  const remote = frame.contentWindow!
  const scope = effectScope()
  const defaults = { minimized: false, plugins: original }
  const preferences = scope.run(() =>
    useStorage(
      'tempad-dev',
      defaults,
      createPreferenceStorage(remote.localStorage, remote.navigator.locks, defaults),
      {
        listenToStorageChanges: false
      }
    )
  )!
  for (const prototype of [
    Storage.prototype,
    Object.getPrototypeOf(remote.localStorage) as Storage
  ]) {
    const nativeSetItem = prototype.setItem
    vi.spyOn(prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === PLUGIN_STORAGE_KEY) throw new DOMException('Quota exceeded', 'QuotaExceededError')
      nativeSetItem.call(this, key, value)
    })
  }
  try {
    const first = createPluginStorage(localStorage, navigator.locks)
    const second = createPluginStorage(remote.localStorage, remote.navigator.locks)
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const held = navigator.locks.request(PLUGIN_STORAGE_KEY, () => {
      entered.resolve()
      return release.promise
    })
    await entered.promise
    const firstRemoval = first.save('a', null)
    preferences.value.minimized = true
    await nextTick()
    const secondRemoval = second.save('b', null)
    const whileLocked = JSON.parse(localStorage.getItem('tempad-dev')!)
    release.resolve()
    await Promise.all([held, firstRemoval, secondRemoval])
    expect(whileLocked).toEqual({ minimized: false, plugins: original })
    await navigator.locks.request(PLUGIN_STORAGE_KEY, () => undefined)
    expect(JSON.parse(localStorage.getItem('tempad-dev')!)).toEqual({
      minimized: true,
      plugins: {}
    })
    expect(localStorage.getItem(PLUGIN_STORAGE_KEY)).toBeNull()
    expect(preferences.value.plugins).toEqual(original)
  } finally {
    scope.stop()
  }
})

it('persists a preference reversal made while a plugin write owns the lock', async () => {
  localStorage.setItem('tempad-dev', JSON.stringify({ minimized: false }))
  const scope = effectScope()
  const preferences = scope.run(() =>
    useStorage(
      'tempad-dev',
      { minimized: false },
      createPreferenceStorage(localStorage, navigator.locks, { minimized: false }),
      { listenToStorageChanges: false }
    )
  )!
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const held = navigator.locks.request(PLUGIN_STORAGE_KEY, () => {
    entered.resolve()
    return release.promise
  })
  try {
    await entered.promise
    preferences.value.minimized = true
    await nextTick()
    preferences.value.minimized = false
    await nextTick()
  } finally {
    release.resolve()
    await held
    await navigator.locks.request(PLUGIN_STORAGE_KEY, () => undefined)
    scope.stop()
  }
  expect(JSON.parse(localStorage.getItem('tempad-dev')!)).toEqual({ minimized: false })
})

it('reports a locked preference write failure and retries the unpersisted edit', async () => {
  localStorage.setItem('tempad-dev', JSON.stringify({ minimized: false, cssUnit: 'px' }))
  const onError = vi.fn()
  const preferences = createPreferenceStorage(localStorage, navigator.locks, {}, onError)
  preferences.getItem('tempad-dev')
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
    throw new DOMException('Quota exceeded', 'QuotaExceededError')
  })
  await preferences.setItem('tempad-dev', JSON.stringify({ minimized: false, cssUnit: 'rem' }))
  expect(onError).toHaveBeenCalledOnce()
  write.mockRestore()
  await preferences.setItem('tempad-dev', JSON.stringify({ minimized: true, cssUnit: 'rem' }))
  expect(JSON.parse(localStorage.getItem('tempad-dev')!)).toEqual({
    minimized: true,
    cssUnit: 'rem'
  })
})
