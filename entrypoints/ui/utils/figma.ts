export function getCanvas() {
  // Need to ensure the whole plugin is rendered after canvas is ready
  // so that we can cast the result to HTMLElement here.
  // The `waitFor` logic is in `./index.ts`.
  return document.querySelector('#fullscreen-root .gpu-view-content canvas') as HTMLElement
}

export function getLeftPanel() {
  // Similar to `getCanvas()`.
  return document.querySelector('#left-panel-container') as HTMLElement
}

function getChevron() {
  return document.querySelector<HTMLElement>(
    '#fullscreen-filename [class^="filename_view--chevronNoMainContainer--"]'
  )
}

function getDuplicateItem() {
  return getChevron()?.querySelector<HTMLElement>(
    '[data-testid="dropdown-option-Duplicate to your drafts"]'
  )
}

export function showDuplicateItem() {
  const chevron = getChevron()

  if (!chevron) {
    return
  }

  chevron.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

  setTimeout(() => {
    getDuplicateItem()?.focus()
  }, 100)
}
