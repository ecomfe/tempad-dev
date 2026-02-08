import { beforeEach, describe, expect, it } from 'vitest'

import { ui } from '@/ui/figma'
import { activePlugin, options, selectedNode, selectedTemPadComponent, selection } from '@/ui/state'

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
    plugins: {},
    activePluginSource: null as string | null
  }
}

describe('ui/state', () => {
  beforeEach(() => {
    localStorage.removeItem('tempad-dev')
    options.value = createDefaultOptions()
    selection.value = []
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

  it('resolves active plugin from source id and falls back to null', async () => {
    expect(activePlugin.value).toBeNull()

    options.value.plugins = {
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
