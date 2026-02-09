import { describe, expect, it } from 'vitest'

import {
  canonicalizeColor,
  canonicalizeValue,
  canonicalizeVarName,
  expandShorthands,
  extractVarNames,
  formatHexAlpha,
  normalizeCssValue,
  normalizeCustomPropertyBody,
  normalizeCustomPropertyName,
  normalizeFigmaVarName,
  normalizeStyleValue,
  normalizeStyleValues,
  parseBackgroundShorthand,
  preprocessCssValue,
  pruneInheritedTextStyles,
  replaceVarFunctions,
  serializeCSS,
  simplifyColorMixToRgba,
  simplifyHexAlphaToRgba,
  splitByTopLevelComma,
  stripDefaultTextStyles,
  stripFallback,
  toFigmaVarExpr,
  toVarExpr
} from '@/utils/css'

describe('utils/css split and var helpers', () => {
  it('splits by top-level comma with nested expressions and quotes', () => {
    const input = `a, rgb(1, 2, 3), "x, y", 'z,\\'w'`
    expect(splitByTopLevelComma(input)).toEqual(['a', 'rgb(1, 2, 3)', '"x, y"', "'z,\\'w'"])
    expect(splitByTopLevelComma('a,,b,', true)).toEqual(['a', '', 'b', ''])
    expect(splitByTopLevelComma('')).toEqual([])
  })

  it('replaces var() calls and extracts normalized var names', () => {
    const replaced = replaceVarFunctions(
      'color: var(--c1, var(--fallback, #fff)); padding: var(--space); broken: var(--x',
      ({ name, fallback }) => `[[${name.trim()}|${fallback ?? ''}]]`
    )
    expect(replaced).toContain('[[--c1|var(--fallback, #fff)]]')
    expect(replaced).toContain('[[--space|]]')
    expect(replaced).toContain('broken: var(--x')

    expect(extractVarNames('var(--foo, 1px) var(--bar_baz) var(color)')).toEqual(
      new Set(['--foo', '--bar_baz'])
    )
  })

  it('handles empty input and whitespace around var names', () => {
    expect(replaceVarFunctions('', ({ full }) => full)).toBe('')
    expect(
      replaceVarFunctions('var(   --brand-color   ,   #fff   )', ({ name, fallback }) => {
        return `name=${name}|fallback=${fallback ?? ''}`
      })
    ).toBe('name=--brand-color|fallback=#fff')
    expect(extractVarNames('')).toEqual(new Set())
  })

  it('skips empty top-level segments when keepEmpty=false and handles trailing escapes', () => {
    expect(splitByTopLevelComma('a,,b')).toEqual(['a', 'b'])
    expect(splitByTopLevelComma('a,')).toEqual(['a'])
    expect(splitByTopLevelComma('"a\\')).toEqual(['"a\\'])
  })
})

