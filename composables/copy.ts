import { useToast } from '@/composables'
import { useClipboard } from '@vueuse/core'

type CopySource = HTMLElement | string | null | undefined

export function useCopy(content?: MaybeRefOrGetter<CopySource>) {
  const { copy } = useClipboard()
  const { show } = useToast()

  return (source?: CopySource) => {
    try {
      const value = toValue(source ?? content)
      copy(typeof value === 'string' ? value : value?.dataset?.copy || value?.textContent || '')
      show('Copied to clipboard')
    } catch (e) {
      console.error(e)
    }
  }
}
