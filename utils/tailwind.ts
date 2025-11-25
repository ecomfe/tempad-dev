import { canonicalizeVariable } from '@/utils/css'

export function styleToTailwind(style: Record<string, string>): string {
  const classes: string[] = []

  const push = (cls?: string) => {
    if (cls) classes.push(cls)
  }

  for (const [prop, rawValue] of Object.entries(style)) {
    const value = rawValue.trim()

    switch (prop) {
      /* Size */
      case 'width':
        push(`w-[${normalizeArbitraryValue(value)}]`)
        break
      case 'height':
        push(`h-[${normalizeArbitraryValue(value)}]`)
        break
      case 'min-width':
        push(`min-w-[${normalizeArbitraryValue(value)}]`)
        break
      case 'max-width':
        push(`max-w-[${normalizeArbitraryValue(value)}]`)
        break
      case 'min-height':
        push(`min-h-[${normalizeArbitraryValue(value)}]`)
        break
      case 'max-height':
        push(`max-h-[${normalizeArbitraryValue(value)}]`)
        break

      /* Spacing */
      case 'padding':
        pushBoxClasses('padding', value, push)
        break
      case 'padding-top':
        emitLengthClass('pt', value, push)
        break
      case 'padding-right':
        emitLengthClass('pr', value, push)
        break
      case 'padding-bottom':
        emitLengthClass('pb', value, push)
        break
      case 'padding-left':
        emitLengthClass('pl', value, push)
        break

      case 'margin':
        pushBoxClasses('margin', value, push)
        break
      case 'margin-top':
        emitLengthClass('mt', value, push, { allowAuto: true })
        break
      case 'margin-right':
        emitLengthClass('mr', value, push, { allowAuto: true })
        break
      case 'margin-bottom':
        emitLengthClass('mb', value, push, { allowAuto: true })
        break
      case 'margin-left':
        emitLengthClass('ml', value, push, { allowAuto: true })
        break

      /* Display */
      case 'display':
        push(displayMap(value) ?? `[display:${normalizeArbitraryValue(value)}]`)
        break

      /* Grid layout */
      case 'grid-template-columns': {
        const mapped = gridTemplateRepeatMap(value, 'cols')
        push(mapped ?? `grid-cols-[${normalizeArbitraryValue(value)}]`)
        break
      }
      case 'grid-template-rows': {
        const mapped = gridTemplateRepeatMap(value, 'rows')
        push(mapped ?? `grid-rows-[${normalizeArbitraryValue(value)}]`)
        break
      }
      case 'grid-auto-flow':
        push(gridAutoFlowMap(value) ?? `grid-flow-[${normalizeArbitraryValue(value)}]`)
        break
      case 'grid-auto-columns':
        push(gridAutoAxisClass('cols', value))
        break
      case 'grid-auto-rows':
        push(gridAutoAxisClass('rows', value))
        break
      case 'grid-row':
        pushGridPlacement('row', value, push)
        break
      case 'grid-column':
        pushGridPlacement('col', value, push)
        break
      case 'grid-row-start':
        push(gridLineClass('row-start', value))
        break
      case 'grid-row-end':
        push(gridLineClass('row-end', value))
        break
      case 'grid-column-start':
        push(gridLineClass('col-start', value))
        break
      case 'grid-column-end':
        push(gridLineClass('col-end', value))
        break

      /* Flex layout */
      case 'flex-direction':
        push(flexDirectionMap(value) ?? `[flex-direction:${normalizeArbitraryValue(value)}]`)
        break
      case 'flex-wrap':
        push(flexWrapMap(value) ?? `[flex-wrap:${normalizeArbitraryValue(value)}]`)
        break
      case 'justify-content':
        push(justifyMap(value) ?? `[justify-content:${normalizeArbitraryValue(value)}]`)
        break
      case 'align-items':
        push(itemsMap(value) ?? `[align-items:${normalizeArbitraryValue(value)}]`)
        break
      case 'align-content':
        push(alignContentMap(value) ?? `[align-content:${normalizeArbitraryValue(value)}]`)
        break
      case 'justify-items':
        push(justifyItemsMap(value) ?? `[justify-items:${normalizeArbitraryValue(value)}]`)
        break
      case 'place-items':
        push(placeItemsMap(value) ?? `[place-items:${normalizeArbitraryValue(value)}]`)
        break
      case 'place-self':
        push(placeSelfMap(value) ?? `[place-self:${normalizeArbitraryValue(value)}]`)
        break
      case 'align-self':
        push(selfMap(value) ?? `[align-self:${normalizeArbitraryValue(value)}]`)
        break
      case 'flex':
        if (flexShorthandToClasses(value, push)) {
          // handled
        } else {
          push(
            flexValueMap(value) ??
              flexShorthandToClass(value) ??
              `[flex:${normalizeArbitraryValue(value)}]`
          )
        }
        break
      case 'gap':
        pushGapClasses(value, push)
        break
      case 'row-gap':
        emitLengthClass('gap-y', value, push)
        break
      case 'column-gap':
        emitLengthClass('gap-x', value, push)
        break
      case 'flex-grow':
        push(
          value === '1'
            ? 'grow'
            : value === '0'
              ? 'grow-0'
              : `grow-[${normalizeArbitraryValue(value)}]`
        )
        break
      case 'flex-shrink':
        push(
          value === '1'
            ? 'shrink'
            : value === '0'
              ? 'shrink-0'
              : `shrink-[${normalizeArbitraryValue(value)}]`
        )
        break
      case 'flex-basis':
        push(flexBasisMap(value) ?? `basis-[${normalizeArbitraryValue(value)}]`)
        break
      case 'order':
        push(
          value === '0'
            ? 'order-first'
            : value === '9999'
              ? 'order-last'
              : `order-[${normalizeArbitraryValue(value)}]`
        )
        break

      /* Positioning */
      case 'position':
        push(positionMap(value))
        break
      case 'inset':
        push(`inset-[${normalizeArbitraryValue(value)}]`)
        break
      case 'inset-x':
        push(`inset-x-[${normalizeArbitraryValue(value)}]`)
        break
      case 'inset-y':
        push(`inset-y-[${normalizeArbitraryValue(value)}]`)
        break
      case 'top':
        push(`top-[${normalizeArbitraryValue(value)}]`)
        break
      case 'right':
        push(`right-[${normalizeArbitraryValue(value)}]`)
        break
      case 'bottom':
        push(`bottom-[${normalizeArbitraryValue(value)}]`)
        break
      case 'left':
        push(`left-[${normalizeArbitraryValue(value)}]`)
        break
      case 'z-index':
        push(`z-[${normalizeArbitraryValue(value)}]`)
        break

      /* Overflow */
      case 'overflow':
        push(overflowMap(value) ?? `overflow-[${normalizeArbitraryValue(value)}]`)
        break
      case 'overflow-x':
        push(overflowAxisMap('x', value) ?? `overflow-x-[${normalizeArbitraryValue(value)}]`)
        break
      case 'overflow-y':
        push(overflowAxisMap('y', value) ?? `overflow-y-[${normalizeArbitraryValue(value)}]`)
        break

      /* Background / color / opacity */
      case 'background':
      case 'background-color':
        push(value === 'transparent' ? 'bg-transparent' : buildColorClass('bg', value))
        break
      case 'background-image':
        push(`bg-[image:${normalizeArbitraryValue(value)}]`)
        break
      case 'background-size':
        push(bgSizeMap(value) ?? `[background-size:${normalizeArbitraryValue(value)}]`)
        break
      case 'background-position':
        push(`[background-position:${normalizeArbitraryValue(value)}]`)
        break
      case 'background-repeat':
        push(bgRepeatMap(value) ?? `[background-repeat:${normalizeArbitraryValue(value)}]`)
        break
      case 'opacity':
        push(`opacity-[${normalizeArbitraryValue(value)}]`)
        break
      case 'color':
        push(value === 'transparent' ? 'text-transparent' : buildColorClass('text', value))
        break

      /* Border */
      case 'border-radius':
        push(borderRadiusMap(value) ?? `rounded-[${normalizeArbitraryValue(value)}]`)
        break
      case 'border-top-left-radius':
        push(`rounded-tl-[${normalizeArbitraryValue(value)}]`)
        break
      case 'border-top-right-radius':
        push(`rounded-tr-[${normalizeArbitraryValue(value)}]`)
        break
      case 'border-bottom-left-radius':
        push(`rounded-bl-[${normalizeArbitraryValue(value)}]`)
        break
      case 'border-bottom-right-radius':
        push(`rounded-br-[${normalizeArbitraryValue(value)}]`)
        break
      case 'border-width':
        push(value === '0px' || value === '0' ? 'border-0' : buildLengthClass('border', value))
        break
      case 'border-top-width':
        push(buildLengthClass('border-t', value))
        break
      case 'border-right-width':
        push(buildLengthClass('border-r', value))
        break
      case 'border-bottom-width':
        push(buildLengthClass('border-b', value))
        break
      case 'border-left-width':
        push(buildLengthClass('border-l', value))
        break
      case 'border-style':
        push(borderStyleMap(value) ?? `border-[${normalizeArbitraryValue(value)}]`)
        break
      case 'border-color':
        push(buildColorClass('border', value))
        break
      case 'border-top-color':
        push(buildColorClass('border-t', value))
        break
      case 'border-right-color':
        push(buildColorClass('border-r', value))
        break
      case 'border-bottom-color':
        push(buildColorClass('border-b', value))
        break
      case 'border-left-color':
        push(buildColorClass('border-l', value))
        break
      case 'border':
        push(buildLengthClass('border', value))
        break

      /* Effects */
      case 'box-shadow':
        push(value === 'none' ? 'shadow-none' : `shadow-[${normalizeArbitraryValue(value)}]`)
        break
      case 'filter':
      case 'backdrop-filter':
      case 'transform':
        // For known properties without dedicated utilities, fall back to arbitrary property
        push(`[${prop}:${normalizeArbitraryValue(value)}]`)
        break
      case 'box-sizing':
        push(
          value === 'border-box'
            ? 'box-border'
            : value === 'content-box'
              ? 'box-content'
              : `[box-sizing:${normalizeArbitraryValue(value)}]`
        )
        break

      /* Typography */
      case 'font-family':
        push(`font-[${normalizeArbitraryValue(value)}]`)
        break
      case 'font-size':
        push(`text-[${normalizeArbitraryValue(value)}]`)
        break
      case 'font-weight':
        push(fontWeightMap(value) ?? `font-[${normalizeArbitraryValue(value)}]`)
        break
      case 'font-style':
        if (value.trim() === 'normal') {
          // default, skip
        } else if (value.toLowerCase().includes('italic')) {
          push('italic')
        } else {
          push(`font-[${normalizeArbitraryValue(value)}]`)
        }
        break
      case 'line-height':
        push(`leading-[${normalizeArbitraryValue(value)}]`)
        break
      case 'letter-spacing':
        push(`tracking-[${normalizeArbitraryValue(value)}]`)
        break
      case 'text-align':
        push(textAlignMap(value) ?? `text-[${normalizeArbitraryValue(value)}]`)
        break
      case 'text-decoration':
        push(textDecorationMap(value))
        break
      case 'text-decoration-line':
        push(
          textDecorationLineMap(value) ?? `[text-decoration-line:${normalizeArbitraryValue(value)}]`
        )
        break
      case 'text-transform':
        push(textTransformMap(value))
        break
      case 'white-space':
        push(whiteSpaceMap(value) ?? `whitespace-[${normalizeArbitraryValue(value)}]`)
        break
      case 'word-break':
        push(wordBreakMap(value) ?? `[word-break:${normalizeArbitraryValue(value)}]`)
        break
      case 'overflow-wrap':
        push(
          value === 'break-word'
            ? 'break-words'
            : `[overflow-wrap:${normalizeArbitraryValue(value)}]`
        )
        break
      case 'text-overflow':
        push(
          value === 'ellipsis'
            ? 'text-ellipsis'
            : `[text-overflow:${normalizeArbitraryValue(value)}]`
        )
        break
      case 'text-shadow':
        push(`[text-shadow:${normalizeArbitraryValue(value)}]`)
        break
      case 'text-decoration-color':
        push(buildColorClass('decoration', value))
        break
      case 'text-decoration-thickness':
        push(`decoration-[${normalizeArbitraryValue(value)}]`)
        break

      /* Images */
      case 'object-fit':
        push(objectFitMap(value) ?? `object-[${normalizeArbitraryValue(value)}]`)
        break
      case 'object-position':
        push(objectPositionMap(value) ?? `object-[${normalizeArbitraryValue(value)}]`)
        break
      case 'aspect-ratio':
        push(`aspect-[${normalizeArbitraryValue(value)}]`)
        break

      default:
        // Unknown properties fall back to arbitrary property
        push(`[${prop}:${normalizeArbitraryValue(value)}]`)
        break
    }
  }

  return dedupe(classes).join(' ')
}