describe('utils/css parsing and normalization', () => {
  it('formats hex alpha values', () => {
    expect(formatHexAlpha({ r: 1, g: 0, b: 0 }, 1)).toBe('#F00')
    expect(formatHexAlpha({ r: 1, g: 0, b: 0 }, 0.5)).toBe('#FF000080')
    expect(formatHexAlpha({ r: 0.1, g: 0.2, b: 0.3 }, 1)).toBe('#1A334D')
    expect(formatHexAlpha({ r: 1, g: 1, b: 1 }, 0.5333333)).toBe('#FFF8')
  })

  it('uses default opacity and parses background with partial components', () => {
    expect(formatHexAlpha({ r: 1, g: 1, b: 1 })).toBe('#FFF')

    expect(parseBackgroundShorthand('url("a.png")')).toEqual({
      image: 'url("a.png")'
    })
    expect(parseBackgroundShorthand('repeat-x')).toEqual({
      repeat: 'repeat-x'
    })
    expect(parseBackgroundShorthand('left top')).toEqual({
      position: 'left top'
    })
  })

  it('parses background shorthand details', () => {
    expect(parseBackgroundShorthand('url("a.png") center/cover no-repeat')).toEqual({
      image: 'url("a.png")',
      size: 'cover',
      repeat: 'no-repeat',
      position: 'center'
    })

    expect(parseBackgroundShorthand('left top / 50% repeat-x')).toEqual({
      size: '50%',
      repeat: 'repeat-x',
      position: 'left top'
    })
  })

  it('normalizes values with scale/rem and keep-px exceptions', () => {
    const remConfig = { cssUnit: 'rem' as const, rootFontSize: 20, scale: 2 }

    expect(normalizeCssValue(' 10px 0px ', remConfig)).toBe('1rem 0')
    expect(normalizeCssValue('1px solid #000', remConfig, 'border')).toBe('1px solid #000')

    expect(
      normalizeStyleValues(
        {
          width: '20px',
          'font-size': '16px',
          border: '1px solid #000'
        },
        remConfig
      )
    ).toEqual({
      width: '2rem',
      'font-size': '1.6rem',
      border: '1px solid #000'
    })

    expect(normalizeCssValue('', remConfig)).toBe('')
  })

  it('simplifies color-mix and hex alpha to rgba forms', () => {
    expect(simplifyColorMixToRgba('color-mix(in srgb, #336699 50%, transparent)')).toBe(
      'rgba(51, 102, 153, 0.5)'
    )
    expect(simplifyColorMixToRgba('color-mix(in hsl, #336699 50%, transparent)')).toBe(
      'color-mix(in hsl, #336699 50%, transparent)'
    )

    expect(simplifyHexAlphaToRgba('color: #11223380 and #abcd and #fff and #112233ff')).toBe(
      'color: rgba(17, 34, 51, 0.5) and rgba(170, 187, 204, 0.87) and #fff and #112233ff'
    )

    expect(simplifyColorMixToRgba('color-mix(in srgb, #zzzzzz 50%, transparent)')).toBe(
      'color-mix(in srgb, #zzzzzz 50%, transparent)'
    )
    expect(simplifyColorMixToRgba('color-mix(in srgb, #336699 xx%, transparent)')).toBe(
      'color-mix(in srgb, #336699 xx%, transparent)'
    )
    expect(simplifyColorMixToRgba('color-mix(in srgb, #12345 50%, transparent)')).toBe(
      'color-mix(in srgb, #12345 50%, transparent)'
    )
    expect(simplifyColorMixToRgba('color-mix(in srgb, #336699 ..%, transparent)')).toBe(
      'color-mix(in srgb, #336699 ..%, transparent)'
    )
  })

  it('expands shorthands for spacing, border, background, flex and grid', () => {
    const expanded = expandShorthands({
      padding: '1px 2px',
      margin: '3px',
      inset: '4px 5px 6px 7px',
      'border-radius': '2px 4px 6px 8px',
      gap: '8px 4px',
      flex: 'auto',
      background: 'url("x.png") center / cover no-repeat',
      'grid-row': '1 / span 2',
      'grid-column': 'span 3 / 6',
      border: '1px solid red',
      'border-top': '2px dashed blue'
    })

    expect(expanded).toMatchObject({
      'padding-top': '1px',
      'padding-right': '2px',
      'padding-bottom': '1px',
      'padding-left': '2px',
      'margin-top': '3px',
      top: '4px',
      right: '5px',
      bottom: '6px',
      left: '7px',
      'border-top-left-radius': '2px',
      'border-top-right-radius': '4px',
      'border-bottom-right-radius': '6px',
      'border-bottom-left-radius': '8px',
      'row-gap': '8px',
      'column-gap': '4px',
      'flex-grow': '1',
      'flex-shrink': '1',
      'flex-basis': 'auto',
      'background-image': 'url("x.png")',
      'background-position': 'center',
      'background-size': 'cover',
      'background-repeat': 'no-repeat',
      'grid-row-start': '1',
      'grid-row-span': '2',
      'grid-column-span': '3',
      'grid-column-end': '6',
      'border-top-width': '2px',
      'border-top-style': 'dashed',
      'border-top-color': 'blue',
      'border-right-width': '1px',
      'border-bottom-width': '1px',
      'border-left-width': '1px'
    })

    expect(expanded).not.toHaveProperty('padding')
    expect(expanded).not.toHaveProperty('background')
    expect(expanded).not.toHaveProperty('border')
    expect(expanded).not.toHaveProperty('border-top')
  })

  it('expands flex/grid variants and keeps multi-layer background shorthand', () => {
    expect(expandShorthands({ flex: 'initial' })).toMatchObject({
      'flex-grow': '0',
      'flex-shrink': '1',
      'flex-basis': 'auto'
    })
    expect(expandShorthands({ flex: 'none' })).toMatchObject({
      'flex-grow': '0',
      'flex-shrink': '0',
      'flex-basis': 'auto'
    })
    expect(expandShorthands({ flex: '2' })).toMatchObject({
      'flex-grow': '2',
      'flex-shrink': '1',
      'flex-basis': '0%'
    })
    expect(expandShorthands({ flex: '10px' })).toMatchObject({
      'flex-grow': '1',
      'flex-shrink': '1',
      'flex-basis': '10px'
    })
    expect(expandShorthands({ flex: '2 3' })).toMatchObject({
      'flex-grow': '2',
      'flex-shrink': '3',
      'flex-basis': '0%'
    })
    expect(expandShorthands({ flex: '2 10px' })).toMatchObject({
      'flex-grow': '2',
      'flex-shrink': '1',
      'flex-basis': '10px'
    })
    expect(expandShorthands({ flex: '2 3 10px' })).toMatchObject({
      'flex-grow': '2',
      'flex-shrink': '3',
      'flex-basis': '10px'
    })

    expect(expandShorthands({ 'grid-row': 'span 2 / 4' })).toMatchObject({
      'grid-row-span': '2',
      'grid-row-end': '4'
    })
    expect(expandShorthands({ 'grid-column': '1 / span 3' })).toMatchObject({
      'grid-column-start': '1',
      'grid-column-span': '3'
    })

    const multiBg = expandShorthands({
      background: 'linear-gradient(red, blue), url("x.png") center / cover no-repeat'
    })
    expect(multiBg.background).toContain('linear-gradient')

    const borderFallback = expandShorthands({ border: '1px solid' })
    expect(borderFallback).toMatchObject({
      'border-top-width': '1px',
      'border-top-style': 'solid'
    })
    expect(borderFallback).not.toHaveProperty('border-top-color')
  })

  it('covers shorthand fallback paths for background, grid and border parsing', () => {
    const gapSingle = expandShorthands({ gap: '12px' })
    expect(gapSingle).toMatchObject({
      'row-gap': '12px',
      'column-gap': '12px'
    })

    const bgUnparsed = expandShorthands({ background: 'red' })
    expect(bgUnparsed.background).toBe('red')

    const bgRepeatOnly = expandShorthands({ background: 'repeat-x' })
    expect(bgRepeatOnly).toMatchObject({
      'background-repeat': 'repeat-x'
    })
    expect(bgRepeatOnly).not.toHaveProperty('background-position')
    expect(bgRepeatOnly).not.toHaveProperty('background-size')
    expect(bgRepeatOnly).not.toHaveProperty('background-image')

    const bgImageOnly = expandShorthands({ background: 'url("img.png")' })
    expect(bgImageOnly).toMatchObject({
      'background-image': 'url("img.png")'
    })
    expect(bgImageOnly).not.toHaveProperty('background-position')
    expect(bgImageOnly).not.toHaveProperty('background-size')
    expect(bgImageOnly).not.toHaveProperty('background-repeat')

    const gridRowNoSlash = expandShorthands({ 'grid-row': 'auto' })
    expect(gridRowNoSlash['grid-row']).toBe('auto')
    expect(gridRowNoSlash).not.toHaveProperty('grid-row-start')

    const gridColumnNoSlash = expandShorthands({ 'grid-column': 'auto' })
    expect(gridColumnNoSlash['grid-column']).toBe('auto')
    expect(gridColumnNoSlash).not.toHaveProperty('grid-column-start')

    const blankBorder = expandShorthands({ border: '   ' })
    expect(blankBorder).toEqual({})
  })
})

