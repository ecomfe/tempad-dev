import { captureScreenshots } from '../screenshots/capture-runtime'

captureScreenshots().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
)
