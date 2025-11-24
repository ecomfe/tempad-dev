import type { GetTokenDefsResult } from '@/mcp-server/src/tools'
import { rgbaToCss } from '@/utils/color'

const COLOR_SCOPE_HINTS = ['COLOR', 'FILL', 'STROKE', 'TEXT_FILL']
const TYPO_SCOPE_HINTS = [
  'FONT',
  'TEXT',
  'LINE_HEIGHT',
  'LETTER_SPACING',
  'PARAGRAPH_SPACING',
  'TEXT_CONTENT'
]
const EFFECT_SCOPE_HINTS = [
  'DROP_SHADOW',
  'INNER_SHADOW',
  'LAYER_BLUR',
  'BACKGROUND_BLUR',
  'EFFECT'
]
const SPACING_SCOPE_HINTS = [
  'WIDTH',
  'HEIGHT',
  'GAP',
  'SPACING',
  'PADDING',
  'MARGIN',
  'CORNER_RADIUS'
]

const STYLE_PROP_KEYS = [
  'fillStyleId',
  'strokeStyleId',
  'effectStyleId',
  'textStyleId',
  'gridStyleId'
] as const

type TokenEntry = GetTokenDefsResult['tokens'][number]
type StylePropKey = (typeof STYLE_PROP_KEYS)[number]
type VariableAlias = { id?: string } | { type?: string; id?: string }
type StylableNode = SceneNode & Partial<Record<StylePropKey, string>>

type SerializablePaint = {
  type: Paint['type']
  visible?: boolean
  opacity?: number
  color?: string
  gradientStops?: Array<{ position: number; color: string }>
}

type SerializableEffect = {
  type: Effect['type']
  color?: string
  offset?: { x: number; y: number }
  radius?: number
  spread?: number
}

type SerializableGrid = {
  pattern: LayoutGrid['pattern']
  sectionSize: number
  visible: boolean
  color: string
  count?: number
  gutterSize?: number
  offset?: number
  alignment?: RowsColsLayoutGrid['alignment']
}

type SerializableTextStyle = {
  fontName: string
  fontSize: number
  lineHeight?: Record<string, unknown>
  letterSpacing?: Record<string, unknown>
  paragraphSpacing?: number
  textCase?: TextCase
  textDecoration?: TextDecoration
}

type SerializablePaintStyle = {
  paints: SerializablePaint[]
}

type SerializableEffectStyle = {
  effects: SerializableEffect[]
}

type SerializableGridStyle = {
  grids: SerializableGrid[]
}

type TokenMetadata = TokenEntry['metadata']

export function handleGetTokenDefs(nodes: SceneNode[]): GetTokenDefsResult {
  const { variableIds, styleIds } = collectTokenReferences(nodes)
  const variableTokens = resolveVariableTokens(variableIds)
  const styleTokens = resolveStyleTokens(styleIds)

  const tokens = [...variableTokens, ...styleTokens]
  tokens.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

  return { tokens }
}

function hasChildren(node: SceneNode): node is SceneNode & ChildrenMixin {
  return 'children' in node
}

function collectTokenReferences(roots: SceneNode[]): {
  variableIds: Set<string>
  styleIds: Set<string>
} {
  const variableIds = new Set<string>()
  const styleIds = new Set<string>()

  const visit = (node: SceneNode) => {
    collectVariableIds(node, variableIds)
    STYLE_PROP_KEYS.forEach((key) => {
      const styleId = getStyleId(node, key)
      if (styleId) {
        styleIds.add(styleId)
      }
    })

    if (hasChildren(node)) {
      node.children.forEach((child) => {
        if (child.visible) {
          visit(child)
        }
      })
    }
  }

  roots.forEach((root) => {
    if (root.visible) {
      visit(root)
    }
  })

  return { variableIds, styleIds }
}

function resolveVariableTokens(ids: Set<string>): TokenEntry[] {
  const tokens: TokenEntry[] = []
  ids.forEach((id) => {
    const variable = figma.variables.getVariableById(id)
    if (!variable) {
      return
    }

    const value = formatVariableValue(variable)
    if (value == null) {
      return
    }

    tokens.push({
      name: variable.name,
      value,
      kind: inferVariableKind(variable),
      source: 'variable',
      metadata: buildVariableMetadata(variable)
    })
  })

  return tokens
}

