import { getCanvas } from '@/utils/figma'

import { readFigmaFileKey } from './figma-session'

type Rect = { x: number; y: number; width: number; height: number }

export type CanvasOverlayFrame = {
  canvas: { left: number; top: number; width: number; height: number }
  bounds: Rect
  zoom: number
  pageId: string
  fileKey: string | null
  selectedNode: SceneNode | null
  tooltips?: Rect[]
}

const observers = new Set<(frame: CanvasOverlayFrame | null) => void>()
let frameId: number | undefined
let currentFrame: CanvasOverlayFrame | null = null

function readFrame(): CanvasOverlayFrame | null {
  try {
    const canvas = getCanvas()
    const api = window.figma
    if (!canvas || !api?.currentPage) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const selection = api.currentPage.selection ?? []
    return {
      canvas: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      bounds: api.viewport.bounds,
      zoom: api.viewport.zoom,
      pageId: api.currentPage.id,
      fileKey: readFigmaFileKey(api),
      selectedNode: selection.length === 1 ? selection[0]! : null,
      tooltips: [...document.querySelectorAll<HTMLElement>('[role="tooltip"]')]
        .filter(
          (element) =>
            !element.closest('tempad') &&
            element.checkVisibility({ opacityProperty: true, visibilityProperty: true })
        )
        .map((element) => {
          const bounds = element.getBoundingClientRect()
          return { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height }
        })
    }
  } catch {
    return null
  }
}

function updateFrame(): void {
  frameId = undefined
  currentFrame = readFrame()
  for (const observer of observers) {
    try {
      observer(currentFrame)
    } catch {
      // A stale native node must not stop the other overlays or canvas work.
    }
  }
  if (observers.size) frameId = requestAnimationFrame(updateFrame)
}

/** Every canvas overlay shares one measurement and one animation frame loop. */
export function observeCanvasOverlay(
  observer: (frame: CanvasOverlayFrame | null) => void
): () => void {
  observers.add(observer)
  if (frameId === undefined) updateFrame()
  else {
    try {
      observer(currentFrame)
    } catch {
      // Initial delivery has the same isolation as subsequent frames.
    }
  }
  return () => {
    observers.delete(observer)
    if (!observers.size) {
      if (frameId !== undefined) cancelAnimationFrame(frameId)
      frameId = undefined
      currentFrame = null
    }
  }
}

export function projectCanvasAnchor(anchor: Rect, bounds: Rect, zoom: number): Rect | null {
  const values = [anchor.x, anchor.y, anchor.width, anchor.height, bounds.x, bounds.y, zoom]
  if (!values.every(Number.isFinite) || zoom <= 0 || anchor.width < 0 || anchor.height < 0)
    return null
  return {
    x: (anchor.x - bounds.x) * zoom,
    y: (anchor.y - bounds.y) * zoom,
    width: anchor.width * zoom,
    height: anchor.height * zoom
  }
}

/** Leave the selected frame's upper-right action area to Figma's native controls. */
export function selectionActionBounds(frame: CanvasOverlayFrame): Rect | null {
  const node = frame.selectedNode
  if (!node || node.removed || !node.absoluteBoundingBox) return null
  const rect = projectCanvasAnchor(node.absoluteBoundingBox, frame.bounds, frame.zoom)
  return rect ? { x: rect.x + rect.width + 4, y: rect.y + 4, width: 24, height: 24 } : null
}

export function canvasRectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

/** The convex envelope keeps diagonal travel between a selection and its controls reachable. */
export function canvasHoverContains(point: { x: number; y: number }, areas: Rect[]): boolean {
  const points = areas
    .flatMap(({ x, y, width, height }) => [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height }
    ])
    .sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (a: typeof point, b: typeof point, c: typeof point) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  function chain(points: (typeof point)[]) {
    const edge: (typeof point)[] = []
    for (const point of points) {
      while (edge.length >= 2 && cross(edge[edge.length - 2]!, edge[edge.length - 1]!, point) <= 0)
        edge.pop()
      edge.push(point)
    }
    return edge.slice(0, -1)
  }
  const hull = [...chain(points), ...chain([...points].reverse())]
  return (
    hull.length >= 3 &&
    hull.every((vertex, index) => cross(vertex, hull[(index + 1) % hull.length]!, point) >= 0)
  )
}

/** Replace the trigger in place; flip its anchored corner before shifting inside the canvas. */
export function placeCanvasPopover(
  anchor: Rect,
  popup: { width: number; height: number },
  canvas: { width: number; height: number }
): { x: number; y: number } {
  const padding = 8
  const right = canvas.width - padding,
    bottom = canvas.height - padding
  const area = (width: number, height: number) =>
    Math.max(0, Math.min(canvas.width - 2 * padding, width)) *
    Math.max(0, Math.min(canvas.height - 2 * padding, height))
  const left = anchor.x + anchor.width - popup.width
  const top = anchor.y + anchor.height - popup.height
  const candidates = [
    { x: anchor.x, y: anchor.y, space: area(right - anchor.x, bottom - anchor.y) },
    { x: left, y: anchor.y, space: area(anchor.x + anchor.width - padding, bottom - anchor.y) },
    { x: anchor.x, y: top, space: area(right - anchor.x, anchor.y + anchor.height - padding) },
    {
      x: left,
      y: top,
      space: area(anchor.x + anchor.width - padding, anchor.y + anchor.height - padding)
    }
  ]
  const point =
    candidates.find(
      ({ x, y }) =>
        x >= padding && y >= padding && x + popup.width <= right && y + popup.height <= bottom
    ) ?? candidates.reduce((best, next) => (next.space > best.space ? next : best))
  return {
    x: Math.max(padding, Math.min(point.x, right - popup.width)),
    y: Math.max(padding, Math.min(point.y, bottom - popup.height))
  }
}

export function canvasClipStyle(canvas: CanvasOverlayFrame['canvas']): {
  left: string
  top: string
  width: string
  height: string
} {
  return {
    left: `${canvas.left}px`,
    top: `${canvas.top}px`,
    width: `${canvas.width}px`,
    height: `${canvas.height}px`
  }
}
