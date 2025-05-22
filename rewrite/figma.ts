import { matchFile, REWRITE_PATTERN, REWRITE_REPLACER } from './config'

async function rewriteScript() {
  const current = document.currentScript as HTMLScriptElement
  const src = current.src

  function replaceScript(src: string) {
    const script = document.createElement('script')
    script.src = src
    script.defer = true
    current.replaceWith(script)
  }

  try {
    let content = await (await fetch(src)).text()

    if (matchFile(src, content)) {
      content = content.replace(REWRITE_PATTERN, REWRITE_REPLACER)
    }

    // document.currentScript will be `null` if we run with `new Function()`
    content = content.replaceAll('document.currentScript.src', `"${src}"`)

    // delete window.figma may throw Error in strict mode
    content = content.replaceAll('delete window.figma', 'window.figma = undefined')

    new Function(content)()
  } catch {
    replaceScript(`${src}?fallback`)
  }
}

rewriteScript()
