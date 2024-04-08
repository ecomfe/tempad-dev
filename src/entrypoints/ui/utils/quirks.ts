import { snakeToKebab } from '.'
import { fadeTo } from './color'
import { parseNumber, toDecimalPlace } from './number'

const TEMPAD_PLUGIN_ID = '1126010039932614529'

type StackMode = 'row' | 'column' | 'none'
type StackWrap = 'wrap' | 'nowrap'
type StackJustify = 'flex-start' | 'center' | 'flex-end' | 'space-between'
type StackAlign = 'flex-start' | 'center' | 'flex-end' | 'baseline' | 'stretch' | 'auto'
type StackPosition = 'absolute' | 'static'
type StackSize = 'hug' | 'fixed'
type Constraint = 'min' | 'max' | 'center' | 'stretch' | 'scale'

interface PluginData {
  pluginID: string
  key: string
  value: string
}

interface ParsedLogProps {
  name: string
  parentId: string
  type: NodeType
  size: [number, number] | null
  opacity: number
  'blend-mode': string
  'fill-paint-data': string
  'stroke-paint-data': string
  'stroke-weight': number
  'stroke-dash-pattern': number[]
  'horizontal-constraint': Constraint
  'vertical-constraint': Constraint
  'relative-transform': DOMMatrixReadOnly
  'max-size'?: [number, number] | null
  'min-size'?: [number, number] | null
  'stack-mode'?: StackMode
  'stack-wrap'?: StackWrap
  'stack-primary-sizing'?: StackSize
  'stack-counter-sizing'?: StackSize
  'stack-primary-align-items'?: StackJustify
  'stack-counter-align-items'?: StackAlign
  'stack-spacing'?: number
  'stack-counter-spacing'?: number
  'stack-padding-top'?: number
  'stack-padding-right'?: number
  'stack-padding-bottom'?: number
  'stack-padding-left'?: number
  'stack-child-primary-grow'?: number
  'stack-child-align-self'?: StackAlign
  'stack-positioning'?: StackPosition
  'border-stroke-weights-independent'?: boolean
  'border-top-weight'?: number
  'border-right-weight'?: number
  'border-bottom-weight'?: number
  'border-left-weight'?: number
  'rectangle-corner-radii-independent'?: boolean
  'rectangle-top-left-corner-radius'?: number
  'rectangle-top-right-corner-radius'?: number
  'rectangle-bottom-left-corner-radius'?: number
  'rectangle-bottom-right-corner-radius'?: number
  'effect-data'?: number // we can only access the count of effects
  'plugin-data'?: PluginData[]
}

const PARENT_ID_RE = /(\d+:\d+)(?:\s*(?:\([^)]*\)|\[[^\]]*\]))*\n-+>/
const KV_ITEMS_RE = /\n{\s+([\s\S]+?)\n}/
const KV_ITEM_RE = /^([^:]+):\s*(.+)$/

function parseLog(log: string) {
  const [, parentId] = log.match(PARENT_ID_RE) || []

  const [, kvStr] = log.match(KV_ITEMS_RE) || []

  if (!kvStr) {
    return null
  }

  const props = kvStr
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce(
      (acc, line) => {
        const [, key, value] = line.match(KV_ITEM_RE) || []

        if (!key || !value) {
          return acc
        }

        const parsedValue = parseTypeAndValue(value)
        if (!parsedValue) {
          return acc
        }

        return {
          ...acc,
          [key]: parsedValue.value
        }
      },
      {
        parentId
      }
    ) as ParsedLogProps

  return new QuirksNode(props)
}

interface RawValue {
  type: string
  value: string
}

const VALUE_RE = /^<([^:]+):([\s\S]+)>$/

function parseTypeAndValue(raw: string): RawValue | null {
  const [, type, rawValue] = raw.match(VALUE_RE) || []

  if (!type || !rawValue) {
    return null
  }

  return {
    type: type,
    value: parseValue({ type, value: rawValue })
  }
}

