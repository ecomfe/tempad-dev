import { installScriptRewriteInterceptor } from '@/rewrite/interceptor'
import { getRewriteSession } from '@/rewrite/session'

function preserveWindowFigma(): void {
  let figma: Window['figma'] | undefined = undefined
  Reflect.defineProperty(window, 'figma', {
    set(val) {
      if (val !== undefined) figma = val
    },
    get() {
      return figma
    }
  })
}

export default defineContentScript({
  matches: ['https://www.figma.com/*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    preserveWindowFigma()
    installScriptRewriteInterceptor(getRewriteSession(!import.meta.env.DEV))
  }
})
