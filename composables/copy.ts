import { useToast } from '@/composables'
import { useClipboard } from '@vueuse/core'

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