function buildVariableMetadata(variable: Variable): TokenMetadata {
  const scopes = (variable.scopes ?? []).slice()
  const metadata: TokenMetadata = {
    id: variable.id,
    resolvedType: variable.resolvedType
  }

  if (scopes.length) {
    metadata.scopes = scopes
  }

  const modeCount = Object.keys(variable.valuesByMode ?? {}).length
  if (modeCount > 1) {
    metadata.modeCount = modeCount
  }

  return metadata
}

function collectVariableIds(node: SceneNode, bucket: Set<string>): void {
  const boundVariables = getBoundVariables(node)
  if (!boundVariables) {
    // still collect inferred variables if available
  } else {
    Object.values(boundVariables).forEach((entry) => {
      collectVariableIdFromValue(entry, bucket)
    })
  }

  const inferred = getInferredVariables(node)
  if (inferred) {
    inferred.forEach((entry) => collectVariableIdFromValue(entry, bucket))
  }
}

function collectVariableIdFromValue(value: unknown, bucket: Set<string>): void {
  if (!value) {
    return
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectVariableIdFromValue(item, bucket))
    return
  }

  if (typeof value === 'object') {
    const alias = value as VariableAlias
    if (alias && typeof alias.id === 'string') {
      bucket.add(alias.id)
      return
    }

    Object.values(value).forEach((nested) => collectVariableIdFromValue(nested, bucket))
  }
}

function formatVariableValue(variable: Variable): string | Record<string, unknown> | null {
  const valuesByMode = variable.valuesByMode ?? {}
  const modeId = Object.keys(valuesByMode)[0]
  if (!modeId) {
    return null
  }

  const defaultValue = valuesByMode[modeId]
  if (defaultValue == null) {
    return null
  }

  switch (variable.resolvedType) {
    case 'COLOR':
      return rgbaToCss(defaultValue as RGBA)
    case 'FLOAT':
      return formatNumericValue(defaultValue as number)
    case 'BOOLEAN':
      return (defaultValue as boolean).toString()
    case 'STRING':
      return String(defaultValue)
    default:
      if (typeof defaultValue === 'object' && defaultValue !== null) {
        return defaultValue as unknown as Record<string, unknown>
      }
      return null
  }
}

function formatNumericValue(value: number): string {
  if (!Number.isFinite(value)) {
    return '0'
  }
  return toFixed(value)
}

function inferVariableKind(variable: Variable): TokenEntry['kind'] {
  const scopes = (variable.scopes ?? []).map((scope) => scope.toUpperCase())

  if (variable.resolvedType === 'COLOR' || hasScope(scopes, COLOR_SCOPE_HINTS)) {
    return 'color'
  }

  if (hasScope(scopes, TYPO_SCOPE_HINTS)) {
    return 'typography'
  }

  if (hasScope(scopes, EFFECT_SCOPE_HINTS)) {
    return 'effect'
  }

  if (hasScope(scopes, SPACING_SCOPE_HINTS)) {
    return 'spacing'
  }

  return 'other'
}

function hasScope(scopes: string[], hints: string[]): boolean {
  return scopes.some((scope) => hints.includes(scope))
}

function resolveStyleTokens(styleIds: Set<string>): TokenEntry[] {
  const tokens: TokenEntry[] = []
  styleIds.forEach((id) => {
    let style: BaseStyle | null = null
    try {
      style = figma.getStyleById(id)
    } catch {
      style = null
    }

    if (!style) {
      return
    }

    const token = serializeStyle(style)
    if (token) {
      tokens.push(token)
    }
  })

  return tokens
}

function getStyleId(node: SceneNode, key: StylePropKey): string | null {
  const value = (node as StylableNode)[key]
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
  }
  return null
}

function getBoundVariables(node: SceneNode): Record<string, unknown> | undefined {
  if ('boundVariables' in node) {
    return (node as { boundVariables?: Record<string, unknown> }).boundVariables
  }
  return undefined
}

function getInferredVariables(node: SceneNode): VariableAlias[] | undefined {
  if ('inferredVariables' in node) {
    return (node as { inferredVariables?: VariableAlias[] }).inferredVariables
  }
  return undefined
}

function serializeStyle(style: BaseStyle): TokenEntry | null {
  switch (style.type) {
    case 'PAINT':
      return {
        name: style.name,
        value: serializePaintStyle(style as PaintStyle),
        kind: 'color',
        source: 'style',
        metadata: buildStyleMetadata(style)
      }
    case 'TEXT':
      return {
        name: style.name,
        value: serializeTextStyle(style as TextStyle),
        kind: 'typography',
        source: 'style',
        metadata: buildStyleMetadata(style)
      }
    case 'EFFECT':
      return {
        name: style.name,
        value: serializeEffectStyle(style as EffectStyle),
        kind: 'effect',
        source: 'style',
        metadata: buildStyleMetadata(style)
      }
    case 'GRID':
      return {
        name: style.name,
        value: serializeGridStyle(style as GridStyle),
        kind: 'spacing',
        source: 'style',
        metadata: buildStyleMetadata(style)
      }
    default:
      return null
  }
}

