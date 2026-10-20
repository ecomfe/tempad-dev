import type { CanvasNodeSpec } from '../model'

import { textRangesOutside, type TextRange } from './text-ranges'

export type BaseTextStyleScope =
  | { kind: 'whole' }
  | { kind: 'retained' }
  | { kind: 'partial'; ranges: TextRange[] }

export function baseTextStyleScope(
  spec: CanvasNodeSpec,
  node?: TextNode | null
): BaseTextStyleScope {
  if (spec.styles?.text) return { kind: 'retained' }
  if (!node) return { kind: 'whole' }
  // Old character ranges cannot safely describe replacement text. Preserve the
  // existing conservative ownership until native text replacement has happened.
  if (spec.text?.characters !== node.characters) {
    return { kind: spec.styles?.text !== null && node.textStyleId ? 'retained' : 'whole' }
  }
  const scope = { start: 0, end: node.characters.length }
  const ranges = spec.figma?.text?.ranges ?? []
  const clearing = ranges.filter((range) => range.textStyle === null)
  let retained: TextRange[]
  if (spec.styles?.text === null) {
    retained = ranges.filter((range) => range.textStyle)
  } else if (!node.textStyleId) {
    return { kind: 'whole' }
  } else if (node.textStyleId !== figma.mixed) {
    if (!clearing.length) return { kind: 'retained' }
    retained = [...textRangesOutside(scope, clearing)]
  } else {
    const segments = node.getStyledTextSegments(['textStyleId'])
    // Native segments cover the complete string. Incomplete bridge data must
    // not silently turn an unknown linked span into writable plain text.
    let end = 0
    for (const segment of segments) {
      if (segment.start !== end || segment.end <= end || typeof segment.textStyleId !== 'string') {
        return { kind: 'retained' }
      }
      end = segment.end
    }
    if (end !== scope.end) return { kind: 'retained' }
    retained = segments.flatMap((segment) =>
      segment.textStyleId ? [...textRangesOutside(segment, clearing)] : []
    )
  }
  if (!retained.length) return { kind: 'whole' }
  const writable = [...textRangesOutside(scope, retained)]
  return writable.length ? { kind: 'partial', ranges: writable } : { kind: 'retained' }
}
