import type { CanvasFigmaTextRange, CanvasVariableReference } from '@tempad-dev/shared'

import type { ApplyState } from './state'

import { applyError } from '../errors'
import { resolveFamilyFont } from '../fonts'
import { resolveStyle } from '../styles'
import { resolveVariable } from '../variables'
import {
  fontNamesEqual,
  nativeValueEqual,
  scalarValuesEqual,
  textMeasuresEqual
} from './comparison'
import { TEXT_STYLE_VARIABLES_BY_VALUE } from './text-fonts'
import { textParagraphRange, textRangesMatchOutside } from './text-ranges'

const READERS = {
  fontName: (node: TextNode, start: number, end: number) => node.getRangeFontName(start, end),
  fontSize: (node: TextNode, start: number, end: number) => node.getRangeFontSize(start, end),
  lineHeight: (node: TextNode, start: number, end: number) => node.getRangeLineHeight(start, end),
  letterSpacing: (node: TextNode, start: number, end: number) =>
    node.getRangeLetterSpacing(start, end),
  textCase: (node: TextNode, start: number, end: number) => node.getRangeTextCase(start, end),
  textDecoration: (node: TextNode, start: number, end: number) =>
    node.getRangeTextDecoration(start, end),
  paragraphIndent: (node: TextNode, start: number, end: number) =>
    node.getRangeParagraphIndent(start, end),
  paragraphSpacing: (node: TextNode, start: number, end: number) =>
    node.getRangeParagraphSpacing(start, end),
  listSpacing: (node: TextNode, start: number, end: number) => node.getRangeListSpacing(start, end),
  textWrapStyle: (node: TextNode, start: number, end: number) =>
    node.getRangeTextWrapStyle(start, end)
}
type Field = keyof typeof READERS
type RangeStyleValues = Pick<TextStyle, Field>
type RangeStyleState = {
  style: TextStyle
  values: RangeStyleValues
  aliases: Partial<Record<VariableBindableTextField, string>>
  namedFont: boolean
  detaches: boolean
}

const LINK_PRESERVING_FIELDS = new Set([
  'start',
  'end',
  'textStyle',
  'fills',
  'fillStyle',
  'textDecoration',
  'hyperlink'
])
const VARIABLE_FIELDS = [
  'fontFamily',
  'fontStyle',
  'fontWeight',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'paragraphIndent',
  'paragraphSpacing'
] as const satisfies readonly VariableBindableTextField[]
export function rangeHasSemanticTextOverrides(
  node: TextNode,
  range: CanvasFigmaTextRange,
  state: ApplyState
): boolean {
  if (!rangeNeedsTextStyleComposition(range)) return false
  const ranges = state.textRangeSemanticOverrides
  const key = `${node.id}:${range.start}:${range.end}`
  const known = ranges.get(key)
  if (known !== undefined) return known
  const retained = node
    .getStyledTextSegments(['textStyleOverrides'], range.start, range.end)
    .some((segment) => segment.textStyleOverrides?.length)
  ranges.set(key, retained)
  return retained
}

export function rangeNeedsTextStyleComposition(range: CanvasFigmaTextRange): boolean {
  return !!range.textStyle && Object.keys(range).some((field) => !LINK_PRESERVING_FIELDS.has(field))
}

async function applyVariableValue(
  values: RangeStyleValues,
  field: VariableBindableTextField,
  reference: CanvasVariableReference,
  node: TextNode,
  state: ApplyState
): Promise<string> {
  const variable = await resolveVariable(reference, state.variables)
  const value = variable.resolveForConsumer(node).value
  if (field === 'fontFamily' || field === 'fontStyle') {
    if (typeof value !== 'string') applyError('A text font variable did not resolve to a string.')
    if (field === 'fontFamily') {
      if (values.fontName.family !== value) {
        values.fontName = await resolveFamilyFont(value, values.fontName.style, state.fonts)
      }
    } else if (values.fontName.style !== value) {
      values.fontName = { family: values.fontName.family, style: value }
    }
  } else {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      applyError('A text typography variable did not resolve to a finite number.')
    }
    if (field === 'lineHeight' || field === 'letterSpacing') {
      values[field] = { unit: 'PIXELS', value }
    } else if (
      field === 'fontSize' ||
      field === 'paragraphIndent' ||
      field === 'paragraphSpacing'
    ) {
      values[field] = value
    }
  }
  return variable.id
}

