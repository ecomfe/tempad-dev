#!/usr/bin/env node
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'

const [flag, cache, versionFlag, selector, currentFlag, current] = process.argv.slice(2)
if (
  process.env.TEMPAD_MCP_DEV_CHECKOUT ||
  process.platform === 'win32' ||
  flag !== '--cache' ||
  !cache ||
  !isAbsolute(cache) ||
  versionFlag !== '--version' ||
  !selector ||
  currentFlag !== '--current' ||
  !current ||
  process.argv.length !== 8
)
  throw new Error(
    'Release acquisition requires an explicit private release cache and version; checkout acquisition is forbidden.'
  )
const isolation = realpathSync(mkdtempSync(join(tmpdir(), 'tp-acquire-')))
for (const [key, directory] of Object.entries({
  TEMPAD_MCP_RUNTIME_DIR: 'run',
  TEMPAD_MCP_STATE_DIR: 'state',
  TEMPAD_MCP_ASSET_DIR: 'assets',
  TEMPAD_MCP_LOG_DIR: 'logs'
}))
  process.env[key] = join(isolation, directory)
const { endLogging } = await import('./shared')
try {
  const { stageRelease } = await import('./runtime-update/acquire')
  const staged = await stageRelease(cache, selector, current)
  process.stdout.write(JSON.stringify(staged ?? null) + '\n')
} catch (error) {
  process.stderr.write(`Runtime acquisition failed: ${String(error)}\n`)
  process.exitCode = 1
} finally {
  endLogging()
  rmSync(isolation, { recursive: true, force: true })
}
