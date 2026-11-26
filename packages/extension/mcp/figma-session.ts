import type { FigmaSession } from '@tempad-dev/shared'

/** A branch URL identifies the active document even when the API returns its parent file key. */
export function readFigmaFileKey(api: Pick<PluginAPI, 'fileKey'>): string | null {
  const pathname = globalThis.location?.pathname
  return (
    pathname?.match(/^\/(?:design|file)\/[^/]+\/branch\/([^/]+)/)?.[1] ||
    api.fileKey ||
    pathname?.match(/^\/(?:design|file)\/([^/]+)/)?.[1] ||
    null
  )
}

export function readFigmaSession(sessionId: string, busy: boolean): FigmaSession | null {
  try {
    const api = window.figma
    if (!api?.currentPage) return null
    const fileKey = readFigmaFileKey(api)
    if (!fileKey) return null
    return {
      sessionId,
      fileKey,
      fileName: (api.root.name || document.title).slice(0, 256),
      pageId: api.currentPage.id,
      busy
    }
  } catch {
    return null
  }
}
