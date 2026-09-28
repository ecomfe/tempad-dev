import type { GetTokenDefsResult } from '@tempad-dev/shared'

import type { CodegenConfig } from '@/utils/codegen'

import { stripFallback } from '@/utils/css'

import type { TokenReadContext } from '../../token/context'
import type { SvgEntry } from '../assets'
import type { ReportTokenDiagnostic } from './diagnostics'

import { createTokenReadContext } from '../../token/context'
import { resolveTokenDefsByIds } from '../../token/defs'
import { createTokenMatcher, extractTokenNames } from './extract'
import { rewriteTokenNamesInCode } from './rewrite'
import { buildSourceNameIndex } from './source-index'
import { applyPluginTransformToNames } from './transform'

type ProcessTokensInput = {
  code: string
  variableIds: Set<string>
  usedCandidateIds: Set<string>
  variableCache: Map<string, Variable | null>
  styles: Map<string, Record<string, string>>
  textSegments: Map<string, StyledTextSegment[] | null>
  svgs: Map<string, SvgEntry>
  config: CodegenConfig
  pluginCode?: string
  resolveTokens?: boolean
  tokenContext?: TokenReadContext
  report?: ReportTokenDiagnostic
  stamp?: (label: string, start: number) => void
  now?: () => number
}

type ProcessTokensResult = {
  code: string
  tokensByCanonical: GetTokenDefsResult
  sourceIndex: Map<string, string>
  tokenMatcher?: (value: string) => boolean
  resolveNodeIds?: Set<string>
  rewriteMap?: Map<string, string>
}

export async function processTokens({
  code: inputCode,
  variableIds,
  usedCandidateIds,
  variableCache,
  styles,
  textSegments,
  svgs,
  config,
  pluginCode,
  resolveTokens,
  tokenContext = createTokenReadContext(config, pluginCode, variableCache),
  report,
  stamp,
  now
}: ProcessTokensInput): Promise<ProcessTokensResult> {
  const clock = now ?? (() => Date.now())
  let code = stripFallback(inputCode)

  const candidateIds = usedCandidateIds.size
    ? new Set<string>([...variableIds, ...usedCandidateIds])
    : variableIds
  const sourceIndex = buildSourceNameIndex(candidateIds, variableCache, (name) => {
    if (extractTokenNames(code, new Set([name])).size) {
      report?.('token-definition', `Token name "${name}" matches multiple variables.`)
    }
  })
  const sourceNames = new Set(sourceIndex.keys())
  const emptyResult = () => ({
    code,
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
    config,
    report
  )

  if (rewriteMap.size) {
    code = rewriteTokenNamesInCode(code, rewriteMap)
  }
  if (stamp) stamp('tokens:rewrite', t)
  if (!finalBridge.size) {
    return emptyResult()
  }

  t = clock()
  const tokensByCanonical = await resolveTokenDefsByIds(
    finalBridge,
    tokenContext,
    true,
    report ? (message) => report('token-definition', message) : undefined
  )
  if (stamp) stamp('tokens:used', t)

  const tokenMatcher = resolveTokens ? createTokenMatcher(sourceNames) : undefined
  const resolveNodeIds =
    resolveTokens && tokenMatcher
      ? collectResolveNodeIds(styles, textSegments, svgs, tokenMatcher)
      : undefined

  return {
    code,
    tokensByCanonical,
    sourceIndex,
    tokenMatcher,
    resolveNodeIds,
    rewriteMap
  }
}

function collectResolveNodeIds(
  styles: Map<string, Record<string, string>>,
  textSegments: Map<string, unknown>,
  svgs: Map<string, SvgEntry>,
  matcher: (value: string) => boolean
): Set<string> {
  const ids = new Set<string>()

  for (const [id, style] of styles.entries()) {
    if (hasTokenInStyle(style, matcher)) ids.add(id)
  }

  for (const id of textSegments.keys()) {
    ids.add(id)
  }

  for (const [id, entry] of svgs.entries()) {
    if (entry.presentationStyle && hasTokenInStyle(entry.presentationStyle, matcher)) {
      ids.add(id)
    }
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
