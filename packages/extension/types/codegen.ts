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
  pluginVariableStyle?: Record<string, string>
  variableSyntax?: Record<string, string>
  component?: DesignComponent
  options: SerializeOptions
  pluginCode?: string
  returnDevComponent?: boolean
}

export type CodegenJobPayload = Omit<RequestPayload, 'pluginCode'>

export interface CodegenBatchRequestPayload {
  jobs: CodegenJobPayload[]
  pluginCode?: string
}

export interface ResponsePayload {
  pluginName?: string
  codeBlocks: CodeBlock[]
  devComponent?: DevComponent
}

export interface CodegenBatchResponsePayload {
  results: ResponsePayload[]
}

export type CodeBlock = {
  name: string
  title: string
  code: string
  lang: SupportedLang
}
