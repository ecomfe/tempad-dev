export type StackMode = 'row' | 'column' | 'none'
export type StackWrap = 'wrap' | 'nowrap'
export type StackJustify = 'flex-start' | 'center' | 'flex-end' | 'space-between'
export type StackAlign = 'flex-start' | 'center' | 'flex-end' | 'baseline' | 'stretch' | 'auto'
export type StackPosition = 'absolute' | 'static'
export type StackSize = 'hug' | 'fixed'
export type Constraint = 'min' | 'max' | 'center' | 'stretch' | 'scale'

export interface StackProps {
  'horizontal-constraint': Constraint
  'vertical-constraint': Constraint
  'relative-transform': DOMMatrixReadOnly
  'max-size'?: [number, number] | null
  'min-size'?: [number, number] | null
  'stack-mode'?: StackMode
  'stack-wrap'?: StackWrap
  'stack-primary-sizing'?: StackSize
  'stack-counter-sizing'?: StackSize
  'stack-primary-align-items'?: StackJustify
  'stack-counter-align-items'?: StackAlign
  'stack-spacing'?: number
  'stack-counter-spacing'?: number
  'stack-padding-top'?: number
  'stack-padding-right'?: number
  'stack-padding-bottom'?: number
  'stack-padding-left'?: number
  'stack-child-primary-grow'?: number
  'stack-child-align-self'?: StackAlign
  'stack-positioning'?: StackPosition
}
