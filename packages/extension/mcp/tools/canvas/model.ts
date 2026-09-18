import type {
  CanvasAssets,
  CanvasBinding,
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
const SHAPE_NODE_TYPES = [
  'RECTANGLE',
  'LINE',
  'ELLIPSE',
  'POLYGON',
  'STAR',
  'VECTOR'
] as const satisfies ReadonlyArray<CanvasShapeNodeType>
const PRESERVED_NODE_TYPES = [
  ...SHAPE_NODE_TYPES,
  'COMPONENT',
  'COMPONENT_SET',
  'INSTANCE'
] as const
const CANVAS_NODE_TYPES = [
  ...PRESERVED_NODE_TYPES,
  'BOOLEAN_OPERATION',
  'FRAME',
  'GROUP',
  'SECTION',
  'SLOT',
  'TEXT'
] as const

type CanvasNodeType = (typeof CANVAS_NODE_TYPES)[number]
export type CanvasPreservedNodeType = (typeof PRESERVED_NODE_TYPES)[number]

const shapeNodeTypes: ReadonlySet<string> = new Set(SHAPE_NODE_TYPES)
const preservedNodeTypes: ReadonlySet<string> = new Set(PRESERVED_NODE_TYPES)
const canvasNodeTypes: ReadonlySet<string> = new Set(CANVAS_NODE_TYPES)

export function isShapeType(type: string): type is CanvasShapeNodeType {
  return shapeNodeTypes.has(type)
}

export function isPreservedNodeType(type: string): type is CanvasPreservedNodeType {
  return preservedNodeTypes.has(type)
}

export function isCanvasNodeType(type: string): type is CanvasNodeType {
  return canvasNodeTypes.has(type)
}

export function isFrameContainerType(
  type: string
): type is 'COMPONENT' | 'COMPONENT_SET' | 'FRAME' | 'SLOT' {
  return type === 'COMPONENT' || type === 'COMPONENT_SET' || type === 'FRAME' || type === 'SLOT'
}

export function isIntrinsicContainer(type: string): type is 'BOOLEAN_OPERATION' | 'GROUP' {
  return type === 'BOOLEAN_OPERATION' || type === 'GROUP'
}

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
  themeVariableFields?: Array<keyof CanvasVariableBindings>
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
  absoluteOffsets?: {
    right?: number
    bottom?: number
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
    fontStyleMatching?: true
    portableFontFamily?: 'mono' | 'sans' | 'serif'
    fontStyle?: string
    fontSize?: number
    lineHeight?: LineHeight
    letterSpacing?: LetterSpacing
    alignHorizontal?: 'CENTER' | 'JUSTIFIED' | 'LEFT' | 'RIGHT'
    alignVertical?: 'BOTTOM' | 'CENTER' | 'TOP'
    autoResize: TextNode['textAutoResize']
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

export type ParsedCanvasNativeUpdateInput = {
  mode: 'update'
  targetNodeId: string
  bindings: Record<string, CanvasBinding>
  assets?: CanvasAssets
  styles?: CanvasStyles
  variableCollections?: CanvasVariableCollections
}

type ParsedCanvasRootRemovalInput = {
  mode: 'remove'
  targetNodeId: string
  root: null
}

export type ParsedCanvasPageInput = {
  mode: 'activate' | 'create' | 'remove' | 'update'
  page: CanvasPageProperties
  selection?: string[]
}

export type ParsedCanvasInput =
  | ParsedCanvasTreeInput
  | ParsedCanvasNativeUpdateInput
  | ParsedCanvasRootRemovalInput
  | ParsedCanvasPageInput
