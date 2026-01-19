export default defineContentScript({
  matches: ['https://www.figma.com/*'],
  runAt: 'document_end',
  main(ctx) {
    const ui = createIntegratedUi(ctx, {
      tag: 'tempad',
      position: 'inline',
      async onMount(root) {
        // Prevent Figma's event capture so that text selection works.
        // Both of the following are required.
        root.tabIndex = -1
        root.classList.add('js-fullscreen-prevent-event-capture')

        injectScript('/loader.js', {
          modifyScript(script) {
            const entry = browser.runtime.getURL('/ui.js')
            script.dataset.entry = entry
          }
        })
      }
    })

    ui.mount()
  }
})
