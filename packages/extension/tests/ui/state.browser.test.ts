import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { ui } from '@/ui/figma'
import {
  activePlugin,
  options,
  plugins,
  savePlugin,
  selectedNode,
  selectedTemPadComponent,
  selection
} from '@/ui/state'

function createDefaultOptions() {
  return {
    minimized: false,
    panelPosition: {
      left: window.innerWidth - ui.nativePanelWidth - ui.tempadPanelWidth,
      top: ui.topBoundary,
      width: ui.tempadPanelWidth
    },
    prefOpen: false,
    deepSelectOn: false,
    measureOn: false,
    cssUnit: 'px' as const,
    rootFontSize: 16,
    scale: 1,
    variableDisplay: 'reference' as const,
    mcpOn: false,
    activePluginSource: null as string | null
  }
}

describe('ui/state', () => {
  beforeEach(async () => {
    await navigator.locks.request('tempad-dev-plugins', () => undefined)
    localStorage.removeItem('tempad-dev')
    localStorage.removeItem('tempad-dev-plugins')
    options.value = createDefaultOptions()
    plugins.value = {}
    selection.value = []
    await nextTick()
    await navigator.locks.request('tempad-dev-plugins', () => undefined)
  })

  it('initializes options with expected panel defaults', () => {
    expect(options.value.panelPosition.left).toBe(
      window.innerWidth - ui.nativePanelWidth - ui.tempadPanelWidth
    )
    expect(options.value.panelPosition.top).toBe(ui.topBoundary)
    expect(options.value.panelPosition.width).toBe(ui.tempadPanelWidth)
    expect(options.value.cssUnit).toBe('px')
    expect(options.value.variableDisplay).toBe('reference')
  })

  it('tracks selected node from selection state', () => {
    expect(selectedNode.value).toBeNull()

    const node = { id: 'node-1' } as SceneNode
    selection.value = [node]

    expect(selectedNode.value).toBe(node)
  })

  it('applies plugin edits to the latest persisted collection instead of the tab snapshot', async () => {
    const first = { name: 'First', source: 'first', code: 'first code' }
    const second = { name: 'Second', source: 'second', code: 'second code' }
    localStorage.setItem('tempad-dev-plugins', JSON.stringify({ first }))

    await savePlugin('second', second)

    expect(JSON.parse(localStorage.getItem('tempad-dev-plugins')!)).toEqual({ first, second })
    localStorage.setItem('tempad-dev-plugins', JSON.stringify({ second }))
    await savePlugin('second', null)
    expect(JSON.parse(localStorage.getItem('tempad-dev-plugins')!)).toEqual({})
  })

  it('retains the migration backup on failure and removes it only after a successful save', async () => {
    const oldPlugin = { name: 'Old', source: 'old', code: 'old code' }
    const nextPlugin = { name: 'New', source: 'new', code: 'new code' }
    const preferences = options.value as typeof options.value & {
      plugins?: typeof plugins.value
    }
    preferences.plugins = { old: oldPlugin }
    localStorage.setItem('tempad-dev', JSON.stringify(preferences))
    plugins.value = { old: oldPlugin }
    await nextTick()
    await navigator.locks.request('tempad-dev-plugins', () => undefined)
    const nativeSetItem = Storage.prototype.setItem
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
    })
    await expect(savePlugin('new', nextPlugin)).rejects.toThrow('Storage quota exceeded')
    expect(plugins.value).toEqual({ old: oldPlugin })
    expect(preferences.plugins).toEqual({ old: oldPlugin })

    write.mockImplementation(nativeSetItem)
    await savePlugin('new', nextPlugin)
    expect(preferences.plugins).toBeUndefined()
    const thirdPlugin = { name: 'Third', source: 'third', code: 'third code' }
    await savePlugin('third', thirdPlugin)
    await nextTick()
    expect(plugins.value).toEqual({ old: oldPlugin, new: nextPlugin, third: thirdPlugin })
    expect(JSON.parse(localStorage.getItem('tempad-dev-plugins')!)).toEqual(plugins.value)
    expect(JSON.parse(localStorage.getItem('tempad-dev')!)).not.toHaveProperty('plugins')
  })

  it('resolves active plugin from source id and falls back to null', async () => {
    expect(activePlugin.value).toBeNull()

    plugins.value = {
      local: {
        name: 'Local plugin',
        code: 'export default {}',
        source: 'local'
      }
    }
    options.value.activePluginSource = 'local'
    await Promise.resolve()

    expect(activePlugin.value).toEqual({
      name: 'Local plugin',
      code: 'export default {}',
      source: 'local'
    })

    options.value.activePluginSource = 'missing'
    await Promise.resolve()
    expect(activePlugin.value).toBeUndefined()

    options.value.activePluginSource = null
    await Promise.resolve()
    expect(activePlugin.value).toBeNull()
  })

  it('can delete a legacy plugin to free real browser quota without losing the remaining code', async () => {
    const plugin = (name: string) => ({ name, source: name, code: 'x'.repeat(100_000) })
    const original = { first: plugin('first'), second: plugin('second') }
    const preferences = options.value as typeof options.value & { plugins?: typeof plugins.value }
    preferences.plugins = original
    localStorage.setItem('tempad-dev', JSON.stringify(preferences))
    plugins.value = original
    await nextTick()
    await navigator.locks.request('tempad-dev-plugins', () => undefined)
    localStorage.removeItem('tempad-dev-plugins')
    const quotaKey = 'tempad-quota-fixture'
    let low = 0
    let high = 6_000_000
    try {
      while (high - low > 1024) {
        const size = Math.floor((low + high) / 2)
        try {
          localStorage.setItem(quotaKey, 'x'.repeat(size))
          low = size
        } catch {
          high = size
        }
      }
      localStorage.setItem(quotaKey, 'x'.repeat(Math.max(0, low - 8192)))
      await expect(savePlugin('first', null)).resolves.toBeUndefined()
      await nextTick()
      expect(plugins.value).toEqual({ second: original.second })
      const saved =
        JSON.parse(localStorage.getItem('tempad-dev-plugins') ?? 'null') ??
        JSON.parse(localStorage.getItem('tempad-dev')!).plugins
      expect(saved).toEqual({ second: original.second })
    } finally {
      localStorage.removeItem(quotaKey)
      delete preferences.plugins
      plugins.value = {}
      await nextTick()
    }
  })

  it('refreshes remote plugin changes without replaying a stale storage event', async () => {
    const oldPlugin = { name: 'Old', source: 'old', code: 'old code' }
    const currentPlugin = { name: 'Current', source: 'current', code: 'current code' }
    localStorage.setItem('tempad-dev-plugins', JSON.stringify({ current: currentPlugin }))
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'tempad-dev-plugins',
        storageArea: localStorage,
        newValue: JSON.stringify({ old: oldPlugin })
      })
    )
    await nextTick()
    expect(plugins.value).toEqual({ current: currentPlugin })
    localStorage.removeItem('tempad-dev-plugins')
    window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: localStorage }))
    expect(plugins.value).toEqual({})
  })

  it('derives tempad component metadata from selected frame node', () => {
    const selectedFrame = {
      type: 'FRAME',
      name: '🧩 Button',
      getSharedPluginData(_ns: string, key: string) {
        if (key === 'source') return JSON.stringify({ libName: '@baidu/one-ui', name: 'Button' })
        if (key === 'code') return '<>\n<Stack>\n  <Button />\n</Stack>\n</>'
        if (key === 'link') return 'https://example.com/button'
        return null
      }
    } as unknown as SceneNode

    selection.value = [selectedFrame]

    expect(selectedTemPadComponent.value).toEqual({
      code: '<Button />',
      link: 'https://example.com/button',
      name: 'Button',
      libName: '@baidu/one-ui',
      libDisplayName: 'ONE UI'
    })
  })
})
