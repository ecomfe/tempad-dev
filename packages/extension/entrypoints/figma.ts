import { GROUPS } from '@/rewrite/config'
import { rewriteCurrentScript } from '@/rewrite/runtime'

export default defineUnlistedScript(() => {
  rewriteCurrentScript(GROUPS)
})
