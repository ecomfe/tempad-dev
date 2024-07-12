import { useClipboard } from '@vueuse/core'
import { toValue } from 'vue'
import { useToast } from '@/entrypoints/ui/composables/toast'
import type { MaybeRefOrGetter } from 'vue'

export function useCopy(content: MaybeRefOrGetter<HTMLElement | string | undefined>) {
  const { copy } = useClipboard()
  const { show } = useToast()

  return () => {
    try {
      const value = toValue(content)
      copy(typeof value === 'string' ? value : value?.dataset?.copy || value?.textContent || '')
      show('Copied to clipboard')
    } catch (e) {
      console.error(e)
    }
  }
}