/* Helpers */

function normalizeArbitraryValue(value: string) {
  // Tailwind arbitrary values are whitespace-sensitive; strip comments, trim, and replace spaces
  const cleaned = stripCssComments(value).trim()
  const canonical = canonicalizeVariable(cleaned)
  if (canonical) {
    return canonical.replace(/\s+/g, '_')
  }
  if (cleaned.toLowerCase().startsWith('var(')) {
    const name = cleaned.split(',')[0]?.replace(/^var\(\s*/, '').replace(/\s*\)$/, '').trim()
    if (name) {
      return `var(${name})`.replace(/\s+/g, '_')
    }
  }
  return cleaned.replace(/\s+/g, '_')
}

function stripCssComments(value: string): string {
  return value.replace(/\s*\/\*[\s\S]*?\*\/\s*/g, '')
}
function dedupe(arr: string[]) {
  return Array.from(new Set(arr))
}

function isZeroValue(value: string): boolean {
  return /^(0+(\.0+)?)([a-z%]+)?$/i.test(value.trim())
}

type EmitLengthOptions = {
  allowAuto?: boolean
  allowVarLength?: boolean
}

function emitLengthClass(
  prefix: string,
  value: string,
  push: (cls?: string) => void,
  { allowAuto = false, allowVarLength = true }: EmitLengthOptions = {}
): void {
  const trimmed = value.trim()
  if (!trimmed) return
  if (allowAuto && trimmed === 'auto') {
    push(`${prefix}-auto`)
    return
  }
  if (isCssVar(trimmed) && allowVarLength) {
    push(`${prefix}-[${normalizeArbitraryValue(trimmed)}]`)
    return
  }
  if (isZeroValue(trimmed)) {
    push(`${prefix}-0`)
    return
  }
  push(`${prefix}-[${normalizeArbitraryValue(trimmed)}]`)
}

