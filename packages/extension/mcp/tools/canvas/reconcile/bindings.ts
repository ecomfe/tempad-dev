import type {
  CanvasFigmaTextRange,
  CanvasStyleBindings,
  CanvasVariableBindings
} from '@tempad-dev/shared'

import type { TextParagraph } from './text-paragraphs'

import { applyError, specError } from '../errors'
import { loadFonts, currentTextFonts } from '../fonts'
import { resolveStyle } from '../styles'
import { resolveVariable } from '../variables'
import {
  type StyleField,
  styleTarget,
  styleLinkMatches,
  STYLE_FIELDS,
  DIRECT_VARIABLE_FIELDS,
  isTextVariableField,
  rangeHasVariableLiteral,
  variableLinkMatches
} from './binding-values'
import { scalarValuesEqual, textMeasuresEqual } from './comparison'
import { type SupportedCanvasNode, type ApplyState, markMutation } from './state'
import { loadVariableFonts } from './text-fonts'
import { resolvedRangeTextStyle } from './text-range-style'
import {
  textMetricRange,
  textParagraphContents,
  textParagraphRange,
  type TextMetricField,
  type TextRange
} from './text-ranges'

async function setStyleLink(
  node: SupportedCanvasNode,
  field: StyleField,
  id: string,
  state: ApplyState,
  ranges: CanvasFigmaTextRange[] | undefined
): Promise<void> {
  if (styleLinkMatches(node, field, id, ranges)) return
  const target = styleTarget(node, field)
  if (!id && target.text) await loadFonts(currentTextFonts(target.text), state.fonts)
  await target.apply(id)
  markMutation(state, node)
}

export async function unlinkStyles(
  node: SupportedCanvasNode,
  bindings: CanvasStyleBindings | undefined,
  state: ApplyState,
  ranges: CanvasFigmaTextRange[] | undefined
): Promise<void> {
  for (const field of STYLE_FIELDS) {
    if (bindings?.[field] !== null) continue
    await setStyleLink(node, field, '', state, ranges)
  }
}

export async function applyStyles(
  node: SupportedCanvasNode,
  bindings: CanvasStyleBindings | undefined,
  state: ApplyState,
  ranges: CanvasFigmaTextRange[] | undefined
): Promise<void> {
  if (!bindings) return
  for (const field of STYLE_FIELDS) {
    const reference = bindings[field]
    if (!reference) continue
    const style = await resolveStyle(reference, state.styles)
    await setStyleLink(node, field, style.id, state, ranges)
  }
}

function applyPaintVariable(
  node: SupportedCanvasNode,
  field: 'fill' | 'stroke',
  variable: Variable | null,
  state: ApplyState
): void {
  if (!('fills' in node)) {
    specError(`${field} variables are not supported on ${node.type} node "${node.id}".`)
  }
  const property = field === 'fill' ? 'fills' : 'strokes'
  const currentVariable = node.boundVariables?.[property]?.[0]
  if (currentVariable?.id === variable?.id || (!currentVariable && !variable)) return
  const styleId = field === 'fill' ? node.fillStyleId : node.strokeStyleId
  if (!variable && styleId) {
    specError(
      `${field} variable bindings cannot be cleared without replacing the existing Paint style on node "${node.id}".`
    )
  }

  const currentPaints = node[property]
  if (currentPaints === figma.mixed) {
    specError(`${field} variable bindings cannot target mixed paints on node "${node.id}".`)
  }
  const paints = [...currentPaints]
  if (paints.length !== 1 || paints[0]?.type !== 'SOLID') {
    specError(`${field} variable bindings require exactly one solid paint on node "${node.id}".`)
  }
  paints[0] = figma.variables.setBoundVariableForPaint(paints[0], 'color', variable)
  node[property] = paints
  markMutation(state, node)
}

async function retainedTextBindings(
  node: TextNode,
  field: VariableBindableTextField,
  ranges: CanvasFigmaTextRange[] | undefined,
  state: ApplyState
): Promise<CanvasFigmaTextRange[]> {
  const retained: CanvasFigmaTextRange[] = []
  for (const range of ranges ?? []) {
    if (range.variables?.[field]) {
      retained.push(range)
      continue
    }
    if (range.variables?.[field] === null || !range.textStyle) continue
    const style = await resolveStyle(range.textStyle, state.styles)
    const expected = style.type === 'TEXT' ? style.boundVariables?.[field] : undefined
    if (!expected) continue
    const span =
      field === 'paragraphIndent' || field === 'paragraphSpacing'
        ? textParagraphRange(node.characters, range)
        : range
    const current = node.getRangeBoundVariable(span.start, span.end, field)
    // A style can carry local overrides. Only its actual alias supersedes the
    // base null; this rule also checks the final state after setters have run.
    if (current !== figma.mixed && current?.id === expected.id) retained.push(range)
  }
  return retained
}

