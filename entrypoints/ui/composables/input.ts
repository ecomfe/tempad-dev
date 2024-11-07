import { useEventListener } from '@vueuse/core'

export function useSelectAll(el: MaybeRefOrGetter<HTMLInputElement | null>) {
  useEventListener(el, 'focus', (e) => {
    ;(e.target as HTMLInputElement).select()
  })
}
