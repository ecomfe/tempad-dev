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
  boundVariables?: SceneNodeMixin['boundVariables']
  typography?: {
    fontSize?: StyledTextSegment['fontSize']
    fontFamily?: StyledTextSegment['fontName']['family']
    fontStyle?: StyledTextSegment['fontName']['style']
    fontWeight?: StyledTextSegment['fontWeight']
    letterSpacing?: StyledTextSegment['letterSpacing']
    lineHeight?: StyledTextSegment['lineHeight']
    paragraphSpacing?: StyledTextSegment['paragraphSpacing']
    paragraphIndent?: StyledTextSegment['paragraphIndent']
  }
}
