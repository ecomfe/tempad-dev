import type {
  CanvasFigmaTextRange,
  CanvasStyleBindings,
  CanvasVariableBindings
} from '@tempad-dev/shared'

import { specError } from '../errors'
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
import { textParagraphRange } from './text-ranges'

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
      variableLinkMatches(node, figmaField, variable.id, ranges) &&
      literalOverridesAreUnbound(node, figmaField, variable, ranges)
    )
      continue
    node.setBoundVariable(figmaField, variable)
    markMutation(state, node)
  }
}

function literalOverridesAreUnbound(
  node: TextNode,
  field: VariableBindableTextField,
  variable: Variable,
  ranges: CanvasFigmaTextRange[]
): boolean {
  const literals = ranges.filter(
    (range) => range.variables?.[field] === undefined && rangeHasVariableLiteral(range, field)
  )
  if (!literals.length) return true
  const value = variable.resolveForConsumer(node).value
  if (typeof value !== 'number') return false
  const nativeValue = Math.fround(value)
  return literals.every((range) => {
    if (range.textStyle !== undefined) return false
    // An equal literal skips its setter and keeps the base alias. Only a
    // different literal can account for an already unbound override.
    if (field === 'lineHeight' || field === 'letterSpacing') {
      if (textMeasuresEqual(field, { unit: 'PIXELS', value: nativeValue }, range[field]!))
        return false
    } else if (
      field === 'fontSize' ||
      field === 'paragraphIndent' ||
      field === 'paragraphSpacing'
    ) {
      if (scalarValuesEqual(nativeValue, range[field])) return false
    } else {
      return false
    }
    const span =
      field === 'paragraphIndent' || field === 'paragraphSpacing'
        ? textParagraphRange(node.characters, range)
        : range
    const alias = node.getRangeBoundVariable(span.start, span.end, field)
    return alias !== figma.mixed && !alias
  })
}
