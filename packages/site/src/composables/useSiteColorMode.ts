import { useColorMode, useStorage } from '@vueuse/core'
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

  const selectedColorMode = computed(() => colorMode.store.value)
  const resolvedColorMode = computed<SiteResolvedColorMode>(() =>
    colorMode.value === 'dark' ? 'dark' : 'light'
  )

  return {
    colorMode,
    resolvedColorMode,
    selectedColorMode
  }
}
