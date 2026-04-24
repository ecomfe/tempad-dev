import type { NodePaintStyleInput } from './types'

/**
 * Property mapping table for generic variable binding resolution
 * Maps Figma boundVariables keys to CSS property names
 * paragraphSpacing is  measured in pixels, so we don't need to convert it to CSS units
 */
export const TEXT_FIELD_CSS_PROPERTY_MAP: { [key in VariableBindableTextField]: string } = {
  fontFamily: 'font-family',
  fontSize: 'font-size',
  fontStyle: 'font-style',
  fontWeight: 'font-weight',
  letterSpacing: 'letter-spacing',
  lineHeight: 'line-height',
  paragraphSpacing: '',
  paragraphIndent: 'text-indent'
}

export function getTypography(node: SceneNode): NodePaintStyleInput['typography'] {
  const fontName =
    'fontName' in node && typeof node.fontName === 'object' ? node.fontName : undefined

  return {
    fontSize: 'fontSize' in node && typeof node.fontSize === 'number' ? node.fontSize : undefined,
    fontFamily: fontName && 'family' in fontName ? fontName.family : undefined,
    fontStyle: fontName && 'style' in fontName ? fontName.style : undefined,
    fontWeight:
      'fontWeight' in node && typeof node.fontWeight === 'number' ? node.fontWeight : undefined,
    letterSpacing:
      'letterSpacing' in node && typeof node.letterSpacing === 'object'
        ? node.letterSpacing
        : undefined,
    lineHeight:
      'lineHeight' in node && typeof node.lineHeight === 'object' ? node.lineHeight : undefined,
    paragraphSpacing:
      'paragraphSpacing' in node && typeof node.paragraphSpacing === 'number'
        ? node.paragraphSpacing
        : undefined,
    paragraphIndent:
      'paragraphIndent' in node && typeof node.paragraphIndent === 'number'
        ? node.paragraphIndent
        : undefined
  }
}

/**
 * Resolves css variable name and value to CSS var() expression
 */
export function resolveTypographyVariableBinding(
  cssVarName: string,
  textField: VariableBindableTextField,
  typographyValue: LineHeight | LetterSpacing | number | string
): string {
  if (!typographyValue) return ''

  let value = ''
  if (
    textField === 'fontSize' ||
    textField === 'paragraphIndent' ||
    textField === 'paragraphSpacing'
  ) {
    value = `${typographyValue}px`
  } else if (textField === 'lineHeight' && typeof typographyValue === 'object') {
    const lineHeight = typographyValue as LineHeight
    if (lineHeight.unit === 'AUTO') {
      value = 'normal'
    } else {
      value = `${lineHeight.value}${lineHeight.unit === 'PERCENT' ? '%' : 'px'}`
    }
  } else if (textField === 'letterSpacing' && typeof typographyValue === 'object') {
    const letterSpacing = typographyValue as LetterSpacing
    value = `${letterSpacing.value}${letterSpacing.unit === 'PERCENT' ? '%' : 'px'}`
  } else if (
    textField === 'fontFamily' ||
    textField === 'fontStyle' ||
    textField === 'fontWeight'
  ) {
    value = '' + (typographyValue as string | number)
  }

  return `var(${cssVarName.startsWith('--') ? cssVarName : `--${cssVarName}`}, ${value})`
}
