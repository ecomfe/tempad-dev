import type {
  CanvasHyperlink,
  CanvasStyleReference,
  CanvasFigmaTextRange,
  CanvasVariableReference
} from '@tempad-dev/shared'

import type { CanvasNodeSpec } from '../model'

import { applyError, specError } from '../errors'
import { resolveStyle } from '../styles'
import { resolvedVariable } from '../variables'
import { currentBoundVariableId, unboundTextMetricRanges } from './binding-values'
import {
  textMeasuresEqual,
  hyperlinksEqual,
  nativeValueEqual,
  fontNamesEqual,
  scalarValuesEqual
} from './comparison'
import { preservesComponentPropertyReference } from './components'
import { nativePaint, paintStacksEqual } from './native-values'
import { isCanvasKeyHyperlink, nativeHyperlink } from './nodes'
import { type ApplyState, markMutation, setValue } from './state'
import { loadTextFonts, loadVariableFonts, TEXT_STYLE_VARIABLES_BY_VALUE } from './text-fonts'
import { textParagraphs, type TextParagraph } from './text-paragraphs'
import {
  rangeTextStyleCanSkip,
  rangeTextStyleMatches,
  resolvedRangeTextStyle
} from './text-range-style'
import {
  textParagraphRanges,
  textRangeWithTrailingNewline,
  textRangesIntersect,
  textRangesMatchOutside,
  textRangesOutside,
  type TextRange
} from './text-ranges'
import { baseTextStyleScope, type BaseTextStyleScope } from './text-style-scope'

