export function getCanvas() {
  // Need to ensure the whole plugin is rendered after canvas is ready
  // so that we can cast the result to HTMLElement here.
  // The layout readiness check lives in App.vue.
  return document.querySelector('#fullscreen-root .gpu-view-content canvas') as HTMLElement
}

export function getLeftPanel() {
  // Similar to `getCanvas()`.
  return document.querySelector('#left-panel-container') as HTMLElement
}