function pushGapClasses(value: string, push: (cls?: string) => void): void {
  const trimmed = value.trim()
  if (!trimmed) return
  const parts = parseBoxShorthand(trimmed)
  if (!parts) {
    emitLengthClass('gap', trimmed, push)
    return
  }

  const [row, column] = expandBoxValues(parts)
  const same =
    normalizeArbitraryValue(row) === normalizeArbitraryValue(column) ||
    (isZeroValue(row) && isZeroValue(column))

  if (same) {
    emitLengthClass('gap', row, push)
    return
  }

  emitLengthClass('gap-y', row, push)
  emitLengthClass('gap-x', column, push)
}

function pushBoxClasses(kind: 'padding' | 'margin', value: string, push: (cls?: string) => void) {
  const prefix = kind === 'padding' ? 'p' : 'm'
  const parts = parseBoxShorthand(value)
  if (!parts) {
    emitLengthClass(prefix, value, push, { allowAuto: kind === 'margin' })
    return
  }

  const [top, right, bottom, left] = expandBoxValues(parts)

  const emit = (axis: string, val: string) =>
    emitLengthClass(`${prefix}${axis}`, val, push, {
      allowAuto: kind === 'margin',
      allowVarLength: true
    })

  if (top === bottom && right === left) {
    if (top === right) {
      emit('', top)
    } else {
      emit('y', top)
      emit('x', right)
    }
    return
  }

  // 3-value shorthand: top, x, bottom
  if (parts.length === 3 && right === left) {
    emit('t', top)
    emit('x', right)
    emit('b', bottom)
    return
  }

  emit('t', top)
  emit('r', right)
  emit('b', bottom)
  emit('l', left)
}