function parseValue(rawValue: RawValue) {
  const { type, value } = rawValue

  switch (type) {
    case 'ImmutableString':
      return getString(value)
    case 'NodeType':
      return getNodeType(value)
    case 'StackMode':
      return getStackMode(value)
    case 'StackJustify':
      return getStackJustify(value)
    case 'StackAlign':
    case 'StackCounterAlign':
      return getStackAlign(value)
    case 'StackWrap':
      return getStackWrap(value)
    case 'StackPositioning':
      return getStackPosition(value)
    case 'StackSize':
      return getStackSize(value)
    case 'ConstraintType':
      return getConstraintType(value)
    case 'AffineTransformF':
      return getTransform(value)
    case 'TVector2<float>':
    case 'Optional<TVector2<float>':
      return getFloatVector2(value)
    case 'ImmutableArray<float>':
      return getFloatArray(value)
    case 'BlendMode':
      return getBlendMode(value)
    case 'Immutable<PaintData>':
      return getPaint(value)
    case 'Immutable<EffectData>':
      return getEffectCount(value)
    case 'PluginData':
      return JSON.parse(value)
    case 'bool':
      return getBool(value)
    case 'float':
      return getFloat(value)
    default:
      return value
  }
}

function getString(raw: string): string {
  return raw.substring(1, raw.length - 1)
}

function getEnumString(raw: string): string {
  return raw.substring(3)
}

const NODE_TYPE_MAP: Record<string, NodeType> = {
  ROUNDED_RECTANGLE: 'RECTANGLE',
  REGULAR_POLYGON: 'POLYGON',
  SYMBOL: 'COMPONENT'
}

function getNodeType(type: string): NodeType {
  const typeString = getEnumString(type)
  return NODE_TYPE_MAP[typeString] || typeString
}

function getBlendMode(raw: string): string {
  const modeString = getEnumString(raw)
  return snakeToKebab(modeString) || modeString
}

const STACK_MODE_MAP: Record<string, StackMode> = {
  HORIZONTAL: 'row',
  VERTICAL: 'column',
  NONE: 'none'
}

function getStackMode(raw: string): StackMode {
  const modeString = getEnumString(raw)
  return STACK_MODE_MAP[modeString] || modeString
}

const STACK_JUSTIFY_MAP: Record<string, StackJustify> = {
  MIN: 'flex-start',
  CENTER: 'center',
  MAX: 'flex-end',
  SPACE_EVENLY: 'space-between'
}

function getStackJustify(raw: string): StackJustify {
  const justifyString = getEnumString(raw)
  return STACK_JUSTIFY_MAP[justifyString] || justifyString
}

const STACK_ALIGN_MAP: Record<string, StackAlign> = {
  MIN: 'flex-start',
  CENTER: 'center',
  MAX: 'flex-end',
  BASELINE: 'baseline',
  STRETCH: 'stretch',
  AUTO: 'auto'
}

function getStackAlign(raw: string): StackAlign {
  const alignString = getEnumString(raw)
  return STACK_ALIGN_MAP[alignString] || alignString
}

const STACK_WRAP_MAP: Record<string, StackWrap> = {
  WRAP: 'wrap',
  NO_WRAP: 'nowrap'
}

function getStackWrap(raw: string): StackWrap {
  const wrapString = getEnumString(raw)
  return STACK_WRAP_MAP[wrapString] || wrapString
}

const POSITION_MAP: Record<string, StackPosition> = {
  ABSOLUTE: 'absolute',
  AUTO: 'static'
}

function getStackPosition(raw: string): StackPosition {
  const positionString = getEnumString(raw)
  return POSITION_MAP[positionString] || positionString
}

const STACK_SIZE_MAP: Record<string, StackSize> = {
  RESIZE_TO_FIT_WITH_IMPLICIT_SIZE: 'hug',
  FIXED: 'fixed'
}

function getStackSize(raw: string): StackSize {
  const sizeString = getEnumString(raw)
  return STACK_SIZE_MAP[sizeString] || sizeString
}

function getConstraintType(raw: string): string {
  const typeString = getEnumString(raw)
  return snakeToKebab(typeString) || typeString
}

const VECTOR_RE = /^VectorF\(([^,]+), ([^)]+)\)$/

function getFloatVector2(raw: string): [number, number] | null {
  if (raw === '(null)') {
    return null
  }

  const [, v0, v1] = raw.match(VECTOR_RE) || []
  if (!v0 || !v1) {
    return null
  }

  return [getFloat(v0), getFloat(v1)]
}

function getFloatArray(raw: string): number[] {
  return JSON.parse(`[${raw.substring(1, raw.length - 1)}]`)
}

const TRANSFORM_RE = /^AffineTransformF\(([^)]+)\)$/

function getTransform(raw: string): DOMMatrixReadOnly | null {
  const [, args] = raw.match(TRANSFORM_RE) || []
  if (!args) {
    return null
  }

  // For transform matrix:
  // a c e
  // b d f
  // 0 0 1
  // CSS transform matrix() order: a, b, c, d, e, f
  // AffineTransformF here: a, c, e, b, d, f
  // So we need to reorder them first.
  const [a, c, e, b, d, f] = JSON.parse(`[${args}]`)

  return new DOMMatrixReadOnly(`matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`)
}

