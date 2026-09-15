type AnchorListener = (node: SceneNode) => void

let listener: AnchorListener | undefined

export function observeCanvasPlacement(next: AnchorListener): () => void {
  listener = next
  return () => {
    if (listener === next) listener = undefined
  }
}

// UI feedback must never change the outcome of a canvas transaction.
export function reportCanvasPlacement(node: SceneNode): void {
  try {
    listener?.(node)
  } catch {
    // A detached overlay or unavailable viewport is not an authoring failure.
  }
}
