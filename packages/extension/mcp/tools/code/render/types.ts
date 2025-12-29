import type { CodegenConfig } from '@/utils/codegen'

import type { SvgEntry } from '../assets'

export type CodeLanguage = 'jsx' | 'vue'

export type RenderContext = {
  styles: Map<string, Record<string, string>>
  layout: Map<string, Record<string, string>>
  nodes: Map<string, SceneNode>
  svgs: Map<string, SvgEntry>
  textSegments: Map<string, StyledTextSegment[] | null>
  pluginComponents?: Map<string, import('./plugin').PluginComponent | null>
  pluginCode?: string
  config: CodegenConfig
  preferredLang?: CodeLanguage
  detectedLang?: CodeLanguage
  resolveStyleVars?: (style: Record<string, string>, node?: SceneNode) => Record<string, string>
}
