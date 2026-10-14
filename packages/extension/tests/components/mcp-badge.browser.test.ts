import { afterEach, expect, it, vi } from 'vitest'
import { computed, nextTick, ref, watch } from 'vue'

vi.mock('@/composables', async () => {
  const { ref } = await import('vue')
  const mcp = {
    status: ref('connecting'),
    selfActive: ref(false),
    count: ref(1),
    errorMessage: ref<string | null>(null),
    needsLocalHostPermission: ref(false),
    designTask: ref(null),
    designAnchor: ref(null),
    designActionResult: ref(null),
    designTaskRestored: ref(false),
    sessionId: 'badge-test',
    activate: vi.fn(),
    requestLocalHostPermission: vi.fn()
  }
  return {
    useMcp: () => mcp,
    useSelection: vi.fn(),
    useKeyLock: vi.fn(),
    useFigmaAvailability: vi.fn(),
    syncSelection: vi.fn()
  }
})
vi.mock('@/components/Panel.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      setup(_, { slots }) {
        return () => h('div', [slots.header?.(), slots.default?.()])
      }
    })
  }
})
vi.mock('@/components/DesignTaskStatus.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/sections/PrefSection.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/sections/MetaSection.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/sections/CodeSection.vue', () => ({ default: { render: () => null } }))

import { useMcp } from '@/composables'
import App from '@/entrypoints/ui/App.vue'
import { layoutReady, options, runtimeMode } from '@/ui/state'

import { mount, unmountAll } from './mount'

afterEach(() => {
  unmountAll()
  vi.unstubAllGlobals()
})

it('shows recovery guidance on the connecting badge and clears it after reconnecting', async () => {
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('watch', watch)
  layoutReady.value = true
  runtimeMode.value = 'standard'
  options.value.mcpOn = true
  const mcp = useMcp()
  const host = mount(App)
  const badge = host.querySelector<HTMLButtonElement>('.tp-mcp-badge')!
  expect(badge.dataset.tooltip).toBe('Connecting')

  const guidance = 'TemPad Dev was updated. Reload this Figma tab to reconnect.'
  mcp.errorMessage.value = guidance
  await nextTick()
  expect(badge.dataset.tooltip).toBe(guidance)
  badge.click()
  expect(mcp.activate).not.toHaveBeenCalled()

  mcp.errorMessage.value = null
  await nextTick()
  expect(badge.dataset.tooltip).toBe('Connecting')
  mcp.status.value = 'connected'
  await nextTick()
  expect(badge.dataset.tooltip).toBe('Inactive\nClick to activate')
  badge.click()
  expect(mcp.activate).toHaveBeenCalledOnce()
})