describe('utils/css serializeCSS regression paths', () => {
  const baseOptions = {
    useRem: false,
    rootFontSize: 16,
    scale: 1
  }

  it('serializes normal styles without gradient border', () => {
    const code = serializeCSS(
      {
        width: '16px',
        color: '#ff000080',
        border: '1px solid #000'
      },
      baseOptions
    )

    expect(code).toContain('width: 16px;')
    expect(code).toContain('color: rgba(255, 0, 0, 0.5);')
    expect(code).toContain('border: 1px solid #000;')
    expect(code).not.toContain('&::before')
  })

  it('builds gradient border pseudo-element output with ring mask fields', () => {
    const code = serializeCSS(
      {
        'border-image': 'linear-gradient(180deg, red, blue) 1',
        'border-width': '1px',
        'border-radius': '8px'
      },
      baseOptions
    )

    expect(code).toContain('border-radius: 8px;')
    expect(code).toContain('border: 1px solid transparent;')
    expect(code).toContain('&::before {')
    expect(code).toContain('inset: -1px;')
    expect(code).not.toContain('-webkit-mask:')
    expect(code).toContain('mask-composite: exclude;')
  })

  it('uses calc fallback for non-literal border width and handles clipping mode', () => {
    const code = serializeCSS(
      {
        'border-image': 'linear-gradient(red, blue) 1',
        'border-width': 'var(--ring-width)',
        overflow: 'hidden'
      },
      baseOptions
    )

    expect(code).toContain('&::before {')
    expect(code).toContain('inset: 0;')
    expect(code).toContain('padding: var(--ring-width);')
    expect(code).not.toContain('border: var(--ring-width) solid transparent;')
  })

  it('uses calc fallback when preserving border with expression width', () => {
    const code = serializeCSS(
      {
        'border-image': 'linear-gradient(red, blue) 1',
        'border-width': 'calc(1px + var(--ring))'
      },
      baseOptions
    )

    expect(code).toContain('inset: calc(-1 * calc(1px + var(--ring)));')
  })

  it('keeps plain serialization when border width is zero', () => {
    const code = serializeCSS(
      {
        'border-image': 'linear-gradient(red, blue) 1',
        'border-width': '0px'
      },
      baseOptions
    )

    expect(code).not.toContain('&::before')
    expect(code).toContain('border-image: linear-gradient(red, blue) 1;')
  })

  it('returns empty string when all style values are falsy', () => {
    expect(
      serializeCSS(
        {
          width: '',
          color: ''
        },
        baseOptions
      )
    ).toBe('')
  })

  it('supports JS mode gradient border serialization and escaping', () => {
    const code = serializeCSS(
      {
        'border-image': 'linear-gradient("red\\",still-red", blue) 1',
        'border-top': '2px solid red',
        'border-right': '2px solid red',
        'border-bottom': '2px solid red',
        'border-left': '2px solid red',
        'font-family': "Author's Font"
      },
      { ...baseOptions, toJS: true }
    )

    expect(code).toContain('"&::before": {')
    expect(code).toContain("fontFamily: 'Author\\'s Font'")
    expect(code).toContain("padding: '2px'")
  })

  it('normalizes negative literal border width inset and side-width extraction', () => {
    const code = serializeCSS(
      {
        'border-image': 'linear-gradient(red, blue) 1',
        'border-top-width': '-2px',
        'border-right-width': '-2px',
        'border-bottom-width': '-2px',
        'border-left-width': '-2px'
      },
      baseOptions
    )

    expect(code).toContain('inset: 2px;')
    expect(code).toContain('padding: -2px;')
  })

  it('falls back to plain serialization for non-gradient or malformed border-image', () => {
    const nonGradient = serializeCSS(
      {
        'border-image': 'url("ring.png") 1',
        'border-width': '1px'
      },
      baseOptions
    )
    expect(nonGradient).not.toContain('&::before')
    expect(nonGradient).toContain('border-image: url("ring.png") 1;')

    const malformed = serializeCSS(
      {
        'border-image': 'linear-gradient(red, blue',
        'border-width': '1px'
      },
      baseOptions
    )
    expect(malformed).not.toContain('&::before')
    expect(malformed).toContain('border-image: linear-gradient(red, blue;')

    const missingWidth = serializeCSS(
      {
        'border-image': 'linear-gradient(red, blue) 1',
        'border-top': '2px solid red'
      },
      baseOptions
    )
    expect(missingWidth).not.toContain('&::before')
    expect(missingWidth).toContain('border-top: 2px solid red;')
  })

  it('supports border width inference from shorthand and side borders', () => {
    const borderShorthand = serializeCSS(
      {
        'border-image': 'linear-gradient(red, blue) 1',
        border: '2px solid red',
        color: ''
      },
      baseOptions
    )
    expect(borderShorthand).toContain('border: 2px solid transparent;')

    const sideShorthand = serializeCSS(
      {
        'border-image': 'linear-gradient(red, blue) 1',
        'border-top': '3px solid red',
        'border-right': '3px solid red',
        'border-bottom': '3px solid red',
        'border-left': '3px solid red'
      },
      baseOptions
    )
    expect(sideShorthand).toContain('border: 3px solid transparent;')
  })

  it('covers gradient-border fallback paths with missing/uneven/blank widths', () => {
    const nestedGradient = serializeCSS(
      {
        'border-image': 'linear-gradient(var(--ring-color, red), blue) 1',
        'border-width': '2px',
        position: 'absolute',
        isolation: 'auto',
        color: '   '
      },
      baseOptions
    )
    expect(nestedGradient).toContain('&::before')
    expect(nestedGradient).toContain('position: absolute;')
    expect(nestedGradient).toContain('isolation: auto;')
    expect(nestedGradient).toContain('border: 2px solid transparent;')

    const blankBorderFallback = serializeCSS(
      {
        'border-image': 'linear-gradient(red, blue) 1',
        border: '   '
      },
      baseOptions
    )
    expect(blankBorderFallback).not.toContain('&::before')

    const unevenSideWidths = serializeCSS(
      {
        'border-image': 'linear-gradient(red, blue) 1',
        'border-top-width': '1px',
        'border-right-width': '2px',
        'border-bottom-width': '1px',
        'border-left-width': '2px'
      },
      baseOptions
    )
    expect(unevenSideWidths).not.toContain('&::before')

    const blankSideBorder = serializeCSS(
      {
        'border-image': 'linear-gradient(red, blue) 1',
        'border-top': '   ',
        'border-right': '2px solid red',
        'border-bottom': '2px solid red',
        'border-left': '2px solid red'
      },
      baseOptions
    )
    expect(blankSideBorder).not.toContain('&::before')
  })

  it('handles variable transforms that collapse border shorthands to comment-only values', () => {
    const transformVariable = () => '/* stripped */'

    const shorthandCollapsed = serializeCSS(
      {
        'border-image': 'linear-gradient(red, blue) 1',
        border: 'var(--ring-width)'
      },
      baseOptions,
      { transformVariable }
    )
    expect(shorthandCollapsed).not.toContain('&::before')
    expect(shorthandCollapsed).toContain('border: /* stripped */;')

    const sideCollapsed = serializeCSS(
      {
        'border-image': 'linear-gradient(red, blue) 1',
        'border-top': 'var(--ring-width)'
      },
      baseOptions,
      { transformVariable }
    )
    expect(sideCollapsed).not.toContain('&::before')
    expect(sideCollapsed).toContain('border-top: /* stripped */;')
  })

  it('supports JS object mode and dynamic token stringification', () => {
    const code = serializeCSS(
      {
        color: '\0theme.colors.primary\0',
        content: 'prefix \0tokenValue\0 suffix'
      },
      { ...baseOptions, toJS: true, useRem: true, rootFontSize: 16, scale: 2 },
      {
        transform: ({ code }) => `${code}\n// transformed`
      }
    )

    expect(code).toContain('color: theme.colors.primary')
    expect(code).toContain('content: `prefix ${tokenValue} suffix`')
    expect(code).toContain('// transformed')
  })

  it('applies variable display modes and transform hooks', () => {
    const reference = serializeCSS(
      { color: 'var(--primary, #fff)' },
      { ...baseOptions, variableDisplay: 'reference' }
    )
    expect(reference).toContain('color: var(--primary);')

    const resolved = serializeCSS(
      {
        color: 'var(--primary, #11223380)',
        background: 'color-mix(in srgb, #112233 50%, transparent)'
      },
      { ...baseOptions, variableDisplay: 'resolved' }
    )
    expect(resolved).toContain('color: rgba(17, 34, 51, 0.5);')
    expect(resolved).toContain('background: rgba(17, 34, 51, 0.5);')

    const both = serializeCSS(
      {
        color: 'var(--brand, #fff)',
        width: '10px'
      },
      { ...baseOptions, variableDisplay: 'both' },
      {
        transformVariable: ({ name, value }) => `token(${name}:${value ?? ''})`,
        transformPx: ({ value }) => `${value / 2}u`
      }
    )
    expect(both).toContain('color: token(brand:#fff);')
    expect(both).toContain('width: 5u;')
  })

  it('covers variable transform fallback branches', () => {
    const resolvedNoFallback = serializeCSS(
      {
        color: 'var(--brand)'
      },
      { ...baseOptions, variableDisplay: 'resolved' }
    )
    expect(resolvedNoFallback).toContain('color: var(--brand);')

    const nonDashedVar = serializeCSS(
      {
        color: 'var(primary)'
      },
      { ...baseOptions, variableDisplay: 'both' },
      {
        transformVariable: ({ name }) => `token(${name})`
      }
    )
    expect(nonDashedVar).toContain('color: token(primary);')
  })

  it('uses rem fallback root when rootFontSize is falsy', () => {
    expect(
      normalizeCssValue('16px', {
        cssUnit: 'rem',
        rootFontSize: 0,
        scale: 1
      })
    ).toBe('1rem')
  })
})

