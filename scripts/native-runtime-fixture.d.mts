export interface NativeRuntimeFixture {
  version: 1
  kind: 'native-runtime-fixture'
  testOnly: true
  checkout: string
  sourceHash: string
  root: string
  registryUrl: string
  env: {
    TEMPAD_MCP_RUNTIME_DIR: string
    TEMPAD_MCP_STATE_DIR: string
    TEMPAD_MCP_ASSET_DIR: string
    TEMPAD_MCP_LOG_DIR: string
  }
  initial: { version: string; directory: string; integrity: string }
  candidate: { version: string; directory: string; integrity: string }
}

export function readNativeRuntimeFixture(
  path: string,
  checkout: string,
  options?: { allowStaleSource?: boolean }
): NativeRuntimeFixture
export function nativeFixtureServer(
  fixture: NativeRuntimeFixture,
  toolTimeout: unknown
): {
  command: string
  args: string[]
  tool_timeout_sec: unknown
  env: NativeRuntimeFixture['env']
}
export function nativeFixtureHubEntry(fixture: NativeRuntimeFixture): string
export function nativeFixtureRuntimeEntries(fixture: NativeRuntimeFixture): string[]
export function shellQuote(value: string): string
