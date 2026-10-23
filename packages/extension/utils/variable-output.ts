import type { FigmaLookupReaders } from './figma-style/types'

import { CANVAS_COUNTER_AXIS_SYNC_NAME, CANVAS_KEY_NAMESPACE } from './canvas-metadata'
import { normalizeCustomPropertyName, replaceVarFunctions, transformCssValue } from './css'
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
type CodeSyntaxReplacement = { value: string; pattern: RegExp | null }

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
  readers: FigmaLookupReaders = DEFAULT_READERS,
  nodeVariableIds?: ReadonlySet<string>
): Record<string, string> {
  const context = buildVariableProjectionContext(node, readers, nodeVariableIds)
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
  readers: FigmaLookupReaders,
  nodeVariableIds?: ReadonlySet<string>
): VariableProjectionContext {
  const variablesById = new Map<string, Variable>()
  const variablesByCodeSyntax = new Map<string, Variable>()
  const ambiguousSyntax = new Set<string>()
  const variableSyntax: Record<string, string> = {}

  for (const id of nodeVariableIds ?? collectNodeVariableIds(node, readers)) {
    const variable = resolveVariableById(id, readers)
    if (!variable) continue
    variablesById.set(id, variable)

    const value = getVariableCodeSyntax(variable)
    if (!value) continue

    const syntax = value.trim()
    if (syntax && !ambiguousSyntax.has(syntax)) {
      if (variablesByCodeSyntax.has(syntax)) {
        variablesByCodeSyntax.delete(syntax)
        ambiguousSyntax.add(syntax)
      } else {
        variablesByCodeSyntax.set(syntax, variable)
      }
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
  const owners = new Map<string, string | null>()

  for (const variable of context.variablesById.values()) {
    const value = format(variable)
    const name = getVariableCssName(variable)
    // Native CSS collapses separator runs ("Collection / Token"), while our
    // canonical name preserves them. Match either only when identity is unambiguous.
    const nativeName = `--${name.slice(2).replace(/-+/g, '-')}`
    for (const alias of new Set([name, nativeName])) {
      const owner = owners.get(alias)
      if (owner !== undefined && owner !== variable.id) {
        owners.set(alias, null)
        map.delete(alias)
      } else {
        owners.set(alias, variable.id)
        if (value) map.set(alias, value)
      }
    }
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

  let tokenReplacements: CodeSyntaxReplacement[] | undefined
  for (const [key, value] of Object.entries(style)) {
    if (!value) continue
    style[key] = transformCssValue(value, (value) => {
      const exact = replacements.find((entry) => value.trim() === entry.syntax)
      if (exact) return exact.value

      tokenReplacements ??= replacements.map(({ syntax, value }) => ({
        value,
        // NUL-delimited literal/var placeholders must stay opaque even to numeric syntax.
        pattern: /\s/.test(syntax)
          ? null
          : new RegExp(
              `(^|[^A-Za-z0-9_\0-])(${syntax.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=[^A-Za-z0-9_\0-]|$)`,
              'g'
            )
      }))
      return replaceKnownCodeSyntaxTokens(value, tokenReplacements)
    })
  }
}

function replaceKnownCodeSyntaxTokens(
  value: string,
  replacements: CodeSyntaxReplacement[]
): string {
  const placeholders: string[] = []
  let delimiter = '\0'
  while (value.includes(delimiter)) delimiter += '\0'
  let out = replaceVarFunctions(value, ({ full }) => {
    const token = `${delimiter}${placeholders.length}${delimiter}`
    placeholders.push(full)
    return token
  })

  for (const { pattern, value: replacement } of replacements) {
    if (!pattern) continue
    out = out.replace(pattern, (_match, prefix: string) => `${prefix}${replacement}`)
  }

  return out.replace(
    new RegExp(`${delimiter}(\\d+)${delimiter}`, 'g'),
    (_match, index: string) => placeholders[Number(index)]!
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
    if (
      (field === 'itemSpacing' || field === 'counterAxisSpacing') &&
      'layoutMode' in node &&
      (node.layoutMode === 'HORIZONTAL' || node.layoutMode === 'VERTICAL')
    ) {
      const variable = resolveContextVariable(id, context, readers)
      const value = variable && format(variable)
      if (!value) continue
      if (style.gap) {
        // Figma's gap shorthand contains at most two top-level values.
        const parts = style.gap.match(/(?:[^\s()]|\([^)]*\))+/g) ?? []
        if (parts.length === 1 || parts.length === 2) {
          style['row-gap'] ??= parts[0]!
          style['column-gap'] ??= parts[1] ?? parts[0]!
          delete style.gap
        }
      }
      const horizontal = (node.layoutMode === 'HORIZONTAL') === (field === 'itemSpacing')
      const prop = horizontal ? 'column-gap' : 'row-gap'
      if (prop in style) style[prop] = value
      if (field === 'itemSpacing' && !bindings.counterAxisSpacing && hasSyncedCounterGap(node)) {
        const crossProp = horizontal ? 'row-gap' : 'column-gap'
        if (crossProp in style) style[crossProp] = value
      }
      continue
    }
    applyVariableToProps(style, props, id, context, format, readers)
  }
}

function hasSyncedCounterGap(node: SceneNode): boolean {
  if (!('layoutWrap' in node) || node.layoutWrap !== 'WRAP') return false
  if (node.counterAxisSpacing === null) return true
  // Native getters can expose a synchronized gap as a number. The authored
  // marker supplies the intent; equality alone must never establish it.
  return (
    typeof node.counterAxisSpacing === 'number' &&
    node.counterAxisSpacing === node.itemSpacing &&
    node.getSharedPluginData?.(CANVAS_KEY_NAMESPACE, CANVAS_COUNTER_AXIS_SYNC_NAME) === 'true'
  )
}

function applyTextFields(
  style: Record<string, string>,
  node: TextNode,
  context: VariableProjectionContext,
  format: VariableFormatter,
  readers: FigmaLookupReaders
): void {
  for (const [field, props] of Object.entries(TEXT_VARIABLE_STYLE_PROPS)) {
    if (!props.some((prop) => prop in style)) continue
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
