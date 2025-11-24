import { canonicalizeVariable } from '@/utils/css'

export function styleToTailwind(style: Record<string, string>): string {
  const classes: string[] = []

  const push = (cls?: string) => {
    if (cls) classes.push(cls)
  }

  const v = (prop: string) => style[prop]

  for (const [prop, rawValue] of Object.entries(style)) {
    let value = rawValue.trim()

    // Normalize any variable-like value to CSS custom property form
    const canonical = canonicalizeVariable(value)
    if (canonical) {
      value = canonical
    }

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
        push(value === '0px' || value === '0' ? 'p-0' : `p-[${normalizeArbitraryValue(value)}]`)
        break
      case 'padding-top':
        push(value === '0px' || value === '0' ? 'pt-0' : `pt-[${normalizeArbitraryValue(value)}]`)
        break
      case 'padding-right':
        push(value === '0px' || value === '0' ? 'pr-0' : `pr-[${normalizeArbitraryValue(value)}]`)
        break
      case 'padding-bottom':
        push(value === '0px' || value === '0' ? 'pb-0' : `pb-[${normalizeArbitraryValue(value)}]`)
        break
      case 'padding-left':
        push(value === '0px' || value === '0' ? 'pl-0' : `pl-[${normalizeArbitraryValue(value)}]`)
        break

      case 'margin':
        push(value === '0px' || value === '0' ? 'm-0' : `m-[${normalizeArbitraryValue(value)}]`)
        break
      case 'margin-top':
        push(value === '0px' || value === '0' ? 'mt-0' : `mt-[${normalizeArbitraryValue(value)}]`)
        break
      case 'margin-right':
        push(value === '0px' || value === '0' ? 'mr-0' : `mr-[${normalizeArbitraryValue(value)}]`)
        break
      case 'margin-bottom':
        push(value === '0px' || value === '0' ? 'mb-0' : `mb-[${normalizeArbitraryValue(value)}]`)
        break
      case 'margin-left':
        push(value === '0px' || value === '0' ? 'ml-0' : `ml-[${normalizeArbitraryValue(value)}]`)
        break

      /* Display */
      case 'display':
        push(displayMap(value) ?? undefined)
        break

      /* Flex layout */
      case 'flex-direction':
        push(flexDirectionMap(value) ?? `flex-[${normalizeArbitraryValue(value)}]`)
        break
      case 'flex-wrap':
        push(flexWrapMap(value) ?? `flex-wrap-[${normalizeArbitraryValue(value)}]`)
        break
      case 'justify-content':
        push(justifyMap(value) ?? `justify-[${normalizeArbitraryValue(value)}]`)
        break
      case 'align-items':
        push(itemsMap(value) ?? `items-[${normalizeArbitraryValue(value)}]`)
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
        push(selfMap(value) ?? `self-[${normalizeArbitraryValue(value)}]`)
        break
      case 'gap':
        push(`gap-[${normalizeArbitraryValue(value)}]`)
        break
      case 'row-gap':
        push(`gap-y-[${normalizeArbitraryValue(value)}]`)
        break
      case 'column-gap':
        push(`gap-x-[${normalizeArbitraryValue(value)}]`)
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
        push(`basis-[${normalizeArbitraryValue(value)}]`)
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
        push(value === 'transparent' ? 'bg-transparent' : `bg-[${normalizeColorValue(value)}]`)
        break
      case 'background-image':
        push(`bg-[${normalizeArbitraryValue(value)}]`)
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
        push(
          value === 'transparent' ? 'text-transparent' : `text-[${normalizeColorValue(value)}]`
        )
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
        push(
          value === '0px' || value === '0'
            ? 'border-0'
            : `border-[${normalizeArbitraryValue(value)}]`
        )
        break
      case 'border-top-width':
        push(`border-t-[${normalizeArbitraryValue(value)}]`)
        break
      case 'border-right-width':
        push(`border-r-[${normalizeArbitraryValue(value)}]`)
        break
      case 'border-bottom-width':
        push(`border-b-[${normalizeArbitraryValue(value)}]`)
        break
      case 'border-left-width':
        push(`border-l-[${normalizeArbitraryValue(value)}]`)
        break
      case 'border-style':
        push(borderStyleMap(value) ?? `border-[${normalizeArbitraryValue(value)}]`)
        break
      case 'border-color':
        push(`border-[${normalizeColorValue(value)}]`)
        break
      case 'border-top-color':
        push(`border-t-[${normalizeColorValue(value)}]`)
        break
      case 'border-right-color':
        push(`border-r-[${normalizeColorValue(value)}]`)
        break
      case 'border-bottom-color':
        push(`border-b-[${normalizeColorValue(value)}]`)
        break
      case 'border-left-color':
        push(`border-l-[${normalizeColorValue(value)}]`)
        break
      case 'border':
        push(`border-[${normalizeArbitraryValue(value)}]`)
        break

      /* Effects */
      case 'box-shadow':
        push(value === 'none' ? 'shadow-none' : `shadow-[${normalizeArbitraryValue(value)}]`)
        break
      case 'filter':
      case 'backdrop-filter':
      case 'transform':
        // 对我们认识但没有对应 utility 的属性，使用 arbitrary property
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
        push(value === 'ellipsis' ? 'text-ellipsis' : `[text-overflow:${normalizeArbitraryValue(value)}]`)
        break
      case 'text-shadow':
        push(`[text-shadow:${normalizeArbitraryValue(value)}]`)
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
        // 不认识的属性用 arbitrary property 兜底
        push(`[${prop}:${normalizeArbitraryValue(value)}]`)
        break
    }
  }

  return dedupe(classes).join(' ')
}

/* Helpers */

function normalizeArbitraryValue(value: string) {
  // Tailwind arbitrary values 对空格敏感，常规做法是空格转下划线
  return value.trim().replace(/\s+/g, '_')
}

function dedupe(arr: string[]) {
  return Array.from(new Set(arr))
}

function displayMap(v: string) {
  return (
    {
      flex: 'flex',
      block: 'block',
      'inline-block': 'inline-block',
      inline: 'inline',
      grid: 'grid',
      none: 'hidden'
    } as Record<string, string | undefined>
  )[v]
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
