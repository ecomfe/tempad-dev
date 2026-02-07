import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  collectCandidateVariableIds: vi.fn(),
  handleGetTokenDefs: vi.fn(),
  resolveTokenDefsByNames: vi.fn()
}))

vi.mock('@/mcp/tools/token/candidates', () => ({
  collectCandidateVariableIds: mocks.collectCandidateVariableIds
}))

vi.mock('@/mcp/tools/token/defs', () => ({
  handleGetTokenDefs: mocks.handleGetTokenDefs,
  resolveTokenDefsByNames: mocks.resolveTokenDefsByNames
}))

import * as tokenRoot from '@/mcp/tools/token'
import * as tokenIndex from '@/mcp/tools/token/index'

describe('token/index exports', () => {
  it('re-exports token candidate and definition APIs', () => {
    expect(tokenRoot.collectCandidateVariableIds).toBe(mocks.collectCandidateVariableIds)
    expect(tokenRoot.handleGetTokenDefs).toBe(mocks.handleGetTokenDefs)
    expect(tokenRoot.resolveTokenDefsByNames).toBe(mocks.resolveTokenDefsByNames)
    expect(tokenIndex.collectCandidateVariableIds).toBe(mocks.collectCandidateVariableIds)
    expect(tokenIndex.handleGetTokenDefs).toBe(mocks.handleGetTokenDefs)
    expect(tokenIndex.resolveTokenDefsByNames).toBe(mocks.resolveTokenDefsByNames)
  })
})
