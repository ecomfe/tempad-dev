import type { BasicProps } from './basic'
import type { FontProps } from './font'
import type { StackProps } from './stack'
import type { StyleProps } from './style'

export interface PluginData {
  pluginID: string
  key: string
  value: string
}

// https://stackoverflow.com/a/66140779
type KebabCase<T extends string, A extends string = ''> = T extends `${infer F}${infer R}`
  ? KebabCase<R, `${A}${F extends Lowercase<F> ? '' : '-'}${Lowercase<F>}`>
  : A

type SupplementProperty =
  | '-webkit-line-clamp'
  | '-webkit-box-orient'
  | '-webkit-background-clip'
  | '-webkit-text-fill-color'
  | 'text-fill-color'

export type StyleRecord = Partial<
  Record<KebabCase<keyof CSSStyleDeclaration & string> | SupplementProperty, string>
>

export interface QuirksNodeProps extends BasicProps, StackProps, FontProps, StyleProps {
  'plugin-data'?: PluginData[]
}
