import type { WorkerResponse } from '@/codegen/protocol'
import type {
  PluginSandboxErrorCode,
  PluginSandboxRequest,
  PluginSandboxResponse
} from '@/plugin-sandbox/protocol'

import CodegenWorker from '@/codegen/worker?sandbox-worker'
import TransformerWorker from '@/mcp/transform-variables/worker?sandbox-worker'
import { inspectSandboxValue, PLUGIN_SANDBOX_LIMITS } from '@/plugin-sandbox/limits'
import {
  isPluginSandboxWorker,
  PLUGIN_SANDBOX_MESSAGE,
  PLUGIN_SANDBOX_PROTOCOL_VERSION,
  PLUGIN_SANDBOX_WORKER
} from '@/plugin-sandbox/protocol'

type BrokerConnection = { port: MessagePort; requestIds: Set<number> }
type BrokerJob = { connection: BrokerConnection; request: PluginSandboxRequest }

let connection: BrokerConnection | null = null
let queue: BrokerJob[] = []
const active = new Map<Worker, BrokerJob>()

window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return
  if (event.data?.type !== PLUGIN_SANDBOX_MESSAGE.connect) return
  if (event.data?.version !== PLUGIN_SANDBOX_PROTOCOL_VERSION) return

  const [port] = event.ports
  if (!port) return
  replaceConnection(port)
})

window.parent.postMessage(
  {
    type: PLUGIN_SANDBOX_MESSAGE.ready,
    version: PLUGIN_SANDBOX_PROTOCOL_VERSION
  },
  '*'
)

function replaceConnection(port: MessagePort): void {
  resetBroker()

  const next: BrokerConnection = { port, requestIds: new Set() }
  connection = next
  port.onmessage = ({ data }: MessageEvent<unknown>) => handlePortMessage(next, data)
  port.onmessageerror = () => {
    if (connection === next) resetBroker()
  }
  port.start()
  port.postMessage({
    type: PLUGIN_SANDBOX_MESSAGE.connected,
    version: PLUGIN_SANDBOX_PROTOCOL_VERSION
  })
}

function handlePortMessage(current: BrokerConnection, data: unknown): void {
  if (connection !== current || !isRecord(data)) return

  if (data.type !== PLUGIN_SANDBOX_MESSAGE.request) return
  if (!isPluginRequest(data)) {
    respondWithError(
      current.port,
      readRequestId(data),
      'protocol-error',
      'Invalid request envelope.'
    )
    return
  }

  if (current.requestIds.has(data.id)) {
    respondWithError(current.port, data.id, 'protocol-error', 'Duplicate request id.')
    return
  }

  const inspection = inspectSandboxValue(data.payload)
  if (!inspection.ok) {
    respondWithError(
      current.port,
      data.id,
      inspection.reason,
      inspection.reason === 'payload-too-large'
        ? 'Plugin request exceeds the sandbox payload limit.'
        : 'Plugin request contains unsupported values.'
    )
    return
  }

  if (queue.length >= PLUGIN_SANDBOX_LIMITS.maxQueuedRequests) {
    respondWithError(current.port, data.id, 'busy', 'Plugin sandbox queue is full.')
    return
  }

  current.requestIds.add(data.id)
  queue.push({ connection: current, request: data })
  pumpQueue()
}

function pumpQueue(): void {
  while (active.size < PLUGIN_SANDBOX_LIMITS.maxConcurrentWorkers && queue.length) {
    const job = queue.shift()!
    if (connection !== job.connection) {
      job.connection.requestIds.delete(job.request.id)
      continue
    }
    startJob(job)
  }
}

