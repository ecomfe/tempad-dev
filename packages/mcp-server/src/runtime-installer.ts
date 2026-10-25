#!/usr/bin/env node
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'

const [
  flag,
  cache,
  versionFlag,
  selector,
  activeFlag,
  active,
  controlFlag,
  control,
  excludedFlag,
  excluded,
  cursorFlag,
  cursor
] = process.argv.slice(2)
if (
  process.env.TEMPAD_MCP_DEV_CHECKOUT ||
  process.platform === 'win32' ||
  flag !== '--cache' ||
  !cache ||
  !isAbsolute(cache) ||
  versionFlag !== '--version' ||
  !selector ||
  activeFlag !== '--active' ||
  !active ||
  controlFlag !== '--control' ||
  !control ||
  excludedFlag !== '--excluded' ||
  !excluded ||
  (process.argv.length !== 12 &&
    !(process.argv.length === 14 && cursorFlag === '--cursor' && cursor))
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
  const { AcquisitionContextSchema, SelectionCursorSchema, stageRelease } =
    await import('./runtime-update/acquire')
  const staged = await stageRelease(
    cache,
    selector,
    AcquisitionContextSchema.parse({
      active: JSON.parse(active),
      control: JSON.parse(control),
      excludedBundles: JSON.parse(excluded)
    }),
    cursor ? SelectionCursorSchema.parse(JSON.parse(cursor)) : undefined
  )
  process.stdout.write(JSON.stringify(staged) + '\n')
} catch (error) {
  process.stderr.write(`Runtime acquisition failed: ${String(error)}\n`)
  process.exitCode = 1
} finally {
  endLogging()
  rmSync(isolation, { recursive: true, force: true })
}
