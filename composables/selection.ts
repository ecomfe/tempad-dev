import { createQuirksSelection } from '@/ui/quirks'
import { selection } from '@/ui/state'
import { getCanvas, getLeftPanel } from '@/utils'

function syncSelection() {
  if (!window.figma) {
    selection.value = createQuirksSelection()
    return
  }
  selection.value = figma.currentPage.selection
}

function handleClick() {
  syncSelection()
}

function handleKeyDown(e: KeyboardEvent) {
  if ((e.target as Element).classList.contains('focus-target')) {
    // command + A or other shortcut that changes selection
    syncSelection()
  }
}

export function useSelection() {
  const canvas = getCanvas()
  const objectsPanel = getLeftPanel()

  const options = { capture: true }

  onMounted(() => {
    syncSelection()

    canvas.addEventListener('click', handleClick, options)
    objectsPanel.addEventListener('click', handleClick, options)
    window.addEventListener('keydown', handleKeyDown, options)
  })

  onUnmounted(() => {
    canvas.removeEventListener('click', handleClick, options)
    objectsPanel.removeEventListener('click', handleClick, options)
    window.removeEventListener('keydown', handleKeyDown, options)
  })
}
