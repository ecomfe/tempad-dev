import type { GetTokenDefsResult } from '@tempad-dev/mcp-shared'

import type { CodegenConfig } from '@/utils/codegen'

import { stripFallback } from '@/utils/css'

import { createTokenMatcher, extractTokenNames } from './extract'
import { rewriteTokenNamesInCode, filterBridge } from './rewrite'
import { buildSourceNameIndex } from './source-index'
import { applyPluginTransformToNames } from './transform'
import { buildUsedTokens } from './used'

type ProcessTokensInput = {
  code: string
  truncated: boolean
  maxChars: number
  variableIds: Set<string>
  usedCandidateIds: Set<string>
  variableCache: Map<string, Variable | null>
  styles: Map<string, Record<string, string>>
  textSegments: Map<string, StyledTextSegment[] | null>
  config: CodegenConfig
  pluginCode?: string
  resolveTokens?: boolean
  stamp?: (label: string, start: number) => void
  now?: () => number
}

type ProcessTokensResult = {
  code: string
  truncated: boolean
  tokensByCanonical: GetTokenDefsResult
  sourceIndex: Map<string, string>
  tokenMatcher?: (value: string) => boolean
  resolveNodeIds?: Set<string>
}

export async function processTokens({
  code: inputCode,
  truncated: inputTruncated,
  maxChars,
  variableIds,
  usedCandidateIds,
  variableCache,
  styles,
  textSegments,
  config,
  pluginCode,
  resolveTokens,
  stamp,
  now
}: ProcessTokensInput): Promise<ProcessTokensResult> {
  const clock = now ?? (() => Date.now())
  let code = stripFallback(inputCode)
  let truncated = inputTruncated

  const candidateIds = usedCandidateIds.size
    ? new Set<string>([...variableIds, ...usedCandidateIds])
    : variableIds
  const sourceIndex = buildSourceNameIndex(candidateIds, variableCache)
  const sourceNames = new Set(sourceIndex.keys())
  const emptyResult = () => ({
    code,
    truncated,
    tokensByCanonical: {},
    sourceIndex
  })
  if (!sourceNames.size) {
    return emptyResult()
  }

  let t = clock()
  const usedNamesRaw = extractTokenNames(code, sourceNames)
  if (stamp) stamp('tokens:detect', t)
  if (!usedNamesRaw.size) {
    return emptyResult()
  }

  t = clock()
  const { rewriteMap, finalBridge } = await applyPluginTransformToNames(
    usedNamesRaw,
    sourceIndex,
    pluginCode,
    config
  )

  const hasRenames = rewriteMap.size > 0

  if (hasRenames) {
    code = rewriteTokenNamesInCode(code, rewriteMap)
    if (code.length > maxChars) {
      code = code.slice(0, maxChars)
      truncated = true
    }
  }

  let usedNamesFinal = usedNamesRaw
  if (hasRenames) {
    const remapped = new Set<string>()
    usedNamesRaw.forEach((name) => {
      remapped.add(rewriteMap.get(name) ?? name)
    })
    usedNamesFinal = remapped
  }
  const finalBridgeFiltered = hasRenames ? filterBridge(finalBridge, usedNamesFinal) : finalBridge
  if (stamp) stamp('tokens:rewrite', t)
  if (!finalBridgeFiltered.size) {
    return emptyResult()
  }

  t = clock()
  const { tokensByCanonical } = await buildUsedTokens(
    finalBridgeFiltered,
    config,
    pluginCode,
    variableCache,
    {
      includeAllModes: true,
      resolveValues: !!resolveTokens
    }
  )
  if (stamp) stamp('tokens:used', t)

  const hasTokens = Object.keys(tokensByCanonical).length > 0
  const tokenMatcher = resolveTokens && hasTokens ? createTokenMatcher(sourceNames) : undefined
  const resolveNodeIds =
    resolveTokens && tokenMatcher
      ? collectResolveNodeIds(styles, textSegments, tokenMatcher)
      : undefined

  return {
    code,
    truncated,
    tokensByCanonical,
    sourceIndex,
    tokenMatcher,
    resolveNodeIds
  }
}

function collectResolveNodeIds(
  styles: Map<string, Record<string, string>>,
  textSegments: Map<string, unknown>,
  matcher: (value: string) => boolean
): Set<string> {
  const ids = new Set<string>()

  for (const [id, style] of styles.entries()) {
    if (hasTokenInStyle(style, matcher)) ids.add(id)
  }

  for (const id of textSegments.keys()) {
    ids.add(id)
  }

  return ids
}

function hasTokenInStyle(
  style: Record<string, string>,
  matcher: (value: string) => boolean
): boolean {
  for (const value of Object.values(style)) {
    if (!value) continue
    if (matcher(value)) return true
  }
  return false
}