describe('utils/css variable name normalization helpers', () => {
  it('canonicalizes variable names and var expressions', () => {
    expect(canonicalizeVarName('var(--foo, 16px)')).toBe('--foo')
    expect(canonicalizeVarName('--Bar$%')).toBe('--Bar')
    expect(canonicalizeVarName('color')).toBeNull()
    expect(canonicalizeVarName('var(foo)')).toBeNull()
    expect(canonicalizeVarName('')).toBeNull()

    expect(toVarExpr('foo')).toBe('var(--foo)')
    expect(normalizeCustomPropertyBody('---my var$')).toBe('myvar')
    expect(normalizeCustomPropertyBody('')).toBe('var')
    expect(normalizeCustomPropertyName('--05')).toBe('--05')
  })

  it('normalizes figma variable names and expressions', () => {
    expect(normalizeFigmaVarName('')).toBe('--unnamed')
    expect(normalizeFigmaVarName('Button / Primary')).toBe('--Button---Primary')
    expect(normalizeFigmaVarName('var(--Token Name)')).toBe('--Token-Name')
    expect(normalizeFigmaVarName('A B C')).toBe('--A-B-C')

    expect(toFigmaVarExpr('Button / Primary')).toBe('var(--Button---Primary)')
  })

  it('normalizes figma names via slow-path token merging', () => {
    expect(normalizeFigmaVarName('Foo (A) B C 12 34')).toBe('--foo-abc-1234')
    expect(normalizeFigmaVarName('Foo (A B) C D')).toBe('--foo-abcd')
    expect(normalizeFigmaVarName('Foo (a b c) d')).toBe('--foo-abcd')
    expect(normalizeFigmaVarName('@@@')).toBe('--unnamed')
    expect(normalizeFigmaVarName('foo.x.bar')).toBe('--foo-x-bar')
    expect(normalizeFigmaVarName(undefined as unknown as string)).toBe('--unnamed')
  })

  it('preprocesses css-like values, strips fallbacks and normalizes style values', () => {
    const preprocessed = preprocessCssValue('/* comment */ $foo + @bar')
    expect(preprocessed).toContain('var(--foo)')
    expect(preprocessed).toContain('var(--bar)')

    expect(stripFallback('var(--a, var(--b, 2px))')).toBe('var(--a)')
    expect(normalizeStyleValue(' /*x*/ var(--a, 0px) 0rem ')).toBe('var(--a) 0')
    expect(preprocessCssValue('')).toBe('')
    expect(normalizeStyleValue('')).toBe('')
  })
})