const PAINT_DATA_RE = /^PaintData\(([\s\S]*)\)$/
const PAINT_RE = /(Solid|Gradient|Raster)Paint\(([^)]+?)\)/g
const PAINT_VALUE_RE = /([^,]+),\s*opacity (.*)/

function getPaint(raw: string): string {
  const [, rawPaints] = raw.match(PAINT_DATA_RE) || []

  if (!rawPaints) {
    return ''
  }

  const paints: string[] = []

  ;[...rawPaints.matchAll(PAINT_RE)].forEach((match) => {
    const [, type, paintValue] = match
    const [, paint, opacity] = paintValue.match(PAINT_VALUE_RE) || []
    if (!paint || !opacity) {
      return
    }

    const opacityValue = toDecimalPlace(opacity, 2)
    switch (type) {
      case 'Solid':
        if (opacityValue > 0) {
          paints.push(fadeTo(paint, opacityValue))
        }
        break
      case 'Gradient':
        paints.push(`linear-gradient(<color-stops>)`)
        break
      case 'Raster':
        paints.push(`url(<path-to-image>) no-repeat`)
      default:
    }
  })

  return paints.reverse().join(', ')
}

const EFFECT_RE = /EffectData\[([^\]]+)\]/
function getEffectCount(raw: string): number {
  const [, effectCount = ''] = raw.match(EFFECT_RE) || []
  return parseNumber(effectCount) || 0
}

function getBool(raw: string): boolean {
  return raw === 'true'
}

function getFloat(raw: string): number {
  if (raw === 'inf') {
    return Infinity
  }
  if (raw === 'nan') {
    return Number.NaN
  }
  return parseFloat(raw)
}

function isShape(type: NodeType) {
  return ['VECTOR', 'ELLIPSE', 'STAR', 'POLYGON'].includes(type)
}

export class QuirksNode {
  constructor(props: ParsedLogProps) {
    this.props = props
    this.name = props.name
    this.type = props.type

    this.warning = this.getWarning()
  }

  private props: ParsedLogProps
  private parentCache: QuirksNode | null = null

  name: string
  type: NodeType

  warning: string

  get parent(): QuirksNode | null {
    // parent is document or canvas, assume it's the root
    if (this.props.parentId?.startsWith('0:')) {
      return null
    }

    if (!this.parentCache) {
      this.parentCache = parseLog(window.DebuggingHelpers.logNode(this.props.parentId))
    }

    return this.parentCache
  }

  async getCSSAsync() {
    if (this.type === 'SECTION') {
      return {}
    }
    return this.getStyles()
  }

  getSharedPluginData(namespace: string, key: string) {
    const pluginData = this.props['plugin-data'] || []

    const data = pluginData.find(({ pluginID, key: itemKey }) => {
      return (
        (pluginID === '' && itemKey === `${namespace}-${key}`) ||
        (pluginID === TEMPAD_PLUGIN_ID && itemKey === key)
      )
    })

    return data?.value || ''
  }

  findChild() {
    return null
  }

  private getWarning(): string {
    const { props } = this
    const effectCount = props['effect-data'] || 0
    const hasGradient = [props['fill-paint-data'], props['stroke-paint-data']]
      .filter(Boolean)
      .find((paint) => paint.includes('linear-gradient'))

    const unsupported: string[] = []

    if (effectCount) {
      unsupported.push('effects')
    }

    if (hasGradient) {
      unsupported.push('gradients')
    }

    if (!unsupported.length) {
      return ''
    }

    return `The node has ${unsupported.join(' and ')} on it, which are not fully supported in quirks mode codegen.`
  }