function parseBoxShorthand(value: string): string[] | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed.includes('/')) return null
  if (/var\(/i.test(trimmed)) return null
  const parts = trimmed.split(/\s+/).filter(Boolean)
  if (parts.length === 0 || parts.length > 4) return null
  return parts
}

function expandBoxValues(parts: string[]): [string, string, string, string] {
  if (parts.length === 1) {
    return [parts[0], parts[0], parts[0], parts[0]]
  }
  if (parts.length === 2) {
    return [parts[0], parts[1], parts[0], parts[1]]
  }
  if (parts.length === 3) {
    return [parts[0], parts[1], parts[2], parts[1]]
  }
  return [parts[0], parts[1], parts[2], parts[3]]
}

function displayMap(v: string) {
  return (
    {
      flex: 'flex',
      'inline-flex': 'inline-flex',
      block: 'block',
      'inline-block': 'inline-block',
      inline: 'inline',
      grid: 'grid',
      'inline-grid': 'inline-grid',
      none: 'hidden'
    } as Record<string, string | undefined>
  )[v]
}

function gridTemplateRepeatMap(v: string, axis: 'cols' | 'rows') {
  const match = v
    .replace(/\s+/g, ' ')
    .trim()
    .match(/^repeat\(\s*(\d+)\s*,\s*minmax\(\s*0(px)?\s*,\s*1fr\s*\)\s*\)$/i)
  if (match) {
    return axis === 'cols' ? `grid-cols-${match[1]}` : `grid-rows-${match[1]}`
  }
  return undefined
}

