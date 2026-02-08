import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  copy: { useCopy: vi.fn() },
  deepLink: { useDeepLinkGuard: vi.fn() },
  devResources: { useDevResourceLinks: vi.fn() },
  availability: { useFigmaAvailability: vi.fn() },
  input: { useSelectAll: vi.fn() },
  keyLock: { useKeyLock: vi.fn() },
  mcp: { useMcp: vi.fn() },
  plugin: { usePluginInstall: vi.fn() },
  scrollbar: { useScrollbar: vi.fn() },
  selection: { useSelection: vi.fn() },
  toast: { useToast: vi.fn() }
}))

vi.mock('@/composables/copy', () => mocks.copy)
vi.mock('@/composables/deep-link', () => mocks.deepLink)
vi.mock('@/composables/dev-resources', () => mocks.devResources)
vi.mock('@/composables/availability', () => mocks.availability)
vi.mock('@/composables/input', () => mocks.input)
vi.mock('@/composables/key-lock', () => mocks.keyLock)
vi.mock('@/composables/mcp', () => mocks.mcp)
vi.mock('@/composables/plugin', () => mocks.plugin)
vi.mock('@/composables/scrollbar', () => mocks.scrollbar)
vi.mock('@/composables/selection', () => mocks.selection)
vi.mock('@/composables/toast', () => mocks.toast)

describe('composables/index', () => {
  it('re-exports all composable entrypoints', async () => {
    const composables = await import('@/composables')

    expect(composables.useCopy).toBe(mocks.copy.useCopy)
    expect(composables.useDeepLinkGuard).toBe(mocks.deepLink.useDeepLinkGuard)
    expect(composables.useDevResourceLinks).toBe(mocks.devResources.useDevResourceLinks)
    expect(composables.useFigmaAvailability).toBe(mocks.availability.useFigmaAvailability)
    expect(composables.useSelectAll).toBe(mocks.input.useSelectAll)
    expect(composables.useKeyLock).toBe(mocks.keyLock.useKeyLock)
    expect(composables.useMcp).toBe(mocks.mcp.useMcp)
    expect(composables.usePluginInstall).toBe(mocks.plugin.usePluginInstall)
    expect(composables.useScrollbar).toBe(mocks.scrollbar.useScrollbar)
    expect(composables.useSelection).toBe(mocks.selection.useSelection)
    expect(composables.useToast).toBe(mocks.toast.useToast)
  }, 15000)
})
