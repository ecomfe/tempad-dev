import type { CanvasFigmaEffect } from '@tempad-dev/shared'

import {
  TAILWIND_ALIGN_ITEMS,
  TAILWIND_FONT_WEIGHTS,
  TAILWIND_JUSTIFY_CONTENT,
  TAILWIND_TEXT_ALIGN,
  TAILWIND_TEXT_CASE,
  TAILWIND_TEXT_DECORATION
} from '@/utils/tailwind-semantics'

import type { CanvasGridTrack, CanvasSizingMode } from './model'

export const MAX_GRID_TRACKS = 100

const BLEND_MODES = {
  'pass-through': 'PASS_THROUGH',
  normal: 'NORMAL',
  darken: 'DARKEN',
  multiply: 'MULTIPLY',
  'plus-darker': 'LINEAR_BURN',
  'color-burn': 'COLOR_BURN',
  lighten: 'LIGHTEN',
  screen: 'SCREEN',
  'plus-lighter': 'LINEAR_DODGE',
  'color-dodge': 'COLOR_DODGE',
  overlay: 'OVERLAY',
  'soft-light': 'SOFT_LIGHT',
  'hard-light': 'HARD_LIGHT',
  difference: 'DIFFERENCE',
  exclusion: 'EXCLUSION',
  hue: 'HUE',
  saturation: 'SATURATION',
  color: 'COLOR',
  luminosity: 'LUMINOSITY'
} as const satisfies Record<string, BlendMode>
const BORDER_SIDES = {
  t: 'top',
  r: 'right',
  b: 'bottom',
  l: 'left'
} as const
const BORDER_AXES = {
  x: ['left', 'right'],
  y: ['top', 'bottom']
} as const
const CORNERS = {
  tl: 'topLeft',
  tr: 'topRight',
  br: 'bottomRight',
  bl: 'bottomLeft'
} as const
const CORNER_GROUPS = {
  t: ['topLeft', 'topRight'],
  r: ['topRight', 'bottomRight'],
  b: ['bottomLeft', 'bottomRight'],
  l: ['topLeft', 'bottomLeft']
} as const
const GRID_ALIGNMENTS = {
  auto: 'AUTO',
  start: 'MIN',
  center: 'CENTER',
  end: 'MAX'
} as const
const ITEM_ALIGNMENTS = {
  'flex-start': 'MIN',
  center: 'CENTER',
  'flex-end': 'MAX',
  baseline: 'BASELINE'
} as const
const JUSTIFY_ALIGNMENTS = {
  'flex-start': 'MIN',
  center: 'CENTER',
  'flex-end': 'MAX',
  'space-between': 'SPACE_BETWEEN'
} as const
const PADDING_SIDES = {
  p: ['top', 'right', 'bottom', 'left'],
  px: ['left', 'right'],
  py: ['top', 'bottom'],
  pt: ['top'],
  pr: ['right'],
  pb: ['bottom'],
  pl: ['left']
} as const
const FONT_STYLES = {
  '100': 'Thin',
  '200': 'Extra Light',
  '300': 'Light',
  '400': 'Regular',
  '500': 'Medium',
  '600': 'Semi Bold',
  '700': 'Bold',
  '800': 'Extra Bold',
  '900': 'Black'
} as const
const FONT_SIZES = {
  xs: [12, 16],
  sm: [14, 20],
  base: [16, 24],
  lg: [18, 28],
  xl: [20, 28],
  '2xl': [24, 32],
  '3xl': [30, 36],
  '4xl': [36, 40],
  '5xl': [48, 48],
  '6xl': [60, 60],
  '7xl': [72, 72],
  '8xl': [96, 96],
  '9xl': [128, 128]
} as const
const LINE_HEIGHTS = {
  none: 100,
  tight: 125,
  snug: 137.5,
  normal: 150,
  relaxed: 162.5,
  loose: 200
} as const
const LETTER_SPACINGS = {
  tighter: -5,
  tight: -2.5,
  normal: 0,
  wide: 2.5,
  wider: 5,
  widest: 10
} as const
const RADII = {
  none: 0,
  xs: 2,
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  '2xl': 16,
  '3xl': 24,
  '4xl': 32,
  full: 9999
} as const
const CONTAINER_WIDTHS = {
  '3xs': 256,
  '2xs': 288,
  xs: 320,
  sm: 384,
  md: 448,
  lg: 512,
  xl: 576,
  '2xl': 672,
  '3xl': 768,
  '4xl': 896,
  '5xl': 1024,
  '6xl': 1152,
  '7xl': 1280
} as const
const TEXT_ALIGNMENTS = {
  left: 'LEFT',
  center: 'CENTER',
  right: 'RIGHT',
  justify: 'JUSTIFIED'
} as const
const TEXT_CASES = {
  none: 'ORIGINAL',
  uppercase: 'UPPER',
  lowercase: 'LOWER',
  capitalize: 'TITLE'
} as const
const TEXT_DECORATIONS = {
  none: 'NONE',
  underline: 'UNDERLINE',
  'line-through': 'STRIKETHROUGH'
} as const
type CanvasShadowEffect = Extract<CanvasFigmaEffect, { type: 'DROP_SHADOW' | 'INNER_SHADOW' }>

