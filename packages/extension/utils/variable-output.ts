import type { FigmaLookupReaders } from './figma-style/types'

import { normalizeCustomPropertyName, replaceVarFunctions } from './css'
import {
  collectNodeVariableIds,
  getSingleVariableId,
  getVariableCodeSyntax,
  getVariableCssExpr,
  getVariableCssName,
  NODE_VARIABLE_STYLE_PROPS,
  resolveTextNodeVariableId,
  resolveVariableById,
  TEXT_VARIABLE_STYLE_PROPS
} from './figma-variables'

const DEFAULT_READERS: FigmaLookupReaders = {
  getStyleById: (id) => figma.getStyleById(id),
  getVariableById: (id) => figma.variables.getVariableById(id)
}

type VariableFormatter = (variable: Variable) => string | null
type Replacement = { value: string }

export function formatNodeStyleForUi(
  style: Record<string, string>,
  node: SceneNode,
  readers: FigmaLookupReaders = DEFAULT_READERS
): Record<string, string> {
  return applyVariableStyle(style, node, getVariableCodeSyntax, readers)
}

export function formatNodeStyleForMcp(
  style: Record<string, string>,
  node: SceneNode,
  readers: FigmaLookupReaders = DEFAULT_READERS
): Record<string, string> {
  return applyVariableStyle(style, node, getVariableCssExpr, readers)
}

function applyVariableStyle(
  style: Record<string, string>,
  node: SceneNode,
  format: VariableFormatter,
  readers: FigmaLookupReaders
): Record<string, string> {
  const next = { ...style }
  const replacements = buildReplacementMap(node, format, readers)

  rewriteInlineVars(next, replacements)
  applyBoundFields(next, node, NODE_VARIABLE_STYLE_PROPS, format, readers)

  if (node.type === 'TEXT') {
    applyTextFields(next, node, format, readers)
  }

  return next
}

function buildReplacementMap(
  node: SceneNode,
  format: VariableFormatter,
  readers: FigmaLookupReaders
): Map<string, Replacement> {
  const map = new Map<string, Replacement>()

  for (const id of collectNodeVariableIds(node, readers)) {
    const variable = resolveVariableById(id, readers)
    if (!variable) continue
    const value = format(variable)
    if (!value) continue
    map.set(getVariableCssName(variable), { value })
  }

  return map
}

function rewriteInlineVars(
  style: Record<string, string>,
  replacements: Map<string, Replacement>
): void {
  if (!replacements.size) return

  for (const [key, value] of Object.entries(style)) {
    if (!value || !value.includes('var(')) continue

    style[key] = replaceVarFunctions(value, ({ full, name }) => {
      const replacement = replacements.get(normalizeCustomPropertyName(name.trim()))
      if (!replacement) return full
      return replacement.value
    })
  }
}

function applyBoundFields(
  style: Record<string, string>,
  node: SceneNode,
  fields: Partial<Record<string, readonly string[]>>,
  format: VariableFormatter,
  readers: FigmaLookupReaders
): void {
  const bindings = (node as { boundVariables?: Record<string, unknown> }).boundVariables
  if (!bindings) return

  for (const [field, props] of Object.entries(fields)) {
    if (!props) continue
    const id = getSingleVariableId(bindings[field])
    if (!id) continue
    applyVariableToProps(style, props, id, format, readers)
  }
}

function applyTextFields(
  style: Record<string, string>,
  node: TextNode,
  format: VariableFormatter,
  readers: FigmaLookupReaders
): void {
  for (const [field, props] of Object.entries(TEXT_VARIABLE_STYLE_PROPS)) {
    const id = resolveTextNodeVariableId(node, field as VariableBindableTextField, readers)
    if (!id) continue
    applyVariableToProps(style, props, id, format, readers)
  }
}

function applyVariableToProps(
  style: Record<string, string>,
  props: readonly string[],
  id: string,
  format: VariableFormatter,
  readers: FigmaLookupReaders
): void {
  if (!props.some((prop) => prop in style)) return

  const variable = resolveVariableById(id, readers)
  if (!variable) return
  const value = format(variable)
  if (!value) return

  props.forEach((prop) => {
    if (prop in style) style[prop] = value
  })
}
