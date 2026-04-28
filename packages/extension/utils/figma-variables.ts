import type { FigmaLookupReaders } from './figma-style/types'

import { canonicalizeVarName, normalizeFigmaVarName, toFigmaVarExpr } from './css'

const DEFAULT_READERS: FigmaLookupReaders = {
  getStyleById: (id) => figma.getStyleById(id),
  getVariableById: (id) => figma.variables.getVariableById(id)
}

export const NODE_VARIABLE_STYLE_PROPS = {
  width: ['width'],
  height: ['height'],
  minWidth: ['min-width'],
  maxWidth: ['max-width'],
  minHeight: ['min-height'],
  maxHeight: ['max-height'],
  itemSpacing: ['gap', 'row-gap', 'column-gap'],
  paddingLeft: ['padding-left'],
  paddingRight: ['padding-right'],
  paddingTop: ['padding-top'],
  paddingBottom: ['padding-bottom'],
  topLeftRadius: ['border-top-left-radius'],
  topRightRadius: ['border-top-right-radius'],
  bottomLeftRadius: ['border-bottom-left-radius'],
  bottomRightRadius: ['border-bottom-right-radius'],
  strokeWeight: ['border-width', 'stroke-width'],
  strokeTopWeight: ['border-top-width'],
  strokeRightWeight: ['border-right-width'],
  strokeBottomWeight: ['border-bottom-width'],
  strokeLeftWeight: ['border-left-width'],
  opacity: ['opacity'],
  gridRowGap: ['row-gap'],
  gridColumnGap: ['column-gap']
} as const satisfies Partial<Record<VariableBindableNodeField, readonly string[]>>

export const TEXT_VARIABLE_STYLE_PROPS = {
  fontFamily: ['font-family'],
  fontSize: ['font-size'],
  fontStyle: ['font-style'],
  fontWeight: ['font-weight'],
  letterSpacing: ['letter-spacing'],
  lineHeight: ['line-height'],
  paragraphIndent: ['text-indent']
} as const satisfies Partial<Record<VariableBindableTextField, readonly string[]>>

export const TEXT_VARIABLE_FIELDS = Object.keys(
  TEXT_VARIABLE_STYLE_PROPS
) as VariableBindableTextField[]

type VariableAliasLike = { id?: unknown } | null | undefined
type TextSegmentBindingSource = {
  start: number
  end: number
  boundVariables?: Record<string, unknown>
  textStyleId?: unknown
}

export function getVariableRawName(variable: Variable): string {
  const codeSyntax = variable.codeSyntax?.WEB
  if (typeof codeSyntax === 'string' && codeSyntax.trim()) {
    const trimmed = codeSyntax.trim()
    const canonical = canonicalizeVarName(trimmed)
    if (canonical) return canonical.slice(2)
    if (/^[A-Za-z0-9_-]+$/.test(trimmed)) return trimmed
  }

  const raw = variable.name?.trim?.() ?? ''
  return raw.startsWith('--') ? raw.slice(2) : raw
}

export function getVariableCssName(variable: Variable): string {
  return normalizeFigmaVarName(getVariableRawName(variable))
}

export function getVariableCssExpr(variable: Variable): string {
  return toFigmaVarExpr(getVariableRawName(variable))
}

export function getVariableCodeSyntax(variable: Variable): string | null {
  const codeSyntax = variable.codeSyntax?.WEB
  return typeof codeSyntax === 'string' && codeSyntax ? codeSyntax : null
}

export function resolveVariableById(
  id: string,
  readers: FigmaLookupReaders = DEFAULT_READERS
): Variable | null {
  try {
    return readers.getVariableById(id)
  } catch {
    return null
  }
}

export function resolveVariableAlias(
  alias: VariableAliasLike,
  readers: FigmaLookupReaders = DEFAULT_READERS
): Variable | null {
  const id = getSingleVariableId(alias)
  return id ? resolveVariableById(id, readers) : null
}

export function collectNodeVariableIds(
  node: SceneNode,
  readers: FigmaLookupReaders = DEFAULT_READERS
): Set<string> {
  const ids = new Set<string>()
  collectNodeVariableIdsInto(node, ids, readers)
  return ids
}

export function collectNodeVariableIdsInto(
  node: SceneNode,
  ids: Set<string>,
  readers: FigmaLookupReaders = DEFAULT_READERS
): void {
  collectVariableIdsFromValue((node as { boundVariables?: unknown }).boundVariables, ids)
  collectPaintVariableIds((node as { fills?: unknown }).fills, ids)
  collectPaintVariableIds((node as { strokes?: unknown }).strokes, ids)
  collectEffectVariableIds((node as { effects?: unknown }).effects, ids)
  collectPaintStyleVariableIds((node as { fillStyleId?: unknown }).fillStyleId, ids, readers)
  collectPaintStyleVariableIds((node as { strokeStyleId?: unknown }).strokeStyleId, ids, readers)

  if (node.type === 'TEXT') {
    TEXT_VARIABLE_FIELDS.forEach((field) => {
      const id = resolveTextNodeVariableId(node, field, readers)
      if (id) ids.add(id)
    })
  }
}

