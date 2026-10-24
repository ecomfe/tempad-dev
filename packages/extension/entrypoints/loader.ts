async function buildSandboxSrcdoc(sandboxUrl: string): Promise<string> {
  const html = await (await fetch(sandboxUrl)).text()
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const external = doc.querySelector<HTMLScriptElement>('script[src]')
  if (!external) throw new Error('Plugin sandbox script is missing.')

  const code = await (await fetch(new URL(external.getAttribute('src')!, sandboxUrl))).text()
  const inline = doc.createElement('script')
  inline.type = 'module'
  inline.textContent = code.replaceAll('</script', '<\\/script')
  external.replaceWith(inline)
  return `<!DOCTYPE html>${doc.documentElement.outerHTML}`
}

async function loadUi(): Promise<void> {
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
  if (entry.protocol !== 'chrome-extension:' && entry.protocol !== 'moz-extension:') {
    console.error('Invalid UI script entry URL.')
    return
  }

  const response = await fetch(entry)
  const content = await response.text()
  const script = document.createElement('script')
  const sandboxUrl = new URL('/plugin-sandbox.html', entry).href
  let bootstrap = `Object.defineProperty(globalThis, "__TEMPAD_PLUGIN_SANDBOX_URL__", { value: ${JSON.stringify(sandboxUrl)}, configurable: false, enumerable: false, writable: false });\n`

  // Firefox does not support sandbox pages, and an opaque-origin iframe cannot load
  // extension resources, so inline the sandbox page into a srcdoc iframe instead.
  if (entry.protocol === 'moz-extension:') {
    const srcdoc = await buildSandboxSrcdoc(sandboxUrl)
    bootstrap += `Object.defineProperty(globalThis, "__TEMPAD_PLUGIN_SANDBOX_SRCDOC__", { value: ${JSON.stringify(srcdoc)}, configurable: false, enumerable: false, writable: false });
`
  }

  script.textContent = `${bootstrap}${content}\n//# sourceURL=${location}\n`
  document.body.appendChild(script)

  script.onload = () => {
    script.remove()
  }
}

export default defineUnlistedScript(() => {
  void loadUi().catch((error) => console.error('Failed to load TemPad Dev UI.', error))
})
