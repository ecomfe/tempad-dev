import { onMounted, onUnmounted } from 'vue'
import { selection } from '../state'
import { getCanvas, getObjectsPanel } from '../utils'

function syncSelection() {
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
  const objectsPanel = getObjectsPanel()

  onMounted(() => {
    selection.value = figma.currentPage.selection

    canvas.addEventListener('click', handleClick)
    objectsPanel.addEventListener('click', handleClick)
    window.addEventListener('keydown', handleKeyDown)
  })

  onUnmounted(() => {
    canvas.removeEventListener('click', handleClick)
    objectsPanel.removeEventListener('click', handleClick)
    window.removeEventListener('keydown', handleKeyDown)
  })
}
