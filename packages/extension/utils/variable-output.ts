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
type VariableStyleOptions = { preserveInlineFallbacks?: boolean }
type VariableProjectionContext = {
  variablesById: Map<string, Variable>
  variablesByCodeSyntax: Map<string, Variable>
  variableSyntax?: Record<string, string>
}

export type FormattedStyle = {
  style: Record<string, string>
  variableSyntax?: Record<string, string>
}

export function formatNodeStyleForUi(
  style: Record<string, string>,
  node: SceneNode,
  readers: FigmaLookupReaders = DEFAULT_READERS
): FormattedStyle {
  const context = buildVariableProjectionContext(node, readers)

  return {
    style: applyVariableStyle(style, node, context, getCssExprForCodeSyntaxVariable, readers),
    ...(context.variableSyntax ? { variableSyntax: context.variableSyntax } : {})
  }
}

export function formatNodeStyleForMcp(
  style: Record<string, string>,
  node: SceneNode,
  readers: FigmaLookupReaders = DEFAULT_READERS
): Record<string, string> {
  const context = buildVariableProjectionContext(node, readers)
  return applyVariableStyle(style, node, context, getVariableCssExpr, readers)
}

export function formatNodeStyleForPluginVariables(
  style: Record<string, string>,
  node: SceneNode,
  readers: FigmaLookupReaders = DEFAULT_READERS
): Record<string, string> {
  const context = buildVariableProjectionContext(node, readers)
  return applyVariableStyle(style, node, context, getVariableCssExpr, readers, {
    preserveInlineFallbacks: true
  })
}

function applyVariableStyle(
  style: Record<string, string>,
  node: SceneNode,
  context: VariableProjectionContext,
  format: VariableFormatter,
  readers: FigmaLookupReaders,
  options: VariableStyleOptions = {}
): Record<string, string> {
  const next = { ...style }
  const replacements = buildReplacementMap(context, format)

  rewriteKnownCodeSyntaxValues(next, context, format)
  rewriteInlineVars(next, replacements, options)
  applyBoundFields(next, node, NODE_VARIABLE_STYLE_PROPS, context, format, readers)

  if (node.type === 'TEXT') {
    applyTextFields(next, node, context, format, readers)
  }

  return next
}

function getCssExprForCodeSyntaxVariable(variable: Variable): string | null {
  return getVariableCodeSyntax(variable) ? getVariableCssExpr(variable) : null
}

function buildVariableProjectionContext(
  node: SceneNode,
  readers: FigmaLookupReaders
): VariableProjectionContext {
  const variablesById = new Map<string, Variable>()
  const variablesByCodeSyntax = new Map<string, Variable>()
  const variableSyntax: Record<string, string> = {}

  for (const id of collectNodeVariableIds(node, readers)) {
    const variable = resolveVariableById(id, readers)
    if (!variable) continue
    variablesById.set(id, variable)

    const value = getVariableCodeSyntax(variable)
    if (!value) continue

    const syntax = value.trim()
    if (syntax && !variablesByCodeSyntax.has(syntax)) {
      variablesByCodeSyntax.set(syntax, variable)
    }

    const name = getVariableCssName(variable)
    if (!(name in variableSyntax)) {
      variableSyntax[name] = value
    }
  }

  return {
    variablesById,
    variablesByCodeSyntax,
    ...(Object.keys(variableSyntax).length ? { variableSyntax } : {})
  }
}

function buildReplacementMap(
  context: VariableProjectionContext,
  format: VariableFormatter
): Map<string, string> {
  const map = new Map<string, string>()

  for (const variable of context.variablesById.values()) {
    const value = format(variable)
    if (!value) continue
    map.set(getVariableCssName(variable), value)
  }

  return map
}

