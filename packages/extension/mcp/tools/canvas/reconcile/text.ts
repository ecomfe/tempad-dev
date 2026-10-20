import type {
  CanvasHyperlink,
  CanvasStyleReference,
  CanvasFigmaTextRange,
  CanvasVariableReference
} from '@tempad-dev/shared'

import type { CanvasNodeSpec } from '../model'

import { specError } from '../errors'
import { resolveStyle } from '../styles'
import { resolvedVariable } from '../variables'
import { currentBoundVariableId } from './binding-values'
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
import { textRangesMatchOutside } from './text-ranges'

export async function applyText(
  node: TextNode,
  spec: CanvasNodeSpec,
  state: ApplyState
): Promise<void> {
  const text = spec.text
  if (!text) return
  const native = spec.figma?.text
  const desiredFont = await loadTextFonts(node, spec, state)
  const hasTextStyle = !!(spec.styles?.text || node.textStyleId)
  setBaseTextValue(
    node,
    'fontName',
    desiredFont ?? undefined,
    {
      current: node.fontName,
      apply: (value) => (node.fontName = value),
      readRange: (start, end) => node.getRangeFontName(start, end),
      equal: fontNamesEqual
    },
    node.characters === text.characters ? native?.ranges : undefined,
    state
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
  setBaseTextValue(
    node,
    'fontSize',
    hasTextStyle || spec.variables?.fontSize || currentBoundVariableId(node, 'fontSize')
      ? undefined
      : text.fontSize,
    {
      current: node.fontSize,
      apply: (value) => (node.fontSize = value),
      readRange: (start, end) => node.getRangeFontSize(start, end)
    },
    native?.ranges,
    state
  )
  setBaseTextValue(
    node,
    'lineHeight',
    hasTextStyle || spec.variables?.lineHeight || currentBoundVariableId(node, 'lineHeight')
      ? undefined
      : text.lineHeight,
    {
      current: node.lineHeight,
      apply: (value) => (node.lineHeight = value),
      readRange: (start, end) => node.getRangeLineHeight(start, end),
      equal: (current, desired) => textMeasuresEqual('lineHeight', current, desired)
    },
    native?.ranges,
    state
  )
  setBaseTextValue(
    node,
    'letterSpacing',
    hasTextStyle || spec.variables?.letterSpacing || currentBoundVariableId(node, 'letterSpacing')
      ? undefined
      : text.letterSpacing,
    {
      current: node.letterSpacing,
      apply: (value) => (node.letterSpacing = value),
      readRange: (start, end) => node.getRangeLetterSpacing(start, end),
      equal: (current, desired) => textMeasuresEqual('letterSpacing', current, desired)
    },
    native?.ranges,
    state
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
  setBaseTextValue(
    node,
    'textCase',
    native?.case ?? (hasTextStyle ? undefined : text.textCase),
    {
      current: node.textCase,
      apply: (value) => (node.textCase = value),
      readRange: (start, end) => node.getRangeTextCase(start, end)
    },
    native?.ranges,
    state
  )
  setBaseTextValue(
    node,
    'textDecoration',
    hasTextStyle ? undefined : text.textDecoration,
    {
      current: node.textDecoration,
      apply: (value) => (node.textDecoration = value),
      readRange: (start, end) => node.getRangeTextDecoration(start, end)
    },
    native?.ranges,
    state
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
  setBaseTextValue(
    node,
    'paragraphIndent',
    spec.variables?.paragraphIndent || currentBoundVariableId(node, 'paragraphIndent')
      ? undefined
      : native?.paragraphIndent,
    {
      current: node.paragraphIndent,
      apply: (value) => (node.paragraphIndent = value),
      readRange: (start, end) => node.getRangeParagraphIndent(start, end)
    },
    native?.ranges,
    state
  )
  setBaseTextValue(
    node,
    'paragraphSpacing',
    spec.variables?.paragraphSpacing || currentBoundVariableId(node, 'paragraphSpacing')
      ? undefined
      : native?.paragraphSpacing,
    {
      current: node.paragraphSpacing,
      apply: (value) => (node.paragraphSpacing = value),
      readRange: (start, end) => node.getRangeParagraphSpacing(start, end)
    },
    native?.ranges,
    state
  )
  setValue(
    node,
    node.listSpacing,
    native?.listSpacing,
    (value) => (node.listSpacing = value),
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
  | 'paragraphIndent'
  | 'paragraphSpacing'
  | 'hyperlink'

function rangeOwnsTextField(range: CanvasFigmaTextRange, field: BaseTextField): boolean {
  if (range[field] !== undefined) return true
  if (field === 'hyperlink') return false
  if (range.textStyle) return true
  if (field === 'fontName') {
    return TEXT_STYLE_VARIABLES_BY_VALUE.fontName.some((variable) => range.variables?.[variable])
  }
  if (field === 'textCase' || field === 'textDecoration') return false
  return !!range.variables?.[field]
}

function textFieldRange(
  node: TextNode,
  field: BaseTextField,
  range: { start: number; end: number }
): { start: number; end: number } {
  if (field !== 'paragraphIndent' && field !== 'paragraphSpacing') return range
  // Paragraph setters affect every paragraph touched, including its newline.
  const start = range.start === 0 ? 0 : node.characters.lastIndexOf('\n', range.start - 1) + 1
  const newline = node.characters.indexOf('\n', range.end - 1)
  return { start, end: newline === -1 ? node.characters.length : newline + 1 }
}

function setBaseTextValue<T>(
  node: TextNode,
  field: BaseTextField,
  desired: T | undefined,
  {
    current,
    apply,
    readRange,
    equal = scalarValuesEqual
  }: {
    current: T | typeof figma.mixed
    apply: (value: T) => void
    readRange: (start: number, end: number) => T | typeof figma.mixed
    equal?: (current: T | typeof figma.mixed, desired: T) => boolean
  },
  ranges: CanvasFigmaTextRange[] | undefined,
  state: ApplyState,
  scope = { start: 0, end: node.characters.length }
): void {
  if (desired === undefined || equal(current, desired)) return
  const overrides = ranges
    ?.filter((range) => rangeOwnsTextField(range, field))
    .map((range) => textFieldRange(node, field, range))
  if (
    overrides?.length &&
    textRangesMatchOutside(textFieldRange(node, field, scope), overrides, (start, end) =>
      equal(readRange(start, end), desired)
    )
  )
    return
  // Compare only spans not owned by later overrides. Actual changes retain the
  // existing setter and subsequent range restoration.
  apply(desired)
  markMutation(state, node)
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
  state: ApplyState
): Promise<void> {
  if (reference === undefined) return
  const styleId = reference ? (await resolveStyle(reference, state.styles)).id : ''
  if (current() === styleId) return
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

async function applyTextRangeVariables(
  node: TextNode,
  range: CanvasFigmaTextRange,
  state: ApplyState
): Promise<void> {
  await loadVariableFonts(node, range.variables, state, range)
  for (const [field, reference] of Object.entries(range.variables ?? {}) as Array<
    [VariableBindableTextField, CanvasVariableReference | null]
  >) {
    const variable = reference ? resolvedVariable(reference, state.variables) : null
    const current = node.getRangeBoundVariable(range.start, range.end, field)
    if (current !== figma.mixed && current?.id === variable?.id) continue
    node.setRangeBoundVariable(range.start, range.end, field, variable)
    markMutation(state, node)
  }
}

export async function applyTextRanges(
  node: TextNode,
  ranges: CanvasFigmaTextRange[] | undefined,
  state: ApplyState
): Promise<void> {
  for (const [index, range] of (ranges ?? []).entries()) {
    if (range.end > node.characters.length) {
      specError(
        `Text range ${range.start}:${range.end} exceeds TEXT node "${node.id}" with ${node.characters.length} UTF-16 code units.`
      )
    }
    await applyTextRangeStyle(
      node,
      range.textStyle,
      () => node.getRangeTextStyleId(range.start, range.end),
      (id) => node.setRangeTextStyleIdAsync(range.start, range.end, id),
      state
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
      range.fontName,
      (value) => node.setRangeFontName(range.start, range.end, value),
      state,
      (current, desired) => current !== null && fontNamesEqual(current, desired)
    )
    applyTextRangeValue(
      node,
      node.getRangeFontSize(range.start, range.end),
      range.fontSize,
      (value) => node.setRangeFontSize(range.start, range.end, value),
      state
    )
    applyTextRangeValue(
      node,
      node.getRangeTextCase(range.start, range.end),
      range.textCase,
      (value) => node.setRangeTextCase(range.start, range.end, value),
      state
    )
    setTextMeasure(
      node,
      'letterSpacing',
      node.getRangeLetterSpacing(range.start, range.end),
      range.letterSpacing,
      (value) => node.setRangeLetterSpacing(range.start, range.end, value),
      state
    )
    setTextMeasure(
      node,
      'lineHeight',
      node.getRangeLineHeight(range.start, range.end),
      range.lineHeight,
      (value) => node.setRangeLineHeight(range.start, range.end, value),
      state
    )
    applyTextRangeValue(
      node,
      node.getRangeTextDecoration(range.start, range.end),
      range.textDecoration,
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
    applyTextRangeValue(
      node,
      node.getRangeListSpacing(range.start, range.end),
      range.listSpacing,
      (value) => node.setRangeListSpacing(range.start, range.end, value),
      state
    )
    applyTextRangeValue(
      node,
      node.getRangeIndentation(range.start, range.end),
      range.indentation,
      (value) => node.setRangeIndentation(range.start, range.end, value),
      state
    )
    setBaseTextValue(
      node,
      'paragraphIndent',
      range.paragraphIndent,
      {
        current: node.getRangeParagraphIndent(range.start, range.end),
        apply: (value) => node.setRangeParagraphIndent(range.start, range.end, value),
        readRange: (start, end) => node.getRangeParagraphIndent(start, end)
      },
      ranges?.slice(index + 1),
      state,
      range
    )
    setBaseTextValue(
      node,
      'paragraphSpacing',
      range.paragraphSpacing,
      {
        current: node.getRangeParagraphSpacing(range.start, range.end),
        apply: (value) => node.setRangeParagraphSpacing(range.start, range.end, value),
        readRange: (start, end) => node.getRangeParagraphSpacing(start, end)
      },
      ranges?.slice(index + 1),
      state,
      range
    )
    const hyperlink = nativeHyperlink(range.hyperlink, state)
    if (
      hyperlink !== undefined &&
      !hyperlinksEqual(node.getRangeHyperlink(range.start, range.end), hyperlink)
    ) {
      node.setRangeHyperlink(range.start, range.end, hyperlink)
      markMutation(state, node)
    }
    await applyTextRangeVariables(node, range, state)
  }
}
