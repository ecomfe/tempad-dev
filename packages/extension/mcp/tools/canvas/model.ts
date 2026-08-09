import type {
  CanvasAssets,
  CanvasComponentPropertyValue,
  CanvasDesignReference,
  CanvasFigmaProperties,
  CanvasFigmaShape,
  CanvasPageProperties,
  CanvasStyleBindings,
  CanvasStyles,
  CanvasVariableBindings,
  CanvasVariableCollections,
  CanvasVariableModes
} from '@tempad-dev/shared'

export type CanvasShapeNodeType = CanvasFigmaShape['type']
export type CanvasNodeType =
  | 'BOOLEAN_OPERATION'
  | 'COMPONENT'
  | 'COMPONENT_SET'
  | 'FRAME'
  | 'GROUP'
  | 'INSTANCE'
  | 'SECTION'
  | 'SLOT'
  | 'TEXT'
  | CanvasShapeNodeType
export type CanvasPreservedNodeType = CanvasShapeNodeType | 'COMPONENT' | 'COMPONENT_SET'
export type CanvasNodeTypeHints = {
  byKey: ReadonlyMap<string, CanvasPreservedNodeType>
  byNodeId: ReadonlyMap<string, CanvasPreservedNodeType>
  root?: CanvasPreservedNodeType
}
export type CanvasSizingMode = 'FILL' | 'FIXED' | 'HUG'
export type CanvasGridTrack = { type: 'FIXED' | 'FLEX'; value: number } | { type: 'HUG' }

type CanvasPadding = number | Partial<Record<'bottom' | 'left' | 'right' | 'top', number>>

export type CanvasGridLayout = {
  autoRows?: boolean
  mode: 'GRID'
  columns: CanvasGridTrack[]
  rows?: CanvasGridTrack[]
  rowGap?: number
  columnGap?: number
  padding?: CanvasPadding
  itemsPositioning?: 'MANUAL' | 'ROW_AUTO_FLOW'
  strokesIncluded?: boolean
}

type CanvasLayout =
  | {
      mode: 'NONE'
    }
  | {
      mode: 'HORIZONTAL' | 'VERTICAL'
      gap?: number
      counterGap?: number
      padding?: CanvasPadding
      primaryAlign?: 'CENTER' | 'MAX' | 'MIN' | 'SPACE_BETWEEN'
      counterAlign?: 'BASELINE' | 'CENTER' | 'MAX' | 'MIN'
      counterAlignContent?: 'AUTO' | 'SPACE_BETWEEN'
      wrap?: 'NO_WRAP' | 'WRAP'
      strokesIncluded?: boolean
    }
  | CanvasGridLayout

export type CanvasNodeSpec = {
  key: string
  nodeId?: string
  type: CanvasNodeType
  displayName?: string
  size: {
    width?: number
    height?: number
    minWidth?: number | null
    maxWidth?: number | null
    minHeight?: number | null
    maxHeight?: number | null
    horizontal: CanvasSizingMode
    vertical: CanvasSizingMode
  }
  grow?: boolean
  visible?: boolean
  blendMode?: BlendMode
  rotation?: number
  position?: {
    x: number
    y: number
  }
  positioning?: 'ABSOLUTE' | 'AUTO'
  layout?: CanvasLayout
  gridChild?: {
    row?: number
    column?: number
    rowSpan: number
    columnSpan: number
    horizontalAlign: 'AUTO' | 'CENTER' | 'MAX' | 'MIN'
    verticalAlign: 'AUTO' | 'CENTER' | 'MAX' | 'MIN'
  }
  appearance?: {
    fill?: `#${string}` | null
    stroke?: `#${string}` | null
    strokeWeight?: number
    strokeTopWeight?: number
    strokeRightWeight?: number
    strokeBottomWeight?: number
    strokeLeftWeight?: number
    cornerRadius?: number
    topLeftRadius?: number
    topRightRadius?: number
    bottomRightRadius?: number
    bottomLeftRadius?: number
    clipsContent?: boolean
    opacity?: number
  }
  text?: {
    characters: string
    fontFamily?: string
    fontStyle?: string
    fontSize?: number
    lineHeight?: LineHeight
    letterSpacing?: LetterSpacing
    alignHorizontal?: 'CENTER' | 'JUSTIFIED' | 'LEFT' | 'RIGHT'
    alignVertical?: 'BOTTOM' | 'CENTER' | 'TOP'
    autoResize: 'HEIGHT' | 'NONE' | 'WIDTH_AND_HEIGHT'
    textCase?: TextCase
    textDecoration?: TextDecoration
    textTruncation?: 'DISABLED' | 'ENDING'
    maxLines?: number | null
  }
  component?: CanvasDesignReference
  componentProperties?: Record<string, CanvasComponentPropertyValue>
  variables?: CanvasVariableBindings
  variableModes?: CanvasVariableModes
  styles?: CanvasStyleBindings
  figma?: CanvasFigmaProperties
  children?: CanvasNodeSpec[]
}

type ParsedCanvasCommon = {
  mode: 'create' | 'update'
  targetNodeId?: string
  removeKeys: string[]
  page?: CanvasPageProperties
  assets?: CanvasAssets
  styles?: CanvasStyles
  variableCollections?: CanvasVariableCollections
}

export type ParsedCanvasTreeInput = ParsedCanvasCommon & {
  root: CanvasNodeSpec
}

type ParsedCanvasRootRemovalInput = {
  mode: 'update'
  targetNodeId: string
  root: null
}

export type ParsedCanvasInput = ParsedCanvasTreeInput | ParsedCanvasRootRemovalInput