const SHADOW_FAMILIES = {
  shadow: { field: 'boxShadows', options: {} },
  'inset-shadow': {
    field: 'insetShadows',
    options: { type: 'INNER_SHADOW' as const }
  },
  'text-shadow': {
    field: 'textShadows',
    options: { type: 'DROP_SHADOW' as const, text: true }
  }
} as const

function classValues(values: Record<string, string>, prefix = ''): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([value, suffix]) => [`${prefix}${suffix}`, value])
  )
}

const ALIGN_ITEM_CLASSES = classValues(TAILWIND_ALIGN_ITEMS, 'items-')
const JUSTIFY_CONTENT_CLASSES = classValues(TAILWIND_JUSTIFY_CONTENT, 'justify-')
const FONT_WEIGHT_CLASSES = classValues(TAILWIND_FONT_WEIGHTS, 'font-')
const TEXT_ALIGN_CLASSES = classValues(TAILWIND_TEXT_ALIGN, 'text-')
const TEXT_CASE_CLASSES = classValues(TAILWIND_TEXT_CASE)
const TEXT_DECORATION_CLASSES = classValues(TAILWIND_TEXT_DECORATION)

type AxisSize = {
  mode: CanvasSizingMode
  value?: number
}

export type CanvasClasses = {
  width?: AxisSize
  height?: AxisSize
  minWidth?: number | null
  maxWidth?: number | null
  minHeight?: number | null
  maxHeight?: number | null
  flex: boolean
  direction?: 'HORIZONTAL' | 'VERTICAL'
  grid: boolean
  gridColumns?: CanvasGridTrack[]
  gridRows?: CanvasGridTrack[]
  gridFlow?: 'MANUAL' | 'ROW_AUTO_FLOW'
  gridColumn?: number
  gridRow?: number
  gridColumnSpan?: number
  gridRowSpan?: number
  gridHorizontalAlign?: 'AUTO' | 'CENTER' | 'MAX' | 'MIN'
  gridVerticalAlign?: 'AUTO' | 'CENTER' | 'MAX' | 'MIN'
  grow?: boolean
  gap?: number
  columnGap?: number
  rowGap?: number
  padding: Partial<Record<'bottom' | 'left' | 'right' | 'top', number>>
  primaryAlign?: 'CENTER' | 'MAX' | 'MIN' | 'SPACE_BETWEEN'
  counterAlign?: 'BASELINE' | 'CENTER' | 'MAX' | 'MIN'
  counterAlignContent?: 'AUTO' | 'SPACE_BETWEEN'
  wrap?: 'NO_WRAP' | 'WRAP'
  strokesIncluded?: boolean
  absolute?: boolean
  left?: number
  top?: number
  fill?: `#${string}` | null
  stroke?: `#${string}`
  strokeWeight?: number
  strokeWeights: Partial<Record<'bottom' | 'left' | 'right' | 'top', number>>
  cornerRadius?: number
  cornerRadii: Partial<Record<'bottomLeft' | 'bottomRight' | 'topLeft' | 'topRight', number>>
  clipsContent?: boolean
  opacity?: number
  visible?: boolean
  blendMode?: BlendMode
  rotation?: number
  boxShadows?: CanvasShadowEffect[]
  insetShadows?: CanvasShadowEffect[]
  textShadows?: CanvasShadowEffect[]
  fontFamily?: string
  fontStyle?: string
  fontSize?: number
  lineHeight?: LineHeight
  letterSpacing?: LetterSpacing
  textAlign?: 'CENTER' | 'JUSTIFIED' | 'LEFT' | 'RIGHT'
  textCase?: TextCase
  textDecoration?: TextDecoration
  textTruncation?: 'DISABLED' | 'ENDING'
  maxLines?: number | null
  preserveWhitespace?: boolean
  frameClass?: string
  gridChildClass?: string
  layoutClass?: string
  textClass?: string
  assigned: Set<string>
}

function classError(message: string): never {
  throw new Error(message)
}

function finiteNumber(
  raw: string,
  token: string,
  options: { allowNegative?: boolean; positive?: boolean } = {}
): number {
  const value = Number(raw)
  if (
    !Number.isFinite(value) ||
    (options.positive ? value <= 0 : !options.allowNegative && value < 0)
  ) {
    classError(`Invalid numeric class "${token}".`)
  }
  return value
}

