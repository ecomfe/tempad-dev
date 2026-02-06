import { useEventListener } from '@vueuse/core'

export function useSelectAll(el: MaybeRefOrGetter<HTMLInputElement | null>) {
  useEventListener(el, 'focus', (e) => {
    const target = e.target as HTMLInputElement | null
    target?.select()
  })
}
