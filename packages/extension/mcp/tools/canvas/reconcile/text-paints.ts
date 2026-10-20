import type { CanvasFigmaTextRange } from '@tempad-dev/shared'

import { paintStacksEqual } from './native-values'
import { textRangesMatchOutside } from './text-ranges'

export function textFillsUnstyledOutsideRanges(
  node: TextNode,
  ranges: CanvasFigmaTextRange[] | undefined
): boolean {
  // Explicit unlinking does not retain a style in this span. Only links outside
  // the authored overrides can protect the base color.
  const overrides =
    ranges?.filter((range) => range.fills !== undefined || range.fillStyle !== undefined) ?? []
  return (
    node.characters.length > 0 &&
    overrides.length > 0 &&
    textRangesMatchOutside(
      { start: 0, end: node.characters.length },
      overrides,
      (start, end) => node.getRangeFillStyleId(start, end) === ''
    )
  )
}

export function textFillsMatch(
  node: TextNode,
  desired: Paint[],
  ranges: CanvasFigmaTextRange[] | undefined
): boolean {
  const current = node.fills
  if (current !== figma.mixed && !node.fillStyleId && paintStacksEqual(current, desired)) {
    return true
  }
  // Clearing a range's style alone does not replace its paint value.
  const overrides = ranges?.filter((range) => range.fills !== undefined || range.fillStyle) ?? []
  return (
    node.characters.length > 0 &&
    overrides.length > 0 &&
    textRangesMatchOutside({ start: 0, end: node.characters.length }, overrides, (start, end) => {
      const paints = node.getRangeFills(start, end)
      return (
        paints !== figma.mixed &&
        node.getRangeFillStyleId(start, end) === '' &&
        paintStacksEqual(paints, desired)
      )
    })
  )
}