function pixels(
  raw: string,
  token: string,
  options: { allowNegative?: boolean; numericScale?: number } = {}
): number | null {
  const arbitrary = /^\[(-?(?:\d+(?:\.\d+)?|\.\d+))px\]$/.exec(raw)
  if (arbitrary) {
    return finiteNumber(arbitrary[1]!, token, { allowNegative: options.allowNegative })
  }
  if (raw === 'px') return 1
  if (options.numericScale === undefined || !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw)) {
    return null
  }
  return finiteNumber(raw, token) * options.numericScale
}

function fixedSize(raw: string, token: string, containers = false): number | null {
  const value = pixels(raw, token, { numericScale: 4 })
  if (value !== null) return value
  return containers ? (CONTAINER_WIDTHS[raw as keyof typeof CONTAINER_WIDTHS] ?? null) : null
}

function radius(raw: string, token: string): number | null {
  const arbitrary = pixels(raw, token)
  if (arbitrary !== null) return arbitrary
  return RADII[raw as keyof typeof RADII] ?? null
}

function color(raw: string): `#${string}` | null {
  if (raw === 'white') return '#FFFFFF'
  if (raw === 'black') return '#000000'
  const arbitrary = /^\[(#(?:[\dA-Fa-f]{3}|[\dA-Fa-f]{4}|[\dA-Fa-f]{6}|[\dA-Fa-f]{8}))\]$/.exec(raw)
  return (arbitrary?.[1] as `#${string}` | undefined) ?? null
}

function splitShadowValue(value: string, separator: ',' | ' '): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!
    if (character === '(') depth += 1
    else if (character === ')') depth -= 1
    else if (depth === 0 && (separator === ',' ? character === ',' : /\s/.test(character))) {
      const part = value.slice(start, index).trim()
      if (part) parts.push(part)
      start = index + 1
    }
  }
  const part = value.slice(start).trim()
  if (part) parts.push(part)
  return parts
}

function cssChannel(raw: string): number | null {
  const percentage = /^(\d+(?:\.\d+)?|\.\d+)%$/.exec(raw)
  const value = percentage ? Number(percentage[1]) / 100 : Number(raw) / 255
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null
}

function cssAlpha(raw: string): number | null {
  const percentage = /^(\d+(?:\.\d+)?|\.\d+)%$/.exec(raw)
  const value = percentage ? Number(percentage[1]) / 100 : Number(raw)
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null
}

function cssColor(raw: string): RGBA | null {
  if (raw === 'black') return { r: 0, g: 0, b: 0, a: 1 }
  if (raw === 'white') return { r: 1, g: 1, b: 1, a: 1 }
  if (raw === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }

  const hex = /^#([\dA-Fa-f]{3}|[\dA-Fa-f]{4}|[\dA-Fa-f]{6}|[\dA-Fa-f]{8})$/.exec(raw)
  if (hex) {
    const compact = hex[1]!
    const expanded =
      compact.length < 6 ? [...compact].map((character) => character.repeat(2)).join('') : compact
    return {
      r: Number.parseInt(expanded.slice(0, 2), 16) / 255,
      g: Number.parseInt(expanded.slice(2, 4), 16) / 255,
      b: Number.parseInt(expanded.slice(4, 6), 16) / 255,
      a: expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1
    }
  }

  const functional = /^rgba?\((.*)\)$/.exec(raw)
  if (!functional) return null
  const body = functional[1]!.trim()
  let channels: string[]
  let alpha = '1'
  if (body.includes(',')) {
    const parts = body.split(',').map((part) => part.trim())
    if (parts.length !== 3 && parts.length !== 4) return null
    channels = parts.slice(0, 3)
    alpha = parts[3] ?? alpha
  } else {
    const [channelValue, alphaValue, ...rest] = body.split('/').map((part) => part.trim())
    if (rest.length || !channelValue || (!alphaValue && body.includes('/'))) return null
    channels = channelValue.split(/\s+/)
    alpha = alphaValue ?? alpha
  }
  if (channels.length !== 3) return null
  const r = cssChannel(channels[0]!)
  const g = cssChannel(channels[1]!)
  const b = cssChannel(channels[2]!)
  const a = cssAlpha(alpha)
  return r === null || g === null || b === null || a === null ? null : { r, g, b, a }
}

function shadowLength(raw: string): number | null {
  if (/^-?0(?:\.0+)?$/.test(raw)) return 0
  const match = /^(-?(?:\d+(?:\.\d+)?|\.\d+))px$/.exec(raw)
  return match ? Number(match[1]) : null
}

