export default defineUnlistedScript(async () => {
  const currentScript = document.currentScript
  if (!(currentScript instanceof HTMLScriptElement)) {
    console.error('Failed to resolve current script element.')
    return
  }

  const { dataset } = currentScript

  if (!dataset.entry) {
    console.error('No entry specified for UI script.')
    return
  }

  const entry = new URL(dataset.entry)
  if (entry.protocol !== 'chrome-extension:') {
    console.error('Invalid UI script entry URL.')
    return
  }

  const response = await fetch(entry)
  const content = await response.text()
  const script = document.createElement('script')
  const sandboxUrl = new URL('/plugin-sandbox.html', entry).href
  const bootstrap = `Object.defineProperty(globalThis, "__TEMPAD_PLUGIN_SANDBOX_URL__", { value: ${JSON.stringify(sandboxUrl)}, configurable: false, enumerable: false, writable: false });\n`

  script.textContent = `${bootstrap}${content}\n//# sourceURL=${location}\n`
  document.body.appendChild(script)

  script.onload = () => {
    script.remove()
  }
})
