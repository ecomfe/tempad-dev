import type { CanvasAssets, TempadMcpErrorCode } from '@tempad-dev/shared'
import type { INode } from 'svgson'

import { TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'

import { downloadAsset } from '@/mcp/assets'
import { sha256Hex } from '@/mcp/encoding'
import { detectImageMime } from '@/mcp/media'

import { createCodedError } from '../../errors'
import { parseSvgXml, stringifySvgXml } from './svg-xml'

const INLINE_SVG_BYTES = 32 * 1024
const HUB_SVG_BYTES = 1024 * 1024
const MAX_SVG_ELEMENTS = 500
const MAX_SVG_DEPTH = 32
export const SVG_POLICY_VERSION = '4'
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink'

const BANNED_ELEMENTS = new Set([
  'audio',
  'foreignobject',
  'iframe',
  'image',
  'script',
  'style',
  'video'
])
const COLOR_ATTRIBUTES = new Set([
  'color',
  'fill',
  'flood-color',
  'lighting-color',
  'solid-color',
  'stop-color',
  'stroke',
  'text-decoration-color'
])

type ResolvedSvgAsset = {
  type: 'SVG'
  digest: string
  height: number
  svg: string
  width: number
}

type ResolvedImageAsset = {
  type: 'IMAGE'
  bytes: Uint8Array
  hash: string
  mimeType: 'image/gif' | 'image/jpeg' | 'image/png'
}

type ResolvedCanvasAsset = ResolvedSvgAsset | ResolvedImageAsset
export type ResolvedCanvasAssets = Map<string, ResolvedCanvasAsset>

export async function resolveCanvasAssets(
  assets: CanvasAssets | undefined,
  svgColors: ReadonlyMap<string, ReadonlySet<string | undefined>>
): Promise<ResolvedCanvasAssets> {
  const resolved: ResolvedCanvasAssets = new Map()
  for (const [key, declaration] of Object.entries(assets ?? {})) {
    if (declaration.type === 'IMAGE') {
      const downloaded = await downloadAsset(declaration.assetHash)
      resolved.set(imageCacheKey(key), {
        type: 'IMAGE',
        bytes: downloaded.bytes,
        hash: declaration.assetHash,
        mimeType: validateImageMime(key, downloaded.bytes, downloaded.mimeType)
      })
      continue
    }
    const colors = svgColors.get(key)
    if (!colors) continue
    const inline = 'svg' in declaration
    const source = inline ? declaration.svg : await downloadSvg(key, declaration.assetHash)
    for (const color of colors) {
      resolved.set(
        svgCacheKey(key, color),
        await sanitizeSvg(key, source, color, inline ? INLINE_SVG_BYTES : HUB_SVG_BYTES)
      )
    }
  }
  return resolved
}

export function resolvedImageAsset(
  assets: ResolvedCanvasAssets,
  key: string
): ResolvedImageAsset | undefined {
  const asset = assets.get(imageCacheKey(key))
  return asset?.type === 'IMAGE' ? asset : undefined
}

export function resolvedSvgAsset(
  assets: ResolvedCanvasAssets,
  key: string,
  color: string | undefined
): ResolvedSvgAsset | undefined {
  const asset = assets.get(svgCacheKey(key, color))
  return asset?.type === 'SVG' ? asset : undefined
}

async function downloadSvg(key: string, hash: string): Promise<string> {
  const asset = await downloadAsset(hash)
  if (asset.bytes.byteLength > HUB_SVG_BYTES) {
    assetError(
      TEMPAD_MCP_ERROR_CODES.ASSET_TOO_LARGE,
      key,
      `SVG asset exceeds ${HUB_SVG_BYTES} bytes.`
    )
  }
  if (normalizeMime(asset.mimeType) !== 'image/svg+xml') {
    assetError(
      TEMPAD_MCP_ERROR_CODES.ASSET_MIME_UNSUPPORTED,
      key,
      'SVG asset must use image/svg+xml.'
    )
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(asset.bytes)
  } catch {
    assetError(TEMPAD_MCP_ERROR_CODES.SVG_INVALID, key, 'SVG asset is not valid UTF-8.')
  }
}

async function sanitizeSvg(
  key: string,
  source: string,
  color: string | undefined,
  maxBytes: number
): Promise<ResolvedSvgAsset> {
  const bytes = new TextEncoder().encode(source)
  if (bytes.byteLength > maxBytes) {
    assetError(
      TEMPAD_MCP_ERROR_CODES.ASSET_TOO_LARGE,
      key,
      maxBytes === INLINE_SVG_BYTES
        ? `Inline SVG exceeds ${INLINE_SVG_BYTES} bytes; store it as a Hub asset.`
        : `SVG asset exceeds ${HUB_SVG_BYTES} bytes.`
    )
  }
  if (/[\uD800-\uDFFF]/u.test(source) || /<!DOCTYPE|<!ENTITY/i.test(source)) {
    assetError(
      TEMPAD_MCP_ERROR_CODES.SVG_INVALID,
      key,
      'SVG declarations, entities, and invalid Unicode are not supported.'
    )
  }

  let root: INode
  try {
    root = parseSvgXml(source)
  } catch {
    assetError(TEMPAD_MCP_ERROR_CODES.SVG_INVALID, key, 'SVG XML is malformed.')
  }
  if (root.type !== 'element' || root.name.toLowerCase() !== 'svg') {
    assetError(TEMPAD_MCP_ERROR_CODES.SVG_INVALID, key, 'SVG requires an <svg> document root.')
  }

  let elements = 0
  const ids = new Map<string, INode>()
  const uses = new Map<INode, string>()
  const normalizedColor = color?.toUpperCase()
  const visit = (node: INode, depth: number, inheritedNamespaces: Map<string, string>): void => {
    if (node.type !== 'element') return
    elements += 1
    if (elements > MAX_SVG_ELEMENTS || depth > MAX_SVG_DEPTH) {
      assetError(
        TEMPAD_MCP_ERROR_CODES.SVG_TOO_COMPLEX,
        key,
        `SVG may contain at most ${MAX_SVG_ELEMENTS} elements and ${MAX_SVG_DEPTH} levels.`
      )
    }
    const namespaces = new Map(inheritedNamespaces)
    for (const [attribute, value] of Object.entries(node.attributes)) {
      if (attribute === 'xmlns') namespaces.set('', value)
      else if (attribute.startsWith('xmlns:')) namespaces.set(attribute.slice(6), value)
    }
    const parts = node.name.split(':')
    const localName = parts.at(-1)!
    const prefix = parts.length === 1 ? '' : parts[0]!
    if (parts.length > 2 || namespaces.get(prefix) !== SVG_NAMESPACE) {
      assetError(
        TEMPAD_MCP_ERROR_CODES.SVG_INVALID,
        key,
        'SVG elements must belong to the SVG namespace.'
      )
    }
    const elementName = localName.toLowerCase()
    if (node.attributes.id) {
      if (ids.has(node.attributes.id)) {
        assetError(TEMPAD_MCP_ERROR_CODES.SVG_INVALID, key, 'SVG ids must be unique.')
      }
      ids.set(node.attributes.id, node)
    }
    if (BANNED_ELEMENTS.has(elementName)) {
      assetError(
        TEMPAD_MCP_ERROR_CODES.SVG_INVALID,
        key,
        `SVG element <${elementName}> is not supported.`
      )
    }
    for (const [attribute, rawValue] of Object.entries(node.attributes)) {
      const name = attribute.toLowerCase()
      const separator = attribute.indexOf(':')
      const namespacePrefix = separator > 0 ? attribute.slice(0, separator) : undefined
      const localName = separator > 0 ? attribute.slice(separator + 1).toLowerCase() : name
      if (localName === 'style' || localName.startsWith('on') || localName === 'src') {
        assetError(
          TEMPAD_MCP_ERROR_CODES.SVG_INVALID,
          key,
          `SVG attribute "${attribute}" is not supported.`
        )
      }
      const value = rawValue.trim()
      const isLink =
        name === 'href' ||
        name === 'xlink:href' ||
        (localName === 'href' &&
          namespacePrefix !== undefined &&
          namespaces.get(namespacePrefix) === XLINK_NAMESPACE)
      if (isLink) {
        if (!/^#[A-Za-z_][\w:.-]*$/.test(value)) {
          assetError(
            TEMPAD_MCP_ERROR_CODES.SVG_EXTERNAL_REFERENCE,
            key,
            'SVG links must reference a local #id.'
          )
        }
        if (elementName === 'use') {
          const previous = uses.get(node)
          if (previous && previous !== value.slice(1)) {
            assetError(
              TEMPAD_MCP_ERROR_CODES.SVG_INVALID,
              key,
              'SVG use links must identify the same target.'
            )
          }
          uses.set(node, value.slice(1))
        }
      }
      const cssValue = decodeCssEscapes(value)
      if (/@import/i.test(cssValue) || hasExternalUrl(cssValue)) {
        assetError(
          TEMPAD_MCP_ERROR_CODES.SVG_EXTERNAL_REFERENCE,
          key,
          'SVG cannot load external content.'
        )
      }
      if (COLOR_ATTRIBUTES.has(name) && /^currentcolor$/i.test(cssValue)) {
        if (!normalizedColor) {
          assetError(
            TEMPAD_MCP_ERROR_CODES.SVG_INVALID,
            key,
            'SVG uses currentColor but its placement has no color.'
          )
        }
        node.attributes[attribute] = normalizedColor
      }
    }
    node.attributes = Object.fromEntries(
      Object.entries(node.attributes).sort(([left], [right]) => left.localeCompare(right))
    )
    for (const child of node.children) visit(child, depth + 1, namespaces)
  }
  visit(root, 1, new Map([['', SVG_NAMESPACE]]))

  const memo = new Map<INode, { count: number; depth: number }>()
  const active = new Set<INode>()
  const expandedSize = (node: INode): { count: number; depth: number } => {
    const cached = memo.get(node)
    if (cached) return cached
    if (active.has(node)) {
      assetError(TEMPAD_MCP_ERROR_CODES.SVG_TOO_COMPLEX, key, 'SVG use references contain a cycle.')
    }
    active.add(node)
    const children = node.children.filter((child) => child.type === 'element')
    const reference = uses.get(node)
    if (reference) {
      const target = ids.get(reference)
      if (!target)
        assetError(
          TEMPAD_MCP_ERROR_CODES.SVG_INVALID,
          key,
          `SVG use target "${reference}" does not exist.`
        )
      children.push(target)
    }
    let count = 1
    let depth = 1
    for (const child of children) {
      const size = expandedSize(child)
      count += size.count
      depth = Math.max(depth, size.depth + 1)
      if (count > MAX_SVG_ELEMENTS || depth > MAX_SVG_DEPTH) {
        assetError(
          TEMPAD_MCP_ERROR_CODES.SVG_TOO_COMPLEX,
          key,
          'SVG use expansion exceeds the element or depth limit.'
        )
      }
    }
    active.delete(node)
    const size = { count, depth }
    memo.set(node, size)
    return size
  }
  expandedSize(root)

  let viewport: { width: number; height: number }
  try {
    viewport = svgViewport(root)
  } catch (error) {
    assetError(
      TEMPAD_MCP_ERROR_CODES.SVG_INVALID,
      key,
      error instanceof Error ? error.message : 'SVG viewport is invalid.'
    )
  }
  const sanitized = stringifySvgXml(root)
  return {
    type: 'SVG',
    digest: await sha256Hex(
      new TextEncoder().encode(`${SVG_POLICY_VERSION}\0${normalizedColor ?? ''}\0${sanitized}`)
    ),
    height: viewport.height,
    svg: sanitized,
    width: viewport.width
  }
}

function svgViewport(root: INode): { width: number; height: number } {
  const viewBox = root.attributes.viewBox?.trim()
  if (viewBox) {
    const values = viewBox.split(/[\s,]+/).map(Number)
    if (values.length === 4 && values.every(Number.isFinite) && values[2]! > 0 && values[3]! > 0) {
      return { width: values[2]!, height: values[3]! }
    }
    throw new Error('SVG viewBox must contain four finite values with positive width and height.')
  }
  const width = parseSvgLength(root.attributes.width)
  const height = parseSvgLength(root.attributes.height)
  if (width && height) return { width, height }
  throw new Error('SVG requires a positive viewBox or positive intrinsic width and height.')
}

function parseSvgLength(value: string | undefined): number | null {
  if (!value || !/^(?:\d+(?:\.\d+)?|\.\d+)(?:px)?$/i.test(value.trim())) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function hasExternalUrl(value: string): boolean {
  const withoutLocalRefs = value.replace(/url\(\s*(['"]?)#[A-Za-z_][\w:.-]*\1\s*\)/gi, '')
  return /url\s*\(/i.test(withoutLocalRefs)
}

function decodeCssEscapes(value: string): string {
  return value.replace(
    /\\(?:([\da-f]{1,6})(?:\r\n|[ \t\r\n\f])?|(\r\n|[\r\n\f])|(.))/gi,
    (_escape, hex: string | undefined, continuation: string | undefined, character: string) => {
      if (!hex) return continuation ? '' : character
      const point = Number.parseInt(hex, 16)
      return String.fromCodePoint(
        point === 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff) ? 0xfffd : point
      )
    }
  )
}

function validateImageMime(
  key: string,
  bytes: Uint8Array,
  declaredMime: string
): ResolvedImageAsset['mimeType'] {
  const actual = detectImageMime(bytes)
  const declared = normalizeMime(declaredMime)
  if (!actual || actual === 'image/webp' || actual !== declared) {
    assetError(
      TEMPAD_MCP_ERROR_CODES.ASSET_MIME_UNSUPPORTED,
      key,
      'Image asset must be a matching PNG, JPEG, or GIF.'
    )
  }
  return actual
}

function normalizeMime(value: string): string {
  const mime = value.split(';', 1)[0]!.trim().toLowerCase()
  return mime === 'image/jpg' ? 'image/jpeg' : mime
}

function imageCacheKey(key: string): string {
  return `image:${key}`
}

function svgCacheKey(key: string, color: string | undefined): string {
  return `svg:${key}:${color?.toUpperCase() ?? ''}`
}

function assetError(code: TempadMcpErrorCode, key: string, message: string): never {
  throw createCodedError(code, `Asset "${key}": ${message}`)
}
