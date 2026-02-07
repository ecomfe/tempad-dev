import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getVariableByIdCached: vi.fn(),
  buildTokenRegex: vi.fn(),
  buildSourceNameIndex: vi.fn(),
  applyPluginTransformToNames: vi.fn(),
  rewriteTokenNamesInCode: vi.fn(),
  buildUsedTokens: vi.fn(),
  createStyleVarResolver: vi.fn(),
  processTokens: vi.fn()
}))

vi.mock('@/mcp/tools/code/tokens/cache', () => ({
  getVariableByIdCached: mocks.getVariableByIdCached
}))

vi.mock('@/mcp/tools/code/tokens/extract', () => ({
  buildTokenRegex: mocks.buildTokenRegex
}))

vi.mock('@/mcp/tools/code/tokens/source-index', () => ({
  buildSourceNameIndex: mocks.buildSourceNameIndex
}))

vi.mock('@/mcp/tools/code/tokens/transform', () => ({
  applyPluginTransformToNames: mocks.applyPluginTransformToNames
}))

vi.mock('@/mcp/tools/code/tokens/rewrite', () => ({
  rewriteTokenNamesInCode: mocks.rewriteTokenNamesInCode
}))

vi.mock('@/mcp/tools/code/tokens/used', () => ({
  buildUsedTokens: mocks.buildUsedTokens
}))

vi.mock('@/mcp/tools/code/tokens/resolve', () => ({
  createStyleVarResolver: mocks.createStyleVarResolver
}))

vi.mock('@/mcp/tools/code/tokens/process', () => ({
  processTokens: mocks.processTokens
}))

import * as tokensIndex from '@/mcp/tools/code/tokens'

describe('tokens/index exports', () => {
  it('re-exports token pipeline helpers', () => {
    expect(tokensIndex.getVariableByIdCached).toBe(mocks.getVariableByIdCached)
    expect(tokensIndex.buildTokenRegex).toBe(mocks.buildTokenRegex)
    expect(tokensIndex.buildSourceNameIndex).toBe(mocks.buildSourceNameIndex)
    expect(tokensIndex.applyPluginTransformToNames).toBe(mocks.applyPluginTransformToNames)
    expect(tokensIndex.rewriteTokenNamesInCode).toBe(mocks.rewriteTokenNamesInCode)
    expect(tokensIndex.buildUsedTokens).toBe(mocks.buildUsedTokens)
    expect(tokensIndex.createStyleVarResolver).toBe(mocks.createStyleVarResolver)
    expect(tokensIndex.processTokens).toBe(mocks.processTokens)
  })
})
