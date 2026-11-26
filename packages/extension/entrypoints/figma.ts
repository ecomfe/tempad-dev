import { rewriteCurrentScript } from '@/rewrite/runtime'

export default defineUnlistedScript(() => {
  void rewriteCurrentScript().catch((error) => {
    console.error('Failed to load the Figma script.', error)
  })
})
