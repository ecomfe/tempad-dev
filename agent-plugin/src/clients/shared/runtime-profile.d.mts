type RuntimeProfile = { kind: 'release' } | { kind: 'checkout'; id: string }
export function checkoutProfile(checkout: string): Extract<RuntimeProfile, { kind: 'checkout' }>
export function resolveRuntimeProfile(
  env?: NodeJS.ProcessEnv,
  entryUrl?: string | URL
): RuntimeProfile
export function runtimeDirectories(
  env?: NodeJS.ProcessEnv,
  profile?: RuntimeProfile,
  options?: { tmpdir?: string; homedir?: string; uid?: number; prepare?: boolean }
): { root: string | undefined; runtime: string; log: string; assets: string; state: string }
export function runtimeSocketPath(
  runtime: string,
  profile?: RuntimeProfile,
  platform?: NodeJS.Platform,
  home?: string
): string
