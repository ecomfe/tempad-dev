import type { Group } from '@/types/rewrite'

import { logger } from '../utils/log'
import { applyGroups } from './shared'

const FIGMA_DELETE_PATCH_TARGET = 'delete window.figma'
const FIGMA_DELETE_PATCH_VALUE = 'window.figma = undefined'

function getCurrentScript(): HTMLScriptElement | null {
  const current = document.currentScript
  if (!(current instanceof HTMLScriptElement) || !current.src) {
    return null
  }
  return current
}

function replaceScript(current: HTMLScriptElement, src: string): void {
  const script = document.createElement('script')
  script.src = src
  script.defer = true
  current.replaceWith(script)
}

function withCurrentScript(current: HTMLScriptElement, run: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'currentScript')

  Object.defineProperty(document, 'currentScript', {
    configurable: true,
    get() {
      return current
    }
  })

  try {
    run()
  } finally {
    if (descriptor) {
      Object.defineProperty(document, 'currentScript', descriptor)
    } else {
      Reflect.deleteProperty(document, 'currentScript')
    }
  }
}

function patchFigmaDelete(code: string): string {
  return code.replaceAll(FIGMA_DELETE_PATCH_TARGET, FIGMA_DELETE_PATCH_VALUE)
}

export async function rewriteCurrentScript(groups: Group[]): Promise<void> {
  const current = getCurrentScript()
  if (!current) {
    return
  }

  const src = current.src

  try {
    const response = await fetch(src)
    const original = await response.text()
    const { content: rewritten, changed } = applyGroups(original, groups)

    if (changed) {
      logger.log(`Rewrote script: ${src}`)
    }

    const content = patchFigmaDelete(rewritten)
    withCurrentScript(current, () => {
      new Function(content)()
    })
  } catch (error) {
    logger.error(error)
    replaceScript(current, `${src}?fallback`)
  }
}
