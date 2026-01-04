export function getCanvas() {
  // Need to ensure the whole plugin is rendered after canvas is ready
  // so that we can cast the result to HTMLElement here.
  // The layout readiness check lives in App.vue.
  return document.querySelector<HTMLElement>('#fullscreen-root .gpu-view-content canvas')
}

export function getLeftPanel() {
  // Similar to `getCanvas()`.
  return (
    document.querySelector<HTMLElement>('#left-panel-container') ||
    document.querySelector<HTMLElement>('[class*="left_panel_island_container"]')
  )
}
