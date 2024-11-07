import { useClipboard } from '@vueuse/core'
import { useToast } from '@/entrypoints/ui/composables/toast'

export function useCopy(content: MaybeRefOrGetter<HTMLElement | string | null | undefined>) {
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
