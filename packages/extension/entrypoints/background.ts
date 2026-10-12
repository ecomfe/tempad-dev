import { McpServiceWorkerBroker } from '@/mcp/broker/service-worker'
import { startBundledRewriteRules } from '@/rewrite/setup'

export default defineBackground(() => {
  new McpServiceWorkerBroker().start()

  startBundledRewriteRules()
})
