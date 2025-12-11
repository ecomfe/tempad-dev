export function useToast() {
  let active: NotificationHandler | null = null

  return {
    show(msg: string) {
      active = figma.notify(msg)
    },
    hide() {
      if (active) {
        active.cancel()
        active = null
      }
    }
  }
}
