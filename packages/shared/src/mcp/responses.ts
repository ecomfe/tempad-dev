import type {
  ApplyCanvasResult,
  GetAssetsResult,
  GetCodeResult,
  GetDesignSystemResult,
  GetScreenshotResult,
  GetStructureResult,
  GetTokenDefsResult,
  UploadAssetResult
} from './tools'

const ENCODER = new TextEncoder()

export type ToolResponseContentBlock = {
  type: string
  text?: string
  uri?: string
  name?: string
  description?: string
  mimeType?: string
  size?: number
}

export type ToolResponseLike = {
  content?: ToolResponseContentBlock[]
  structuredContent?: unknown
  isError?: boolean
  _meta?: Record<string, unknown>
}

export function utf8Bytes(value: unknown): number {
  const serialized =
    typeof value === 'string' ? value : (JSON.stringify(value, null, 0) ?? 'undefined')
  return ENCODER.encode(serialized).length
}

export function measureCallToolResultBytes(result: ToolResponseLike): number {
  return utf8Bytes(result)
}

export function buildGetCodeToolResult(payload: GetCodeResult): ToolResponseLike {
  const summary: string[] = []
  const codeSize = utf8Bytes(payload.code)
  summary.push(`Generated \`${payload.lang}\` snippet (${formatBytes(codeSize)}).`)

  if (payload.warnings?.length) {
    summary.push(...payload.warnings.map((warning) => warning.message))
  }

  summary.push(
    payload.assets?.length
      ? `Assets attached: ${payload.assets.length}. Use asset.localPath directly when present; otherwise download asset.url.`
      : 'No binary assets were attached to this response.'
  )

  const tokenCount = payload.tokens ? Object.keys(payload.tokens).length : 0
  if (tokenCount) {
    summary.push(`Token references included: ${tokenCount}.`)
  }

  summary.push('Read structuredContent for the full code string and metadata.')

  return buildTextToolResult(summary.join('\n'), payload)
}

export function buildGetDesignSystemToolResult(payload: GetDesignSystemResult): ToolResponseLike {
  if (payload.details) {
    return buildTextToolResult(
      `Returned bounded ${payload.details.kind} definition ${payload.details.ref} from catalog ${payload.catalogId}.`,
      payload
    )
  }
  const summary = `Returned ${formatCount(payload.components.length, 'component')}, ${formatCount(payload.variables.length, 'variable')}, ${formatCount(payload.styles.length, 'style')}, ${formatCount(payload.collections.length, 'collection')}, and ${formatCount(payload.shaders?.length ?? 0, 'shader')} from catalog ${payload.catalogId}.`
  const warnings = payload.warnings?.length ? `\n${payload.warnings.join('\n')}` : ''
  const continuation =
    payload.nextCursor === undefined
      ? ''
      : ` Continue this catalog with cursor ${payload.nextCursor} to inspect omitted resources.`
  return buildTextToolResult(
    `${summary}${warnings}\nRead structuredContent for deterministic short refs and component tags.${continuation} Read one bounded definition with this catalogId and a returned ref.`,
    payload
  )
}

export function buildApplyCanvasToolResult(payload: ApplyCanvasResult): ToolResponseLike {
  const nodeChanges = {
    created: payload.createdNodeIds.length,
    updated: payload.updatedNodeIds.length,
    removed: payload.removedNodeIds.length
  }
  const summary = `Applied ${formatCount(payload.mutationCount, 'canvas mutation')}: ${formatCount(nodeChanges.created, 'node')} created, ${formatCount(nodeChanges.updated, 'node')} updated, and ${formatCount(nodeChanges.removed, 'node')} removed.`
  const verifiedCounts = [
    formatCount(payload.verification.nodesChecked, 'node'),
    formatCount(payload.verification.referencesChecked, 'native reference'),
    ...(payload.verification.nativeFieldsChecked === undefined
      ? []
      : [formatCount(payload.verification.nativeFieldsChecked, 'native state assertion')])
  ]
  const verification = `Structural verification ${payload.verification.status}: ${verifiedCounts.length === 2 ? `${verifiedCounts[0]} and ${verifiedCounts[1]}` : `${verifiedCounts.slice(0, -1).join(', ')}, and ${verifiedCounts.at(-1)}`} checked.`
  const warnings = payload.verification.warnings.length
    ? `\n${payload.verification.warnings.map(({ code, key, message }) => `${code}${key ? ` (${key})` : ''}: ${message}`).join('\n')}`
    : ''
  const root = payload.rootRemoved
    ? `Root node is absent: ${payload.rootNodeId}. Repeating the same assertion is safe.`
    : `Root node: ${payload.rootNodeId}.`
  const identities = payload.rootRemoved
    ? ''
    : '\nRead structuredContent.nodeIdsByKey before a follow-up update or component instance call.'
  return buildTextToolResult(`${summary}\n${verification}${warnings}\n${root}${identities}`, {
    rootNodeId: payload.rootNodeId,
    ...(payload.rootRemoved ? { rootRemoved: true } : {}),
    nodeIdsByKey: payload.nodeIdsByKey,
    mutationCount: payload.mutationCount,
    nodeChanges,
    verification: payload.verification
  })
}