function gridAutoFlowMap(v: string) {
  const normalized = v.trim().toLowerCase()
  return (
    {
      row: 'grid-flow-row',
      column: 'grid-flow-col',
      'row dense': 'grid-flow-row-dense',
      'column dense': 'grid-flow-col-dense',
      dense: 'grid-flow-dense'
    } as Record<string, string | undefined>
  )[normalized]
}

function gridAutoAxisClass(axis: 'cols' | 'rows', v: string) {
  const val = v.trim().toLowerCase()
  const prefix = axis === 'cols' ? 'auto-cols' : 'auto-rows'
  if (val === 'auto' || val === 'min' || val === 'max' || val === 'min-content' || val === 'max-content') {
    return `${prefix}-${val === 'auto' ? 'auto' : val.replace('-content', '')}`
  }
  if (val === '1fr' || val === 'minmax(0, 1fr)') {
    return `${prefix}-fr`
  }
  return `${prefix}-[${normalizeArbitraryValue(v)}]`
}

function parseGridPlacement(value: string): { start?: string; end?: string; span?: string } | null {
  const parts = value.split('/')
  if (parts.length !== 2) {
    return null
  }
  const start = parts[0].trim()
  const end = parts[1].trim()
  const spanMatch = end.match(/^span\s+(-?\d+)$/i)
  const startSpanMatch = start.match(/^span\s+(-?\d+)$/i)

  if (spanMatch) {
    return {
      start: start && start !== 'auto' ? start : undefined,
      span: spanMatch[1]
    }
  }

  if (startSpanMatch) {
    return {
      end: end && end !== 'auto' ? end : undefined,
      span: startSpanMatch[1]
    }
  }

  return {
    start: start && start !== 'auto' ? start : undefined,
    end: end && end !== 'auto' ? end : undefined
  }
}

function pushGridPlacement(axis: 'row' | 'col', value: string, push: (cls?: string) => void) {
  const parsed = parseGridPlacement(value)
  if (!parsed) {
    push(`[grid-${axis}:${normalizeArbitraryValue(value)}]`)
    return
  }

  const { start, end, span } = parsed
  if (start) {
    push(gridLineClass(`${axis}-start`, start))
  }
  if (end) {
    push(gridLineClass(`${axis}-end`, end))
  }
  if (span) {
    push(`${axis}-span-${normalizeArbitraryValue(span)}`)
  }

  if (!start && !end && !span) {
    push(`[grid-${axis}:${normalizeArbitraryValue(value)}]`)
  }
}