export async function resolvedRangeTextStyle(
  node: TextNode,
  range: CanvasFigmaTextRange,
  state: ApplyState
): Promise<RangeStyleState | null> {
  if (!range.textStyle || !rangeNeedsTextStyleComposition(range)) {
    return null
  }
  if (rangeHasSemanticTextOverrides(node, range, state)) return null
  const style = (await resolveStyle(range.textStyle, state.styles)) as TextStyle
  // A weight variable may select an unnamed variable-font instance. Font
  // loading's nearest named face does not prove that instance's exact identity.
  if (style.boundVariables?.fontWeight || range.variables?.fontWeight) return null
  const values = Object.fromEntries(
    Object.keys(READERS).map((field) => [field, style[field as Field]])
  ) as RangeStyleValues
  const aliases: RangeStyleState['aliases'] = {}
  let detaches = false
  // Match native order: style defaults in the consumer's mode, literal
  // overrides (which clear their bindings), then explicit range bindings.
  for (const field of VARIABLE_FIELDS) {
    const alias = style.boundVariables?.[field]
    if (alias)
      aliases[field] = await applyVariableValue(values, field, { id: alias.id }, node, state)
  }
  for (const field of Object.keys(READERS) as Field[]) {
    if (field === 'textWrapStyle' || range[field] === undefined) continue
    if (fieldMatches(field, values[field], range[field], field === 'fontName')) continue
    Object.assign(values, { [field]: range[field] })
    for (const variable of TEXT_STYLE_VARIABLES_BY_VALUE[field]) delete aliases[variable]
    if (!LINK_PRESERVING_FIELDS.has(field)) detaches = true
  }
  for (const [field, reference] of Object.entries(range.variables ?? {}) as Array<
    [VariableBindableTextField, CanvasVariableReference | null]
  >) {
    const previous = aliases[field]
    if (reference === null) delete aliases[field]
    else aliases[field] = await applyVariableValue(values, field, reference, node, state)
    if (previous !== aliases[field]) detaches = true
  }
  const unknownOverrides = Object.keys(range).some(
    (field) => !LINK_PRESERVING_FIELDS.has(field) && !(field in READERS) && field !== 'variables'
  )
  // Unknown-only combinations retain their previous acceptance. A known
  // typography override still permits checking its composed style defaults.
  if (!detaches && unknownOverrides) return null
  return { style, values, aliases, namedFont: range.fontName !== undefined, detaches }
}

function fieldMatches(
  field: Field,
  current: unknown,
  desired: unknown,
  namedFont: boolean
): boolean {
  if (field === 'fontName') {
    if (!fontNamesEqual(current as FontName | typeof figma.mixed, desired as FontName)) return false
    // The authored font schema names a face. Native styles can additionally own
    // variable-font axes, whose changes must not disappear during convergence.
    const axes = (desired as FontName).variationSettings
    return (
      namedFont ||
      axes === undefined ||
      nativeValueEqual((current as FontName).variationSettings, axes)
    )
  }
  if (field === 'lineHeight' || field === 'letterSpacing') {
    return textMeasuresEqual(
      field,
      current as LineHeight | LetterSpacing | typeof figma.mixed,
      desired as LineHeight | LetterSpacing
    )
  }
  return scalarValuesEqual(current, desired)
}

function effectiveFieldMatches(
  node: TextNode,
  range: CanvasFigmaTextRange,
  field: Field,
  laterRanges: readonly CanvasFigmaTextRange[],
  matches: (start: number, end: number) => boolean
): boolean {
  if (field !== 'paragraphIndent' && field !== 'paragraphSpacing' && field !== 'textWrapStyle') {
    return matches(range.start, range.end)
  }
  const overrides = laterRanges
    .filter(
      (later) =>
        later.textStyle ||
        (field !== 'textWrapStyle' && (later[field] !== undefined || later.variables?.[field]))
    )
    .map((later) => textParagraphRange(node.characters, later))
  return textRangesMatchOutside(textParagraphRange(node.characters, range), overrides, matches)
}

export function rangeTextStyleMatches(
  node: TextNode,
  range: CanvasFigmaTextRange,
  expected: RangeStyleState,
  laterRanges: readonly CanvasFigmaTextRange[]
): boolean {
  const currentStyle = node.getRangeTextStyleId(range.start, range.end)
  if (currentStyle !== '' && currentStyle !== expected.style.id) return false
  if (!currentStyle && !expected.detaches) return false
  for (const field of Object.keys(READERS) as Field[]) {
    const desired = expected.values[field]
    if (desired === undefined) continue
    if (
      !effectiveFieldMatches(node, range, field, laterRanges, (start, end) =>
        fieldMatches(field, READERS[field](node, start, end), desired, expected.namedFont)
      )
    )
      return false
  }
  for (const field of VARIABLE_FIELDS) {
    const valueField =
      field === 'fontFamily' || field === 'fontStyle' || field === 'fontWeight' ? 'fontName' : field
    if (
      !effectiveFieldMatches(node, range, valueField, laterRanges, (start, end) => {
        const current = node.getRangeBoundVariable(start, end, field)
        return current !== figma.mixed && current?.id === expected.aliases[field]
      })
    )
      return false
  }
  return true
}

export function rangeTextStyleCanSkip(node: TextNode, expected: RangeStyleState): boolean {
  // These native style fields have no range getter. A whole-node mismatch
  // cannot prove a no-op, but is not evidence of an invalid range override.
  return (['leadingTrim', 'hangingPunctuation', 'hangingList'] as const).every(
    (field) => expected.style[field] === undefined || node[field] === expected.style[field]
  )
}