function parseShadowEffects(
  raw: string,
  token: string,
  options: { type?: CanvasShadowEffect['type']; text?: boolean } = {}
): CanvasShadowEffect[] {
  const layers = splitShadowValue(raw.replaceAll('_', ' '), ',')
  if (!layers.length) classError(`Invalid shadow class "${token}".`)
  return layers.map((layer) => {
    const values: number[] = []
    let color: RGBA | undefined
    let inset = false
    for (const part of splitShadowValue(layer, ' ')) {
      if (part === 'inset') {
        if (options.text || inset || options.type === 'DROP_SHADOW') {
          classError(`Invalid shadow class "${token}".`)
        }
        inset = true
        continue
      }
      const parsedColor = cssColor(part)
      if (parsedColor) {
        if (color) classError(`Shadow class "${token}" has more than one color per layer.`)
        color = parsedColor
        continue
      }
      const length = shadowLength(part)
      if (length === null) classError(`Invalid shadow value "${part}" in class "${token}".`)
      values.push(length)
    }

    const maximum = options.text ? 3 : 4
    if (values.length < 2 || values.length > maximum || !color || (values[2] ?? 0) < 0) {
      classError(
        `Shadow class "${token}" requires a color and ${options.text ? 'two or three' : 'two to four'} px lengths per layer.`
      )
    }
    return {
      type: options.type ?? (inset ? 'INNER_SHADOW' : 'DROP_SHADOW'),
      color,
      offset: { x: values[0]!, y: values[1]! },
      radius: values[2] ?? 0,
      ...(values[3] === undefined ? {} : { spread: values[3] })
    } as CanvasShadowEffect
  })
}

function lineHeight(raw: string, token: string): LineHeight | null {
  const named = LINE_HEIGHTS[raw as keyof typeof LINE_HEIGHTS]
  if (named !== undefined) return { unit: 'PERCENT', value: named }
  const spacing = /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw)
    ? finiteNumber(raw, token, { positive: true }) * 4
    : null
  if (spacing !== null) return { unit: 'PIXELS', value: spacing }
  const arbitrary = /^\[((?:\d+(?:\.\d+)?|\.\d+))(px|%|)\]$/.exec(raw)
  if (!arbitrary) return null
  const value = finiteNumber(arbitrary[1]!, token, { positive: true })
  return arbitrary[2] === 'px'
    ? { unit: 'PIXELS', value }
    : { unit: 'PERCENT', value: arbitrary[2] === '%' ? value : value * 100 }
}

function textSize(
  raw: string,
  token: string
): { defaultLineHeight?: LineHeight; value: number } | null {
  const named = FONT_SIZES[raw as keyof typeof FONT_SIZES]
  if (named) {
    return { value: named[0], defaultLineHeight: { unit: 'PIXELS', value: named[1] } }
  }
  const arbitrary = /^\[((?:\d+(?:\.\d+)?|\.\d+))px\]$/.exec(raw)
  if (!arbitrary) return null
  const value = finiteNumber(arbitrary[1]!, token, { positive: true })
  if (value < 1) classError(`Font-size class "${token}" must be at least 1px.`)
  return { value }
}

function assignIndividuals<Key extends string>(
  classes: CanvasClasses,
  group: string,
  values: Partial<Record<Key, number>>,
  fields: readonly Key[],
  value: number,
  token: string
): void {
  for (const field of fields) {
    const assignment = `${group}-${field}`
    if (classes.assigned.has(assignment)) {
      classError(`Class "${token}" conflicts with another ${assignment} class.`)
    }
  }
  for (const field of fields) {
    classes.assigned.add(`${group}-${field}`)
    values[field] = value
  }
}

function assign<T extends keyof CanvasClasses>(
  classes: CanvasClasses,
  field: T,
  value: CanvasClasses[T],
  token: string
): void {
  if (classes.assigned.has(field)) {
    const hint =
      field === 'fill'
        ? ' Use one fill class per node; a label with a background needs a parent div and a child span for its text color.'
        : ''
    classError(`Class "${token}" conflicts with another ${field} class.${hint}`)
  }
  classes.assigned.add(field)
  classes[field] = value
}

function assignPadding(
  classes: CanvasClasses,
  sides: ReadonlyArray<'bottom' | 'left' | 'right' | 'top'>,
  value: number,
  token: string
): void {
  for (const side of sides) {
    const field = `padding-${side}`
    if (classes.assigned.has(field)) {
      classError(`Class "${token}" conflicts with another ${field} class.`)
    }
  }
  for (const side of sides) {
    classes.assigned.add(`padding-${side}`)
    classes.padding[side] = value
  }
  classes.layoutClass ??= token
}

