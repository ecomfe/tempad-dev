import type { VisibleTree } from '../model'

type StyleMap = Map<string, Record<string, string>>

export function patchNegativeGapStyles(tree: VisibleTree, styles: StyleMap): void {
  tree.rootIds.forEach((rootId) => patchNode(rootId, tree, styles))
}

function patchNode(nodeId: string, tree: VisibleTree, styles: StyleMap): void {
  const node = tree.nodes.get(nodeId)
  if (!node) return

  const style = styles.get(node.id)
  const children = node.children ?? []
  if (!style) {
    children.forEach((childId) => patchNode(childId, tree, styles))
    return
  }

  const [row, col] = readGap(style)
  const negRow = row != null && row < 0
  const negCol = col != null && col < 0
  if (!negRow && !negCol) {
    children.forEach((childId) => patchNode(childId, tree, styles))
    return
  }

  const overlapRow = negRow ? -row! : 0
  const overlapCol = negCol ? -col! : 0
  const shouldCompensate = children.length > 1

  const nextStyle = { ...style }
  delete nextStyle['gap']
  delete nextStyle['row-gap']
  delete nextStyle['column-gap']

  if (row != null) nextStyle['row-gap'] = `${Math.max(row, 0)}px`
  if (col != null) nextStyle['column-gap'] = `${Math.max(col, 0)}px`

  if (shouldCompensate) {
    if (overlapRow) nextStyle['padding-top'] = addPxOrCalc(nextStyle['padding-top'], overlapRow)
    if (overlapCol) nextStyle['padding-left'] = addPxOrCalc(nextStyle['padding-left'], overlapCol)
  }
  styles.set(node.id, nextStyle)

  for (const childId of children) {
    if (shouldCompensate && (overlapRow || overlapCol)) {
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
    patchNode(childId, tree, styles)
  }
}

function readGap(style: Record<string, string>): [number | undefined, number | undefined] {
  const fromGap = parseGap(style['gap'])
  return [
    parsePxLiteral(style['row-gap']) ?? fromGap[0],
    parsePxLiteral(style['column-gap']) ?? fromGap[1]
  ]
}

function parsePxLiteral(value?: string): number | null {
  if (!value) return null
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)px$/i)
  if (!match) return null
  const n = Number(match[1])
  return Number.isFinite(n) ? n : null
}

function parseGap(gap?: string): [number | undefined, number | undefined] {
  if (!gap) return [undefined, undefined]
  const [r, c] = gap.trim().split(/\s+/).filter(Boolean)
  if (!r) return [undefined, undefined]
  const row = parsePxLiteral(r)
  const col = parsePxLiteral(c ?? r)
  return [row ?? undefined, col ?? undefined]
}

function addPxOrCalc(existing: string | undefined, deltaPx: number): string {
  if (deltaPx === 0) return existing ?? '0px'
  const px = parsePxLiteral(existing)
  if (px != null) return `${px + deltaPx}px`
  if (!existing) return `${deltaPx}px`
  const sign = deltaPx < 0 ? '-' : '+'
  return `calc(${existing.trim()} ${sign} ${Math.abs(deltaPx)}px)`
}
