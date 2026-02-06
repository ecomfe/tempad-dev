export type StyleMap = Record<string, string>

export type StyleStep = (style: StyleMap, node?: SceneNode, parent?: SceneNode) => StyleMap

export type AutoLayoutLike = {
  layoutMode?: 'HORIZONTAL' | 'VERTICAL' | 'GRID' | 'NONE'
  itemSpacing?: number
  primaryAxisAlignItems?: string
  counterAxisAlignItems?: string
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  paddingLeft?: number
  layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL'
  layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL'
}

export type OverflowDirection = 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'BOTH'

export type LayoutBounds = {
  x: number
  y: number
  width: number
  height: number
}
