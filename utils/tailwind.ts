/**
 * Style to Tailwind converter
 * Features:
 * - Deterministic output
 * - Config-driven architecture
 * - Hybrid value support (keywords + arbitrary values)
 * - Auto-normalization (variables, comments, units)
 * - Composite property support (smart flexbox)
 */

import { normalizeStyleValue } from '@/utils/css'

// Global regex patterns
const WHITESPACE = /\s+/
const ALL_WHITESPACE = /\s+/g
const COMMA_DELIMITER = /,\s*/g
const QUOTES = /['"]/g
const NUMBER = /^\d+(\.\d+)?$/

// Core types (strict discriminated unions)

export type Side = 't' | 'r' | 'b' | 'l'
export type Corner = 'tl' | 'tr' | 'br' | 'bl'
export type Axis = 'x' | 'y'
export type DirectField = 'v'

export type CollapseMode = 'side' | 'corner' | 'axis' | 'direct' | 'composite'

export type ValueKind = 'length' | 'color' | 'integer' | 'percent' | 'url' | 'any' | 'keyword'

export type PropDef = string | { prop: string; defaultValue?: string }
export type KeywordDef = string | [string, string]

// Base interface
interface FamilyConfigBase {
  prefix: string
  valueKind: ValueKind
  keywords?: KeywordDef[]
}

// Discriminated union: ensures props keys match the mode at compile time
interface SideFamily extends FamilyConfigBase {
  mode: 'side'
  props: Partial<Record<Side, PropDef>>
}

interface CornerFamily extends FamilyConfigBase {
  mode: 'corner'
  props: Partial<Record<Corner, PropDef>>
}

interface AxisFamily extends FamilyConfigBase {
  mode: 'axis'
  props: Partial<Record<Axis, PropDef>>
}

interface DirectFamily extends FamilyConfigBase {
  mode: 'direct'
  props: Partial<Record<DirectField, PropDef>>
}

// Composite mode for flex
interface AtomicFallback {
  prefix: string
  valueKind: ValueKind
}

interface CompositeFamily extends FamilyConfigBase {
  mode: 'composite'
  props: Record<string, string>
  composites: Array<{ match: Record<string, string>; suffix: string }>
  atomics: Record<string, AtomicFallback>
}

export type FamilyConfig = SideFamily | CornerFamily | AxisFamily | DirectFamily | CompositeFamily

// Runtime structures
interface PropertyLookup {
  familyKey: string
  field: string
  defaultValue?: string
}
interface FamilyBuffer {
  sides?: Partial<Record<Side, string>>
  corners?: Partial<Record<Corner, string>>
  axes?: Partial<Record<Axis, string>>
  composite?: Record<string, string>
  val?: string
}
interface FormattedValue {
  text: string
  isNegative: boolean
  isKeyword: boolean
}

// Type guards

function isSide(f: string): f is Side {
  return f === 't' || f === 'r' || f === 'b' || f === 'l'
}
function isCorner(f: string): f is Corner {
  return f === 'tl' || f === 'tr' || f === 'br' || f === 'bl'
}
function isAxis(f: string): f is Axis {
  return f === 'x' || f === 'y'
}

// Configuration

const TAILWIND_CONFIG: Record<string, FamilyConfig> = {
  // Layout properties
  display: {
    prefix: '',
    mode: 'direct',
    valueKind: 'keyword',
    keywords: [
      'block',
      'inline-block',
      'inline',
      'flex',
      'inline-flex',
      'grid',
      'inline-grid',
      'table',
      'table-row',
      'table-cell',
      'contents',
      'list-item',
      ['none', 'hidden'],
      'flow-root'
    ],
    props: { v: 'display' }
  },

  // Positioning
  position: {
    prefix: '',
    mode: 'direct',
    valueKind: 'keyword',
    keywords: ['static', 'fixed', 'absolute', 'relative', 'sticky'],
    props: { v: 'position' }
  },

  // Overflow
  // Figma "Clip content" -> overflow: hidden
  overflow: {
    prefix: 'overflow',
    mode: 'direct',
    valueKind: 'keyword',
    keywords: ['auto', 'hidden', 'clip', 'visible', 'scroll'],
    props: { v: 'overflow' }
  },
  overflowX: {
    prefix: 'overflow-x',
    mode: 'direct',
    valueKind: 'keyword',
    keywords: ['auto', 'hidden', 'clip', 'visible', 'scroll'],
    props: { v: 'overflow-x' }
  },
  overflowY: {
    prefix: 'overflow-y',
    mode: 'direct',
    valueKind: 'keyword',
    keywords: ['auto', 'hidden', 'clip', 'visible', 'scroll'],
    props: { v: 'overflow-y' }
  },

  // Visual / Image handling
  objectFit: {
    prefix: 'object',
    mode: 'direct',
    valueKind: 'keyword',
    keywords: ['contain', 'cover', 'fill', 'none', 'scale-down'],
    props: { v: 'object-fit' }
  },
  objectPosition: {
    prefix: 'object',
    mode: 'direct',
    valueKind: 'any', // e.g. object-[50%_50%] or keywords
    keywords: [
      'bottom',
      'center',
      'left',
      'left bottom',
      'left top',
      'right',
      'right bottom',
      'right top',
      'top'
    ],
    props: { v: 'object-position' }
  },
  visibility: {
    prefix: '',
    mode: 'direct',
    valueKind: 'keyword',
    keywords: ['visible', ['hidden', 'invisible'], 'collapse'],
    props: { v: 'visibility' }
  },

  // Interactivity
  cursor: {
    prefix: 'cursor',
    mode: 'direct',
    valueKind: 'keyword',
    keywords: ['auto', 'default', 'pointer', 'wait', 'text', 'move', 'help', 'not-allowed'],
    props: { v: 'cursor' }
  },
  pointerEvents: {
    prefix: 'pointer-events',
    mode: 'direct',
    valueKind: 'keyword',
    keywords: ['none', 'auto'],
    props: { v: 'pointer-events' }
  },
  resize: {
    prefix: 'resize',
    mode: 'direct',
    valueKind: 'keyword',
    keywords: [
      ['none', 'none'],
      ['both', ''],
      ['vertical', 'y'],
      ['horizontal', 'x']
    ],
    props: { v: 'resize' }
  },

  // List Style
  listStyleType: {
    prefix: 'list',
    mode: 'direct',
    valueKind: 'keyword',
    keywords: ['none', 'disc', 'decimal'],
    props: { v: 'list-style-type' }
  },
  listStylePosition: {
    prefix: 'list',
    mode: 'direct',
    valueKind: 'keyword',
    keywords: ['inside', 'outside'],
    props: { v: 'list-style-position' }
  },

  // Composite: flex shorthand
  flex: {
    prefix: 'flex',
    mode: 'composite',
    valueKind: 'keyword',
    props: { grow: 'flex-grow', shrink: 'flex-shrink', basis: 'flex-basis' },
    composites: [
      { match: { grow: '1', shrink: '1', basis: '0%' }, suffix: '1' },
      { match: { grow: '1', shrink: '1', basis: '0px' }, suffix: '1' },
      { match: { grow: '1', shrink: '1', basis: 'auto' }, suffix: 'auto' },
      { match: { grow: '0', shrink: '1', basis: 'auto' }, suffix: 'initial' },
      { match: { grow: '0', shrink: '0', basis: 'auto' }, suffix: 'none' }
    ],
    atomics: {
      grow: { prefix: 'grow', valueKind: 'integer' },
      shrink: { prefix: 'shrink', valueKind: 'integer' },
      basis: { prefix: 'basis', valueKind: 'length' }
    }
  },

  // Layout properties
  flexDirection: {
    prefix: 'flex',
    mode: 'direct',
    valueKind: 'keyword',
    keywords: [
      ['row', 'row'],
      ['row-reverse', 'row-reverse'],
      ['column', 'col'],
      ['column-reverse', 'col-reverse']
    ],
    props: { v: 'flex-direction' }
  },
  flexWrap: {
    prefix: 'flex',
    mode: 'direct',
    valueKind: 'keyword',
    keywords: [
      ['nowrap', 'nowrap'],
      ['wrap', 'wrap'],
      ['wrap-reverse', 'wrap-reverse']
    ],
    props: { v: 'flex-wrap' }
  },
  alignItems: {
    prefix: 'items',
    mode: 'direct',
    valueKind: 'keyword',
    keywords: [
      ['flex-start', 'start'],
      ['flex-end', 'end']
    ],
    props: { v: 'align-items' }
  },
  alignContent: {
    prefix: 'content',
    mode: 'direct',
    valueKind: 'keyword',
    keywords: [
      ['flex-start', 'start'],
      ['flex-end', 'end'],
      ['space-between', 'between'],
      ['space-around', 'around'],
      ['space-evenly', 'evenly']
    ],
    props: { v: 'align-content' }
  },
  justifyContent: {
    prefix: 'justify',
    mode: 'direct',
    valueKind: 'keyword',
    keywords: [
      ['flex-start', 'start'],
      ['flex-end', 'end'],
      ['space-between', 'between'],
      ['space-around', 'around'],
      ['space-evenly', 'evenly']
    ],
    props: { v: 'justify-content' }
  },
  justifyItems: {
    prefix: 'justify-items',
    mode: 'direct',
    valueKind: 'keyword',
    props: { v: 'justify-items' }
  },
  justifySelf: {
    prefix: 'justify-self',
    mode: 'direct',
    valueKind: 'keyword',
    props: { v: 'justify-self' }
  },
  alignSelf: {
    prefix: 'self',
    mode: 'direct',
    valueKind: 'keyword',
    keywords: [
      ['flex-start', 'start'],
      ['flex-end', 'end']
    ],
    props: { v: 'align-self' }
  },
  order: {
    prefix: 'order',
    mode: 'direct',
    valueKind: 'integer',
    keywords: [
      ['0', 'none'],
      ['-9999', 'first'],
      ['9999', 'last']
    ],
    props: { v: 'order' }
  },

  // Grid layout
  gridTemplateColumns: {
    prefix: 'grid-cols',
    mode: 'direct',
    valueKind: 'any',
    keywords: ['none', 'subgrid'],
    props: { v: 'grid-template-columns' }
  },
  gridTemplateRows: {
    prefix: 'grid-rows',
    mode: 'direct',
    valueKind: 'any',
    keywords: ['none', 'subgrid'],
    props: { v: 'grid-template-rows' }
  },
  gridAutoFlow: {
    prefix: 'grid-flow',
    mode: 'direct',
    valueKind: 'keyword',
    keywords: ['row', 'col', 'dense', ['row dense', 'row-dense'], ['column dense', 'col-dense']],
    props: { v: 'grid-auto-flow' }
  },
  gridAutoColumns: {
    prefix: 'auto-cols',
    mode: 'direct',
    valueKind: 'length',
    keywords: ['auto', 'min', 'max', 'fr'],
    props: { v: 'grid-auto-columns' }
  },
  gridAutoRows: {
    prefix: 'auto-rows',
    mode: 'direct',
    valueKind: 'length',
    keywords: ['auto', 'min', 'max', 'fr'],
    props: { v: 'grid-auto-rows' }
  },
  gridColumn: {
    prefix: 'col',
    mode: 'direct',
    valueKind: 'any',
    keywords: [['auto', 'auto']],
    props: { v: 'grid-column' }
  },
  gridColumnStart: {
    prefix: 'col-start',
    mode: 'direct',
    valueKind: 'integer',
    keywords: [['auto', 'auto']],
    props: { v: 'grid-column-start' }
  },
  gridColumnEnd: {
    prefix: 'col-end',
    mode: 'direct',
    valueKind: 'integer',
    keywords: [['auto', 'auto']],
    props: { v: 'grid-column-end' }
  },
  gridRow: {
    prefix: 'row',
    mode: 'direct',
    valueKind: 'any',
    keywords: [['auto', 'auto']],
    props: { v: 'grid-row' }
  },
  gridRowStart: {
    prefix: 'row-start',
    mode: 'direct',
    valueKind: 'integer',
    keywords: [['auto', 'auto']],
    props: { v: 'grid-row-start' }
  },
  gridRowEnd: {
    prefix: 'row-end',
    mode: 'direct',
    valueKind: 'integer',
    keywords: [['auto', 'auto']],
    props: { v: 'grid-row-end' }
  },

  // Spacing
  padding: {
    prefix: 'p',
    mode: 'side',
    valueKind: 'length',
    props: { t: 'padding-top', r: 'padding-right', b: 'padding-bottom', l: 'padding-left' }
  },
  margin: {
    prefix: 'm',
    mode: 'side',
    valueKind: 'length',
    props: { t: 'margin-top', r: 'margin-right', b: 'margin-bottom', l: 'margin-left' }
  },
  inset: {
    prefix: 'inset-',
    mode: 'side',
    valueKind: 'length',
    props: { t: 'top', r: 'right', b: 'bottom', l: 'left' }
  },
  gap: {
    prefix: 'gap-',
    mode: 'axis',
    valueKind: 'length',
    props: { y: 'row-gap', x: 'column-gap' }
  },

  // Sizing
  width: { prefix: 'w', mode: 'direct', valueKind: 'length', props: { v: 'width' } },
  height: { prefix: 'h', mode: 'direct', valueKind: 'length', props: { v: 'height' } },
  minWidth: { prefix: 'min-w', mode: 'direct', valueKind: 'length', props: { v: 'min-width' } },
  minHeight: { prefix: 'min-h', mode: 'direct', valueKind: 'length', props: { v: 'min-height' } },
  maxWidth: { prefix: 'max-w', mode: 'direct', valueKind: 'length', props: { v: 'max-width' } },
  maxHeight: { prefix: 'max-h', mode: 'direct', valueKind: 'length', props: { v: 'max-height' } },

  // Typography
  fontFamily: { prefix: 'font', mode: 'direct', valueKind: 'any', props: { v: 'font-family' } },
  fontSize: { prefix: 'text', mode: 'direct', valueKind: 'length', props: { v: 'font-size' } },

  fontWeight: {
    prefix: 'font',
    mode: 'direct',
    valueKind: 'any',
    keywords: ['normal', 'bold', 'lighter', 'bolder'],
    props: { v: 'font-weight' }
  },

  fontStyle: {
    prefix: '',
    mode: 'direct',
    valueKind: 'keyword',
    keywords: [['normal', 'not-italic'], 'italic'],
    props: { v: { prop: 'font-style', defaultValue: 'normal' } }
  },

  fontStretch: {
    prefix: 'font-stretch-',
    mode: 'direct',
    valueKind: 'keyword',
    props: { v: { prop: 'font-stretch', defaultValue: 'normal' } }
  },

  fontVariantNumeric: {
    prefix: '',
    mode: 'direct',
    valueKind: 'keyword',
    keywords: [['normal', 'normal-nums']],
    props: { v: { prop: 'font-variant-numeric', defaultValue: 'normal' } }
  },

  textColor: { prefix: 'text', mode: 'direct', valueKind: 'color', props: { v: 'color' } },
  textAlign: { prefix: 'text', mode: 'direct', valueKind: 'keyword', props: { v: 'text-align' } },
  lineHeight: {
    prefix: 'leading',
    mode: 'direct',
    valueKind: 'length',
    props: { v: 'line-height' }
  },
  letterSpacing: {
    prefix: 'tracking',
    mode: 'direct',
    valueKind: 'length',
    props: { v: 'letter-spacing' }
  },
  textIndent: {
    prefix: 'indent',
    mode: 'direct',
    valueKind: 'length',
    props: { v: 'text-indent' }
  },

  verticalAlign: {
    prefix: 'align-',
    mode: 'direct',
    valueKind: 'length',
    keywords: ['baseline', 'top', 'middle', 'bottom', 'text-top', 'text-bottom', 'sub', 'super'],
    props: { v: 'vertical-align' }
  },

  whitespace: {
    prefix: 'whitespace',
    mode: 'direct',
    valueKind: 'keyword',
    props: { v: 'white-space' }
  },
  wordBreak: { prefix: 'break', mode: 'direct', valueKind: 'keyword', props: { v: 'word-break' } },
  lineClamp: {
    prefix: 'line-clamp',
    mode: 'direct',
    valueKind: 'integer',
    props: { v: 'line-clamp' }
  },

  textTransform: {
    prefix: '',
    mode: 'direct',
    valueKind: 'keyword',
    keywords: [['none', 'normal-case'], 'uppercase', 'lowercase', 'capitalize'],
    props: { v: 'text-transform' }
  },

  textDecorationLine: {
    prefix: '',
    mode: 'direct',
    valueKind: 'keyword',
    keywords: [['none', 'no-underline'], 'underline', 'line-through'],
    props: { v: { prop: 'text-decoration-line', defaultValue: 'none' } }
  },
  textDecorationColor: {
    prefix: 'decoration',
    mode: 'direct',
    valueKind: 'color',
    props: { v: 'text-decoration-color' }
  },
  textDecorationStyle: {
    prefix: 'decoration',
    mode: 'direct',
    valueKind: 'keyword',
    props: { v: { prop: 'text-decoration-style', defaultValue: 'solid' } }
  },
  textDecorationThickness: {
    prefix: 'decoration',
    mode: 'direct',
    valueKind: 'length',
    props: { v: 'text-decoration-thickness' }
  },
  textUnderlineOffset: {
    prefix: 'underline-offset-',
    mode: 'direct',
    valueKind: 'length',
    props: { v: 'text-underline-offset' }
  },

  // Backgrounds
  background: {
    prefix: 'bg',
    mode: 'direct',
    valueKind: 'any',
    props: { v: 'background' }
  },
  backgroundColor: {
    prefix: 'bg',
    mode: 'direct',
    valueKind: 'color',
    props: { v: 'background-color' }
  },
  backgroundImage: {
    prefix: 'bg',
    mode: 'direct',
    valueKind: 'any',
    props: { v: 'background-image' }
  },
  backgroundPosition: {
    prefix: 'bg',
    mode: 'direct',
    valueKind: 'any',
    props: { v: 'background-position' }
  },
  backgroundSize: {
    prefix: 'bg',
    mode: 'direct',
    valueKind: 'any',
    props: { v: 'background-size' }
  },

  // SVG / Borders
  fill: { prefix: 'fill-', mode: 'direct', valueKind: 'color', props: { v: 'fill' } },
  stroke: { prefix: 'stroke-', mode: 'direct', valueKind: 'color', props: { v: 'stroke' } },
  strokeWidth: {
    prefix: 'stroke-',
    mode: 'direct',
    valueKind: 'length',
    props: { v: 'stroke-width' }
  },

  borderWidth: {
    prefix: 'border-',
    mode: 'side',
    valueKind: 'length',
    props: {
      t: 'border-top-width',
      r: 'border-right-width',
      b: 'border-bottom-width',
      l: 'border-left-width'
    }
  },
  borderColor: {
    prefix: 'border-',
    mode: 'side',
    valueKind: 'color',
    props: {
      t: 'border-top-color',
      r: 'border-right-color',
      b: 'border-bottom-color',
      l: 'border-left-color'
    }
  },
  borderStyle: {
    prefix: 'border-',
    mode: 'side',
    valueKind: 'keyword',
    props: {
      t: { prop: 'border-top-style', defaultValue: 'solid' },
      r: { prop: 'border-right-style', defaultValue: 'solid' },
      b: { prop: 'border-bottom-style', defaultValue: 'solid' },
      l: { prop: 'border-left-style', defaultValue: 'solid' }
    }
  },
  radius: {
    prefix: 'rounded-',
    mode: 'corner',
    valueKind: 'length',
    props: {
      tl: 'border-top-left-radius',
      tr: 'border-top-right-radius',
      br: 'border-bottom-right-radius',
      bl: 'border-bottom-left-radius'
    }
  },

  // Effects
  opacity: { prefix: 'opacity', mode: 'direct', valueKind: 'percent', props: { v: 'opacity' } },
  zIndex: {
    prefix: 'z',
    mode: 'direct',
    valueKind: 'integer',
    keywords: ['auto'],
    props: { v: 'z-index' }
  },
  boxShadow: { prefix: 'shadow', mode: 'direct', valueKind: 'any', props: { v: 'box-shadow' } },
  filter: { prefix: 'filter', mode: 'direct', valueKind: 'any', props: { v: 'filter' } },
  backdropFilter: {
    prefix: 'backdrop',
    mode: 'direct',
    valueKind: 'any',
    props: { v: 'backdrop-filter' }
  },
  mixBlendMode: {
    prefix: 'mix-blend',
    mode: 'direct',
    valueKind: 'keyword',
    props: { v: 'mix-blend-mode' }
  }
}

// Initialization (pre-compute lookups)

const PROPERTY_MAP: Record<string, PropertyLookup> = {}
const KEYWORD_REGISTRY: Record<string, Record<string, string>> = {}

Object.keys(TAILWIND_CONFIG).forEach((key) => {
  const familyKey = key
  const config = TAILWIND_CONFIG[familyKey]

  Object.entries(config.props).forEach(([field, def]) => {
    const propName = typeof def === 'string' ? def : def.prop
    const defaultValue = typeof def === 'string' ? undefined : def.defaultValue
    PROPERTY_MAP[propName] = { familyKey, field, defaultValue }
  })

  if (config.keywords) {
    const map: Record<string, string> = {}
    config.keywords.forEach((k) => {
      if (Array.isArray(k)) {
        map[k[0]] = k[1]
      } else {
        map[k] = k
      }
    })
    KEYWORD_REGISTRY[familyKey] = map
  }
})

// Normalization

function expandShorthands(style: Record<string, string>): Record<string, string> {
  const expanded: Record<string, string> = { ...style }
  const parse = (v: string) => v.trim().split(WHITESPACE)

  const expand4 = (arr: string[]): [string, string, string, string] => {
    if (arr.length === 1) return [arr[0], arr[0], arr[0], arr[0]]
    if (arr.length === 2) return [arr[0], arr[1], arr[0], arr[1]]
    if (arr.length === 3) return [arr[0], arr[1], arr[2], arr[1]]
    return [arr[0], arr[1], arr[2], arr[3]]
  }

  const boxKeys = ['padding', 'margin', 'inset']
  boxKeys.forEach((key) => {
    if (expanded[key]) {
      const val = normalizeStyleValue(expanded[key])
      const [t, r, b, l] = expand4(parse(val))
      if (key === 'inset') {
        expanded['top'] = t
        expanded['right'] = r
        expanded['bottom'] = b
        expanded['left'] = l
      } else {
        expanded[`${key}-top`] = t
        expanded[`${key}-right`] = r
        expanded[`${key}-bottom`] = b
        expanded[`${key}-left`] = l
      }
      delete expanded[key]
    }
  })

  if (expanded['border-radius']) {
    const val = normalizeStyleValue(expanded['border-radius'])
    const [tl, tr, br, bl] = expand4(parse(val))
    expanded['border-top-left-radius'] = tl
    expanded['border-top-right-radius'] = tr
    expanded['border-bottom-right-radius'] = br
    expanded['border-bottom-left-radius'] = bl
    delete expanded['border-radius']
  }
  if (expanded['gap']) {
    const val = normalizeStyleValue(expanded['gap'])
    const parts = parse(val)
    expanded['row-gap'] = parts[0]
    expanded['column-gap'] = parts[1] || parts[0]
    delete expanded['gap']
  }

  // Flex shorthand parser
  if (expanded['flex']) {
    const val = normalizeStyleValue(expanded['flex'])
    const parts = parse(val)
    let grow = '1'
    let shrink = '1'
    let basis = '0%'

    if (parts.length === 1) {
      const p = parts[0]
      if (p === 'initial') {
        grow = '0'
        shrink = '1'
        basis = 'auto'
      } else if (p === 'auto') {
        grow = '1'
        shrink = '1'
        basis = 'auto'
      } else if (p === 'none') {
        grow = '0'
        shrink = '0'
        basis = 'auto'
      } else if (NUMBER.test(p)) {
        grow = p
        shrink = '1'
        basis = '0%'
      } else {
        grow = '1'
        shrink = '1'
        basis = p
      }
    } else if (parts.length === 2) {
      grow = parts[0]
      if (NUMBER.test(parts[1])) {
        shrink = parts[1]
        basis = '0%'
      } else {
        shrink = '1'
        basis = parts[1]
      }
    } else if (parts.length >= 3) {
      grow = parts[0]
      shrink = parts[1]
      basis = parts[2]
    }

    expanded['flex-grow'] = grow
    expanded['flex-shrink'] = shrink
    expanded['flex-basis'] = basis
    delete expanded['flex']
  }

  // Grid gap legacy support
  if (expanded['grid-gap']) {
    const val = normalizeStyleValue(expanded['grid-gap'])
    const parts = parse(val)
    expanded['row-gap'] = parts[0]
    expanded['column-gap'] = parts[1] || parts[0]
    delete expanded['grid-gap']
  }

  return expanded
}

// Formatting

function extractValuePart(
  val: string,
  config: FamilyConfig,
  familyKey: string,
  overrideKind?: ValueKind
): FormattedValue {
  const isNegative = val.startsWith('-')
  let inner = isNegative ? val.substring(1) : val

  const keywordMap = KEYWORD_REGISTRY[familyKey]
  if (keywordMap && keywordMap[inner]) {
    return { isNegative, text: keywordMap[inner], isKeyword: true }
  }

  if (inner.includes('calc')) inner = inner.replace(ALL_WHITESPACE, '_')
  if (familyKey === 'fontFamily') {
    inner = inner.replace(COMMA_DELIMITER, ',')
    inner = inner.replace(WHITESPACE, '_')
    inner = inner.replace(QUOTES, '')
  }
  inner = formatArbitraryValue(inner)

  const kind = overrideKind || config.valueKind
  const isStrictKeywordType = kind === 'keyword'
  let text = inner
  let isKeyword = isStrictKeywordType

  if (!isStrictKeywordType) {
    text = `[${inner}]`
    if (familyKey === 'borderWidth' && (inner.includes('var(') || !isNaN(Number(inner)))) {
      text = `[length:${inner}]`
    }
    isKeyword = false
  } else {
    isKeyword = true
  }

  return { isNegative, text, isKeyword }
}

function buildClass(config: FamilyConfig, modifier: string, val: FormattedValue): string {
  const negPrefix = val.isNegative ? '-' : ''
  const base = config.prefix + modifier

  let connector = ''
  if (base && !base.endsWith('-')) {
    connector = '-'
  }

  if (!base) {
    return `${negPrefix}${val.text}`
  }

  return `${negPrefix}${base}${connector}${val.text}`
}

// Collapsing (with type guards)

function collapseSides(
  config: FamilyConfig,
  familyKey: string,
  s: NonNullable<FamilyBuffer['sides']>
): string[] {
  const out: string[] = []
  const { t, r, b, l } = s

  if (t && t === r && r === b && b === l) {
    out.push(buildClass(config, '', extractValuePart(t, config, familyKey)))
    return out
  }
  const done: Record<Side, boolean> = { t: false, r: false, b: false, l: false }
  if (l && r && l === r) {
    out.push(buildClass(config, 'x', extractValuePart(l, config, familyKey)))
    done.l = done.r = true
  }
  if (t && b && t === b) {
    out.push(buildClass(config, 'y', extractValuePart(t, config, familyKey)))
    done.t = done.b = true
  }
  const sideMap: Record<Side, string> = { t: 't', r: 'r', b: 'b', l: 'l' }
  ;(Object.keys(sideMap) as Side[]).forEach((k) => {
    if (s[k] && !done[k])
      out.push(buildClass(config, sideMap[k], extractValuePart(s[k]!, config, familyKey)))
  })
  return out
}

function collapseCorners(
  config: FamilyConfig,
  familyKey: string,
  c: NonNullable<FamilyBuffer['corners']>
): string[] {
  const out: string[] = []
  const { tl, tr, br, bl } = c

  if (tl && tl === tr && tr === br && br === bl) {
    out.push(buildClass(config, '', extractValuePart(tl, config, familyKey)))
    return out
  }
  const done: Record<Corner, boolean> = { tl: false, tr: false, br: false, bl: false }
  if (tl && tr && tl === tr) {
    out.push(buildClass(config, 't', extractValuePart(tl, config, familyKey)))
    done.tl = done.tr = true
  }
  if (bl && br && bl === br) {
    out.push(buildClass(config, 'b', extractValuePart(bl, config, familyKey)))
    done.bl = done.br = true
  }
  if (!done.tl && !done.bl && tl && bl && tl === bl) {
    out.push(buildClass(config, 'l', extractValuePart(tl, config, familyKey)))
    done.tl = done.bl = true
  }
  if (!done.tr && !done.br && tr && br && tr === br) {
    out.push(buildClass(config, 'r', extractValuePart(tr, config, familyKey)))
    done.tr = done.br = true
  }
  const cornerMap: Record<Corner, string> = { tl: 'tl', tr: 'tr', br: 'br', bl: 'bl' }
  ;(Object.keys(cornerMap) as Corner[]).forEach((k) => {
    if (c[k] && !done[k])
      out.push(buildClass(config, cornerMap[k], extractValuePart(c[k]!, config, familyKey)))
  })
  return out
}

function collapseAxes(
  config: FamilyConfig,
  familyKey: string,
  a: NonNullable<FamilyBuffer['axes']>
): string[] {
  const out: string[] = []
  const { x, y } = a
  if (x && y && x === y) {
    out.push(buildClass(config, '', extractValuePart(x, config, familyKey)))
  } else {
    if (x) out.push(buildClass(config, 'x', extractValuePart(x, config, familyKey)))
    if (y) out.push(buildClass(config, 'y', extractValuePart(y, config, familyKey)))
  }
  return out
}

function collapseComposite(
  config: CompositeFamily,
  familyKey: string,
  buffer: Record<string, string>
): string[] {
  const out: string[] = []

  const matchedComposite = config.composites.find((comp) => {
    return Object.entries(comp.match).every(([k, v]) => buffer[k] === v)
  })

  if (matchedComposite) {
    out.push(
      buildClass(config, '', {
        text: matchedComposite.suffix,
        isNegative: false,
        isKeyword: true
      })
    )
    return out
  }

  Object.keys(config.props).forEach((field) => {
    const val = buffer[field]
    if (val) {
      const atomicConfig = config.atomics[field]
      if (atomicConfig) {
        const formatted = extractValuePart(val, config, familyKey, atomicConfig.valueKind)
        const tempConfig: FamilyConfig = {
          ...config,
          prefix: atomicConfig.prefix
        }
        out.push(buildClass(tempConfig, '', formatted))
      }
    }
  })

  return out
}

// Main API

export function styleToTailwind(rawStyle: Record<string, string>): string {
  if (!rawStyle || Object.keys(rawStyle).length === 0) return ''
  const expandedStyle = expandShorthands(rawStyle)
  const buffers: Record<string, FamilyBuffer> = {}

  for (const [prop, rawVal] of Object.entries(expandedStyle)) {
    if (!rawVal) continue
    const lookup = PROPERTY_MAP[prop]
    if (!lookup) continue

    const { familyKey, field, defaultValue } = lookup
    const val = normalizeStyleValue(rawVal)
    if (!val) continue
    if (defaultValue && val === defaultValue) continue

    if (!buffers[familyKey]) buffers[familyKey] = {}
    const buf = buffers[familyKey]
    const config = TAILWIND_CONFIG[familyKey]

    if (config.mode === 'side' && isSide(field)) {
      const sides = buf.sides || (buf.sides = {})
      sides[field] = val
    } else if (config.mode === 'corner' && isCorner(field)) {
      const corners = buf.corners || (buf.corners = {})
      corners[field] = val
    } else if (config.mode === 'axis' && isAxis(field)) {
      const axes = buf.axes || (buf.axes = {})
      axes[field] = val
    } else if (config.mode === 'direct') {
      buf.val = val
    } else if (config.mode === 'composite') {
      const comp = buf.composite || (buf.composite = {})
      comp[field] = val
    }
  }

  const classes: string[] = []
  for (const [familyKey, buf] of Object.entries(buffers)) {
    const config = TAILWIND_CONFIG[familyKey]
    if (config.mode === 'side' && buf.sides) {
      classes.push(...collapseSides(config, familyKey, buf.sides))
    } else if (config.mode === 'corner' && buf.corners) {
      classes.push(...collapseCorners(config, familyKey, buf.corners))
    } else if (config.mode === 'axis' && buf.axes) {
      classes.push(...collapseAxes(config, familyKey, buf.axes))
    } else if (config.mode === 'direct' && buf.val) {
      classes.push(buildClass(config, '', extractValuePart(buf.val, config, familyKey)))
    } else if (config.mode === 'composite' && buf.composite) {
      classes.push(...collapseComposite(config, familyKey, buf.composite))
    }
  }

  return classes.join(' ')
}

function formatArbitraryValue(value: string): string {
  return value.trim().replace(/;+$/, '').replace(ALL_WHITESPACE, '_')
}

export function styleToClassNames(style: Record<string, string>): string[] {
  const cls = styleToTailwind(style)
  return cls ? cls.split(WHITESPACE).filter(Boolean) : []
}

export function joinClassNames(classNames: string[]): string {
  return classNames.filter(Boolean).join(' ')
}
