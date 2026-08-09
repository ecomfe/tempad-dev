const CONNECTION_TIMEOUT_PATTERN =
  /Unable to establish connection to Figma after \d+(?:\.\d+)? seconds/i

const pageLoads = new WeakMap<PageNode, Promise<void>>()

function isConnectionTimeout(error: unknown): boolean {
  return CONNECTION_TIMEOUT_PATTERN.test(error instanceof Error ? error.message : String(error))
}

async function loadCurrentPage(): Promise<void> {
  const page = figma.currentPage
  const pending = pageLoads.get(page)
  if (pending) return pending

  const load = Promise.resolve()
    .then(() => page.loadAsync())
    .finally(() => {
      if (pageLoads.get(page) === load) pageLoads.delete(page)
    })
  pageLoads.set(page, load)
  return load
}

export async function retryAfterFigmaConnectionTimeout<T>(
  operation: () => T | Promise<T>,
  error: unknown,
  ...relatedErrors: unknown[]
): Promise<T> {
  if (![error, ...relatedErrors].some(isConnectionTimeout)) throw error
  await loadCurrentPage()
  return operation()
}
