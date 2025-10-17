import type { DesignComponent, SupportedLang } from '@/types/plugin'

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
}

export interface ResponsePayload {
  pluginName?: string
  codeBlocks: CodeBlock[]
}

export type CodeBlock = {
  name: string
  title: string
  code: string
  lang: SupportedLang
}