export function collectVariableIdsFromValue(value: unknown, ids: Set<string>): void {
  if (!value) return

  if (Array.isArray(value)) {
    value.forEach((entry) => collectVariableIdsFromValue(entry, ids))
    return
  }

  if (typeof value !== 'object') return

  if (
    'visible' in (value as { visible?: boolean }) &&
    (value as { visible?: boolean }).visible === false
  ) {
    return
  }

  const id = (value as { id?: unknown }).id
  if (typeof id === 'string' && id) {
    ids.add(id)
    return
  }

  Object.values(value).forEach((entry) => collectVariableIdsFromValue(entry, ids))
}

export function getSingleVariableId(value: unknown): string | null {
  if (!value) return null

  if (Array.isArray(value)) {
    const ids = new Set(
      value
        .map((entry) => getSingleVariableId(entry))
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    )
    return ids.size === 1 ? [...ids][0] : null
  }

  if (typeof value !== 'object') return null
  const id = (value as { id?: unknown }).id
  return typeof id === 'string' && id ? id : null
}

export function resolveTextNodeVariableId(
  node: TextNode,
  field: VariableBindableTextField,
  readers: FigmaLookupReaders = DEFAULT_READERS
): string | null {
  return (
    resolveRangeVariableId(node, 0, node.characters.length, field) ??
    resolveTextStyleVariableId((node as { textStyleId?: unknown }).textStyleId, field, readers) ??
    getSingleVariableId(
      (node as { boundVariables?: Record<string, unknown> }).boundVariables?.[field]
    )
  )
}

export function resolveTextSegmentVariable(
  node: TextNode,
  segment: TextSegmentBindingSource,
  field: VariableBindableTextField,
  readers: FigmaLookupReaders = DEFAULT_READERS
): Variable | null {
  const id =
    getSingleVariableId(segment.boundVariables?.[field]) ??
    resolveTextStyleVariableId(segment.textStyleId, field, readers) ??
    resolveRangeVariableId(node, segment.start, segment.end, field)

  return id ? resolveVariableById(id, readers) : null
}

function resolveTextStyleVariableId(
  textStyleId: unknown,
  field: VariableBindableTextField,
  readers: FigmaLookupReaders
): string | null {
  if (typeof textStyleId !== 'string' || !textStyleId) return null

  try {
    const style = readers.getStyleById(textStyleId) as
      | (TextStyle & {
          boundVariables?: Partial<Record<VariableBindableTextField, VariableAliasLike>>
        })
      | null
    return getSingleVariableId(style?.boundVariables?.[field])
  } catch {
    return null
  }
}

function resolveRangeVariableId(
  node: TextNode,
  start: number,
  end: number,
  field: VariableBindableTextField
): string | null {
  if (typeof node.getRangeBoundVariable !== 'function') return null

  try {
    const alias = node.getRangeBoundVariable(start, end, field)
    return alias !== figma.mixed ? getSingleVariableId(alias) : null
  } catch {
    return null
  }
}

function collectPaintVariableIds(paints: unknown, ids: Set<string>): void {
  if (!Array.isArray(paints)) return
  paints.forEach((paint) => {
    if (!paint || typeof paint !== 'object') return
    collectVariableIdsFromValue((paint as { boundVariables?: unknown }).boundVariables, ids)
    collectVariableIdsFromValue((paint as { variableReferences?: unknown }).variableReferences, ids)
  })
}

function collectEffectVariableIds(effects: unknown, ids: Set<string>): void {
  if (!Array.isArray(effects)) return
  effects.forEach((effect) => {
    if (!effect || typeof effect !== 'object') return
    collectVariableIdsFromValue((effect as { boundVariables?: unknown }).boundVariables, ids)
    collectVariableIdsFromValue(
      (effect as { variableReferences?: unknown }).variableReferences,
      ids
    )
  })
}

function collectPaintStyleVariableIds(
  styleId: unknown,
  ids: Set<string>,
  readers: FigmaLookupReaders
): void {
  if (typeof styleId !== 'string' || !styleId) return

  try {
    const style = readers.getStyleById(styleId) as PaintStyle | null
    if (!style?.paints || !Array.isArray(style.paints)) return
    style.paints.forEach((paint) => {
      if (!paint || paint.visible === false) return
      collectVariableIdsFromValue(paint.boundVariables, ids)
      collectVariableIdsFromValue(
        (paint as { variableReferences?: unknown }).variableReferences,
        ids
      )
    })
  } catch {
    // noop
  }
}
