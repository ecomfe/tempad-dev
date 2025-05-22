export const SRC_PATTERN = /\/figma_app/

export const REWRITE_PATTERN = /\.appModel\.isReadOnly/g

export const REWRITE_REPLACER = '.appModel.__isReadOnly__'

const MARKERS = ['.appModel.isReadOnly']

export function matchFile(src: string, content: string) {
  return SRC_PATTERN.test(src) && MARKERS.every((marker) => content.includes(marker))
}