  // Unsupported CSS properties:
  // - background-blend-mode
  // - box-shadow
  // - filter
  // - backdrop-filter
  private getStyles(): Record<string, string> {
    const { props } = this
    const result: Record<string, string> = {}

    const [width, height] = props.size!
    Object.assign(result, {
      width: `${toDecimalPlace(width)}px`,
      height: `${toDecimalPlace(height)}px`
    })

    const maxSize = props['max-size']
    if (maxSize) {
      const [width, height] = maxSize
      Object.assign(result, {
        ...(width !== Infinity ? { 'max-width': `${toDecimalPlace(width)}px` } : {}),
        ...(height !== Infinity ? { 'max-height': `${toDecimalPlace(height)}px` } : {})
      })
    }

    const minSize = props['min-size']
    if (minSize) {
      const [width, height] = minSize
      Object.assign(result, {
        ...(width !== 0 ? { 'min-width': `${toDecimalPlace(width)}px` } : {}),
        ...(height !== 0 ? { 'min-height': `${toDecimalPlace(height)}px` } : {})
      })
    }

    const opacity = props.opacity
    if (opacity !== 1) {
      result.opacity = `${toDecimalPlace(opacity, 4)}`
    }

    const blendMode = props['blend-mode']
    if (blendMode !== 'pass-through') {
      result['mix-blend-mode'] = blendMode
    }

    const fill = props['fill-paint-data']
    if (fill) {
      if (isShape(this.type)) {
        result.fill = fill
      } else {
        result.background = fill
      }
    }

    return {
      ...result,
      ...this.getFlex(),
      ...this.getFlexItem(),
      ...(isShape(this.type) ? this.getStroke() : this.getBorders()),
      ...this.getBorderRadius()
    }
  }

  private getFlex(): Record<string, string> | null {
    const { props } = this
    const mode = props['stack-mode']
    if (!mode || mode === 'none') {
      return null
    }

    const widthSizing = props[mode === 'column' ? 'stack-counter-sizing' : 'stack-primary-sizing']

    const result: Record<string, string> = {
      display: widthSizing === 'hug' ? 'inline-flex' : 'flex'
    }

    if (mode === 'column') {
      result['flex-direction'] = 'column'
    }

    const wrap = props['stack-wrap']
    if (wrap === 'wrap') {
      result['flex-wrap'] = 'wrap'
    }

    const justify = props['stack-primary-align-items']
    if (justify && justify !== 'flex-start') {
      result['justify-content'] = justify
    }

    if (justify !== 'space-between') {
      const gapMain = toDecimalPlace(props['stack-spacing'] || 0)
      const gapAxis = toDecimalPlace(props['stack-counter-spacing'] || 0)
      if (gapMain !== 0 && gapAxis !== 0) {
        result.gap = gapMain === gapAxis ? `${gapMain}px` : `${gapMain}px ${gapAxis}px`
      }
    }

    const align = props['stack-counter-align-items']
    result['align-items'] = align || 'flex-start'
    if (wrap === 'wrap') {
      result['align-content'] = result['align-items']
    }

    const paddingTop = toDecimalPlace(props['stack-padding-top'] || 0)
    const paddingRight = toDecimalPlace(props['stack-padding-right'] || 0)
    const paddingBottom = toDecimalPlace(props['stack-padding-bottom'] || 0)
    const paddingLeft = toDecimalPlace(props['stack-padding-left'] || 0)

    if (
      paddingTop === paddingBottom &&
      paddingTop === paddingRight &&
      paddingTop === paddingLeft &&
      paddingTop !== 0
    ) {
      result.padding = `${paddingTop}px`
    } else if (paddingTop === paddingBottom && paddingRight === paddingLeft) {
      result.padding = `${paddingTop}px ${paddingRight}px`
    } else {
      result.padding = `${paddingTop}px ${paddingRight}px ${paddingBottom}px ${paddingLeft}px`
    }

    return result
  }

  private getFlexItem(): Record<string, string> | null {
    const { props } = this

    const result: Record<string, string> = {}

    const { parent } = this

    const parentFlex = parent?.getFlex()
    const position = props['stack-positioning']

    if (parent?.props.size && (position === 'absolute' || !parentFlex)) {
      const hConstraint = props['horizontal-constraint']
      const vConstraint = props['vertical-constraint']

      const matrix = props['relative-transform']
      const { e: left, f: top } = matrix

      const [width, height] = props.size!
      const [parentWidth, parentHeight] = parent.props.size

      const right = parentWidth - width - left
      const bottom = parentHeight - height - top

      const [l, t, r, b] = [left, top, right, bottom].map((v) => toDecimalPlace(v))

      result.position = 'absolute'

      switch (hConstraint) {
        case 'min':
          result.left = `${l}px`
          break
        case 'max':
          result.right = `${r}px`
          break
        case 'center':
          result.left = `calc(50% - ${toDecimalPlace(width / 2 + (parentWidth / 2 - width / 2 - left))}px)`
          break
        case 'stretch':
          result.left = `${l}px`
          result.right = `${r}px`
          break
        case 'scale':
          result.left = `${toDecimalPlace((left / parentWidth) * 100)}%`
          result.right = `${toDecimalPlace((right / parentWidth) * 100)}%`
          break
      }

      switch (vConstraint) {
        case 'min':
          result.top = `${t}px`
          break
        case 'max':
          result.bottom = `${b}px`
          break
        case 'center':
          result.top = `calc(50% - ${toDecimalPlace(height / 2 + (parentHeight / 2 - height / 2 - top))}px)`
          break
        case 'stretch':
          result.top = `${t}px`
          result.bottom = `${b}px`
          break
        case 'scale':
          result.top = `${toDecimalPlace((t / parentHeight) * 100)}%`
          result.bottom = `${toDecimalPlace((b / parentHeight) * 100)}%`
          break
      }
    }

    if (!parentFlex) {
      return result
    }

    const grow = props['stack-child-primary-grow'] || 0
    const align = props['stack-child-align-self'] || 'auto'
    const direction = parentFlex['flex-direction'] || 'row'

    if (grow === 1) {
      result.flex = '1 0 0'
    } else if (align === 'auto') {
      result['flex-shrink'] = '0'
    }

    if (align === 'stretch') {
      result['align-self'] = 'stretch'
    }

    if (direction === 'row') {
      if (grow === 1) {
        result.width = ''
      }
      if (align === 'stretch') {
        result.height = ''
      }
    } else {
      if (grow === 1) {
        result.height = ''
      }
      if (align === 'stretch') {
        result.width = ''
      }
    }

    return result
  }

