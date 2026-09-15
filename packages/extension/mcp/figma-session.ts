import type { FigmaSession } from '@tempad-dev/shared'

/** URL identity also works when Figma does not expose fileKey to the Plugin API. */
export function readFigmaFileKey(api: Pick<PluginAPI, 'fileKey'>): string | null {
  return (
    api.fileKey ||
    location.pathname.match(/^\/(?:design|file)\/[^/]+\/branch\/([^/]+)/)?.[1] ||
    location.pathname.match(/^\/(?:design|file)\/([^/]+)/)?.[1] ||
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
