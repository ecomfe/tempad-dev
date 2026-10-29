#!/usr/bin/env node
import { rmSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

import { createPrivateTempDirectory } from './runtime-platform'

const [flag, cache, versionFlag, selector, contextFlag, context, cursorFlag, cursor] =
  process.argv.slice(2)
if (
  process.env.TEMPAD_MCP_DEV_CHECKOUT ||
  flag !== '--cache' ||
  !cache ||
  !isAbsolute(cache) ||
  versionFlag !== '--version' ||
  !selector ||
  contextFlag !== '--context' ||
  !context ||
  (process.argv.length !== 8 &&
    !(process.argv.length === 10 && cursorFlag === '--cursor' && cursor))
)
  throw new Error(
    'Release acquisition requires an explicit private release cache and version; checkout acquisition is forbidden.'
  )
const isolation = createPrivateTempDirectory('tp-acquire-')
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
    AcquisitionContextSchema.parse(JSON.parse(context)),
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