export async function clearedVariableMatches(
  node: SupportedCanvasNode,
  field: VariableBindableNodeField | VariableBindableTextField,
  ranges: CanvasFigmaTextRange[] | undefined,
  state: ApplyState
): Promise<boolean> {
  const retained =
    node.type === 'TEXT' && isTextVariableField(field)
      ? await retainedTextBindings(node, field, ranges, state)
      : undefined
  return variableLinkMatches(node, field, undefined, retained)
}

export async function clearVariables(
  node: SupportedCanvasNode,
  bindings: CanvasVariableBindings | undefined,
  state: ApplyState,
  ranges?: CanvasFigmaTextRange[]
): Promise<void> {
  if (!bindings) return
  for (const field of Object.keys(bindings) as Array<keyof CanvasVariableBindings>) {
    if (bindings[field] !== null) continue
    if (field === 'fill' || field === 'stroke') {
      applyPaintVariable(node, field, null, state)
      continue
    }
    const figmaField = DIRECT_VARIABLE_FIELDS[field]
    if (await clearedVariableMatches(node, figmaField, ranges, state)) continue
    node.setBoundVariable(figmaField, null)
    markMutation(state, node)
  }
}

export async function applyVariables(
  node: SupportedCanvasNode,
  bindings: CanvasVariableBindings | undefined,
  state: ApplyState,
  ranges?: CanvasFigmaTextRange[]
): Promise<void> {
  if (!bindings) return
  if (node.type === 'TEXT') await loadVariableFonts(node, bindings, state)
  for (const field of Object.keys(bindings) as Array<keyof CanvasVariableBindings>) {
    const reference = bindings[field]
    if (!reference) continue
    const variable = await resolveVariable(reference, state.variables)
    if (field === 'fill' || field === 'stroke') {
      applyPaintVariable(node, field, variable, state)
      continue
    }
    const figmaField = DIRECT_VARIABLE_FIELDS[field]
    if (variableLinkMatches(node, figmaField, variable.id)) continue
    if (
      node.type === 'TEXT' &&
      isTextVariableField(figmaField) &&
      ranges?.length &&
      variableLinkMatches(node, figmaField, variable.id, ranges)
    )
      continue
    node.setBoundVariable(figmaField, variable)
    markMutation(state, node)
  }
}

function literalKeepsVariable(
  range: CanvasFigmaTextRange,
  field: VariableBindableTextField,
  value: number
): boolean | undefined {
  const nativeValue = Math.fround(value)
  if (field === 'lineHeight' || field === 'letterSpacing') {
    return textMeasuresEqual(field, { unit: 'PIXELS', value: nativeValue }, range[field]!)
  }
  if (field === 'fontSize' || field === 'paragraphIndent' || field === 'paragraphSpacing') {
    return scalarValuesEqual(nativeValue, range[field])
  }
}

export async function repairTextRangeBindings(
  node: TextNode,
  paragraphs: readonly TextParagraph[],
  index: number,
  bindings: CanvasVariableBindings | undefined,
  earlierBindings: Record<'paragraphIndent' | 'paragraphSpacing', number>,
  state: ApplyState
): Promise<void> {
  const paragraph = paragraphs[index]!
  const range = paragraph.range
  if (range.textStyle) return
  for (const field of [
    'fontSize',
    'lineHeight',
    'letterSpacing',
    'paragraphIndent',
    'paragraphSpacing'
  ] as const) {
    const reference = bindings?.[field]
    if (!reference || range.variables?.[field] !== undefined) continue
    if (!rangeHasVariableLiteral(range, field)) continue
    const variable = await resolveVariable(reference, state.variables)
    const value = variable.resolveForConsumer(node).value
    if (typeof value !== 'number') continue
    const keep = literalKeepsVariable(range, field, value)
    if (keep === undefined) continue
    const scope =
      field === 'paragraphIndent' || field === 'paragraphSpacing'
        ? {
            start: Math.max(paragraph.effective[field].start, earlierBindings[field]),
            end: paragraph.effective[field].end
          }
        : textMetricRange(node.characters, range, field, paragraphs[index + 1]?.range)
    if (scope.start >= scope.end) continue
    const alias = node.getRangeBoundVariable(scope.start, scope.end, field)
    // A native node rebind may retain local aliases. Repair only plain literal
    // owners before applying the ordered ranges. Earlier paragraph binding
    // owners retain their precedence when an equal later literal skips its setter.
    // A base alias is cleared by a differing literal.
    if (alias !== figma.mixed && (alias?.id === variable.id || (!keep && !alias))) continue
    if (field === 'fontSize' || field === 'lineHeight' || field === 'letterSpacing')
      await protectFollowingTextStyle(
        node,
        range,
        field,
        paragraphs[index + 1]?.range,
        state,
        keep ? variable.id : undefined
      )
    const writable = field === 'paragraphIndent' || field === 'paragraphSpacing' ? scope : range
    node.setRangeBoundVariable(writable.start, writable.end, field, keep ? variable : null)
    markMutation(state, node)
    if (!keep) {
      ensureTextRangeUnbound(node, scope, field, state)
    } else {
      const actual = node.getRangeBoundVariable(scope.start, scope.end, field)
      if (actual === figma.mixed || actual?.id !== variable.id) {
        applyError(
          `Verification failed for TEXT node "${node.id}": range variable link "${field}" does not match.`
        )
      }
    }
  }
}

