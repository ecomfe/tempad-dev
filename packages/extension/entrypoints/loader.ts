export default defineUnlistedScript(async () => {
  window.addEventListener('message', async (event) => {
    if (event.data.source === 'tempad-dev' && event.data.type === 'load-ui') {
      const entry = event.data.entry

      const content = await fetch(entry).then((res) => res.text())
      const script = document.createElement('script')

      script.textContent = `${content}\n//# sourceURL=${location}\n`
      document.body.appendChild(script)

      script.onload = () => {
        script.remove()
      }
    }
  })
})
