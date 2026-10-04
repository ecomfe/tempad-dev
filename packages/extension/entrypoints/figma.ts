import { getRewriteSession } from '@/rewrite/session'

export default defineUnlistedScript(() => {
  // Capture before any await; the remote runtime never needs document.currentScript.
  const current = document.currentScript
  if (!(current instanceof HTMLScriptElement) || !current.src) return
  void getRewriteSession(!import.meta.env.DEV).rewriteScript(current)
})
