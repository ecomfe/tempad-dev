import { win32 } from 'node:path'

import type { HostContext } from './agent-clients/host-context'

const PLATFORM_KEYS = [
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'SYSTEMROOT',
  'WINDIR',
  'ComSpec',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ'
] as const
const WINDOWS_KEYS = [
  'SystemDrive',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'PROCESSOR_ARCHITECTURE',
  'USERNAME',
  'HOMEDRIVE',
  'HOMEPATH'
] as const
const HUB_KEYS = [
  'DEBUG',
  'NODE_EXTRA_CA_CERTS',
  'TEMPAD_MCP_DEV_CHECKOUT',
  'TEMPAD_MCP_RUNTIME_DIR',
  'TEMPAD_MCP_LOG_DIR',
  'TEMPAD_MCP_ASSET_DIR',
  'TEMPAD_MCP_STATE_DIR',
  'TEMPAD_MCP_TOOL_TIMEOUT',
  'TEMPAD_MCP_AUTO_ACTIVATE_GRACE',
  'TEMPAD_MCP_MAX_ASSET_BYTES',
  'TEMPAD_MCP_ASSET_TTL_MS',
  'TEMPAD_MCP_MAX_ASSET_STORE_BYTES',
  'TEMPAD_MCP_MAX_CONCURRENT_ASSET_UPLOADS',
  'TEMPAD_MCP_MAX_EXTENSION_CONNECTIONS',
  'TEMPAD_MCP_GET_CODE_TIMEOUT',
  'TEMPAD_MCP_GET_DESIGN_SYSTEM_TIMEOUT',
  'TEMPAD_MCP_PAGE_STRUCTURE_TIMEOUT',
  'TEMPAD_MCP_APPLY_CANVAS_TIMEOUT',
  'TEMPAD_MCP_ALLOWED_EXTENSION_ORIGINS'
] as const

function pick(env: NodeJS.ProcessEnv, keys: readonly string[]): NodeJS.ProcessEnv {
  if (process.platform === 'win32') {
    const allowed = new Map<string, string>()
    for (const key of keys) if (!allowed.has(key.toLowerCase())) allowed.set(key.toLowerCase(), key)
    return Object.fromEntries(
      Object.entries(env).flatMap(([key, value]) => {
        const canonical = allowed.get(key.toLowerCase())
        return canonical && value !== undefined ? [[canonical, value]] : []
      })
    )
  }
  return Object.fromEntries(
    keys.flatMap((key) => (env[key] === undefined ? [] : [[key, env[key]]]))
  )
}

/** Windows helpers need the OS directory and architecture variables even in a clean environment. */
export function platformEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return pick(
    env,
    process.platform === 'win32' ? [...PLATFORM_KEYS, ...WINDOWS_KEYS] : PLATFORM_KEYS
  )
}

/** Never inherit host identities, credentials, NODE_OPTIONS, or arbitrary runtime overrides. */
export function hubEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...platformEnvironment(env), ...pick(env, HUB_KEYS) }
}

export function hostEnvironment(
  context: HostContext,
  env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const home = win32.normalize(context.home)
  const root = win32.parse(home).root
  return {
    ...platformEnvironment(env),
    HOME: context.home,
    USERPROFILE: context.home,
    ...(process.platform === 'win32'
      ? {
          HOMEDRIVE: root.slice(0, -1),
          HOMEPATH: `\\${home.slice(root.length)}`
        }
      : {}),
    TMPDIR: context.tempDir,
    TEMP: context.tempDir,
    TMP: context.tempDir,
    CODEX_HOME: context.codexHome,
    CODEX_SQLITE_HOME: context.codexSqliteHome
  }
}
