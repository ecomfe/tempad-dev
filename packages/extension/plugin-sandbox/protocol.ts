export const PLUGIN_SANDBOX_PROTOCOL_VERSION = 1

export const PLUGIN_SANDBOX_MESSAGE = {
  ready: 'tempad-plugin-sandbox:ready',
  connect: 'tempad-plugin-sandbox:connect',
  connected: 'tempad-plugin-sandbox:connected',
  request: 'tempad-plugin-sandbox:request',
  response: 'tempad-plugin-sandbox:response'
} as const

export const PLUGIN_SANDBOX_WORKER = {
  codegen: 'codegen',
  transformVariable: 'transform-variable'
} as const

export type PluginSandboxWorker = (typeof PLUGIN_SANDBOX_WORKER)[keyof typeof PLUGIN_SANDBOX_WORKER]

const PLUGIN_SANDBOX_ERROR_CODES = [
  'busy',
  'invalid-payload',
  'payload-too-large',
  'protocol-error',
  'timeout',
  'worker-error',
  'worker-message-error'
] as const

const pluginSandboxErrorCodes = new Set<string>(PLUGIN_SANDBOX_ERROR_CODES)

export type PluginSandboxErrorCode = (typeof PLUGIN_SANDBOX_ERROR_CODES)[number]

type PluginSandboxErrorData = {
  code: PluginSandboxErrorCode
  message: string
}

export type PluginSandboxRequest<T = unknown> = {
  id: number
  type: typeof PLUGIN_SANDBOX_MESSAGE.request
  worker: PluginSandboxWorker
  payload: T
}

export type PluginSandboxResponse<T = unknown> =
  | {
      id: number
      type: typeof PLUGIN_SANDBOX_MESSAGE.response
      payload: T
      error?: undefined
    }
  | {
      id: number
      type: typeof PLUGIN_SANDBOX_MESSAGE.response
      payload?: undefined
      error: PluginSandboxErrorData
    }

export function isPluginSandboxWorker(value: unknown): value is PluginSandboxWorker {
  return Object.values(PLUGIN_SANDBOX_WORKER).some((worker) => worker === value)
}

export function isPluginSandboxErrorCode(value: unknown): value is PluginSandboxErrorCode {
  return typeof value === 'string' && pluginSandboxErrorCodes.has(value)
}
