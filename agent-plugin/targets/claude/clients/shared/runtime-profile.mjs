import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { realpathSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { prepareDefaultRoot, resolveDefaultRoot } from './runtime-paths.mjs'

function hash(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

export function checkoutProfile(checkout) {
  if (!isAbsolute(checkout)) throw new Error('TEMPAD_MCP_DEV_CHECKOUT must be an absolute path.')
  const root = realpathSync(checkout)
  if (!statSync(root).isDirectory()) throw new Error('The checkout must be a directory.')
  return { kind: 'checkout', id: hash(root) }
}

export function resolveRuntimeProfile(env = process.env, entryUrl) {
  if (env.TEMPAD_MCP_DEV_CHECKOUT === undefined) return { kind: 'release' }
  const profile = checkoutProfile(env.TEMPAD_MCP_DEV_CHECKOUT)
  if (entryUrl) {
    const root = realpathSync(env.TEMPAD_MCP_DEV_CHECKOUT)
    const dist = join(root, 'packages/mcp-server/dist')
    for (const name of ['cli.mjs', 'hub.mjs']) {
      const path = join(dist, name)
      try {
        if (realpathSync(path) === path && statSync(path).isFile()) continue
      } catch (cause) {
        throw new Error(`Missing checkout runtime: ${path}. Run pnpm build:mcp in the checkout.`, {
          cause
        })
      }
      throw new Error(`Invalid checkout runtime: ${path}. Build the checkout before starting MCP.`)
    }
    if (dirname(realpathSync(fileURLToPath(entryUrl))) !== dist)
      throw new Error('The MCP entry point does not belong to TEMPAD_MCP_DEV_CHECKOUT.')
  }
  return profile
}

export function runtimeDirectories(
  env = process.env,
  profile = resolveRuntimeProfile(env),
  options = {}
) {
  const temporary = options.tmpdir ?? tmpdir()
  const home = options.homedir ?? homedir()
  const user = options.uid ?? process.getuid?.() ?? hash(home)
  const checkout = profile.kind === 'checkout'
  const needsRoot =
    !env.TEMPAD_MCP_RUNTIME_DIR || !env.TEMPAD_MCP_LOG_DIR || !env.TEMPAD_MCP_ASSET_DIR
  let root
  if (needsRoot) {
    root = checkout
      ? join(temporary, `tpd-${user}-${profile.id}`)
      : (options.prepare ? prepareDefaultRoot : resolveDefaultRoot)(temporary)
  }
  // Explicit directories remain usable for isolated tests, but never merge checkout and release.
  const directory = (override, name) => {
    if (!override) return join(root, name)
    return checkout ? join(override, `checkout-${profile.id}`) : override
  }
  const runtime = directory(env.TEMPAD_MCP_RUNTIME_DIR, 'run')
  let state
  if (!checkout && env.TEMPAD_MCP_STATE_DIR !== undefined) {
    state = env.TEMPAD_MCP_STATE_DIR
  } else if (env.TEMPAD_MCP_STATE_DIR) {
    state = directory(env.TEMPAD_MCP_STATE_DIR, 'state')
  } else if (env.TEMPAD_MCP_RUNTIME_DIR) {
    state = join(runtime, 'state')
  } else {
    state = checkout
      ? join(home, '.tempad-dev', 'checkouts', profile.id, 'state')
      : join(home, '.tempad-dev', 'state')
  }
  return {
    root,
    runtime,
    log: directory(env.TEMPAD_MCP_LOG_DIR, 'log'),
    assets: directory(env.TEMPAD_MCP_ASSET_DIR, 'assets'),
    state
  }
}

export function runtimeSocketPath(
  runtime,
  profile = { kind: 'release' },
  platform = process.platform,
  home = homedir()
) {
  if (platform !== 'win32') {
    const socket = join(runtime, 'mcp.sock')
    if (profile.kind === 'checkout' && Buffer.byteLength(socket) > 103)
      throw new Error('Checkout socket path is too long. Choose a shorter TEMPAD_MCP_RUNTIME_DIR.')
    return socket
  }
  return profile.kind === 'checkout'
    ? `\\\\.\\pipe\\tempad-mcp-${hash(home)}-${profile.id}`
    : '\\\\.\\pipe\\tempad-mcp'
}