function gridLineClass(prefix: string, value: string) {
  const val = value.trim()
  if (!val || val === 'auto') return undefined
  return `${prefix}-${normalizeArbitraryValue(val)}`
}

function flexDirectionMap(v: string) {
  return (
    {
      row: 'flex-row',
      column: 'flex-col',
      'row-reverse': 'flex-row-reverse',
      'column-reverse': 'flex-col-reverse'
    } as Record<string, string | undefined>
  )[v]
}

function flexWrapMap(v: string) {
  return (
    {
      nowrap: 'flex-nowrap',
      wrap: 'flex-wrap',
      'wrap-reverse': 'flex-wrap-reverse'
    } as Record<string, string | undefined>
  )[v]
}

function justifyMap(v: string) {
  return (
    {
      'flex-start': 'justify-start',
      center: 'justify-center',
      'flex-end': 'justify-end',
      'space-between': 'justify-between',
      'space-around': 'justify-around',
      'space-evenly': 'justify-evenly'
    } as Record<string, string | undefined>
  )[v]
}

function itemsMap(v: string) {
  return (
    {
      'flex-start': 'items-start',
      center: 'items-center',
      'flex-end': 'items-end',
      baseline: 'items-baseline',
      stretch: 'items-stretch'
    } as Record<string, string | undefined>
  )[v]
}

function alignContentMap(v: string) {
  return (
    {
      'flex-start': 'content-start',
      'flex-end': 'content-end',
      center: 'content-center',
      stretch: 'content-stretch',
      'space-between': 'content-between',
      'space-around': 'content-around',
      'space-evenly': 'content-evenly'
    } as Record<string, string | undefined>
  )[v]
}

function justifyItemsMap(v: string) {
  return (
    {
      start: 'justify-items-start',
      end: 'justify-items-end',
      center: 'justify-items-center',
      stretch: 'justify-items-stretch'
    } as Record<string, string | undefined>
  )[v]
}

function placeItemsMap(v: string) {
  return (
    {
      start: 'place-items-start',
      end: 'place-items-end',
      center: 'place-items-center',
      stretch: 'place-items-stretch'
    } as Record<string, string | undefined>
  )[v]
}

function placeSelfMap(v: string) {
  return (
    {
      auto: 'place-self-auto',
      start: 'place-self-start',
      end: 'place-self-end',
      center: 'place-self-center',
      stretch: 'place-self-stretch'
    } as Record<string, string | undefined>
  )[v]
}

function selfMap(v: string) {
  return (
    {
      auto: 'self-auto',
      'flex-start': 'self-start',
      center: 'self-center',
      'flex-end': 'self-end',
      stretch: 'self-stretch',
      baseline: 'self-baseline'
    } as Record<string, string | undefined>
  )[v]
}

function flexValueMap(v: string) {
  return (
    {
      none: 'flex-none',
      auto: 'flex-auto',
      initial: 'flex-initial',
      '1': 'flex-1'
    } as Record<string, string | undefined>
  )[v]
}

function flexShorthandToClass(v: string) {
  const normalized = v.replace(/\s+/g, ' ').trim()
  if (normalized === '0 1 auto') return 'flex-initial'
  if (normalized === '1 1 0%' || normalized === '1 1 0') return 'flex-1'
  if (normalized === '1 1 auto') return 'flex-auto'
  if (normalized === 'none') return 'flex-none'
  return undefined
}