describe('utils/css text canonicalization helpers', () => {
  it('strips default text styles', () => {
    expect(
      stripDefaultTextStyles({
        'font-weight': 'normal',
        'line-height': 'normal',
        color: '#ffffff',
        'font-size': '16px'
      })
    ).toEqual({
      color: '#ffffff',
      'font-size': '16px'
    })
  })

  it('prunes inherited and default text styles in-place', () => {
    const style = {
      color: 'rgb(255,255,255)',
      'font-weight': '700',
      'text-decoration-style': 'solid',
      'line-height': 'normal'
    }

    pruneInheritedTextStyles(style, { color: '#fff', 'font-weight': 'bold' })

    expect(style).toEqual({})
  })

  it('canonicalizes values and colors', () => {
    expect(canonicalizeValue('line-height', ' normal ')).toBe('normal')
    expect(canonicalizeValue('font-weight', 'bold')).toBe('700')
    expect(canonicalizeValue('letter-spacing', '0px')).toBe('0')
    expect(canonicalizeValue('color', 'RGBA(255, 255, 255, 0.5)')).toBe('#fff/50')

    expect(canonicalizeColor('#AABBCC')).toBe('#ABC')
    expect(canonicalizeColor('rgb(255, 0, 0)')).toBe('#f00')
    expect(canonicalizeColor('rgba(0, 0, 0, 0.25)')).toBe('#000/25')
    expect(canonicalizeColor('rgb(zz, 0, 0)')).toBeNull()
    expect(canonicalizeColor('rgba(256, 0, 0, 1)')).toBeNull()
    expect(canonicalizeColor('not-a-color')).toBeNull()

    expect(canonicalizeValue('color', 'not-a-color')).toBe('not-a-color')
    expect(normalizeCustomPropertyBody('@@@')).toBe('var')
  })

  it('keeps non-default text style values when they are not inherited', () => {
    const style = {
      'font-style': 'italic',
      color: 'rgba(255, 0, 0, 1)'
    }

    pruneInheritedTextStyles(style, { color: '#000' })

    expect(style).toEqual({
      'font-style': 'italic',
      color: 'rgba(255, 0, 0, 1)'
    })
  })
})
