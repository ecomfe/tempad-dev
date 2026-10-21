import type {
  CanvasFigmaTextRange,
  CanvasStyleBindings,
  CanvasVariableBindings
} from '@tempad-dev/shared'

import type { CanvasNodeSpec } from '../model'
import type { SupportedCanvasNode } from './state'

import { specError } from '../errors'
import { isFrameContainer } from './nodes'
import {
  textParagraphRanges,
  textRangesMatchOutside,
  textRangesOutside,
  type TextRange
} from './text-ranges'

export const STYLE_TYPES = {
  fill: 'PAINT',
  stroke: 'PAINT',
  text: 'TEXT',
  effect: 'EFFECT',
  grid: 'GRID'
} satisfies Record<keyof CanvasStyleBindings, StyleType>

export function validateStyleType(
  field: keyof CanvasStyleBindings,
  style: BaseStyle,
  key: string
): void {
  const expected = STYLE_TYPES[field]
  if (style.type !== expected) {
    specError(
      `Style "${style.id}" for ${field} on "${key}" is ${style.type}, expected ${expected}.`
    )
  }
}

function expectedVariableType(field: keyof CanvasVariableBindings): VariableResolvedDataType {
  if (field === 'fill' || field === 'stroke') return 'COLOR'
  if (field === 'characters' || field === 'fontFamily' || field === 'fontStyle') return 'STRING'
  if (field === 'visible') return 'BOOLEAN'
  return 'FLOAT'
}

export function validateVariableType(
  field: keyof CanvasVariableBindings,
  variable: Pick<Variable, 'id' | 'resolvedType'>,
  key: string
): void {
  validateVariableDataType(variable, expectedVariableType(field), `${field} on "${key}"`)
}

export function validateVariableDataType(
  variable: Pick<Variable, 'id' | 'resolvedType'>,
  expected: VariableResolvedDataType,
  usage: string
): void {
  if (variable.resolvedType !== expected) {
    specError(
      `Variable "${variable.id}" for ${usage} is ${variable.resolvedType}, expected ${expected}.`
    )
  }
}

export const STYLE_FIELDS = ['fill', 'stroke', 'text', 'effect', 'grid'] as const

export type StyleField = (typeof STYLE_FIELDS)[number]

export function styleLinkMatches(
  node: SupportedCanvasNode,
  field: StyleField,
  id: string,
  ranges: CanvasFigmaTextRange[] | undefined
): boolean {
  if (styleTarget(node, field).current === id) return true
  if (
    node.type !== 'TEXT' ||
    node.characters.length === 0 ||
    (field !== 'text' && field !== 'fill')
  )
    return false
  const overrides = ranges?.filter((range) =>
    field === 'text'
      ? range.textStyle !== undefined
      : range.fillStyle !== undefined || range.fills !== undefined
  )
  if (!overrides?.length) return false
  return textRangesMatchOutside(
    { start: 0, end: node.characters.length },
    overrides,
    (start, end) =>
      (field === 'text'
        ? node.getRangeTextStyleId(start, end)
        : node.getRangeFillStyleId(start, end)) === id
  )
}

export function styleTarget(
  node: SupportedCanvasNode,
  field: StyleField
): {
  apply: (id: string) => Promise<void>
  current: string | symbol
  text?: TextNode
} {
  switch (field) {
    case 'fill':
      if (!('fillStyleId' in node)) {
        specError(`Fill styles are not supported on ${node.type} nodes.`)
      }
      return {
        current: node.fillStyleId,
        apply: (id) => node.setFillStyleIdAsync(id)
      }
    case 'stroke':
      if (!('strokeStyleId' in node)) {
        specError(`Stroke styles are not supported on ${node.type} nodes.`)
      }
      return {
        current: node.strokeStyleId,
        apply: (id) => node.setStrokeStyleIdAsync(id)
      }
    case 'text':
      if (node.type !== 'TEXT') specError(`Text styles require a TEXT node, not ${node.type}.`)
      return {
        current: node.textStyleId,
        apply: (id) => node.setTextStyleIdAsync(id),
        text: node
      }
    case 'effect':
      if (!('effectStyleId' in node)) {
        specError(`Effect styles are not supported on ${node.type} nodes.`)
      }
      return {
        current: node.effectStyleId,
        apply: (id) => node.setEffectStyleIdAsync(id)
      }
    case 'grid':
      if (!isFrameContainer(node) && node.type !== 'INSTANCE') {
        specError('Grid styles require a frame container or instance node.')
      }
      return {
        current: node.gridStyleId,
        apply: (id) => node.setGridStyleIdAsync(id)
      }
  }
}