export function buildGetStructureToolResult(payload: GetStructureResult): ToolResponseLike {
  const roots = payload.roots.length
  const nodeCount = countOutlineNodes(payload.roots)
  const summary =
    roots === 0
      ? 'No structure nodes were returned.'
      : `Returned ${payload.truncated ? 'a truncated structure outline' : 'structure outline'} with ${formatCount(roots, 'root')} and ${formatCount(nodeCount, 'node')}.`
  const guidance = payload.truncated
    ? 'The outline is partial because the response safety cap was reached; narrow the selection or depth before treating it as complete.'
    : 'Read structuredContent for the full outline payload.'

  return buildTextToolResult(`${summary}\n${guidance}`, payload)
}

export function buildGetTokenDefsToolResult(payload: GetTokenDefsResult): ToolResponseLike {
  const count = Object.keys(payload).length
  const summary =
    count === 0
      ? 'No token definitions were resolved.'
      : `Resolved ${formatCount(count, 'token definition')}.`

  return buildTextToolResult(
    `${summary}\nRead structuredContent for token values and aliases.`,
    payload
  )
}

export function buildGetScreenshotToolResult(payload: GetScreenshotResult): ToolResponseLike {
  const access = payload.asset.localPath
    ? `Open the local PNG directly with an image viewer: ${payload.asset.localPath}.`
    : 'Download and open the linked PNG with an image viewer.'
  return {
    content: [
      {
        type: 'text',
        text: `${describeScreenshot(payload)}. ${access} Receiving the asset reference alone is not visual verification. If this is a representative-screen check, inspect it before applying dependent screens.`
      },
      {
        type: 'resource_link',
        uri: payload.asset.url,
        name: `Figma screenshot ${payload.asset.hash}.png`,
        description: `${payload.width}x${payload.height} rendered Figma node`,
        mimeType: payload.asset.mimeType,
        size: payload.asset.size
      }
    ],
    structuredContent: payload
  }
}

export function buildGetAssetsToolResult(payload: GetAssetsResult): ToolResponseLike {
  const summary: string[] = []
  summary.push(
    payload.assets.length
      ? `Resolved ${formatCount(payload.assets.length, 'asset')}.`
      : 'No assets were resolved for the requested hashes.'
  )
  if (payload.missing.length) {
    summary.push(`Missing: ${payload.missing.join(', ')}`)
  }
  summary.push('Use asset.localPath directly when present; otherwise download asset.url.')

  return buildTextToolResult(summary.join('\n'), payload)
}

export function buildUploadAssetToolResult(payload: UploadAssetResult): ToolResponseLike {
  return buildTextToolResult(
    `Stored generated image asset ${payload.assetHash} (${formatBytes(payload.size)}, ${payload.mimeType}). Use structuredContent.assetHash in an apply_canvas IMAGE asset declaration.`,
    payload
  )
}

function buildTextToolResult(text: string, structuredContent: unknown): ToolResponseLike {
  return {
    content: [
      {
        type: 'text',
        text
      }
    ],
    structuredContent
  }
}

function countOutlineNodes(nodes: GetStructureResult['roots']): number {
  let count = 0
  const stack = [...nodes]
  while (stack.length) {
    const current = stack.pop()
    if (!current) continue
    count += 1
    if (current.children?.length) {
      stack.push(...current.children)
    }
  }
  return count
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatCount(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`
}

function describeScreenshot(result: GetScreenshotResult): string {
  return `Screenshot ${result.width}x${result.height} @${result.scale}x (${formatBytes(result.bytes)})`
}