export async function applyText(
  node: TextNode,
  spec: CanvasNodeSpec,
  state: ApplyState
): Promise<void> {
  const text = spec.text
  if (!text) return
  const native = spec.figma?.text
  const styleScope = baseTextStyleScope(spec, node)
  const desiredFont = await loadTextFonts(node, spec, state, styleScope)
  const hasTextStyle = styleScope.kind === 'retained'
  setStyledBaseTextValue(
    node,
    'fontName',
    desiredFont ?? undefined,
    {
      current: node.fontName,
      apply: (value) => (node.fontName = value),
      applyRange: (start, end, value) => node.setRangeFontName(start, end, value),
      readRange: (start, end) => node.getRangeFontName(start, end),
      equal: fontNamesEqual
    },
    node.characters === text.characters ? native?.ranges : undefined,
    state,
    styleScope
  )
  setValue(node, node.autoRename, native?.autoRename, (value) => (node.autoRename = value), state)
  setValue(
    node,
    node.characters,
    preservesComponentPropertyReference(node, spec, 'characters') ||
      spec.variables?.characters ||
      currentBoundVariableId(node, 'characters')
      ? undefined
      : text.characters,
    (value) => (node.characters = value),
    state
  )
  // Character replacement can change both the range boundaries and their aliases.
  const variableRanges = {
    fontSize: unboundTextMetricRanges(node, spec, 'fontSize'),
    lineHeight: unboundTextMetricRanges(node, spec, 'lineHeight'),
    letterSpacing: unboundTextMetricRanges(node, spec, 'letterSpacing'),
    paragraphIndent: unboundTextMetricRanges(node, spec, 'paragraphIndent'),
    paragraphSpacing: unboundTextMetricRanges(node, spec, 'paragraphSpacing')
  }
  setStyledBaseTextValue(
    node,
    'fontSize',
    hasTextStyle ? undefined : text.fontSize,
    {
      current: node.fontSize,
      apply: (value) => (node.fontSize = value),
      applyRange: (start, end, value) => node.setRangeFontSize(start, end, value),
      readRange: (start, end) => node.getRangeFontSize(start, end)
    },
    native?.ranges,
    state,
    styleScope,
    variableRanges.fontSize
  )
  setStyledBaseTextValue(
    node,
    'lineHeight',
    hasTextStyle ? undefined : text.lineHeight,
    {
      current: node.lineHeight,
      apply: (value) => (node.lineHeight = value),
      applyRange: (start, end, value) => node.setRangeLineHeight(start, end, value),
      readRange: (start, end) => node.getRangeLineHeight(start, end),
      equal: (current, desired) => textMeasuresEqual('lineHeight', current, desired)
    },
    native?.ranges,
    state,
    styleScope,
    variableRanges.lineHeight
  )
  setStyledBaseTextValue(
    node,
    'letterSpacing',
    hasTextStyle ? undefined : text.letterSpacing,
    {
      current: node.letterSpacing,
      apply: (value) => (node.letterSpacing = value),
      applyRange: (start, end, value) => node.setRangeLetterSpacing(start, end, value),
      readRange: (start, end) => node.getRangeLetterSpacing(start, end),
      equal: (current, desired) => textMeasuresEqual('letterSpacing', current, desired)
    },
    native?.ranges,
    state,
    styleScope,
    variableRanges.letterSpacing
  )
  setValue(
    node,
    node.textAlignHorizontal,
    text.alignHorizontal,
    (value) => (node.textAlignHorizontal = value),
    state
  )
  setValue(
    node,
    node.textAlignVertical,
    text.alignVertical,
    (value) => (node.textAlignVertical = value),
    state
  )
  setStyledBaseTextValue(
    node,
    'textCase',
    native?.case ?? (hasTextStyle ? undefined : text.textCase),
    {
      current: node.textCase,
      apply: (value) => (node.textCase = value),
      applyRange: (start, end, value) => node.setRangeTextCase(start, end, value),
      readRange: (start, end) => node.getRangeTextCase(start, end)
    },
    native?.ranges,
    state,
    native?.case !== undefined ? { kind: 'whole' } : styleScope
  )
  setStyledBaseTextValue(
    node,
    'textDecoration',
    hasTextStyle ? undefined : text.textDecoration,
    {
      current: node.textDecoration,
      apply: (value) => (node.textDecoration = value),
      applyRange: (start, end, value) => node.setRangeTextDecoration(start, end, value),
      readRange: (start, end) => node.getRangeTextDecoration(start, end)
    },
    native?.ranges,
    state,
    styleScope
  )
  setValue(
    node,
    node.textTruncation,
    text.textTruncation,
    (value) => (node.textTruncation = value),
    state
  )
  setValue(node, node.maxLines, text.maxLines, (value) => (node.maxLines = value), state)
  setValue(
    node,
    node.textAutoResize,
    text.autoResize,
    (value) => (node.textAutoResize = value),
    state
  )
  setBaseParagraphValue(
    node,
    'paragraphIndent',
    native?.paragraphIndent,
    {
      current: node.paragraphIndent,
      apply: (value) => (node.paragraphIndent = value),
      applyRange: (start, end, value) => node.setRangeParagraphIndent(start, end, value),
      readRange: (start, end) => node.getRangeParagraphIndent(start, end)
    },
    native?.ranges,
    state,
    variableRanges.paragraphIndent
  )
  setBaseParagraphValue(
    node,
    'paragraphSpacing',
    native?.paragraphSpacing,
    {
      current: node.paragraphSpacing,
      apply: (value) => (node.paragraphSpacing = value),
      applyRange: (start, end, value) => node.setRangeParagraphSpacing(start, end, value),
      readRange: (start, end) => node.getRangeParagraphSpacing(start, end)
    },
    native?.ranges,
    state,
    variableRanges.paragraphSpacing
  )
  setBaseParagraphValue(
    node,
    'listSpacing',
    native?.listSpacing,
    {
      current: node.listSpacing,
      apply: (value) => (node.listSpacing = value),
      applyRange: (start, end, value) => node.setRangeListSpacing(start, end, value),
      readRange: (start, end) => node.getRangeListSpacing(start, end)
    },
    native?.ranges,
    state
  )
  setValue(
    node,
    node.hangingPunctuation,
    native?.hangingPunctuation,
    (value) => (node.hangingPunctuation = value),
    state
  )
  setValue(
    node,
    node.hangingList,
    native?.hangingList,
    (value) => (node.hangingList = value),
    state
  )
  setValue(
    node,
    node.leadingTrim,
    native?.leadingTrim,
    (value) => (node.leadingTrim = value),
    state
  )
  if (!isCanvasKeyHyperlink(native?.hyperlink)) {
    applyTextHyperlink(node, native?.hyperlink, state, native?.ranges)
  }
}

type BaseTextField =
  | 'fontName'
  | 'fontSize'
  | 'lineHeight'
  | 'letterSpacing'
  | 'textCase'
  | 'textDecoration'
  | 'hyperlink'

type BaseParagraphField = 'paragraphIndent' | 'paragraphSpacing' | 'listSpacing'

function rangeOwnsTextField(
  range: CanvasFigmaTextRange,
  field: BaseTextField | BaseParagraphField
): boolean {
  if (range[field] !== undefined) return true
  if (field === 'hyperlink') return false
  if (range.textStyle) return true
  if (field === 'fontName') {
    return TEXT_STYLE_VARIABLES_BY_VALUE.fontName.some((variable) => range.variables?.[variable])
  }
  if (field === 'textCase' || field === 'textDecoration' || field === 'listSpacing') return false
  return !!range.variables?.[field]
}

