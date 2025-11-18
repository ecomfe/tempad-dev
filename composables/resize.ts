import type { Ref, ComputedRef } from 'vue'

export interface UseResizableOptions {
  min?: number
  max?: number
  defaultWidth?: number
  initialWidth?: number
  onResizeStart?: () => void
  onResize?: (width: number) => void
  onResizeEnd?: (width: number) => void
  onPositionChange?: (position: number) => void
}

export interface UseResizableReturn {
  width: Ref<number>
  isResizing: Readonly<Ref<boolean>>
  handleRightEdgeResize: (e: PointerEvent) => void
  handleLeftEdgeResize: (e: PointerEvent) => void
  setWidth: (width: number) => void
  resetWidth: () => void
  cleanup: () => void
  isAtMinWidth: ComputedRef<boolean>
  isAtMaxWidth: ComputedRef<boolean>
}

export function useResizable(options: UseResizableOptions = {}): UseResizableReturn {
  const {
    min = 300,
    max = 800,
    defaultWidth = 400,
    initialWidth,
    onResizeStart,
    onResize,
    onResizeEnd,
    onPositionChange
  } = options

  const width = ref(initialWidth ?? defaultWidth)
  const isResizing = ref(false)
  const activeCleanups = new Set<() => void>()

  function clampWidth(value: number): number {
    return Math.max(min, Math.min(max, value))
  }

  function setWidth(newWidth: number) {
    width.value = clampWidth(newWidth)
    onResize?.(width.value)
  }

  function resetWidth() {
    width.value = defaultWidth
    onResize?.(width.value)
    onResizeEnd?.(width.value)
  }

  const isAtMinWidth = computed(() => width.value <= min)
  const isAtMaxWidth = computed(() => width.value >= max)

  function createResizeHandler(direction: 'right' | 'left') {
    return function handleResize(e: PointerEvent) {
      e.preventDefault()
      e.stopPropagation()

      const target = e.currentTarget as HTMLElement
      if (!target) return

      target.setPointerCapture(e.pointerId)
      isResizing.value = true
      onResizeStart?.()

      const startX = e.clientX
      const startWidth = width.value
      const pointerId = e.pointerId
      let lastWidth = startWidth

      function onPointerMove(moveEvent: PointerEvent) {
        if (moveEvent.buttons === 0) {
          cleanup(moveEvent)
          return
        }

        const deltaX = moveEvent.clientX - startX
        const newWidth = direction === 'right'
          ? clampWidth(startWidth + deltaX)
          : clampWidth(startWidth - deltaX)

        if (direction === 'left' && onPositionChange) {
          const positionDelta = lastWidth - newWidth
          onPositionChange(positionDelta)
          lastWidth = newWidth
        }

        width.value = newWidth
        onResize?.(newWidth)
      }

      function cleanup(upEvent: PointerEvent) {
        if (!isResizing.value) return

        isResizing.value = false

        target.releasePointerCapture(pointerId)
        target.removeEventListener('pointermove', onPointerMove)
        target.removeEventListener('pointerup', cleanup)
        target.removeEventListener('pointercancel', cleanup)
        target.removeEventListener('lostpointercapture', cleanup)

        activeCleanups.delete(cleanupHandler)
        onResizeEnd?.(width.value)
      }

      const cleanupHandler = () => {
        target.removeEventListener('pointermove', onPointerMove)
        target.removeEventListener('pointerup', cleanup)
        target.removeEventListener('pointercancel', cleanup)
        target.removeEventListener('lostpointercapture', cleanup)
      }

      activeCleanups.add(cleanupHandler)

      target.addEventListener('pointermove', onPointerMove)
      target.addEventListener('pointerup', cleanup)
      target.addEventListener('pointercancel', cleanup)
      target.addEventListener('lostpointercapture', cleanup)
    }
  }

  const handleRightEdgeResize = createResizeHandler('right')
  const handleLeftEdgeResize = createResizeHandler('left')

  function cleanup() {
    activeCleanups.forEach(fn => fn())
    activeCleanups.clear()
    isResizing.value = false
  }

  return {
    width,
    isResizing: readonly(isResizing),
    handleRightEdgeResize,
    handleLeftEdgeResize,
    setWidth,
    resetWidth,
    cleanup,
    isAtMinWidth,
    isAtMaxWidth
  }
}
