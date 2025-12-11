import type { CodegenConfig } from '@/utils/codegen'

import type { SvgEntry } from '../assets'

export type CodeLanguage = 'jsx' | 'vue'

export type RenderContext = {
  styles: Map<string, Record<string, string>>
  nodes: Map<string, SceneNode>
  svgs: Map<string, SvgEntry>
  pluginCode?: string
  config: CodegenConfig
  preferredLang?: CodeLanguage
  detectedLang?: CodeLanguage
}