function buildStyleMetadata(style: BaseStyle): TokenMetadata {
  const metadata: TokenMetadata = {
    id: style.id,
    styleType: style.type
  }
  return metadata
}

function serializePaintStyle(style: PaintStyle): SerializablePaintStyle {
  const paints = (style.paints ?? []).map((paint) => serializePaint(paint))
  return { paints }
}

function serializePaint(paint: Paint): SerializablePaint {
  const base: SerializablePaint = {
    type: paint.type,
    visible: paint.visible !== false
  }

  if (typeof paint.opacity === 'number') {
    base.opacity = Number(paint.opacity.toFixed(3))
  }

  switch (paint.type) {
    case 'SOLID':
      base.color = rgbaToCss(paint.color, paint.opacity)
      break
    case 'GRADIENT_LINEAR':
    case 'GRADIENT_RADIAL':
    case 'GRADIENT_ANGULAR':
    case 'GRADIENT_DIAMOND':
      base.gradientStops = paint.gradientStops.map((stop) => ({
        position: stop.position,
        color: rgbaToCss(stop.color)
      }))
      break
    default:
      break
  }

  return base
}

function serializeTextStyle(style: TextStyle): SerializableTextStyle {
  return {
    fontName: formatFontName(style.fontName),
    fontSize: style.fontSize,
    lineHeight: formatLineHeight(style.lineHeight),
    letterSpacing: formatLetterSpacing(style.letterSpacing),
    paragraphSpacing: style.paragraphSpacing,
    textCase: style.textCase,
    textDecoration: style.textDecoration
  }
}

function serializeEffectStyle(style: EffectStyle): SerializableEffectStyle {
  return {
    effects: (style.effects ?? []).map((effect) => serializeEffect(effect))
  }
}

function serializeEffect(effect: Effect): SerializableEffect {
  const result: SerializableEffect = {
    type: effect.type,
    radius: 'radius' in effect ? effect.radius : undefined
  }

  if ('color' in effect && effect.color) {
    result.color = rgbaToCss(effect.color)
  }

  if ('offset' in effect && effect.offset) {
    result.offset = { x: effect.offset.x, y: effect.offset.y }
  }

  if ('spread' in effect && typeof effect.spread === 'number') {
    result.spread = effect.spread
  }

  return result
}

function serializeGridStyle(style: GridStyle): SerializableGridStyle {
  return {
    grids: (style.layoutGrids ?? []).map((grid) => serializeGrid(grid))
  }
}

function serializeGrid(grid: LayoutGrid): SerializableGrid {
  const base: SerializableGrid = {
    pattern: grid.pattern,
    sectionSize: grid.sectionSize ?? 0,
    visible: grid.visible !== false,
    color: rgbaToCss(grid.color ?? { r: 0, g: 0, b: 0, a: 1 }),
    count: undefined,
    gutterSize: undefined,
    offset: undefined,
    alignment: undefined
  }

  if (grid.pattern === 'GRID') {
    return base
  }

  const rowsCols = grid as RowsColsLayoutGrid
  return {
    ...base,
    count: rowsCols.count,
    gutterSize: rowsCols.gutterSize,
    offset: rowsCols.offset,
    alignment: rowsCols.alignment
  }
}

function formatFontName(fontName: FontName | typeof figma.mixed): string {
  if (fontName === figma.mixed) {
    return 'mixed'
  }
  return `${fontName.family} ${fontName.style}`
}

function formatLineHeight(lineHeight: LineHeight): Record<string, unknown> | undefined {
  if (lineHeight.unit === 'AUTO') {
    return { unit: 'AUTO' }
  }
  if ('value' in lineHeight) {
    return { unit: lineHeight.unit, value: lineHeight.value }
  }
  return undefined
}

function formatLetterSpacing(letterSpacing: LetterSpacing): Record<string, unknown> | undefined {
  if ('value' in letterSpacing) {
    return { unit: letterSpacing.unit, value: letterSpacing.value }
  }
  return undefined
}

function toFixed(value: number): string {
  const rounded = Math.round(value * 1000) / 1000
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}
