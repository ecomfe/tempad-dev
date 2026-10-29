import { expandShorthands } from '@/utils/css'

import type { VisibleTree } from '../model'

type StyleMap = Map<string, Record<string, string>>

export function patchNegativeGapStyles(tree: VisibleTree, styles: StyleMap): void {
  for (const nodeId of tree.order) {
    const node = tree.nodes.get(nodeId)
    const style = styles.get(nodeId)
    if (!node || !style) continue

    // Expand only the gap, preserving explicit longhands and unknown shorthand arity.
    const gap = style.gap ? expandShorthands({ gap: style.gap }) : undefined
    const row = parsePxLiteral(style['row-gap'] ?? gap?.['row-gap'])
    const col = parsePxLiteral(style['column-gap'] ?? gap?.['column-gap'])
    const overlapRow = row != null && row < 0 ? -row : 0
    const overlapCol = col != null && col < 0 ? -col : 0
    if (!overlapRow && !overlapCol) continue

    const nextStyle = { ...gap, ...style }
    if (!gap?.gap) delete nextStyle.gap
    if (overlapRow) nextStyle['row-gap'] = '0px'
    if (overlapCol) nextStyle['column-gap'] = '0px'
    styles.set(nodeId, nextStyle)

    const children = (node.children ?? []).filter(
      (id) => !/^(absolute|fixed)$/i.test(styles.get(id)?.position?.trim() ?? '')
    )
    if (children.length <= 1) continue

    if (overlapRow) nextStyle['padding-top'] = addPxOrCalc(nextStyle['padding-top'], overlapRow)
    if (overlapCol) nextStyle['padding-left'] = addPxOrCalc(nextStyle['padding-left'], overlapCol)
    for (const childId of children) {
      const childStyle = styles.get(childId) ?? {}
      const nextChildStyle = { ...childStyle }
      if (!nextChildStyle['box-sizing']) nextChildStyle['box-sizing'] = 'border-box'
      if (overlapRow) {
        nextChildStyle['margin-top'] = addPxOrCalc(nextChildStyle['margin-top'], -overlapRow)
      }
      if (overlapCol) {
        nextChildStyle['margin-left'] = addPxOrCalc(nextChildStyle['margin-left'], -overlapCol)
      }
      styles.set(childId, nextChildStyle)
    }
  }
}

function parsePxLiteral(value?: string): number | null {
  if (!value) return null
  const match = value.trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(px)?$/i)
  if (!match) return null
  const n = Number(match[1])
  return Number.isFinite(n) && (match[2] || n === 0) ? n : null
}

function addPxOrCalc(existing: string | undefined, deltaPx: number): string {
  const px = parsePxLiteral(existing)
  if (px != null) return `${px + deltaPx}px`
  if (!existing) return `${deltaPx}px`
  const sign = deltaPx < 0 ? '-' : '+'
  return `calc(${existing.trim()} ${sign} ${Math.abs(deltaPx)}px)`
}
