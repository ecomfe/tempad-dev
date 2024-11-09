import { SupportedLang } from '@/plugins/src'

export interface SerializeOptions {
  useRem: boolean
  rootFontSize: number
}

export interface RequestPayload {
  style: Record<string, string>
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
