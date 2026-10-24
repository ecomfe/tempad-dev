import type { AssetDescriptor } from '@tempad-dev/shared'

import type { CodegenConfig } from '@/utils/codegen'

import { ensureAssetUploaded } from '@/mcp/assets'
import { normalizeCssValue } from '@/utils/css'
import { logger } from '@/utils/log'
import { toDecimalPlace } from '@/utils/number'

import type { VectorColorModel } from './vector-semantics'

import {
  ensureSvgRootSize,
  extractSvgAttributes,
  normalizeSvgExport,
  normalizeThemeableSvg
} from './svg'

export { extractSvgAttributes } from './svg'

export type VectorMode = 'smart' | 'snapshot'

export type SvgEntry = {
  props: Record<string, string>
  presentationStyle?: Record<string, string>
  raw?: string
  wrapper?: { width: string; height: string; left: string; top: string }
}

type ExportOptions = {
  colorModel?: VectorColorModel
  vectorMode?: VectorMode
  flow?: boolean
  assertActive?: () => void
}

export async function exportSvgEntry(
  node: SceneNode,
  config: CodegenConfig,
  assetRegistry: Map<string, AssetDescriptor>,
  options: ExportOptions = {}
): Promise<SvgEntry | null> {
  const { colorModel = { kind: 'fixed' }, vectorMode = 'smart', assertActive } = options
  assertActive?.()
  const themeable = colorModel.kind === 'single-channel'
  const presentationStyle: Record<string, string> = themeable ? { color: colorModel.color } : {}
  if (node.relativeTransform && !options.flow) {
    const [[a, c], [b, d]] = node.relativeTransform
    if (a !== 1 || b !== 0 || c !== 0 || d !== 1) {
      presentationStyle.transform = `matrix(${a}, ${b}, ${c}, ${d}, 0, 0)`
      presentationStyle['transform-origin'] = '0 0'
    }
  }
  const hasPresentation = Object.keys(presentationStyle).length > 0

  try {
    assertActive?.()
    // Full geometry avoids ancestor clipping. A zero-size axis (LINE) has no
    // full-node export viewport, so use its visible stroke's render bounds.
    const svgUint8 = await node.exportAsync({
      format: 'SVG',
      useAbsoluteBounds: node.width > 0 && node.height > 0
    })
    assertActive?.()
    const exported = decodeSvgBytes(svgUint8)
    const assetSvg = normalizeSvgExport(
      exported,
      node,
      options.flow ? node.relativeTransform : undefined
    )
    const svgString = assetSvg?.content ?? exported
    const assetWidth = assetSvg?.width ?? node.width
    const assetHeight = assetSvg?.height ?? node.height
    const [[a, c], [b, d]] = node.relativeTransform ?? [
      [1, 0, 0],
      [0, 1, 0]
    ]
    const layoutWidth = options.flow
      ? Math.abs(a * node.width) + Math.abs(c * node.height)
      : node.width
    const layoutHeight = options.flow
      ? Math.abs(b * node.width) + Math.abs(d * node.height)
      : node.height
    if (options.flow && (a !== 1 || b !== 0 || c !== 0 || d !== 1)) {
      presentationStyle.width = `${toDecimalPlace(layoutWidth)}px`
      presentationStyle.height = `${toDecimalPlace(layoutHeight)}px`
    }
    const wrapper =
      assetSvg &&
      (assetSvg.x !== 0 ||
        assetSvg.y !== 0 ||
        assetWidth !== toDecimalPlace(layoutWidth) ||
        assetHeight !== toDecimalPlace(layoutHeight))
        ? {
            width: `${toDecimalPlace(layoutWidth)}px`,
            height: `${toDecimalPlace(layoutHeight)}px`,
            left: `${assetSvg.x}px`,
            top: `${assetSvg.y}px`
          }
        : undefined
    const sized = ensureSvgRootSize(svgString, config, assetWidth, assetHeight)
    const entry: SvgEntry = {
      ...(wrapper ? { wrapper } : {}),
      props: sized?.props ?? buildFallbackProps(node, config),
      ...(Object.keys(presentationStyle).length ? { presentationStyle } : {})
    }
    try {
      const width = Math.round(toDecimalPlace(assetWidth))
      const height = Math.round(toDecimalPlace(assetHeight))
      const assetBytes = assetSvg ? new TextEncoder().encode(svgString) : svgUint8
      assertActive?.()
      const asset = await ensureAssetUploaded(assetBytes, 'image/svg+xml', {
        ...(width > 0 ? { width } : {}),
        ...(height > 0 ? { height } : {}),
        ...(themeable ? { themeable: true } : {})
      })
      assertActive?.()
      assetRegistry.set(asset.hash, asset)
      entry.props = { ...entry.props, 'data-src': asset.url }
    } catch {
      assertActive?.()
      // The transport error may contain the upload capability URL.
      logger.warn(
        'Failed to upload vector asset; inlining SVG fallback to preserve source of truth.'
      )
      const themeableFallback =
        themeable && vectorMode !== 'snapshot'
          ? normalizeThemeableSvg(svgString, config, {
              width: assetWidth,
              height: assetHeight,
              idPrefix: node.id
            })
          : null
      entry.raw = themeableFallback?.content ?? sized?.content ?? svgString
    }
    return entry
  } catch (error) {
    assertActive?.()
    logger.warn('Failed to export vector node:', error)
    return {
      props: buildFallbackProps(node, config),
      ...(hasPresentation ? { presentationStyle } : {})
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
