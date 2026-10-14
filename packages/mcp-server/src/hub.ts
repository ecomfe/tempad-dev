import { startHub } from './hub-runtime'
import { log } from './shared'

void startHub().catch((error) => {
  log.error({ error }, 'Hub startup failed.')
  process.exitCode = 1
})