function startJob(job: BrokerJob): void {
  let worker: Worker
  try {
    const WorkerClass =
      job.request.worker === PLUGIN_SANDBOX_WORKER.codegen ? CodegenWorker : TransformerWorker
    worker = new WorkerClass()
  } catch (error) {
    job.connection.requestIds.delete(job.request.id)
    if (connection === job.connection) {
      respondWithError(
        job.connection.port,
        job.request.id,
        'worker-error',
        normalizeErrorMessage(error, 'Worker startup failed.')
      )
    }
    pumpQueue()
    return
  }

  active.set(worker, job)
  let settled = false
  const finish = (response: PluginSandboxResponse) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    worker.onmessage = null
    worker.onerror = null
    worker.onmessageerror = null
    worker.terminate()
    active.delete(worker)
    job.connection.requestIds.delete(job.request.id)
    if (connection === job.connection) post(job.connection.port, response)
    pumpQueue()
  }

  const timer = setTimeout(() => {
    finish(
      errorResponse(
        job.request.id,
        'timeout',
        `Plugin worker timed out after ${PLUGIN_SANDBOX_LIMITS.requestTimeoutMs}ms.`
      )
    )
  }, PLUGIN_SANDBOX_LIMITS.requestTimeoutMs)

  worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
    if (!isRecord(data) || data.id !== job.request.id) return
    if ('error' in data) {
      finish(
        errorResponse(
          job.request.id,
          'worker-error',
          normalizeErrorMessage(data.error, 'Plugin worker failed.')
        )
      )
      return
    }
    if (!('payload' in data)) {
      finish(errorResponse(job.request.id, 'protocol-error', 'Worker response is missing payload.'))
      return
    }

    const inspection = inspectSandboxValue(data.payload)
    if (!inspection.ok) {
      finish(
        errorResponse(
          job.request.id,
          inspection.reason,
          inspection.reason === 'payload-too-large'
            ? 'Plugin response exceeds the sandbox payload limit.'
            : 'Plugin response contains unsupported values.'
        )
      )
      return
    }

    finish({
      id: job.request.id,
      type: PLUGIN_SANDBOX_MESSAGE.response,
      payload: data.payload
    })
  }
  worker.onerror = (event) => {
    finish(
      errorResponse(
        job.request.id,
        'worker-error',
        normalizeErrorMessage(event.message, 'Plugin worker failed.')
      )
    )
  }
  worker.onmessageerror = () => {
    finish(errorResponse(job.request.id, 'worker-message-error', 'Worker response was unreadable.'))
  }

  try {
    worker.postMessage({ id: job.request.id, payload: job.request.payload })
  } catch (error) {
    finish(
      errorResponse(
        job.request.id,
        'worker-error',
        normalizeErrorMessage(error, 'Unable to send the plugin request.')
      )
    )
  }
}

function resetBroker(): void {
  queue = []
  for (const worker of active.keys()) worker.terminate()
  active.clear()
  connection?.requestIds.clear()
  connection?.port.close()
  connection = null
}

function isPluginRequest(value: Record<string, unknown>): value is PluginSandboxRequest {
  return (
    value.type === PLUGIN_SANDBOX_MESSAGE.request &&
    Number.isSafeInteger(value.id) &&
    typeof value.id === 'number' &&
    value.id >= 0 &&
    isPluginSandboxWorker(value.worker) &&
    Object.hasOwn(value, 'payload')
  )
}

function errorResponse(
  id: number,
  code: PluginSandboxErrorCode,
  message: string
): PluginSandboxResponse {
  return {
    id,
    type: PLUGIN_SANDBOX_MESSAGE.response,
    error: { code, message }
  }
}

function respondWithError(
  port: MessagePort,
  id: number,
  code: PluginSandboxErrorCode,
  message: string
): void {
  post(port, errorResponse(id, code, message))
}

function post(port: MessagePort, message: PluginSandboxResponse): void {
  try {
    port.postMessage(message)
  } catch {
    resetBroker()
  }
}

function normalizeErrorMessage(error: unknown, fallback: string): string {
  let message = fallback
  if (error instanceof Error && error.message) message = error.message
  else if (typeof error === 'string' && error) message = error
  else if (isRecord(error) && typeof error.message === 'string' && error.message) {
    message = error.message
  }
  return message.slice(0, 2048)
}

function readRequestId(value: Record<string, unknown>): number {
  return typeof value.id === 'number' && Number.isSafeInteger(value.id) ? value.id : -1
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}
