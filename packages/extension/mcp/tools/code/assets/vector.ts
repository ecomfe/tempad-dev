import type { AssetDescriptor } from '@tempad-dev/shared'

import type { CodegenConfig } from '@/utils/codegen'

import { ensureAssetUploaded } from '@/mcp/assets'
import { normalizeCssValue } from '@/utils/css'
import { logger } from '@/utils/log'
import { toDecimalPlace } from '@/utils/number'

import type { VectorColorModel } from './vector-semantics'

import { ensureSvgRootSize, extractSvgAttributes, normalizeThemeableSvg } from './svg'

export { extractSvgAttributes } from './svg'

export type VectorMode = 'smart' | 'snapshot'

export type SvgEntry = {
  props: Record<string, string>
  presentationStyle?: Record<string, string>
  raw?: string
}

type ExportOptions = {
  colorModel?: VectorColorModel
  vectorMode?: VectorMode
}

export async function exportSvgEntry(
  node: SceneNode,
  config: CodegenConfig,
  assetRegistry: Map<string, AssetDescriptor>,
  options: ExportOptions = {}
): Promise<SvgEntry | null> {
  const { colorModel = { kind: 'fixed' }, vectorMode = 'smart' } = options
  const themeable = colorModel.kind === 'single-channel'
  const metadata = themeable ? { themeable: true as const } : undefined
  const presentationStyle = themeable ? { color: colorModel.color } : undefined

  try {
    const svgUint8 = await node.exportAsync({ format: 'SVG' })
    const svgString = decodeSvgBytes(svgUint8)
    const sized = ensureSvgRootSize(svgString, config, node.width, node.height)
    const baseProps = sized?.props ?? buildFallbackProps(node, config)
    try {
      const asset = await ensureAssetUploaded(svgUint8, 'image/svg+xml', {
        width: Math.round(toDecimalPlace(node.width)),
        height: Math.round(toDecimalPlace(node.height)),
        ...(metadata ?? {})
      })
      assetRegistry.set(asset.hash, {
        ...asset,
        ...(metadata ?? {})
      })
      return {
        props: {
          ...baseProps,
          'data-src': asset.url
        },
        ...(presentationStyle ? { presentationStyle } : {})
      }
    } catch (uploadError) {
      logger.warn(
        'Failed to upload vector asset; inlining SVG fallback to preserve source of truth.',
        uploadError
      )
      const themeableFallback =
        themeable && vectorMode !== 'snapshot'
          ? normalizeThemeableSvg(svgString, config, {
              width: node.width,
              height: node.height,
              idPrefix: node.id
            })
          : null
      return {
        props: baseProps,
        ...(themeableFallback
          ? {
              raw: themeableFallback.content,
              presentationStyle
            }
          : {
              raw: sized?.content ?? svgString
            })
      }
    }
  } catch (error) {
    logger.warn('Failed to export vector node:', error)
    return {
      props: buildFallbackProps(node, config),
      ...(presentationStyle ? { presentationStyle } : {})
    }
  }
}

function decodeSvgBytes(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(bytes)
  }
  return String.fromCharCode(...bytes)
}

export function transformSvgAttributes(svg: string, config: CodegenConfig): string {
  const attrs = extractSvgAttributes(svg)
  if (!Object.keys(attrs).length) return svg

  const width = attrs.width
  const height = attrs.height
  let next = svg
  if (width) {
    next = next.replace(
      /(\s|^)width=(['"])(.*?)\2/i,
      `$1width=$2${ensureSizedValue(width, config)}$2`
    )
  }
  if (height) {
    next = next.replace(
      /(\s|^)height=(['"])(.*?)\2/i,
      `$1height=$2${ensureSizedValue(height, config)}$2`
    )
  }
  return next
}

function ensureSizedValue(value: string, config: CodegenConfig): string {
  if (value.includes('%')) return value
  const normalized = value.endsWith('px') ? value : `${value}px`
  return normalizeCssValue(normalized, config)
}

function buildFallbackProps(node: SceneNode, config: CodegenConfig): Record<string, string> {
  return {
    width: normalizeCssValue(`${toDecimalPlace(node.width)}px`, config),
    height: normalizeCssValue(`${toDecimalPlace(node.height)}px`, config)
  }
}
