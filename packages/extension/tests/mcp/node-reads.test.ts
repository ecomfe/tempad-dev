import type { GetCodeResult } from '@tempad-dev/shared'

import {
  MCP_TOOL_INLINE_BUDGET_BYTES,
  buildGetCodeToolResult,
  measureCallToolResultBytes
} from '@tempad-dev/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { readNodeBatch, resolveReadTargets, singleReadTarget } from '@/mcp/node-reads'
import { assertToolResponseWithinBudget } from '@/mcp/tools/code/messages'

function code(value: string): GetCodeResult {
  return {
    code: value,
    lang: 'jsx',
    codegen: { plugin: 'builtin', config: { cssUnit: 'px', rootFontSize: 16, scale: 1 } }
  }
}

function installNodes(ids: string[]) {
  const nodes = ids.map((id) => ({ id, type: 'FRAME', visible: true }) as SceneNode)
  const getNodeById = vi.fn((id: string) => nodes.find((node) => node.id === id) ?? null)
  const currentPage = { selection: nodes }
  vi.stubGlobal('figma', { currentPage, getNodeById })
  return { nodes, currentPage, getNodeById }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('node reads', () => {
  it('snapshots ordered selection once, retaining overlapping roots', async () => {
    const { nodes, currentPage } = installNodes(['parent', 'child'])
    Object.assign(nodes[0]!, { children: [nodes[1]] })
    const { targets, batch } = resolveReadTargets()
    const read = vi.fn(async (node: SceneNode) => {
      currentPage.selection = []
      return code(node.id)
    })
    const result = await readNodeBatch(targets, read, buildGetCodeToolResult)
    expect(batch).toBe(true)
    expect(result.results.map(({ nodeId }) => nodeId)).toEqual(['parent', 'child'])
    expect(result.results.map(({ result }) => result?.code)).toEqual(['parent', 'child'])
  })

  it('uses exact IDs in supplied order, deduplicates, and isolates invalid nodes', async () => {
    const { nodes, getNodeById } = installNodes(['a', 'b', 'hidden'])
    Object.assign(nodes[2]!, { visible: false })
    const { targets } = resolveReadTargets({ nodeIds: ['b', 'missing', 'a', 'hidden', 'b'] })
    const result = await readNodeBatch(
      targets,
      async (node) => code(node.id),
      buildGetCodeToolResult
    )
    expect(getNodeById).toHaveBeenCalledTimes(4)
    expect(result.results.map(({ nodeId }) => nodeId)).toEqual(['b', 'missing', 'a', 'hidden'])
    expect(result.results[0]?.result?.code).toBe('b')
    expect(result.results[1]?.error).toMatchObject({ code: 'NODE_NOT_VISIBLE' })
    expect(result.results[2]?.result?.code).toBe('a')
    expect(result.results[3]?.error).toMatchObject({ code: 'NODE_NOT_VISIBLE' })
  })

  it('retains single-node compatibility and explicit batch intent', () => {
    const { nodes } = installNodes(['a'])
    expect(resolveReadTargets().batch).toBe(false)
    expect(resolveReadTargets({ nodeId: 'a' }).batch).toBe(false)
    expect(resolveReadTargets({ nodeIds: ['a', 'a'] }).batch).toBe(true)
    expect(singleReadTarget(resolveReadTargets().targets)).toBe(nodes[0])
    expect(() => singleReadTarget(resolveReadTargets({ nodeId: 'missing' }).targets)).toThrow(
      'does not exist'
    )
    expect(() => resolveReadTargets({ nodeId: 'a', nodeIds: ['a'] })).toThrow('only one')
    expect(() => resolveReadTargets({ nodeIds: [] })).toThrow('Select one or more')
  })

  it('isolates native lookup exceptions to the failed target', async () => {
    const { getNodeById } = installNodes(['a', 'b'])
    getNodeById.mockImplementationOnce(() => {
      throw { message: 'Page is unavailable' }
    })
    const result = await readNodeBatch(
      resolveReadTargets({ nodeIds: ['a', 'b'] }).targets,
      async (node) => code(node.id),
      buildGetCodeToolResult
    )
    expect(result.results[0]).toEqual({ nodeId: 'a', error: { message: 'Page is unavailable' } })
    expect(result.results[1]?.result?.code).toBe('b')
  })

  it('preserves successful peers when code generation fails', async () => {
    installNodes(['a', 'b', 'c'])
    const result = await readNodeBatch(
      resolveReadTargets().targets,
      async (node) => {
        if (node.id === 'b') throw new Error('Plugin failed')
        return code(node.id)
      },
      buildGetCodeToolResult
    )
    expect(result.results).toEqual([
      { nodeId: 'a', result: code('a') },
      { nodeId: 'b', error: { message: 'Plugin failed' } },
      { nodeId: 'c', result: code('c') }
    ])
  })

  it('measures the full UTF-8 envelope and continues deferred roots with a fresh budget', async () => {
    installNodes(['a', 'b'])
    const output = code('你好🙂'.repeat(4000))
    const read = vi.fn(
      async (
        _node: SceneNode,
        format: (value: GetCodeResult) => ReturnType<typeof buildGetCodeToolResult>
      ) => {
        assertToolResponseWithinBudget(format(output), MCP_TOOL_INLINE_BUDGET_BYTES)
        return output
      }
    )
    const first = await readNodeBatch(resolveReadTargets().targets, read, buildGetCodeToolResult)
    expect(first.results).toEqual([{ nodeId: 'a', result: output }])
    expect(first.remainingNodeIds).toEqual(['b'])
    expect(measureCallToolResultBytes(buildGetCodeToolResult(first))).toBeLessThanOrEqual(
      MCP_TOOL_INLINE_BUDGET_BYTES
    )
    const next = await readNodeBatch(
      resolveReadTargets({ nodeIds: first.remainingNodeIds }).targets,
      read,
      buildGetCodeToolResult
    )
    expect(next).toEqual({ results: [{ nodeId: 'b', result: output }] })
  })

  it('reports an oversized first root without dropping following roots', async () => {
    installNodes(['a', 'b'])
    const result = await readNodeBatch(
      resolveReadTargets().targets,
      async (node, format) => {
        const output = code(node.id === 'a' ? 'x'.repeat(70_000) : 'small')
        assertToolResponseWithinBudget(format(output), MCP_TOOL_INLINE_BUDGET_BYTES)
        return output
      },
      buildGetCodeToolResult
    )
    expect(result.results[0]?.error?.message).toContain('inline budget')
    expect(result.results[1]?.result?.code).toBe('small')
  })

  it('bounds expensive work and leaves exact IDs for continuation', async () => {
    installNodes(Array.from({ length: 12 }, (_, index) => String(index)))
    const read = vi.fn(async (node: SceneNode) => code(node.id))
    const result = await readNodeBatch(resolveReadTargets().targets, read, buildGetCodeToolResult)
    expect(read).toHaveBeenCalledTimes(8)
    expect(result.remainingNodeIds).toEqual(['8', '9', '10', '11'])
  })

  it('bounds results even for a reader without an internal formatter check', async () => {
    installNodes(['a', 'b'])
    const result = await readNodeBatch(
      resolveReadTargets().targets,
      async (node) => code(node.id === 'a' ? 'x'.repeat(70_000) : 'small'),
      buildGetCodeToolResult
    )
    expect(result.results[0]?.error?.message).toContain('inline budget')
    expect(result.results[1]?.result?.code).toBe('small')
    const deferred = await readNodeBatch(
      resolveReadTargets().targets,
      async () => code('x'.repeat(40_000)),
      buildGetCodeToolResult
    )
    expect(deferred.remainingNodeIds).toEqual(['b'])
  })

  it('rejects a target manifest that leaves no room for a result before doing work', async () => {
    installNodes(['x'.repeat(64_000)])
    const read = vi.fn(async () => code('small'))
    await expect(
      readNodeBatch(resolveReadTargets().targets, read, buildGetCodeToolResult)
    ).rejects.toThrow('Request fewer nodeIds')
    expect(read).not.toHaveBeenCalled()
  })

  it('stops starting more roots when the batch work window is exhausted', async () => {
    installNodes(['a', 'b'])
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(10_000)
    const result = await readNodeBatch(
      resolveReadTargets().targets,
      async (node) => code(node.id),
      buildGetCodeToolResult
    )
    expect(result.results).toHaveLength(1)
    expect(result.remainingNodeIds).toEqual(['b'])
  })
})
