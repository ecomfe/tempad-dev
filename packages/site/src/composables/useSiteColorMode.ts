import { useColorMode, useMounted, useStorage } from '@vueuse/core'
import { computed, type ComputedRef } from 'vue'

export type SiteColorMode = 'auto' | 'light' | 'dark'
export type SiteResolvedColorMode = 'light' | 'dark'

type UseSiteColorModeResult = {
  colorMode: ReturnType<typeof useColorMode<SiteColorMode>>
  resolvedColorMode: ComputedRef<SiteResolvedColorMode>
  selectedColorMode: ComputedRef<SiteColorMode>
}

const STORAGE_KEY = 'tempad-dev-site-color-mode'

export function useSiteColorMode(): UseSiteColorModeResult {
  const store = useStorage<SiteColorMode>(STORAGE_KEY, 'auto', undefined, {
    serializer: {
      read: (value) => (value === 'light' || value === 'dark' ? value : 'auto'),
      write: (value) => value
    }
  })
  const colorMode = useColorMode<SiteColorMode>({
    storageRef: store
  })
  const mounted = useMounted()

  // VueUse attaches the persisted preference ref to the color mode ref.
  // eslint-disable-next-line vue/no-ref-as-operand
  const selectedColorMode = computed(() => (mounted.value ? colorMode.store.value : 'auto'))
  const resolvedColorMode = computed<SiteResolvedColorMode>(() =>
    mounted.value && colorMode.value === 'dark' ? 'dark' : 'light'
  )

  return {
    colorMode,
    resolvedColorMode,
    selectedColorMode
  }
}
