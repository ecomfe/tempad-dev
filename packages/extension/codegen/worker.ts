import type {
  CodegenBatchRequestPayload,
  CodegenBatchResponsePayload,
  RequestPayload,
  ResponsePayload
} from '@/types/codegen'
import type { Plugin } from '@/types/plugin'

import { logger } from '@/utils/log'
import { assertPluginModuleIsSelfContained, evaluate } from '@/utils/module'
import { stringify } from '@/utils/string'
import { lockdownWorker } from '@/worker/lockdown'

import type { WorkerRequest, WorkerResponse } from './protocol'

import { generateCodegenPayload } from './generate'

type Request = WorkerRequest<RequestPayload | CodegenBatchRequestPayload>
type Response = WorkerResponse<ResponsePayload | CodegenBatchResponsePayload>

const postMessage = globalThis.postMessage

globalThis.onmessage = async ({ data }: MessageEvent<Request>) => {
  const { id, payload } = data
  try {
    const plugin = await loadPlugin(payload.pluginCode)
    const result = isBatchRequest(payload)
      ? { results: payload.jobs.map((job) => generateCodegenPayload(job, plugin)) }
      : generateCodegenPayload(payload, plugin)
    postSafe({ id, payload: result })
  } catch (error) {
    logger.error(error)
    postMessage({ id, error } satisfies Response)
  }
}

async function loadPlugin(pluginCode: string | undefined): Promise<Plugin | null> {
  if (!pluginCode) return null
  assertPluginModuleIsSelfContained(pluginCode)
  const exports = await evaluate(pluginCode)
  return ((exports.default || exports.plugin) as Plugin | undefined) ?? null
}

function postSafe(message: Response): void {
  const safe: Response = JSON.parse(
    JSON.stringify(message, (_, v) => {
      if (typeof v === 'function') return stringify(v)
      return v
    })
  )
  postMessage(safe)
}

function isBatchRequest(
  payload: RequestPayload | CodegenBatchRequestPayload
): payload is CodegenBatchRequestPayload {
  return 'jobs' in payload && Array.isArray(payload.jobs)
}

// Only expose the necessary APIs to plugins
lockdownWorker('codegen')
