import type { CodegenConfig } from '@/utils/codegen'

import { options } from '@/ui/state'

export function currentCodegenConfig(): CodegenConfig {
  const { cssUnit, rootFontSize, scale } = options.value
  return { cssUnit, rootFontSize, scale }
}
