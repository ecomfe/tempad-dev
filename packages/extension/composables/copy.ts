import { useClipboard } from '@vueuse/core'

import { useToast } from '@/composables'
import { logger } from '@/utils/log'

type CopySource = HTMLElement | string | null | undefined

type UseCopyOptions = {
  message?: MaybeRefOrGetter<string>
}

export function useCopy(content?: MaybeRefOrGetter<CopySource>, options?: UseCopyOptions) {
  const { copy: copyToClipboard } = useClipboard()
  const { show } = useToast()

  return (source?: CopySource, message?: string) => {
    try {
      const value = toValue(source ?? content)
      copyToClipboard(
        typeof value === 'string' ? value : value?.dataset?.copy || value?.textContent || ''
      )
      const resolvedMessage =
        message ?? (options?.message ? toValue(options.message) : 'Copied to clipboard')
      show(resolvedMessage)
    } catch (e) {
      logger.error(e)
    }
  }
}
