import type { RequestPayload, ResponsePayload, SerializeOptions } from '@/types/codegen'
import type { DesignComponent } from '@/types/plugin'

import Codegen from '@/codegen/codegen?worker&inline'
import { createWorkerRequester } from '@/codegen/worker'

export async function codegen(
  style: Record<string, string>,
  component: DesignComponent | null,
  options: SerializeOptions,
  pluginCode?: string
): Promise<ResponsePayload> {
  const request = createWorkerRequester<RequestPayload, ResponsePayload>(Codegen)

  return await request({
    style,
    component: component ?? undefined,
    options,
    pluginCode
  })
}
