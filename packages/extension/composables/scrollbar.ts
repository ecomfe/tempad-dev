import {
  OverlayScrollbars,
  ScrollbarsHidingPlugin,
  SizeObserverPlugin,
  ClickScrollPlugin
} from 'overlayscrollbars'

OverlayScrollbars.plugin([ScrollbarsHidingPlugin, SizeObserverPlugin, ClickScrollPlugin])

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
