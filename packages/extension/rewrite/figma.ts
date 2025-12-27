import { logger } from '../utils/log'
import { GROUPS } from './config'
import { applyGroups } from './shared'

async function rewriteScript() {
  const current = document.currentScript as HTMLScriptElement
  const src = current?.src
  if (!current || !src) {
    return
  }

  const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'currentScript')

  function replaceScript(src: string) {
    const script = document.createElement('script')
    script.src = src
    script.defer = true
    current.replaceWith(script)
  }

  try {
    const response = await fetch(src)
    const original = await response.text()

    const { content: afterRules, changed } = applyGroups(original, GROUPS)

    if (changed) {
      logger.log(`Rewrote script: ${src}`)
    }

    const content = afterRules.replaceAll('delete window.figma', 'window.figma = undefined')

    Object.defineProperty(document, 'currentScript', {
      configurable: true,
      get() {
        return current
      }
    })

    new Function(content)()
  } catch (e) {
    logger.error(e)
    replaceScript(`${src}?fallback`)
  } finally {
    if (desc) {
      Object.defineProperty(document, 'currentScript', desc)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (document as any).currentScript
    }
  }
}

rewriteScript()