function rewriteKnownCodeSyntaxValues(
  style: Record<string, string>,
  context: VariableProjectionContext,
  format: VariableFormatter
): void {
  if (!context.variablesByCodeSyntax.size) return

  const replacements = [...context.variablesByCodeSyntax.entries()]
    .map(([syntax, variable]) => ({ syntax, value: format(variable) }))
    .filter((entry): entry is { syntax: string; value: string } => !!entry.value)
    .sort((a, b) => b.syntax.length - a.syntax.length)

  if (!replacements.length) return

  for (const [key, value] of Object.entries(style)) {
    if (!value) continue
    const exact = replacements.find((entry) => value.trim() === entry.syntax)
    if (exact) {
      style[key] = exact.value
      continue
    }

    style[key] = replaceKnownCodeSyntaxTokens(value, replacements)
  }
}

function replaceKnownCodeSyntaxTokens(
  value: string,
  replacements: Array<{ syntax: string; value: string }>
): string {
  const placeholders: string[] = []
  let out = replaceVarFunctions(value, ({ full }) => {
    const token = `__VAR_${placeholders.length}__`
    placeholders.push(full)
    return token
  })

  for (const { syntax, value: replacement } of replacements) {
    if (/\s/.test(syntax)) continue
    const escaped = syntax.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(^|[^A-Za-z0-9_-])(${escaped})(?=[^A-Za-z0-9_-]|$)`, 'g')
    out = out.replace(re, (_match, prefix: string) => `${prefix}${replacement}`)
  }

  return placeholders.reduce(
    (next, placeholder, index) => next.replace(`__VAR_${index}__`, placeholder),
    out
  )
}

function rewriteInlineVars(
  style: Record<string, string>,
  replacements: Map<string, string>,
  { preserveInlineFallbacks = false }: VariableStyleOptions = {}
): void {
  if (!replacements.size) return

  for (const [key, value] of Object.entries(style)) {
    if (!value || !value.includes('var(')) continue

    style[key] = replaceVarFunctions(value, ({ full, name, fallback }) => {
      const replacement = replacements.get(normalizeCustomPropertyName(name.trim()))
      if (!replacement) return full
      if (preserveInlineFallbacks && fallback && replacement.startsWith('var(')) {
        return replacement.replace(/\)$/, `, ${fallback})`)
      }
      return replacement
    })
  }
}

function applyBoundFields(
  style: Record<string, string>,
  node: SceneNode,
  fields: Partial<Record<string, readonly string[]>>,
  context: VariableProjectionContext,
  format: VariableFormatter,
  readers: FigmaLookupReaders
): void {
  const bindings = (node as { boundVariables?: Record<string, unknown> }).boundVariables
  if (!bindings) return

  for (const [field, props] of Object.entries(fields)) {
    if (!props) continue
    const id = getSingleVariableId(bindings[field])
    if (!id) continue
    applyVariableToProps(style, props, id, context, format, readers)
  }
}

function applyTextFields(
  style: Record<string, string>,
  node: TextNode,
  context: VariableProjectionContext,
  format: VariableFormatter,
  readers: FigmaLookupReaders
): void {
  for (const [field, props] of Object.entries(TEXT_VARIABLE_STYLE_PROPS)) {
    const id = resolveTextNodeVariableId(node, field as VariableBindableTextField, readers)
    if (!id) continue
    applyVariableToProps(style, props, id, context, format, readers)
  }
}

function applyVariableToProps(
  style: Record<string, string>,
  props: readonly string[],
  id: string,
  context: VariableProjectionContext,
  format: VariableFormatter,
  readers: FigmaLookupReaders
): void {
  if (!props.some((prop) => prop in style)) return

  const variable = resolveContextVariable(id, context, readers)
  if (!variable) return
  const value = format(variable)
  if (!value) return

  props.forEach((prop) => {
    if (!(prop in style)) return
    style[prop] = value
  })
}

function resolveContextVariable(
  id: string,
  context: VariableProjectionContext,
  readers: FigmaLookupReaders
): Variable | null {
  const cached = context.variablesById.get(id)
  if (cached) return cached

  const variable = resolveVariableById(id, readers)
  if (variable) {
    context.variablesById.set(id, variable)
  }
  return variable
}
