import type { PluginSandboxWorker } from './protocol'

import { PluginSandboxClient } from './client'

let client: PluginSandboxClient | null = null

export function configurePluginSandbox(sandboxUrl: string): void {
  client?.dispose()
  client = new PluginSandboxClient(sandboxUrl)
}

export async function requestPluginSandbox<T, U>(
  worker: PluginSandboxWorker,
  payload: T
): Promise<U> {
  if (!client) {
    throw new Error('Plugin sandbox is not configured.')
  }
  return await client.request<T, U>(worker, payload)
}