function parseGridTracks(raw: string, token: string): CanvasGridTrack[] {
  const tracks = raw.split('_').map((value): CanvasGridTrack => {
    if (value === 'fit-content(100%)') return { type: 'HUG' }
    const match = /^(\d+(?:\.\d+)?)(fr|px)$/.exec(value)
    if (!match) classError(`Invalid grid track in class "${token}".`)
    return {
      type: match[2] === 'fr' ? 'FLEX' : 'FIXED',
      value: finiteNumber(match[1]!, token, { positive: match[2] === 'fr' })
    }
  })
  if (!tracks.length || tracks.length > MAX_GRID_TRACKS) {
    classError(`Grid class "${token}" must contain 1 to ${MAX_GRID_TRACKS} tracks.`)
  }
  return tracks
}

export function parseCanvasClasses(value: string): CanvasClasses {
  const classes: CanvasClasses = {
    flex: false,
    grid: false,
    cornerRadii: {},
    padding: {},
    strokeWeights: {},
    assigned: new Set()
  }
  let defaultLineHeight: LineHeight | undefined
  const tokens = value.trim() ? value.trim().split(/\s+/) : []
  for (const token of tokens) {
    if (token === 'flex') {
      assign(classes, 'flex', true, token)
      classes.layoutClass ??= token
      continue
    }
    if (token === 'grid') {
      assign(classes, 'grid', true, token)
      classes.layoutClass ??= token
      continue
    }
    if (token === 'flex-row' || token === 'flex-col') {
      assign(classes, 'direction', token === 'flex-row' ? 'HORIZONTAL' : 'VERTICAL', token)
      classes.layoutClass ??= token
      continue
    }
    if (token === 'grow' || token === 'grow-0') {
      assign(classes, 'grow', token === 'grow', token)
      continue
    }
    if (token === 'hidden' || token === 'visible') {
      assign(classes, 'visible', token === 'visible', token)
      continue
    }
    if (token.startsWith('mix-blend-')) {
      const name = token.slice('mix-blend-'.length)
      const blendMode = BLEND_MODES[name as keyof typeof BLEND_MODES]
      if (!blendMode) classError(`Unsupported blend mode class "${token}".`)
      assign(classes, 'blendMode', blendMode, token)
      continue
    }
    const rotation =
      /^(-)?rotate-(?:\[(-?(?:\d+(?:\.\d+)?|\.\d+))deg\]|((?:\d+(?:\.\d+)?|\.\d+)))$/.exec(token)
    if (rotation) {
      const raw = rotation[2] ?? rotation[3]!
      if (rotation[1] && raw.startsWith('-')) classError(`Invalid numeric class "${token}".`)
      const value = finiteNumber(raw, token, { allowNegative: true })
      assign(classes, 'rotation', rotation[1] ? value : -value, token)
      continue
    }
    if (token === 'rotate-none') {
      assign(classes, 'rotation', 0, token)
      continue
    }
    const simpleGridTracks = /^grid-(cols|rows)-(\d+)$/.exec(token)
    if (simpleGridTracks) {
      const count = Number(simpleGridTracks[2])
      if (!Number.isSafeInteger(count) || count < 1 || count > MAX_GRID_TRACKS) {
        classError(`Grid class "${token}" must contain 1 to ${MAX_GRID_TRACKS} tracks.`)
      }
      assign(
        classes,
        simpleGridTracks[1] === 'cols' ? 'gridColumns' : 'gridRows',
        Array.from({ length: count }, () => ({ type: 'FLEX', value: 1 })),
        token
      )
      classes.layoutClass ??= token
      continue
    }
    const arbitraryGridTracks = /^grid-(cols|rows)-\[(.+)\]$/.exec(token)
    if (arbitraryGridTracks) {
      assign(
        classes,
        arbitraryGridTracks[1] === 'cols' ? 'gridColumns' : 'gridRows',
        parseGridTracks(arbitraryGridTracks[2]!, token),
        token
      )
      classes.layoutClass ??= token
      continue
    }
    if (token === 'grid-flow-row' || token === 'grid-flow-none') {
      assign(classes, 'gridFlow', token === 'grid-flow-row' ? 'ROW_AUTO_FLOW' : 'MANUAL', token)
      classes.layoutClass ??= token
      continue
    }
    const gridPosition = /^(col|row)-(start|span)-(\d+)$/.exec(token)
    if (gridPosition) {
      const value = Number(gridPosition[3])
      if (!Number.isSafeInteger(value) || value < 1) {
        classError(`Invalid grid placement class "${token}".`)
      }
      const field =
        gridPosition[1] === 'col'
          ? gridPosition[2] === 'start'
            ? 'gridColumn'
            : 'gridColumnSpan'
          : gridPosition[2] === 'start'
            ? 'gridRow'
            : 'gridRowSpan'
      assign(classes, field, gridPosition[2] === 'start' ? value - 1 : value, token)
      classes.gridChildClass ??= token
      continue
    }
    const gridAlignment = /^(justify-self|self)-(auto|start|center|end)$/.exec(token)
    if (gridAlignment) {
      assign(
        classes,
        gridAlignment[1] === 'justify-self' ? 'gridHorizontalAlign' : 'gridVerticalAlign',
        GRID_ALIGNMENTS[gridAlignment[2] as keyof typeof GRID_ALIGNMENTS],
        token
      )
      classes.gridChildClass ??= token
      continue
    }
    if (token === 'absolute' || token === 'static') {
      assign(classes, 'absolute', token === 'absolute', token)
      continue
    }
    const inset = /^(-)?(left|top)-(.+)$/.exec(token)
    if (inset) {
      const value = pixels(inset[3]!, token, { allowNegative: !inset[1], numericScale: 4 })
      if (value === null) classError(`Unsupported class "${token}".`)
      assign(classes, inset[2] as 'left' | 'top', inset[1] ? -value : value, token)
      continue
    }

    const size = /^size-(.+)$/.exec(token)
    if (size) {
      if (size[1] === 'fit' || size[1] === 'full') {
        const mode = size[1] === 'fit' ? 'HUG' : 'FILL'
        assign(classes, 'width', { mode }, token)
        assign(classes, 'height', { mode }, token)
        continue
      }
      const value = fixedSize(size[1]!, token)
      if (value === null) classError(`Unsupported class "${token}".`)
      assign(classes, 'width', { mode: 'FIXED', value }, token)
      assign(classes, 'height', { mode: 'FIXED', value }, token)
      continue
    }
    const fluidSize = /^(w|h)-(fit|full)$/.exec(token)
    if (fluidSize) {
      const axis = fluidSize[1] === 'w' ? 'width' : 'height'
      assign(classes, axis, { mode: fluidSize[2] === 'fit' ? 'HUG' : 'FILL' }, token)
      continue
    }
    const boundedSize = /^(min|max)-(w|h)-(.+)$/.exec(token)
    if (boundedSize) {
      const field = `${boundedSize[1]}${boundedSize[2] === 'w' ? 'Width' : 'Height'}` as
        | 'maxHeight'
        | 'maxWidth'
        | 'minHeight'
        | 'minWidth'
      const value =
        boundedSize[3] === 'none' ? null : fixedSize(boundedSize[3]!, token, boundedSize[2] === 'w')
      if (value === null && boundedSize[3] !== 'none') {
        classError(`Unsupported class "${token}".`)
      }
      assign(classes, field, value, token)
      continue
    }
    const axisSize = /^(w|h)-(.+)$/.exec(token)
    if (axisSize) {
      const value = fixedSize(axisSize[2]!, token, axisSize[1] === 'w')
      if (value === null) classError(`Unsupported class "${token}".`)
      assign(classes, axisSize[1] === 'w' ? 'width' : 'height', { mode: 'FIXED', value }, token)
      continue
    }

    const gap = /^gap(?:-(x|y))?-(.+)$/.exec(token)
    if (gap) {
      const field = gap[1] === 'x' ? 'columnGap' : gap[1] === 'y' ? 'rowGap' : 'gap'
      const value = pixels(gap[2]!, token, { numericScale: 4 })
      if (value === null) classError(`Unsupported class "${token}".`)
      assign(classes, field, value, token)
      classes.layoutClass ??= token
      continue
    }
    const padding = /^(p|px|py|pt|pr|pb|pl)-(.+)$/.exec(token)
    if (padding) {
      const value = pixels(padding[2]!, token, { numericScale: 4 })
      if (value === null) classError(`Unsupported class "${token}".`)
      assignPadding(classes, PADDING_SIDES[padding[1] as keyof typeof PADDING_SIDES], value, token)
      continue
    }

    const itemAlignment = ALIGN_ITEM_CLASSES[token]
    const counterAlign = ITEM_ALIGNMENTS[itemAlignment as keyof typeof ITEM_ALIGNMENTS]
    if (counterAlign) {
      assign(classes, 'counterAlign', counterAlign, token)
      classes.layoutClass ??= token
      continue
    }
    const justifyContent = JUSTIFY_CONTENT_CLASSES[token]
    const primaryAlign = JUSTIFY_ALIGNMENTS[justifyContent as keyof typeof JUSTIFY_ALIGNMENTS]
    if (primaryAlign) {
      assign(classes, 'primaryAlign', primaryAlign, token)
      classes.layoutClass ??= token
      continue
    }
    if (token === 'flex-wrap' || token === 'flex-nowrap') {
      assign(classes, 'wrap', token === 'flex-wrap' ? 'WRAP' : 'NO_WRAP', token)
      classes.layoutClass ??= token
      continue
    }
    if (token === 'content-between' || token === 'content-normal') {
      assign(
        classes,
        'counterAlignContent',
        token === 'content-between' ? 'SPACE_BETWEEN' : 'AUTO',
        token
      )
      classes.layoutClass ??= token
      continue
    }
    if (token === 'box-border' || token === 'box-content') {
      assign(classes, 'strokesIncluded', token === 'box-border', token)
      classes.layoutClass ??= token
      continue
    }

    if (token === 'bg-transparent') {
      assign(classes, 'fill', null, token)
      classes.frameClass ??= token
      continue
    }
    if (token === 'overflow-hidden' || token === 'overflow-visible') {
      assign(classes, 'clipsContent', token === 'overflow-hidden', token)
      classes.frameClass ??= token
      continue
    }
    const fill = /^bg-(.+)$/.exec(token)
    if (fill) {
      const value = color(fill[1]!)
      if (value) {
        assign(classes, 'fill', value, token)
        classes.frameClass ??= token
        continue
      }
    }
    if (token === 'border') {
      assign(classes, 'strokeWeight', 1, token)
      classes.frameClass ??= token
      continue
    }
    const borderSideWeight = /^border-(x|y|t|r|b|l)(?:-(.+))?$/.exec(token)
    if (borderSideWeight) {
      const value =
        borderSideWeight[2] === undefined
          ? 1
          : pixels(borderSideWeight[2], token, { numericScale: 1 })
      if (value === null) classError(`Unsupported class "${token}".`)
      const side = borderSideWeight[1] as keyof typeof BORDER_SIDES | keyof typeof BORDER_AXES
      const fields =
        side in BORDER_AXES
          ? BORDER_AXES[side as keyof typeof BORDER_AXES]
          : [BORDER_SIDES[side as keyof typeof BORDER_SIDES]]
      assignIndividuals(classes, 'stroke', classes.strokeWeights, fields, value, token)
      classes.frameClass ??= token
      continue
    }
    const borderWeight = /^border-(.+)$/.exec(token)
    if (borderWeight) {
      const width = pixels(borderWeight[1]!, token, { numericScale: 1 })
      if (width !== null) {
        assign(classes, 'strokeWeight', width, token)
        classes.frameClass ??= token
        continue
      }
      const stroke = color(borderWeight[1]!)
      if (stroke) {
        assign(classes, 'stroke', stroke, token)
        classes.frameClass ??= token
        continue
      }
    }
    if (token === 'rounded') {
      assign(classes, 'cornerRadius', 4, token)
      classes.frameClass ??= token
      continue
    }
    const cornerRadius = /^rounded-(t|r|b|l|tl|tr|br|bl)(?:-(.+))?$/.exec(token)
    if (cornerRadius) {
      const value = cornerRadius[2] === undefined ? 4 : radius(cornerRadius[2], token)
      if (value === null) classError(`Unsupported class "${token}".`)
      const corner = cornerRadius[1] as keyof typeof CORNERS | keyof typeof CORNER_GROUPS
      const fields =
        corner in CORNER_GROUPS
          ? CORNER_GROUPS[corner as keyof typeof CORNER_GROUPS]
          : [CORNERS[corner as keyof typeof CORNERS]]
      assignIndividuals(classes, 'corner', classes.cornerRadii, fields, value, token)
      classes.frameClass ??= token
      continue
    }
    const uniformRadius = /^rounded-(.+)$/.exec(token)
    if (uniformRadius) {
      const value = radius(uniformRadius[1]!, token)
      if (value !== null) {
        assign(classes, 'cornerRadius', value, token)
        classes.frameClass ??= token
        continue
      }
    }
    const opacity = /^opacity-(?:\[((?:\d+(?:\.\d+)?|\.\d+))\]|((?:\d+(?:\.\d+)?|\.\d+)))$/.exec(
      token
    )
    if (opacity) {
      const numeric = finiteNumber(opacity[1] ?? opacity[2]!, token) / (opacity[2] ? 100 : 1)
      if (numeric > 1) classError(`Opacity class "${token}" must be between 0 and 1.`)
      assign(classes, 'opacity', numeric, token)
      continue
    }

    const shadow = /^(shadow|inset-shadow|text-shadow)-(?:\[(.+)\]|none)$/.exec(token)
    if (shadow) {
      const family = SHADOW_FAMILIES[shadow[1] as keyof typeof SHADOW_FAMILIES]
      const effects = shadow[2] ? parseShadowEffects(shadow[2], token, family.options) : []
      assign(classes, family.field, effects, token)
      continue
    }
    if (/^(?:shadow|inset-shadow|text-shadow)-/.test(token)) {
      classError(
        `Shadow class "${token}" needs an exact bracketed value or "none"; use a native effect style or binding for a reusable token.`
      )
    }

    if (token === 'font-sans') {
      assign(classes, 'fontFamily', 'Inter', token)
      classes.textClass ??= token
      continue
    }
    if (token === 'whitespace-pre-wrap') {
      assign(classes, 'preserveWhitespace', true, token)
      classes.textClass ??= token
      continue
    }
    const fontWeight = FONT_WEIGHT_CLASSES[token]
    const fontStyle = FONT_STYLES[fontWeight as keyof typeof FONT_STYLES]
    if (fontStyle) {
      assign(classes, 'fontStyle', fontStyle, token)
      classes.textClass ??= token
      continue
    }
    const combinedTextSize = /^text-(\[[^\]]+\]|[^/]+)\/(.+)$/.exec(token)
    if (combinedTextSize) {
      const size = textSize(combinedTextSize[1]!, token)
      const leading = lineHeight(combinedTextSize[2]!, token)
      if (!size || !leading) classError(`Unsupported class "${token}".`)
      assign(classes, 'fontSize', size.value, token)
      assign(classes, 'lineHeight', leading, token)
      classes.textClass ??= token
      continue
    }
    const standaloneTextSize = /^text-(.+)$/.exec(token)
    if (standaloneTextSize) {
      const size = textSize(standaloneTextSize[1]!, token)
      if (size) {
        assign(classes, 'fontSize', size.value, token)
        defaultLineHeight = size.defaultLineHeight
        classes.textClass ??= token
        continue
      }
    }
    const leading = /^leading-(.+)$/.exec(token)
    if (leading) {
      const value = lineHeight(leading[1]!, token)
      if (value === null) classError(`Unsupported class "${token}".`)
      assign(classes, 'lineHeight', value, token)
      classes.textClass ??= token
      continue
    }
    const letterSpacing = /^tracking-(?:\[(-?(?:\d+(?:\.\d+)?|\.\d+))(px|%|em)\]|(\w+))$/.exec(
      token
    )
    if (letterSpacing) {
      const named = LETTER_SPACINGS[letterSpacing[3] as keyof typeof LETTER_SPACINGS]
      if (letterSpacing[3] && named === undefined) classError(`Unsupported class "${token}".`)
      const unit = letterSpacing[2]
      const value =
        named ??
        finiteNumber(letterSpacing[1]!, token, { allowNegative: true }) * (unit === 'em' ? 100 : 1)
      assign(
        classes,
        'letterSpacing',
        {
          unit: named !== undefined || unit === '%' || unit === 'em' ? 'PERCENT' : 'PIXELS',
          value
        },
        token
      )
      classes.textClass ??= token
      continue
    }
    const textAlign = TEXT_ALIGN_CLASSES[token]
    const textAlignment = TEXT_ALIGNMENTS[textAlign as keyof typeof TEXT_ALIGNMENTS]
    if (textAlignment) {
      assign(classes, 'textAlign', textAlignment, token)
      classes.textClass ??= token
      continue
    }
    const textTransform = TEXT_CASE_CLASSES[token]
    const textCase = TEXT_CASES[textTransform as keyof typeof TEXT_CASES]
    if (textCase) {
      assign(classes, 'textCase', textCase, token)
      classes.textClass ??= token
      continue
    }
    const decorationLine = TEXT_DECORATION_CLASSES[token]
    const textDecoration = TEXT_DECORATIONS[decorationLine as keyof typeof TEXT_DECORATIONS]
    if (textDecoration) {
      assign(classes, 'textDecoration', textDecoration, token)
      classes.textClass ??= token
      continue
    }
    if (token === 'truncate') {
      assign(classes, 'textTruncation', 'ENDING', token)
      assign(classes, 'maxLines', 1, token)
      classes.textClass ??= token
      continue
    }
    if (token === 'line-clamp-none') {
      assign(classes, 'textTruncation', 'DISABLED', token)
      assign(classes, 'maxLines', null, token)
      classes.textClass ??= token
      continue
    }
    const lineClamp = /^line-clamp-(\d+)$/.exec(token)
    if (lineClamp) {
      const maxLines = Number(lineClamp[1])
      if (!Number.isSafeInteger(maxLines) || maxLines < 1) {
        classError(`Invalid line clamp class "${token}".`)
      }
      assign(classes, 'textTruncation', 'ENDING', token)
      assign(classes, 'maxLines', maxLines, token)
      classes.textClass ??= token
      continue
    }
    const textColor = /^text-(.+)$/.exec(token)
    if (textColor) {
      const value = color(textColor[1]!)
      if (value) {
        assign(classes, 'fill', value, token)
        classes.textClass ??= token
        continue
      }
    }

    classError(`Unsupported class "${token}".`)
  }
  if (classes.flex && classes.direction === undefined) classes.direction = 'HORIZONTAL'
  classes.lineHeight ??= defaultLineHeight
  return classes
}
