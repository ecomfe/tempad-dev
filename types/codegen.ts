import type { DesignComponent, DevComponent, SupportedLang } from '@/types/plugin'

export interface SerializeOptions {
  useRem: boolean
  rootFontSize: number
  scale: number
}

export interface RequestPayload {
  style: Record<string, string>
  component?: DesignComponent
  options: SerializeOptions
  pluginCode?: string
  returnDevComponent?: boolean
}

export interface ResponsePayload {
  pluginName?: string
  codeBlocks: CodeBlock[]
  devComponent?: DevComponent
}

export type CodeBlock = {
  name: string
  title: string
  code: string
  lang: SupportedLang
}
