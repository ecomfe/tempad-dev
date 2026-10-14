import type { FigmaLookupReaders } from './figma-style/types'

import { normalizeFigmaVarName, toFigmaVarExpr } from './css'

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
  itemSpacing: [],
  counterAxisSpacing: [],
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
  readers: FigmaLookupReaders = DEFAULT_READERS,
  checkpoint?: () => void
): void {
  checkpoint?.()
  collectVariableIdsFromValue(
    (node as { boundVariables?: unknown }).boundVariables,
    ids,
    checkpoint
  )
  checkpoint?.()
  collectPaintOrEffectVariableIds((node as { fills?: unknown }).fills, ids, checkpoint)
  checkpoint?.()
  collectPaintOrEffectVariableIds((node as { strokes?: unknown }).strokes, ids, checkpoint)
  checkpoint?.()
  collectPaintOrEffectVariableIds((node as { effects?: unknown }).effects, ids, checkpoint)
  checkpoint?.()
  collectPaintStyleVariableIds(
    (node as { fillStyleId?: unknown }).fillStyleId,
    ids,
    readers,
    checkpoint
  )
  checkpoint?.()
  collectPaintStyleVariableIds(
    (node as { strokeStyleId?: unknown }).strokeStyleId,
    ids,
    readers,
    checkpoint
  )
  checkpoint?.()

  if (node.type === 'TEXT') {
    TEXT_VARIABLE_FIELDS.forEach((field) => {
      checkpoint?.()
      const id = resolveTextNodeVariableId(node, field, readers, checkpoint)
      if (id) ids.add(id)
    })
  }
}

export function collectVariableIdsFromValue(
  value: unknown,
  ids: Set<string>,
  checkpoint?: () => void
): void {
  checkpoint?.()
  if (!value) return

  if (Array.isArray(value)) {
    value.forEach((entry) => collectVariableIdsFromValue(entry, ids, checkpoint))
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

  Object.values(value).forEach((entry) => collectVariableIdsFromValue(entry, ids, checkpoint))
}

export function getSingleVariableId(value: unknown): string | null {
  if (!value) return null

  if (Array.isArray(value)) {
    const ids = new Set(
      value
        .map((entry) => getSingleVariableId(entry))
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    )
    return ids.size === 1 ? [...ids][0]! : null
  }

  if (typeof value !== 'object') return null
  const id = (value as { id?: unknown }).id
  return typeof id === 'string' && id ? id : null
}

export function resolveTextNodeVariableId(
  node: TextNode,
  field: VariableBindableTextField,
  readers: FigmaLookupReaders = DEFAULT_READERS,
  checkpoint?: () => void
): string | null {
  checkpoint?.()
  const rangeId = resolveRangeVariableId(node, 0, node.characters.length, field, readers)
  checkpoint?.()
  if (rangeId) return rangeId
  const styleId = resolveTextStyleVariableId(
    (node as { textStyleId?: unknown }).textStyleId,
    field,
    readers
  )
  checkpoint?.()
  return (
    styleId ??
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
    resolveRangeVariableId(node, segment.start, segment.end, field, readers)

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
  field: VariableBindableTextField,
  readers: FigmaLookupReaders
): string | null {
  if (typeof node.getRangeBoundVariable !== 'function') return null

  try {
    const alias = readers.getRangeBoundVariable
      ? readers.getRangeBoundVariable(node, start, end, field)
      : node.getRangeBoundVariable(start, end, field)
    return alias !== figma.mixed ? getSingleVariableId(alias) : null
  } catch {
    return null
  }
}

function collectPaintOrEffectVariableIds(
  entries: unknown,
  ids: Set<string>,
  checkpoint?: () => void
): void {
  if (!Array.isArray(entries)) return
  entries.forEach((entry) => {
    checkpoint?.()
    if (!entry || typeof entry !== 'object') return
    collectVariableIdsFromValue(
      (entry as { boundVariables?: unknown }).boundVariables,
      ids,
      checkpoint
    )
    collectVariableIdsFromValue(
      (entry as { variableReferences?: unknown }).variableReferences,
      ids,
      checkpoint
    )
  })
}

function collectPaintStyleVariableIds(
  styleId: unknown,
  ids: Set<string>,
  readers: FigmaLookupReaders,
  checkpoint?: () => void
): void {
  if (typeof styleId !== 'string' || !styleId) return

  let paints: readonly Paint[]
  let boundVariables: unknown
  try {
    const style = readers.getStyleById(styleId) as PaintStyle | null
    if (!style) return
    paints = style.paints
    if (!Array.isArray(paints)) return
    boundVariables = (style as { boundVariables?: unknown }).boundVariables
  } catch {
    return
  }
  // Keep cancellation outside native lookup recovery so the deadline propagates.
  checkpoint?.()
  collectVariableIdsFromValue(boundVariables, ids, checkpoint)
  paints.forEach((paint) => {
    checkpoint?.()
    if (!paint || paint.visible === false) return
    collectVariableIdsFromValue(paint.boundVariables, ids, checkpoint)
    collectVariableIdsFromValue(
      (paint as { variableReferences?: unknown }).variableReferences,
      ids,
      checkpoint
    )
  })
}
