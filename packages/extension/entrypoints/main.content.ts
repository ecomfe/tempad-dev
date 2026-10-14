import { startMcpContentBridge } from '@/mcp/bridge/content'

export default defineContentScript({
  matches: ['https://www.figma.com/*'],
  runAt: 'document_end',
  main(ctx) {
    ctx.onInvalidated(startMcpContentBridge())

    const ui = createIntegratedUi(ctx, {
      tag: 'tempad',
      position: 'inline',
      async onMount(root) {
        // Prevent Figma's event capture so that text selection works.
        // Both of the following are required.
        root.tabIndex = -1
        root.classList.add('js-fullscreen-prevent-event-capture')

        await injectScript('/loader.js', {
          modifyScript(script) {
            const entry = browser.runtime.getURL('/ui.js')
            script.dataset.entry = entry
          }
        }).catch((error) => console.error('Failed to initialize TemPad Dev UI.', error))
      }
    })

    ui.mount()
  }
})
