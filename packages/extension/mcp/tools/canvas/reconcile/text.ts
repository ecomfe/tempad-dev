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
import { textMeasuresEqual, hyperlinksEqual, nativeValueEqual } from './comparison'
import { preservesComponentPropertyReference } from './components'
import { nativePaint, paintStacksEqual } from './native-values'
import { isCanvasKeyHyperlink, nativeHyperlink } from './nodes'
import { type ApplyState, markMutation, setValue } from './state'
import { loadTextFonts, loadVariableFonts } from './text-fonts'

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
  if (
    desiredFont &&
    (node.fontName === figma.mixed ||
      node.fontName.family !== desiredFont.family ||
      node.fontName.style !== desiredFont.style)
  ) {
    node.fontName = desiredFont
    markMutation(state, node)
  }
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
  setValue(
    node,
    node.fontSize,
    hasTextStyle || spec.variables?.fontSize || currentBoundVariableId(node, 'fontSize')
      ? undefined
      : text.fontSize,
    (value) => (node.fontSize = value),
    state
  )
  setTextMeasure(
    node,
    node.lineHeight,
    hasTextStyle || spec.variables?.lineHeight || currentBoundVariableId(node, 'lineHeight')
      ? undefined
      : text.lineHeight,
    (value) => (node.lineHeight = value),
    state
  )
  setTextMeasure(
    node,
    node.letterSpacing,
    hasTextStyle || spec.variables?.letterSpacing || currentBoundVariableId(node, 'letterSpacing')
      ? undefined
      : text.letterSpacing,
    (value) => (node.letterSpacing = value),
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
  setValue(
    node,
    node.textCase,
    native?.case ?? (hasTextStyle ? undefined : text.textCase),
    (value) => (node.textCase = value),
    state
  )
  setValue(
    node,
    node.textDecoration,
    hasTextStyle ? undefined : text.textDecoration,
    (value) => (node.textDecoration = value),
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
  setValue(
    node,
    node.paragraphIndent,
    spec.variables?.paragraphIndent || currentBoundVariableId(node, 'paragraphIndent')
      ? undefined
      : native?.paragraphIndent,
    (value) => (node.paragraphIndent = value),
    state
  )
  setValue(
    node,
    node.paragraphSpacing,
    spec.variables?.paragraphSpacing || currentBoundVariableId(node, 'paragraphSpacing')
      ? undefined
      : native?.paragraphSpacing,
    (value) => (node.paragraphSpacing = value),
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
    applyTextHyperlink(node, native?.hyperlink, state)
  }
}

function setTextMeasure<T extends LineHeight | LetterSpacing>(
  node: TextNode,
  current: T | typeof figma.mixed,
  desired: T | undefined,
  apply: (value: T) => void,
  state: ApplyState
): void {
  if (desired === undefined || textMeasuresEqual(current, desired)) return
  apply(desired)
  markMutation(state, node)
}

export function applyTextHyperlink(
  node: TextNode,
  hyperlink: CanvasHyperlink | undefined,
  state: ApplyState
): void {
  const desired = nativeHyperlink(hyperlink, state)
  if (desired === undefined || hyperlinksEqual(node.hyperlink, desired)) return
  node.hyperlink = desired
  markMutation(state, node)
}

function applyTextRangeValue<T>(
  node: TextNode,
  current: T | typeof figma.mixed | null,
  desired: T | undefined,
  apply: (value: T) => void,
  state: ApplyState
): void {
  if (desired === undefined || nativeValueEqual(current, desired)) return
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
  for (const range of ranges ?? []) {
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
      state
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
    applyTextRangeValue(
      node,
      node.getRangeLetterSpacing(range.start, range.end),
      range.letterSpacing,
      (value) => node.setRangeLetterSpacing(range.start, range.end, value),
      state
    )
    applyTextRangeValue(
      node,
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
    applyTextRangeValue(
      node,
      node.getRangeParagraphIndent(range.start, range.end),
      range.paragraphIndent,
      (value) => node.setRangeParagraphIndent(range.start, range.end, value),
      state
    )
    applyTextRangeValue(
      node,
      node.getRangeParagraphSpacing(range.start, range.end),
      range.paragraphSpacing,
      (value) => node.setRangeParagraphSpacing(range.start, range.end, value),
      state
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