type TextValueAccess<T> = {
  current: T | typeof figma.mixed
  apply: (value: T) => void
  readRange: (start: number, end: number) => T | typeof figma.mixed
  equal?: (current: T | typeof figma.mixed, desired: T) => boolean
}

function setStyledBaseTextValue<T>(
  node: TextNode,
  field: BaseTextField,
  desired: T | undefined,
  access: TextValueAccess<T> & { applyRange: (start: number, end: number, value: T) => void },
  ranges: CanvasFigmaTextRange[] | undefined,
  state: ApplyState,
  styleScope: BaseTextStyleScope,
  variableRanges?: TextRange[]
): void {
  if (desired === undefined || variableRanges?.length === 0) return
  if (styleScope.kind !== 'partial' && !variableRanges) {
    setBaseTextValue(node, field, desired, access, ranges, state)
    return
  }
  // Restrict writes, not only comparisons, to characters whose existing styles
  // and variables do not own the field.
  const whole = { start: 0, end: node.characters.length }
  const styleRanges = styleScope.kind === 'partial' ? styleScope.ranges : [whole]
  for (const scope of textRangesIntersect(styleRanges, variableRanges ?? [whole])) {
    setBaseTextValue(
      node,
      field,
      desired,
      {
        current: access.readRange(scope.start, scope.end),
        apply: (value) => access.applyRange(scope.start, scope.end, value),
        readRange: access.readRange,
        equal: access.equal
      },
      ranges,
      state,
      scope
    )
  }
}

function setBaseTextValue<T>(
  node: TextNode,
  field: BaseTextField,
  desired: T | undefined,
  { current, apply, readRange, equal = scalarValuesEqual }: TextValueAccess<T>,
  ranges: CanvasFigmaTextRange[] | undefined,
  state: ApplyState,
  scope = { start: 0, end: node.characters.length }
): void {
  if (desired === undefined || equal(current, desired)) return
  if (ranges?.length) {
    const overrides = ranges
      .filter((range) => rangeOwnsTextField(range, field))
      .map((range) =>
        (field === 'fontSize' || field === 'lineHeight' || field === 'letterSpacing') &&
        (range[field] !== undefined || range.variables?.[field])
          ? textRangeWithTrailingNewline(node.characters, range)
          : range
      )
    if (
      textRangesMatchOutside(scope, overrides, (start, end) =>
        equal(readRange(start, end), desired)
      )
    )
      return
  }
  // Compare only spans not owned by later overrides. Actual changes retain the
  // existing setter and subsequent range restoration.
  apply(desired)
  markMutation(state, node)
}

function setBaseParagraphValue(
  node: TextNode,
  field: BaseParagraphField,
  desired: number | undefined,
  access: TextValueAccess<number> & {
    applyRange: (start: number, end: number, value: number) => void
  },
  ranges: CanvasFigmaTextRange[] | undefined,
  state: ApplyState,
  variableRanges?: TextRange[]
): void {
  if (desired === undefined || variableRanges?.length === 0) return
  if (!node.characters.length) {
    setValue(node, access.current, desired, access.apply, state)
    return
  }
  const owned = (ranges ?? []).filter((range) => rangeOwnsTextField(range, field))
  const overrides = textParagraphRanges(node.characters, owned)
  // Native whole-node paragraph writes leave existing range values intact.
  // Set only the paragraphs not owned by the later range declarations.
  const scope = { start: 0, end: node.characters.length }
  const writable = [...textRangesOutside(scope, overrides)]
  for (const { start, end } of textRangesIntersect(writable, variableRanges ?? [scope])) {
    setValue(
      node,
      access.readRange(start, end),
      desired,
      (value) => access.applyRange(start, end, value),
      state
    )
  }
}

function setTextMeasure<T extends LineHeight | LetterSpacing>(
  node: TextNode,
  field: 'lineHeight' | 'letterSpacing',
  current: T | typeof figma.mixed,
  desired: T | undefined,
  apply: (value: T) => void,
  state: ApplyState
): void {
  if (desired === undefined || textMeasuresEqual(field, current, desired)) return
  apply(desired)
  markMutation(state, node)
}

