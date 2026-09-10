import type { ObjectDirective } from 'vue'

import { ClickScrollPlugin, OverlayScrollbars, ScrollbarsHidingPlugin } from 'overlayscrollbars'

OverlayScrollbars.plugin([ScrollbarsHidingPlugin, ClickScrollPlugin])

type ScrollAxis = 'x' | 'y' | 'both'

export function createSiteScrollbar(
  target: HTMLElement,
  axis: ScrollAxis = 'y'
): OverlayScrollbars {
  return OverlayScrollbars(
    { target, elements: { viewport: target }, cancel: { body: null } },
    {
      overflow: { x: axis === 'y' ? 'hidden' : 'scroll', y: axis === 'x' ? 'hidden' : 'scroll' },
      scrollbars: {
        theme: 'os-theme-tempad',
        autoHide: 'leave',
        autoHideDelay: 500,
        clickScroll: true
      }
    }
  )
}

export const vScrollbar: ObjectDirective<HTMLElement, ScrollAxis | undefined> = {
  mounted(element, { value }) {
    createSiteScrollbar(element, value)
  },
  beforeUnmount(element) {
    OverlayScrollbars(element)?.destroy()
  }
}

export function setPageScrollLocked(locked: boolean): void {
  OverlayScrollbars(document.body)?.options({ overflow: { y: locked ? 'hidden' : 'scroll' } })
}
