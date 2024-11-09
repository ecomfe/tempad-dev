import type { RequestPayload, ResponsePayload, SerializeOptions } from '@/codegen/types'

import Codegen from '@/codegen/codegen?worker&inline'
import { createWorkerRequester } from '@/codegen/worker'

export async function codegen(
  style: Record<string, string>,
  options: SerializeOptions,
  pluginCode?: string
): Promise<ResponsePayload> {
  const request = createWorkerRequester<RequestPayload, ResponsePayload>(Codegen)

  return await request({
    style,
    options,
    pluginCode
  })
}