export async function protectFollowingTextStyle(
  node: TextNode,
  range: TextRange,
  field: TextMetricField,
  later: CanvasFigmaTextRange | undefined,
  state: ApplyState,
  aliasId: string | undefined,
  literal?: number | LineHeight | LetterSpacing
): Promise<void> {
  if (node.characters[range.end] !== '\n' || later?.start !== range.end || !later.textStyle) return
  const alias = node.getRangeBoundVariable(range.end, range.end + 1, field)
  let unchanged = alias !== figma.mixed && alias?.id === aliasId
  if (unchanged && literal !== undefined) {
    const value =
      field === 'fontSize'
        ? node.getRangeFontSize(range.end, range.end + 1)
        : field === 'lineHeight'
          ? node.getRangeLineHeight(range.end, range.end + 1)
          : node.getRangeLetterSpacing(range.end, range.end + 1)
    unchanged =
      field === 'fontSize'
        ? scalarValuesEqual(value, literal)
        : textMeasuresEqual(
            field,
            value as LineHeight | LetterSpacing | typeof figma.mixed,
            literal as LineHeight | LetterSpacing
          )
  }
  if (unchanged) return
  const style = await resolveStyle(later.textStyle, state.styles)
  if (
    node.getRangeTextStyleId(later.start, later.end) === style.id &&
    !(await resolvedRangeTextStyle(node, later, state))
  ) {
    applyError(
      `Cannot change range ${range.start}:${range.end} field "${field}" without changing the retained TextStyle on its following newline (range ${later.start}:${later.end}, style "${style.id}"). Keep this range unchanged or explicitly replace the adjacent style; repeating the same request will not repair this native boundary.`
    )
  }
}

export function ensureTextRangeUnbound(
  node: TextNode,
  range: TextRange,
  field: VariableBindableTextField,
  state: ApplyState
): void {
  if (field === 'paragraphIndent' || field === 'paragraphSpacing') {
    // Native null can retain a paragraph alias even for a complete paragraph.
    // Force its current literal, separately for each paragraph so mixed values
    // survive, and require the alias to disappear before later owners run.
    for (const {
      span: { start, end },
      content
    } of textParagraphContents(node.characters, range)) {
      const alias = node.getRangeBoundVariable(start, end, field)
      // Including the paragraph break in a literal setter can also change the
      // following paragraph. Empty paragraphs have no proven safe fallback.
      if (alias && start < content.end) {
        const value =
          field === 'paragraphIndent'
            ? node.getRangeParagraphIndent(start, end)
            : node.getRangeParagraphSpacing(start, end)
        if (value !== figma.mixed) {
          if (field === 'paragraphIndent') node.setRangeParagraphIndent(start, content.end, value)
          else node.setRangeParagraphSpacing(start, content.end, value)
          markMutation(state, node)
        }
      }
    }
  } else if (field !== 'fontSize' && field !== 'lineHeight' && field !== 'letterSpacing') {
    return
  }
  if (node.getRangeBoundVariable(range.start, range.end, field)) {
    applyError(
      `Cannot clear range ${range.start}:${range.end} variable "${field}": Figma retained its alias and no safe literal fallback is available. Preserve the binding or explicitly replace the affected text range; do not repeat this unchanged request.`
    )
  }
}