export type DirectVariableField = Exclude<keyof CanvasVariableBindings, 'fill' | 'stroke'>

export const DIRECT_VARIABLE_FIELDS: Record<
  DirectVariableField,
  VariableBindableNodeField | VariableBindableTextField
> = {
  characters: 'characters',
  visible: 'visible',
  width: 'width',
  height: 'height',
  minWidth: 'minWidth',
  maxWidth: 'maxWidth',
  minHeight: 'minHeight',
  maxHeight: 'maxHeight',
  gap: 'itemSpacing',
  counterAxisSpacing: 'counterAxisSpacing',
  gridRowGap: 'gridRowGap',
  gridColumnGap: 'gridColumnGap',
  paddingTop: 'paddingTop',
  paddingRight: 'paddingRight',
  paddingBottom: 'paddingBottom',
  paddingLeft: 'paddingLeft',
  cornerRadius: 'cornerRadius',
  topLeftRadius: 'topLeftRadius',
  topRightRadius: 'topRightRadius',
  bottomRightRadius: 'bottomRightRadius',
  bottomLeftRadius: 'bottomLeftRadius',
  strokeWeight: 'strokeWeight',
  strokeTopWeight: 'strokeTopWeight',
  strokeRightWeight: 'strokeRightWeight',
  strokeBottomWeight: 'strokeBottomWeight',
  strokeLeftWeight: 'strokeLeftWeight',
  opacity: 'opacity',
  fontFamily: 'fontFamily',
  fontStyle: 'fontStyle',
  fontWeight: 'fontWeight',
  fontSize: 'fontSize',
  lineHeight: 'lineHeight',
  letterSpacing: 'letterSpacing',
  paragraphIndent: 'paragraphIndent',
  paragraphSpacing: 'paragraphSpacing'
}

export function currentBoundVariableId(
  node: SupportedCanvasNode,
  field: VariableBindableNodeField | VariableBindableTextField
): string | undefined {
  const value = node.boundVariables?.[field]
  const directId = Array.isArray(value) ? value[0]?.id : value?.id
  if (directId || field !== 'cornerRadius') return directId

  const aliases = [
    node.boundVariables?.topLeftRadius,
    node.boundVariables?.topRightRadius,
    node.boundVariables?.bottomLeftRadius,
    node.boundVariables?.bottomRightRadius
  ]
  const radiusId = aliases[0]?.id
  return radiusId && aliases.every((alias) => alias?.id === radiusId) ? radiusId : undefined
}

// Undefined permits a whole-node write; an empty list preserves the whole field.
export function unboundTextMetricRanges(
  node: TextNode,
  spec: CanvasNodeSpec,
  field: 'fontSize' | 'lineHeight' | 'letterSpacing' | 'paragraphIndent' | 'paragraphSpacing'
): TextRange[] | undefined {
  if (spec.variables?.[field]) return []
  if (spec.variables?.[field] === null || !currentBoundVariableId(node, field)) return undefined
  if (node.characters !== spec.text?.characters || !node.characters.length) return []
  const scope = { start: 0, end: node.characters.length }
  const current = node.getRangeBoundVariable(scope.start, scope.end, field)
  let bound: TextRange[]
  if (current !== figma.mixed) {
    if (!current) return []
    bound = [scope]
  } else {
    const segments = node.getStyledTextSegments(['boundVariables'])
    let end = 0
    bound = []
    for (const segment of segments) {
      if (segment.start !== end || segment.end <= end || segment.end > scope.end) return []
      end = segment.end
      if (segment.boundVariables?.[field]) bound.push(segment)
    }
    // Keep aggregate ownership when segment data cannot account for its alias.
    if (end !== scope.end || !bound.length) return []
  }
  let clearing: TextRange[] =
    spec.figma?.text?.ranges?.filter((range) => range.variables?.[field] === null) ?? []
  if (field === 'paragraphIndent' || field === 'paragraphSpacing') {
    bound = textParagraphRanges(node.characters, bound)
    clearing = textParagraphRanges(node.characters, clearing)
  }
  const retained = bound.flatMap((range) => [...textRangesOutside(range, clearing)])
  return retained.length ? [...textRangesOutside(scope, retained)] : undefined
}
