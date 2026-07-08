import { startMcpContentBridge } from '@/mcp/bridge/content'

export default defineContentScript({
  matches: ['https://www.figma.com/*'],
  runAt: 'document_start',
  main() {
    startMcpContentBridge()
  }
})
