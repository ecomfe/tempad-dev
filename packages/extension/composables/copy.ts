import { toValue } from 'vue'

import { useToast } from '@/composables'
import { logger } from '@/utils/log'

type CopySource = HTMLElement | string | null | undefined

type UseCopyOptions = {
  message?: MaybeRefOrGetter<string>
}

export function useCopy(content?: MaybeRefOrGetter<CopySource>, options?: UseCopyOptions) {
  const { show } = useToast()

  return async (source?: CopySource, message?: string) => {
    try {
      const value = toValue(source ?? content)
      await writeClipboard(
        typeof value === 'string' ? value : value?.dataset?.copy || value?.textContent || ''
      )
      const resolvedMessage =
        message ?? (options?.message ? toValue(options.message) : 'Copied to clipboard')
      show(resolvedMessage)
    } catch (e) {
      logger.error(e)
      show('Could not copy to clipboard. Please try again.')
    }
  }
}

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Older permission configurations can still allow copying through a user gesture.
    }
  }
  const active = document.activeElement
  const inputSelection =
    active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
      ? {
          start: active.selectionStart,
          end: active.selectionEnd,
          direction: active.selectionDirection
        }
      : null
  const selection = document.getSelection()
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) =>
        selection.getRangeAt(index).cloneRange()
      )
    : []
  const input = document.createElement('textarea')
  input.value = text
  input.readOnly = true
  input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
  document.body.append(input)
  try {
    input.select()
    if (!document.execCommand('copy')) throw new Error('Clipboard copy was rejected.')
  } finally {
    input.remove()
    if (active instanceof HTMLElement) active.focus({ preventScroll: true })
    if (selection) {
      selection.removeAllRanges()
      for (const range of ranges) selection.addRange(range)
    }
    if (
      inputSelection?.start != null &&
      inputSelection.end != null &&
      (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)
    )
      active.setSelectionRange(
        inputSelection.start,
        inputSelection.end,
        inputSelection.direction ?? undefined
      )
  }
}