export function applyTextHyperlink(
  node: TextNode,
  hyperlink: CanvasHyperlink | undefined,
  state: ApplyState,
  ranges: CanvasFigmaTextRange[] | undefined
): void {
  const desired = nativeHyperlink(hyperlink, state)
  setBaseTextValue(
    node,
    'hyperlink',
    desired,
    {
      current: node.hyperlink,
      apply: (value) => (node.hyperlink = value),
      readRange: (start, end) => node.getRangeHyperlink(start, end),
      equal: hyperlinksEqual
    },
    ranges,
    state
  )
}

function applyTextRangeValue<T>(
  node: TextNode,
  current: T | typeof figma.mixed | null,
  desired: T | undefined,
  apply: (value: T) => void,
  state: ApplyState,
  equal: (current: T | typeof figma.mixed | null, desired: T) => boolean = nativeValueEqual
): void {
  if (desired === undefined || equal(current, desired)) return
  apply(desired)
  markMutation(state, node)
}

async function applyTextRangeStyle(
  node: TextNode,
  reference: CanvasStyleReference | null | undefined,
  current: () => string | typeof figma.mixed,
  apply: (id: string) => Promise<void>,
  state: ApplyState,
  force = false
): Promise<void> {
  if (reference === undefined) return
  const styleId = reference ? (await resolveStyle(reference, state.styles)).id : ''
  if (current() === styleId && !force) return
  await apply(styleId)
  markMutation(state, node)
}

function applyTextRangeFills(node: TextNode, range: CanvasFigmaTextRange, state: ApplyState): void {
  if (range.fills === undefined) return
  const desired = range.fills.map((paint) => nativePaint(paint, state))
  const current = node.getRangeFills(range.start, range.end)
  const style = node.getRangeFillStyleId(range.start, range.end)
  if (current !== figma.mixed && !style && paintStacksEqual(current, desired)) return
  node.setRangeFills(range.start, range.end, desired)
  markMutation(state, node)
}

function nativeTextDecorationColor(
  range: CanvasFigmaTextRange,
  state: ApplyState
): TextDecorationColor | undefined {
  const color = range.textDecorationColor
  if (!color || color.value === 'AUTO') return color
  return { value: nativePaint(color.value, state) as SolidPaint }
}

async function paragraphUnbindingRange(
  node: TextNode,
  paragraphs: readonly TextParagraph[],
  index: number,
  field: 'paragraphIndent' | 'paragraphSpacing',
  state: ApplyState
): Promise<TextRange> {
  const span = paragraphs[index]!.span
  for (let laterIndex = index + 1; laterIndex < paragraphs.length; laterIndex++) {
    const later = paragraphs[laterIndex]!
    if (later.span.start >= span.end) break
    let ownsBinding = !!later.range.variables?.[field]
    if (!ownsBinding && later.range.textStyle) {
      const style = await resolveStyle(later.range.textStyle, state.styles)
      const desired = style.type === 'TEXT' ? style.boundVariables?.[field] : undefined
      if (desired) {
        const current = node.getRangeBoundVariable(later.span.start, span.end, field)
        // A retained style can have semantic overrides. Preserve its own alias,
        // not a different one that an equal literal may leave untouched.
        ownsBinding =
          node.getRangeTextStyleId(later.range.start, later.range.end) !== style.id ||
          (current !== figma.mixed && current?.id === desired.id)
      }
    }
    if (ownsBinding) {
      return { start: span.start, end: later.span.start }
    }
  }
  return span
}

