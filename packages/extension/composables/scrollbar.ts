import {
  OverlayScrollbars,
  ScrollbarsHidingPlugin,
  SizeObserverPlugin,
  ClickScrollPlugin
} from 'overlayscrollbars'
import { toValue, watchEffect } from 'vue'

OverlayScrollbars.plugin([ScrollbarsHidingPlugin, SizeObserverPlugin, ClickScrollPlugin])

/** Vertical-only scrolling with hover-revealed bars: the shape every panel here wants. */
export const VERTICAL_SCROLLBAR_OPTIONS: Parameters<typeof OverlayScrollbars>[1] = {
  overflow: {
    x: 'hidden'
  },
  scrollbars: {
    autoHide: 'leave',
    autoHideDelay: 0,
    clickScroll: true
  }
}

export function useScrollbar(
  container: MaybeRefOrGetter<HTMLElement | null>,
  scrollOptions: Parameters<typeof OverlayScrollbars>[1]
) {
  let os: OverlayScrollbars | null = null

  watchEffect(
    (onCleanup) => {
      const el = toValue(container)
      if (!el) {
        return
      }

      os = OverlayScrollbars(el, scrollOptions)

      onCleanup(() => {
        os?.destroy()
      })
    },
    { flush: 'post' }
  )
}
