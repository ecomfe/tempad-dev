export default defineContentScript({
  matches: ['https://www.figma.com/file/*', 'https://www.figma.com/design/*'],
  runAt: 'document_end',
  main(ctx) {
    const ui = createIntegratedUi(ctx, {
      tag: 'tempad',
      position: 'inline',
      onMount(root) {
        const script = document.createElement('script')
        script.src = browser.runtime.getURL('/ui.js')
        root.appendChild(script)
        script.onload = () => {
          script.remove()
        }

        // Prevent Figma's event capture so that text selection works.
        // Both of the following are required.
        root.tabIndex = -1
        root.classList.add('js-fullscreen-prevent-event-capture')
      }
    })

    ui.mount()
  }
})
