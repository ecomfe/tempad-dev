import type { CanvasStyleBindings, CanvasVariableBindings } from '@tempad-dev/shared'

import { specError } from '../errors'
import { loadFonts, currentTextFonts } from '../fonts'
import { resolveStyle } from '../styles'
import { resolveVariable } from '../variables'
import {
  type StyleField,
  styleTarget,
  STYLE_FIELDS,
  DIRECT_VARIABLE_FIELDS,
  currentBoundVariableId
} from './binding-values'
import { type SupportedCanvasNode, type ApplyState, markMutation } from './state'
import { loadVariableFonts } from './text-fonts'

async function setStyleLink(
  node: SupportedCanvasNode,
  field: StyleField,
  id: string,
  state: ApplyState
): Promise<void> {
  const target = styleTarget(node, field)
  if (target.current === id) return
  if (!id && target.text) await loadFonts(currentTextFonts(target.text), state.fonts)
  await target.apply(id)
  markMutation(state, node)
}

export async function unlinkStyles(
  node: SupportedCanvasNode,
  bindings: CanvasStyleBindings | undefined,
  state: ApplyState
): Promise<void> {
  for (const field of STYLE_FIELDS) {
    if (bindings?.[field] !== null) continue
    await setStyleLink(node, field, '', state)
  }
}

export async function applyStyles(
  node: SupportedCanvasNode,
  bindings: CanvasStyleBindings | undefined,
  state: ApplyState
): Promise<void> {
  if (!bindings) return
  for (const field of STYLE_FIELDS) {
    const reference = bindings[field]
    if (!reference) continue
    const style = await resolveStyle(reference, state.styles)
    await setStyleLink(node, field, style.id, state)
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

export function clearVariables(
  node: SupportedCanvasNode,
  bindings: CanvasVariableBindings | undefined,
  state: ApplyState
): void {
  if (!bindings) return
  for (const field of Object.keys(bindings) as Array<keyof CanvasVariableBindings>) {
    if (bindings[field] !== null) continue
    if (field === 'fill' || field === 'stroke') {
      applyPaintVariable(node, field, null, state)
      continue
    }
    const figmaField = DIRECT_VARIABLE_FIELDS[field]
    if (!currentBoundVariableId(node, figmaField)) continue
    node.setBoundVariable(figmaField, null)
    markMutation(state, node)
  }
}

export async function applyVariables(
  node: SupportedCanvasNode,
  bindings: CanvasVariableBindings | undefined,
  state: ApplyState
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
    if (currentBoundVariableId(node, figmaField) === variable.id) continue
    node.setBoundVariable(figmaField, variable)
    markMutation(state, node)
  }
}
