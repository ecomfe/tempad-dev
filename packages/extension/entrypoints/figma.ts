import { GROUPS } from '@/rewrite/config'
import { rewriteCurrentScript } from '@/rewrite/runtime'

export default defineUnlistedScript(() => {
  void rewriteCurrentScript(GROUPS).catch((error) => {
    console.error('Failed to load the Figma script.', error)
  })
})