  private getStroke(): Record<string, string> | null {
    const { props } = this

    const strokeWidth = toDecimalPlace(props['stroke-weight'] || 0)
    if (!strokeWidth) {
      return null
    }
    const strokeColor = props['stroke-paint-data']
    return {
      'stroke-width': `${strokeWidth}px`,
      stroke: strokeColor
    }
  }

  private getBorders(): Record<string, string> | null {
    const { props } = this

    if (this.type === 'VECTOR') {
    }

    const borderTopWidth = props['border-top-weight']
    if (!borderTopWidth) {
      return null
    }

    const borderStyle = props['stroke-dash-pattern'].length ? 'dashed' : 'solid'
    const borderColor = props['stroke-paint-data']

    if (!props['border-stroke-weights-independent']) {
      const borderWidth = toDecimalPlace(borderTopWidth)
      if (!borderWidth) {
        return null
      }
      return {
        border: `${borderWidth}px ${borderStyle} ${borderColor}`
      }
    }

    const topWidth = toDecimalPlace(borderTopWidth)
    const rightWidth = toDecimalPlace(props['border-right-weight'] || 0)
    const bottomWidth = toDecimalPlace(props['border-bottom-weight'] || 0)
    const leftWidth = toDecimalPlace(props['border-left-weight'] || 0)

    return {
      'border-top': `${topWidth}px ${borderStyle} ${borderColor}`,
      'border-right': `${rightWidth}px ${borderStyle} ${borderColor}`,
      'border-bottom': `${bottomWidth}px ${borderStyle} ${borderColor}`,
      'border-left': `${leftWidth}px ${borderStyle} ${borderColor}`
    }
  }

  private getBorderRadius(): Record<string, string> | null {
    const { props } = this
    if (!props['rectangle-corner-radii-independent']) {
      const borderRadius = toDecimalPlace(props['rectangle-top-left-corner-radius'] || 0)
      if (!borderRadius) {
        return null
      }
      return {
        'border-radius': `${borderRadius}px`
      }
    }

    const topLeft = toDecimalPlace(props['rectangle-top-left-corner-radius'] || 0)
    const topRight = toDecimalPlace(props['rectangle-top-right-corner-radius'] || 0)
    const bottomLeft = toDecimalPlace(props['rectangle-bottom-left-corner-radius'] || 0)
    const bottomRight = toDecimalPlace(props['rectangle-bottom-right-corner-radius'] || 0)

    return {
      'border-radius': `${topLeft}px ${topRight}px ${bottomRight}px ${bottomLeft}px`
    }
  }
}

export class GhostNode {
  name: string = '-'

  async getCSSAsync() {
    return {} as Record<string, string>
  }
}

export function createQuirksSelection(): (QuirksNode | GhostNode)[] {
  const log = window.DebuggingHelpers.logSelected()

  // selected node is document or canvas, means no selection
  if (log.startsWith('logging node state for 0:')) {
    return []
  }

  const nodeLogs = log.split(/\n*logging node state for \d+:\d+\n*/).filter(Boolean)

  if (nodeLogs.length > 1) {
    // multiple nodes are selected, no need to parse
    return Array.from({ length: nodeLogs.length }, () => new GhostNode())
  }

  return [parseLog(nodeLogs[0]) as QuirksNode]
}
