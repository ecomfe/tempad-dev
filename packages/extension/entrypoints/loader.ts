export default defineUnlistedScript(async () => {
  const { dataset } = document.currentScript as HTMLScriptElement

  if (!dataset.entry) {
    console.error('No entry specified for UI script.')
    return
  }

  const content = await fetch(dataset.entry).then((res) => res.text())
  const script = document.createElement('script')

  script.textContent = `${content}\n//# sourceURL=${location}\n`
  document.body.appendChild(script)

  script.onload = () => {
    script.remove()
  }
})
