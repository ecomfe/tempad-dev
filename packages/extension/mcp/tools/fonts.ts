import type { DesignSystemFontsResult, GetDesignSystemParametersInput } from '@tempad-dev/shared'

import { utf8Bytes } from '@tempad-dev/shared'

import { compareText } from '@/utils/string'

const TARGET_BYTES = 12 * 1024
const FONTS_PAGE_SIZE = 32

// Query the environment only: no file nodes, styles, components, or library imports.
export async function queryAvailableFonts(
  args: GetDesignSystemParametersInput
): Promise<DesignSystemFontsResult> {
  const available = await figma.listAvailableFontsAsync()
  const familySet = new Set(available.map(({ fontName }) => fontName.family))
  const requestedFamilies = args.families ? new Set(args.families) : undefined
  const query = requestedFamilies ? undefined : args.query?.toLowerCase()
  const cursor = args.cursor ?? 0
  const result: DesignSystemFontsResult = { scope: 'fonts' }
  const rows = requestedFamilies
    ? [
        ...new Map(
          available
            .filter(({ fontName }) => requestedFamilies.has(fontName.family))
            .map(({ fontName }) => [JSON.stringify(fontName), fontName])
        ).values()
      ].sort((a, b) => compareText(a.family, b.family) || compareText(a.style, b.style))
    : [...familySet]
        .sort(compareText)
        .filter((family) => !query || family.toLowerCase().includes(query))
  if (cursor > 0 && cursor >= rows.length) {
    throw new Error('Font cursor is outside the current query. Restart the font query.')
  }
  if (requestedFamilies) {
    result.fonts = []
    const missing = [...requestedFamilies].filter((family) => !familySet.has(family))
    if (missing.length) result.missingFamilies = missing
  } else result.families = []
  if (utf8Bytes(result) > TARGET_BYTES) {
    throw new Error('Missing font-family names exceed the response budget; query fewer families.')
  }
  let index = cursor
  for (; index < rows.length; index += 1) {
    const row = rows[index]!
    if (typeof row === 'string') result.families!.push(row)
    else result.fonts!.push(row)
    if (utf8Bytes(result) > TARGET_BYTES) {
      if (typeof row === 'string') result.families!.pop()
      else result.fonts!.pop()
      if (index === cursor)
        throw new Error('A native font name exceeds the bounded font response budget.')
      break
    }
    if (index + 1 - cursor >= FONTS_PAGE_SIZE) {
      index += 1
      break
    }
  }
  if (index < rows.length) result.nextCursor = index
  return result
}
