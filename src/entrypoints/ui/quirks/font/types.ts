export type TextCase = 'none' | 'uppercase' | 'lowercase' | 'capitalize' // text-transform
export type TextAutoResize = 'none' | 'width' | 'height'
export type TextAlignX = 'left' | 'center' | 'right' | 'justify'
export type TextAlignY = 'top' | 'center' | 'bottom'
export type TextDecoration = 'underline' | 'line-through' | 'none'
export type NumericSpacing = 'normal' | 'proportional-nums' | 'tabular-nums'
export type NumericFigure = 'normal' | 'lining-nums' | 'oldstyle-nums'
export type NumericFraction = 'normal' | 'stacked-fractions'
export type FontCaps = 'normal' | 'smallcaps' | 'all-small-caps'
export type FontPosition = 'normal' | 'sub' | 'super'

export interface FontProps {
  'font-handle'?: string
  'derived-text-data'?: string
  'font-size'?: number
  'text-case'?: TextCase
  'text-align-horizontal'?: TextAlignX
  'text-align-vertical'?: TextAlignY
  'text-auto-resize'?: TextAutoResize
  'text-decoration'?: TextDecoration
  'paragraph-indent'?: number
  'text-truncation'?: boolean
  'max-lines'?: number
  'line-height'?: string
  'font-variant-numeric-figure'?: NumericFigure
  'font-variant-numeric-spacing'?: NumericSpacing
  'font-variant-numeric-fraction'?: NumericFraction
  'font-variant-slashed-zero'?: boolean // 'zero'
  'font-variant-ordinal'?: boolean // 'ordn'
  'font-variant-caps'?: FontCaps
  'font-vairant-position'?: FontPosition
  'toggled-on-ot-features'?: string[]
  'toggled-off-ot-features'?: string[]
}
