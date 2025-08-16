import { matchFile, REWRITE_PATTERN, REWRITE_REPLACER } from './config'

async function rewriteScript() {
  const current = document.currentScript as HTMLScriptElement
  const src = current.src

  const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'currentScript')

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
      console.log(`Rewrote script: ${src}`)
    }

    // delete window.figma may throw Error in strict mode
    content = content.replaceAll('delete window.figma', 'window.figma = undefined')

    Object.defineProperty(document, 'currentScript', {
      configurable: true,
      get() {
        return current
      }
    })

    new Function(content)()
  } catch (e) {
    console.error(e)
    replaceScript(`${src}?fallback`)
  } finally {
    Object.defineProperty(document, 'currentScript', desc as PropertyDescriptor)
  }
}

rewriteScript()
