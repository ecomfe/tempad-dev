export interface StyleProps {
  opacity: number
  'blend-mode': string
  'fill-paint-data'?: string[]
  'stroke-paint-data'?: string[]
  'stroke-weight': number
  'stroke-dash-pattern': number[]
  'border-stroke-weights-independent'?: boolean
  'border-top-weight'?: number
  'border-right-weight'?: number
  'border-bottom-weight'?: number
  'border-left-weight'?: number
  'rectangle-corner-radii-independent'?: boolean
  'rectangle-top-left-corner-radius'?: number
  'rectangle-top-right-corner-radius'?: number
  'rectangle-bottom-left-corner-radius'?: number
  'rectangle-bottom-right-corner-radius'?: number
  'effect-data'?: number // we can only access the count of effects
}