async function applyTextRangeVariables(
  node: TextNode,
  paragraphs: readonly TextParagraph[],
  index: number,
  state: ApplyState
): Promise<void> {
  const paragraph = paragraphs[index]!
  const range = paragraph.range
  await loadVariableFonts(node, range.variables, state, range)
  for (const [field, reference] of Object.entries(range.variables ?? {}) as Array<
    [VariableBindableTextField, CanvasVariableReference | null]
  >) {
    const variable = reference ? resolvedVariable(reference, state.variables) : null
    // Null setters need complete paragraphs, but must leave a later binding
    // owner intact. An equal literal alone does not own the alias.
    const bindingRange =
      !variable && (field === 'paragraphIndent' || field === 'paragraphSpacing')
        ? await paragraphUnbindingRange(node, paragraphs, index, field, state)
        : range
    if (bindingRange.start === bindingRange.end) continue
    const comparisonRange =
      field === 'fontSize' || field === 'lineHeight' || field === 'letterSpacing'
        ? textRangeWithTrailingNewline(node.characters, bindingRange)
        : bindingRange
    const current = node.getRangeBoundVariable(comparisonRange.start, comparisonRange.end, field)
    if (current !== figma.mixed && current?.id === variable?.id) continue
    if (variable && (field === 'paragraphIndent' || field === 'paragraphSpacing')) {
      const scope = paragraph.effective[field]
      const alias =
        scope.start < scope.end
          ? node.getRangeBoundVariable(scope.start, scope.end, field)
          : undefined
      const unchanged =
        scope.start === scope.end || (alias !== figma.mixed && alias?.id === variable.id)
      const overriding: TextParagraph[] = []
      for (let laterIndex = index + 1; laterIndex < paragraphs.length; laterIndex++) {
        const later = paragraphs[laterIndex]!
        if (later.span.start >= paragraph.span.end) break
        if (rangeOwnsTextField(later.range, field)) overriding.push(later)
      }
      if (unchanged && overriding.length) {
        // An equal later literal may skip its native setter. Do not let its value
        // ownership retain a different alias or swallow an explicit null unbinding.
        const value = variable.resolveForConsumer(node).value
        const clearsBinding = overriding.every(
          (later) =>
            later.range.textStyle === undefined &&
            later.range.variables?.[field] === undefined &&
            later.range[field] !== undefined &&
            !scalarValuesEqual(value, later.range[field])
        )
        // The later setter can also clear aliases beyond the earlier range.
        const unbound = overriding.every(({ span }) => {
          const alias = node.getRangeBoundVariable(span.start, span.end, field)
          return alias !== figma.mixed && !alias
        })
        if (clearsBinding && unbound) continue
      }
    }
    node.setRangeBoundVariable(bindingRange.start, bindingRange.end, field, variable)
    markMutation(state, node)
    if (!variable) ensureTextRangeUnbound(node, comparisonRange, field, state)
  }
}

function ensureTextRangeUnbound(
  node: TextNode,
  range: TextRange,
  field: VariableBindableTextField,
  state: ApplyState
): void {
  if (field === 'paragraphIndent' || field === 'paragraphSpacing') {
    // Native null can retain a paragraph alias even for a complete paragraph.
    // Force its current literal, separately for each paragraph so mixed values
    // survive, and require the alias to disappear before later owners run.
    let start = range.start
    while (start < range.end) {
      const newline = node.characters.indexOf('\n', start)
      const end = Math.min(range.end, newline === -1 ? node.characters.length : newline + 1)
      const alias = node.getRangeBoundVariable(start, end, field)
      if (alias) {
        const value =
          field === 'paragraphIndent'
            ? node.getRangeParagraphIndent(start, end)
            : node.getRangeParagraphSpacing(start, end)
        if (value !== figma.mixed) {
          if (field === 'paragraphIndent') node.setRangeParagraphIndent(start, end, value)
          else node.setRangeParagraphSpacing(start, end, value)
          markMutation(state, node)
        }
      }
      start = end
    }
  } else if (field !== 'fontSize' && field !== 'lineHeight' && field !== 'letterSpacing') {
    return
  }
  if (node.getRangeBoundVariable(range.start, range.end, field)) {
    applyError(
      `Verification failed for TEXT node "${node.id}": range variable link "${field}" was not cleared.`
    )
  }
}

