interface Window {
  figma: PluginAPI
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  webpackChunk_figma_web_bundler: any[] & { push: (...args: any[]) => any }
  tempadTools?: Partial<import('@/mcp/runtime').MCPHandlers>
}

declare const __DEV__: boolean