function flexShorthandToClasses(v: string, push: (cls?: string) => void): boolean {
  const normalized = v.trim().replace(/\s+/g, ' ')
  const parts = normalized.split(' ')
  if (parts.length !== 3) return false
  const [grow, shrink, basis] = parts

  const emitGrow = () => {
    if (grow === '0') push('grow-0')
    else if (grow === '1') push('grow')
    else push(`grow-[${normalizeArbitraryValue(grow)}]`)
  }

  const emitShrink = () => {
    if (shrink === '0') push('shrink-0')
    else if (shrink === '1') push('shrink')
    else push(`shrink-[${normalizeArbitraryValue(shrink)}]`)
  }

  const emitBasis = () => {
    const mapped = flexBasisMap(basis)
    if (mapped) push(mapped)
    else push(`basis-[${normalizeArbitraryValue(basis)}]`)
  }

  emitGrow()
  emitShrink()
  emitBasis()
  return true
}

function flexBasisMap(v: string) {
  const val = v.trim()
  if (val === '0' || val === '0px') return 'basis-0'
  if (val === 'auto') return 'basis-auto'
  if (val === '100%' || val === 'full') return 'basis-full'
  return undefined
}

function positionMap(v: string) {
  return (
    {
      static: 'static',
      relative: 'relative',
      absolute: 'absolute',
      fixed: 'fixed',
      sticky: 'sticky'
    } as Record<string, string | undefined>
  )[v]
}

function overflowMap(v: string) {
  return (
    {
      visible: 'overflow-visible',
      hidden: 'overflow-hidden',
      clip: 'overflow-clip',
      scroll: 'overflow-scroll',
      auto: 'overflow-auto'
    } as Record<string, string | undefined>
  )[v]
}

function overflowAxisMap(axis: 'x' | 'y', v: string) {
  const map = {
    visible: `overflow-${axis}-visible`,
    hidden: `overflow-${axis}-hidden`,
    clip: `overflow-${axis}-clip`,
    scroll: `overflow-${axis}-scroll`,
    auto: `overflow-${axis}-auto`
  } as Record<string, string>
  return map[v]
}

function borderRadiusMap(v: string) {
  if (v === '0px' || v === '0') return 'rounded-none'
  if (v === '9999px' || v === '9999rem' || v === '50%') return 'rounded-full'
  return undefined
}

function borderStyleMap(v: string) {
  return (
    {
      solid: 'border-solid',
      dashed: 'border-dashed',
      dotted: 'border-dotted',
      double: 'border-double',
      none: 'border-none'
    } as Record<string, string | undefined>
  )[v]
}

function fontWeightMap(v: string) {
  return (
    {
      '100': 'font-thin',
      '200': 'font-extralight',
      '300': 'font-light',
      '400': 'font-normal',
      '500': 'font-medium',
      '600': 'font-semibold',
      '700': 'font-bold',
      '800': 'font-extrabold',
      '900': 'font-black'
    } as Record<string, string | undefined>
  )[v]
}

function textAlignMap(v: string) {
  return (
    {
      left: 'text-left',
      center: 'text-center',
      right: 'text-right',
      justified: 'text-justify',
      justify: 'text-justify'
    } as Record<string, string | undefined>
  )[v]
}

function textDecorationMap(v: string) {
  return (
    {
      none: 'no-underline',
      underline: 'underline',
      'line-through': 'line-through',
      overline: '[text-decoration:overline]'
    } as Record<string, string | undefined>
  )[v]
}

function textDecorationLineMap(v: string) {
  const tokens = v.split(/\s+/).filter(Boolean)
  if (tokens.length === 1) {
    return (
      {
        none: 'no-underline',
        underline: 'underline',
        'line-through': 'line-through',
        overline: '[text-decoration-line:overline]'
      } as Record<string, string | undefined>
    )[tokens[0]]
  }
  return undefined
}

function textTransformMap(v: string) {
  return (
    {
      none: 'normal-case',
      uppercase: 'uppercase',
      lowercase: 'lowercase',
      capitalize: 'capitalize'
    } as Record<string, string | undefined>
  )[v]
}

function whiteSpaceMap(v: string) {
  return (
    {
      normal: 'whitespace-normal',
      nowrap: 'whitespace-nowrap',
      pre: 'whitespace-pre',
      'pre-line': 'whitespace-pre-line',
      'pre-wrap': 'whitespace-pre-wrap',
      'break-spaces': 'whitespace-break-spaces'
    } as Record<string, string | undefined>
  )[v]
}

