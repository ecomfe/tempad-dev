export function getCanvas() {
  // Need to ensure the whole plugin is rendered after canvas is ready
  // so that we can cast the result to HTMLElement here.
  // The `waitFor` logic is in `./index.ts`.
  return (document.querySelector('#fullscreen-root .gpu-view-content canvas')) as HTMLElement
}

export function getLeftPanel() {
  // Similar to `getCanvas()`.
  return document.querySelector('#left-panel-container') as HTMLElement
}
