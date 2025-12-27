import type { AssetDescriptor } from '@tempad-dev/mcp-shared'

import type { CodegenConfig } from '@/utils/codegen'

import { ensureAssetUploaded } from '@/mcp/assets'
import { normalizeCssValue } from '@/utils/css'
import { logger } from '@/utils/log'
import { toDecimalPlace } from '@/utils/number'

export type SvgEntry = {
  props: Record<string, string>
  raw?: string
}

export async function exportSvgEntry(
  node: SceneNode,
  config: CodegenConfig,
  assetRegistry: Map<string, AssetDescriptor>
): Promise<SvgEntry | null> {
  try {
    const svgUint8 = await node.exportAsync({ format: 'SVG' })
    const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null
    let svgString = decoder ? decoder.decode(svgUint8) : String.fromCharCode(...svgUint8)

    svgString = transformSvgAttributes(svgString, config)

    const baseProps = extractSvgAttributes(svgString)
    if (!Object.keys(baseProps).length) {
      // If we failed to parse attributes, inline the SVG to avoid emitting an empty tag.
      return { props: {}, raw: svgString }
    }
    try {
      const asset = await ensureAssetUploaded(svgUint8, 'image/svg+xml', {
        width: Math.round(toDecimalPlace(node.width)),
        height: Math.round(toDecimalPlace(node.height))
      })
      assetRegistry.set(asset.hash, asset)
      baseProps['data-resource-uri'] = asset.resourceUri
      return { props: baseProps }
    } catch (uploadError) {
      logger.warn('Failed to upload vector asset; inlining raw SVG.', uploadError)
      return { props: baseProps, raw: svgString }
    }
  } catch (error) {
    logger.warn('Failed to export vector node:', error)
    return {
      props: {
        width: `${toDecimalPlace(node.width)}px`,
        height: `${toDecimalPlace(node.height)}px`
      },
      raw: '<svg></svg>'
    }
  }
}

export function transformSvgAttributes(svg: string, config: CodegenConfig): string {
  const regex = /(\s|^)(width|height)=(['"])(.*?)\3/g
  const replacer = (_match: string, prefix: string, attr: string, quote: string, val: string) => {
    const pxVal = val.endsWith('px') ? val : `${val}px`
    const normalized = normalizeCssValue(pxVal, config)
    return `${prefix}${attr}=${quote}${normalized}${quote}`
  }
  return svg.replace(regex, replacer)
}

export function extractSvgAttributes(svg: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const match = svg.match(/<svg\s+([^>]+)>/i)
  if (!match) return attrs
  const attrString = match[1]
  const regex = /([^\s=]+)\s*=\s*(['"])(.*?)\2/g
  let m: RegExpExecArray | null
  while ((m = regex.exec(attrString))) {
    attrs[m[1]] = m[3]
  }
  return attrs
}
