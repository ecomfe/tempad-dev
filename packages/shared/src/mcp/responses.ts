import type {
  GetAssetsResult,
  GetCodeResult,
  GetCodeWarning,
  GetScreenshotResult,
  GetStructureResult,
  GetTokenDefsResult
} from './tools'

const ENCODER = new TextEncoder()

export type ToolResponseContentBlock = {
  type: string
  text?: string
}

export type ToolResponseLike = {
  content?: ToolResponseContentBlock[]
  structuredContent?: unknown
  isError?: boolean
  _meta?: Record<string, unknown>
}

type GetCodeContinuationArgs = {
  nodeId: string
  preferredLang?: 'jsx' | 'vue'
  resolveTokens?: boolean
  vectorMode?: 'smart' | 'snapshot'
}

type ContinuationData = {
  recommendedNextArgs?: GetCodeContinuationArgs
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

  const continuation = summarizeCodeContinuation(payload.warnings)
  if (continuation) {
    summary.push(continuation)
  }

  summary.push(
    payload.assets?.length
      ? `Assets attached: ${payload.assets.length}. Download bytes from each asset.url.`
      : 'No binary assets were attached to this response.'
  )

  const tokenCount = payload.tokens ? Object.keys(payload.tokens).length : 0
  if (tokenCount) {
    summary.push(`Token references included: ${tokenCount}.`)
  }

  summary.push('Read structuredContent for the full code string and metadata.')

  return {
    content: [
      {
        type: 'text',
        text: summary.join('\n')
      }
    ],
    structuredContent: payload
  }
}

export function buildGetStructureToolResult(payload: GetStructureResult): ToolResponseLike {
  const roots = payload.roots.length
  const nodeCount = countOutlineNodes(payload.roots)
  const summary =
    roots === 0
      ? 'No structure nodes were returned.'
      : `Returned structure outline with ${roots} root${roots === 1 ? '' : 's'} and ${nodeCount} node${nodeCount === 1 ? '' : 's'}.`

  return {
    content: [
      {
        type: 'text',
        text: `${summary}\nRead structuredContent for the full outline payload.`
      }
    ],
    structuredContent: payload
  }
}

export function buildGetTokenDefsToolResult(payload: GetTokenDefsResult): ToolResponseLike {
  const count = Object.keys(payload).length
  const summary =
    count === 0
      ? 'No token definitions were resolved.'
      : `Resolved ${count} token definition${count === 1 ? '' : 's'}.`

  return {
    content: [
      {
        type: 'text',
        text: `${summary}\nRead structuredContent for token values and aliases.`
      }
    ],
    structuredContent: payload
  }
}

export function buildGetScreenshotToolResult(payload: GetScreenshotResult): ToolResponseLike {
  return {
    content: [
      {
        type: 'text',
        text: `${describeScreenshot(payload)} - Download: ${payload.asset.url}`
      }
    ],
    structuredContent: payload
  }
}

export function buildGetAssetsToolResult(payload: GetAssetsResult): ToolResponseLike {
  const summary: string[] = []
  summary.push(
    payload.assets.length
      ? `Resolved ${payload.assets.length} asset${payload.assets.length === 1 ? '' : 's'}.`
      : 'No assets were resolved for the requested hashes.'
  )
  if (payload.missing.length) {
    summary.push(`Missing: ${payload.missing.join(', ')}`)
  }
  summary.push('Download bytes from each asset.url.')

  return {
    content: [
      {
        type: 'text',
        text: summary.join('\n')
      }
    ],
    structuredContent: payload
  }
}

function summarizeCodeContinuation(warnings?: GetCodeWarning[]): string | undefined {
  if (!warnings?.length) return undefined

  const preferred = warnings.find((warning) => {
    const data = warning.data as ContinuationData | undefined
    return !!data?.recommendedNextArgs
  })

  const nextArgs = (preferred?.data as ContinuationData | undefined)?.recommendedNextArgs
  if (!nextArgs) return undefined

  const prefix =
    preferred?.type === 'shell' ? 'Returned a shell response.' : 'Returned a partial response.'
  return `${prefix} Next: call get_code with ${JSON.stringify(nextArgs)}.`
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

function describeScreenshot(result: GetScreenshotResult): string {
  return `Screenshot ${result.width}x${result.height} @${result.scale}x (${formatBytes(result.bytes)})`
}
