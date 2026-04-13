export type PaintList = Paint[] | ReadonlyArray<Paint> | null | undefined

export type FigmaLookupReaders = {
  getStyleById(id: string): BaseStyle | null
  getVariableById(id: string): Variable | null
}

export type PaintResolutionSize = {
  width: number
  height: number
}

export type NodePaintStyleInput = {
  fillStyleId?: unknown
  strokeStyleId?: unknown
  fills?: PaintList
  strokes?: PaintList
  dimensions?: PaintResolutionSize
}
