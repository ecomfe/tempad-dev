import { useColorMode } from '@vueuse/core'
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
  const colorMode = useColorMode<SiteColorMode>({
    initialValue: 'auto',
    storageKey: STORAGE_KEY
  })

  const selectedColorMode = computed(() => colorMode.store.value as SiteColorMode)
  const resolvedColorMode = computed<SiteResolvedColorMode>(() =>
    colorMode.value === 'dark' ? 'dark' : 'light'
  )

  return {
    colorMode,
    resolvedColorMode,
    selectedColorMode
  }
}
