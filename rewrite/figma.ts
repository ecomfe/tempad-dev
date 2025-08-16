import type { Group } from './config'
import { GROUPS } from './config'

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

  function applyGroup(content: string, group: Group) {
    const markers = group.markers || []

    if (!markers.every((marker) => content.includes(marker))) {
      return content
    }

    let out = content
    for (const { pattern, replacer } of group.replacements) {
      if (typeof pattern === 'string') {
        // @ts-ignore
        out = out.replaceAll(pattern, replacer)
      } else {
        // @ts-ignore
        out = out.replace(pattern, replacer)
      }
    }
    return out
  }

  try {
    const original = await (await fetch(src)).text()
    let content = original

    for (const group of GROUPS) {
      content = applyGroup(content, group)
    }

    if (content !== original) {
      console.log(`Rewrote script: ${src}`)
    }

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
