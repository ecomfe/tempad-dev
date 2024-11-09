import type { RequestPayload, ResponsePayload, SerializeOptions, CodeBlock } from '@/codegen/types'

import Codegen from '@/codegen/codegen?worker&inline'
import { createWorkerRequester } from '@/codegen/worker'

export async function codegen(
  style: Record<string, string>,
  options: SerializeOptions,
  pluginCode?: string
): Promise<CodeBlock[]> {
  const request = createWorkerRequester<RequestPayload, ResponsePayload>(Codegen)

  return (
    await request({
      style,
      options,
      pluginCode
    })
  ).codeBlocks
}
