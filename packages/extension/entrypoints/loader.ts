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

  const response = await fetch(dataset.entry)
  const content = await response.text()
  const script = document.createElement('script')

  script.textContent = `${content}\n//# sourceURL=${location}\n`
  document.body.appendChild(script)

  script.onload = () => {
    script.remove()
  }
})
