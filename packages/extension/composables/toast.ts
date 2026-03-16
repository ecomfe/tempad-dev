let activeNotification: NotificationHandler | null = null

function cancelActiveNotification(): void {
  if (!activeNotification) return

  activeNotification.cancel()
  activeNotification = null
}

export function useToast() {
  function show(msg: string): void {
    cancelActiveNotification()
    activeNotification = figma.notify(msg)
  }

  return {
    show,
    hide(): void {
      cancelActiveNotification()
    }
  }
}
