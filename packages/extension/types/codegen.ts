import type { DesignComponent, DevComponent, SupportedLang } from '@/types/plugin'

export type VariableDisplayMode = 'reference' | 'resolved' | 'both'

export interface SerializeOptions {
  useRem: boolean
  rootFontSize: number
  scale: number
  variableDisplay?: VariableDisplayMode
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