function objectFitMap(v: string) {
  return (
    {
      contain: 'object-contain',
      cover: 'object-cover',
      fill: 'object-fill',
      none: 'object-none',
      'scale-down': 'object-scale-down'
    } as Record<string, string | undefined>
  )[v]
}

function objectPositionMap(v: string) {
  return (
    {
      center: 'object-center',
      top: 'object-top',
      bottom: 'object-bottom',
      left: 'object-left',
      right: 'object-right'
    } as Record<string, string | undefined>
  )[v]
}

function bgSizeMap(v: string) {
  return (
    {
      cover: 'bg-cover',
      contain: 'bg-contain',
      auto: 'bg-auto'
    } as Record<string, string | undefined>
  )[v]
}

function bgRepeatMap(v: string) {
  return (
    {
      'no-repeat': 'bg-no-repeat',
      repeat: 'bg-repeat',
      'repeat-x': 'bg-repeat-x',
      'repeat-y': 'bg-repeat-y',
      round: 'bg-repeat-round',
      space: 'bg-repeat-space'
    } as Record<string, string | undefined>
  )[v]
}

function wordBreakMap(v: string) {
  return (
    {
      'break-all': 'break-all',
      'keep-all': 'break-keep',
      'break-word': 'break-words',
      normal: undefined
    } as Record<string, string | undefined>
  )[v]
}

function normalizeColorValue(value: string) {
  const trimmed = value.trim()
  if (isCssVar(trimmed)) {
    return trimmed
  }
  const rgbMatch = trimmed.match(/^rgba?\(([^)]+)\)$/i)
  if (rgbMatch) {
    const parts = rgbMatch[1].split(',').map((p) => p.trim())
    const [r, g, b, a = '1'] = parts
    const toInt = (v: string) => {
      const n = Number(v)
      return Number.isFinite(n) ? Math.round(n) : null
    }
    const rInt = toInt(r)
    const gInt = toInt(g)
    const bInt = toInt(b)
    const aNum = Number(a)
    if (
      rInt != null &&
      gInt != null &&
      bInt != null &&
      rInt >= 0 &&
      rInt <= 255 &&
      gInt >= 0 &&
      gInt <= 255 &&
      bInt >= 0 &&
      bInt <= 255 &&
      Number.isFinite(aNum)
    ) {
      const hex = compressHex(formatHex(rInt, gInt, bInt))
      if (aNum >= 1) {
        return hex
      }
      const opacity = Math.max(0, Math.min(100, Math.round(aNum * 100)))
      const shortHex = hex.length === 7 ? compressHex(hex) : hex
      return `${shortHex}/${opacity}`
    }
    return `rgb(${parts.join(',')})`
  }

  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) {
    return compressHex(trimmed)
  }

  return trimmed
}

function formatHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => n.toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function compressHex(hex: string): string {
  const h = hex.toLowerCase()
  if (!/^#[0-9a-f]{6}$/.test(h)) return h
  const [r1, r2, g1, g2, b1, b2] = h.slice(1).split('')
  if (r1 === r2 && g1 === g2 && b1 === b2) {
    return `#${r1}${g1}${b1}`
  }
  return h
}

function isCssVar(value: string): boolean {
  return /^var\(/i.test(stripCssComments(value).trim())
}

function buildColorClass(prefix: string, value: string): string {
  const needsColorAnnotation = prefix === 'text' || prefix === 'border' || prefix === 'decoration'
  if (isCssVar(value)) {
    const norm = normalizeArbitraryValue(value)
    return needsColorAnnotation ? `${prefix}-[color:${norm}]` : `${prefix}-[${norm}]`
  }
  const norm = normalizeColorValue(value)
  if (needsColorAnnotation && norm.startsWith('var(')) {
    return `${prefix}-[color:${norm}]`
  }
  return `${prefix}-[${norm}]`
}

function buildLengthClass(prefix: string, value: string): string {
  if (isCssVar(value)) {
    return `${prefix}-[${normalizeArbitraryValue(value)}]`
  }
  return `${prefix}-[${normalizeArbitraryValue(value)}]`
}