export async function applyTextRanges(
  node: TextNode,
  ranges: CanvasFigmaTextRange[] | undefined,
  state: ApplyState
): Promise<void> {
  const paragraphs = textParagraphs(node.characters, ranges ?? [])
  for (const [index, paragraph] of paragraphs.entries()) {
    const range = paragraph.range
    if (range.end > node.characters.length) {
      specError(
        `Text range ${range.start}:${range.end} exceeds TEXT node "${node.id}" with ${node.characters.length} UTF-16 code units.`
      )
    }
    const composed = await resolvedRangeTextStyle(node, range, state)
    const matches = composed && rangeTextStyleMatches(node, range, composed, paragraph.effective)
    const unchanged = composed && matches && rangeTextStyleCanSkip(node, composed)
    const typography: CanvasFigmaTextRange = unchanged
      ? { start: range.start, end: range.end }
      : range
    if (!unchanged)
      await applyTextRangeStyle(
        node,
        range.textStyle,
        () => node.getRangeTextStyleId(range.start, range.end),
        (id) => node.setRangeTextStyleIdAsync(range.start, range.end, id),
        state,
        !!composed && !matches
      )
    await applyTextRangeStyle(
      node,
      range.fillStyle,
      () => node.getRangeFillStyleId(range.start, range.end),
      (id) => node.setRangeFillStyleIdAsync(range.start, range.end, id),
      state
    )
    applyTextRangeFills(node, range, state)
    applyTextRangeValue(
      node,
      node.getRangeFontName(range.start, range.end),
      typography.fontName,
      (value) => node.setRangeFontName(range.start, range.end, value),
      state,
      (current, desired) => current !== null && fontNamesEqual(current, desired)
    )
    applyTextRangeValue(
      node,
      node.getRangeFontSize(range.start, range.end),
      typography.fontSize,
      (value) => node.setRangeFontSize(range.start, range.end, value),
      state,
      scalarValuesEqual
    )
    applyTextRangeValue(
      node,
      node.getRangeTextCase(range.start, range.end),
      typography.textCase,
      (value) => node.setRangeTextCase(range.start, range.end, value),
      state
    )
    setTextMeasure(
      node,
      'letterSpacing',
      node.getRangeLetterSpacing(range.start, range.end),
      typography.letterSpacing,
      (value) => node.setRangeLetterSpacing(range.start, range.end, value),
      state
    )
    setTextMeasure(
      node,
      'lineHeight',
      node.getRangeLineHeight(range.start, range.end),
      typography.lineHeight,
      (value) => node.setRangeLineHeight(range.start, range.end, value),
      state
    )
    applyTextRangeValue(
      node,
      node.getRangeTextDecoration(range.start, range.end),
      typography.textDecoration,
      (value) => node.setRangeTextDecoration(range.start, range.end, value),
      state
    )
    applyTextRangeValue(
      node,
      node.getRangeTextDecorationStyle(range.start, range.end),
      range.textDecorationStyle,
      (value) => node.setRangeTextDecorationStyle(range.start, range.end, value),
      state
    )
    applyTextRangeValue(
      node,
      node.getRangeTextDecorationOffset(range.start, range.end),
      range.textDecorationOffset,
      (value) => node.setRangeTextDecorationOffset(range.start, range.end, value),
      state
    )
    applyTextRangeValue(
      node,
      node.getRangeTextDecorationThickness(range.start, range.end),
      range.textDecorationThickness,
      (value) => node.setRangeTextDecorationThickness(range.start, range.end, value),
      state
    )
    applyTextRangeValue(
      node,
      node.getRangeTextDecorationColor(range.start, range.end),
      nativeTextDecorationColor(range, state),
      (value) => node.setRangeTextDecorationColor(range.start, range.end, value),
      state
    )
    applyTextRangeValue(
      node,
      node.getRangeTextDecorationSkipInk(range.start, range.end),
      range.textDecorationSkipInk,
      (value) => node.setRangeTextDecorationSkipInk(range.start, range.end, value),
      state
    )
    applyTextRangeValue(
      node,
      node.getRangeListOptions(range.start, range.end),
      range.listOptions,
      (value) => node.setRangeListOptions(range.start, range.end, value),
      state
    )
    const listSpacing = paragraph.effective.listSpacing
    if (listSpacing.start < listSpacing.end)
      applyTextRangeValue(
        node,
        node.getRangeListSpacing(listSpacing.start, listSpacing.end),
        typography.listSpacing,
        (value) => node.setRangeListSpacing(range.start, range.end, value),
        state,
        scalarValuesEqual
      )
    applyTextRangeValue(
      node,
      node.getRangeIndentation(range.start, range.end),
      range.indentation,
      (value) => node.setRangeIndentation(range.start, range.end, value),
      state
    )
    const indent = paragraph.effective.paragraphIndent
    if (indent.start < indent.end)
      applyTextRangeValue(
        node,
        node.getRangeParagraphIndent(indent.start, indent.end),
        typography.paragraphIndent,
        (value) => node.setRangeParagraphIndent(range.start, range.end, value),
        state,
        scalarValuesEqual
      )
    const spacing = paragraph.effective.paragraphSpacing
    if (spacing.start < spacing.end)
      applyTextRangeValue(
        node,
        node.getRangeParagraphSpacing(spacing.start, spacing.end),
        typography.paragraphSpacing,
        (value) => node.setRangeParagraphSpacing(range.start, range.end, value),
        state,
        scalarValuesEqual
      )
    const hyperlink = nativeHyperlink(range.hyperlink, state)
    if (
      hyperlink !== undefined &&
      !hyperlinksEqual(node.getRangeHyperlink(range.start, range.end), hyperlink)
    ) {
      node.setRangeHyperlink(range.start, range.end, hyperlink)
      markMutation(state, node)
    }
    await applyTextRangeVariables(node, paragraphs, index, state)
  }
}
