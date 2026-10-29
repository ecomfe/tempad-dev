import { startHub } from './hub-runtime'
import { log } from './shared'

void startHub({ entryPath: fileURLToPath(import.meta.url) }).catch((error) => {
  log.error({ error }, 'Hub startup failed.')
  process.exitCode = 1
})
import { fileURLToPath } from 'node:url'
