import type { Ref } from 'vue'

export interface UseResizableOptions {
  min?: number
  max?: number
  defaultWidth?: number
  initialWidth?: number
  positionX?: Ref<number>
  onResizeStart?: () => void
  onResize?: (width: number) => void
  onResizeEnd?: (width: number) => void
}

export interface UseResizableReturn {
  width: Ref<number>
  isResizing: Readonly<Ref<boolean>>
  onResizeRightStart: (e: PointerEvent) => void
  onResizeLeftStart: (e: PointerEvent) => void
  setWidth: (width: number) => void
}

export function useResizable(options: UseResizableOptions = {}): UseResizableReturn {
  const {
    min = 300,
    max = 800,
    defaultWidth = 400,
    initialWidth,
    positionX,
    onResizeStart,
    onResize,
    onResizeEnd
  } = options

  const width = ref(initialWidth ?? defaultWidth)
  const isResizing = ref(false)

  function clampWidth(value: number): number {
    return Math.max(min, Math.min(max, value))
  }

  function setWidth(newWidth: number) {
    width.value = clampWidth(newWidth)
    onResize?.(width.value)
  }

  function onResizeRightStart(e: PointerEvent) {
    e.preventDefault()
    e.stopPropagation()

    const target = e.currentTarget as HTMLElement
    if (!target) return

    // Capture pointer to ensure we receive all events
    target.setPointerCapture(e.pointerId)
    isResizing.value = true
    onResizeStart?.()

    const startX = e.clientX
    const startWidth = width.value

    function onPointerMove(moveEvent: PointerEvent) {
      const deltaX = moveEvent.clientX - startX
      const newWidth = clampWidth(startWidth + deltaX)
      width.value = newWidth
      onResize?.(newWidth)
    }

    function onPointerUp(upEvent: PointerEvent) {
      isResizing.value = false
      target.releasePointerCapture(upEvent.pointerId)
      target.removeEventListener('pointermove', onPointerMove)
      target.removeEventListener('pointerup', onPointerUp)

      onResizeEnd?.(width.value)
    }

    target.addEventListener('pointermove', onPointerMove)
    target.addEventListener('pointerup', onPointerUp)
  }

  function onResizeLeftStart(e: PointerEvent) {
    e.preventDefault()
    e.stopPropagation()

    const target = e.currentTarget as HTMLElement
    if (!target) return

    // Capture pointer to ensure we receive all events
    target.setPointerCapture(e.pointerId)
    isResizing.value = true
    onResizeStart?.()

    const startX = e.clientX
    const startWidth = width.value
    const startLeft = positionX?.value ?? 0

    function onPointerMove(moveEvent: PointerEvent) {
      const deltaX = moveEvent.clientX - startX
      const newWidth = clampWidth(startWidth - deltaX)

      // Adjust position to keep right edge fixed (if positionX is provided)
      if (positionX) {
        positionX.value = startLeft + (startWidth - newWidth)
      }

      width.value = newWidth
      onResize?.(newWidth)
    }

    function onPointerUp(upEvent: PointerEvent) {
      isResizing.value = false
      target.releasePointerCapture(upEvent.pointerId)
      target.removeEventListener('pointermove', onPointerMove)
      target.removeEventListener('pointerup', onPointerUp)

      onResizeEnd?.(width.value)
    }

    target.addEventListener('pointermove', onPointerMove)
    target.addEventListener('pointerup', onPointerUp)
  }

  return {
    width,
    isResizing: readonly(isResizing),
    onResizeRightStart,
    onResizeLeftStart,
    setWidth
  }
}
