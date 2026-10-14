import { afterEach, expect, it, vi } from 'vitest'

import { suggestDepthLimit } from '@/mcp/semantic-tree'
import { createGetCodeCacheContext, getNodeSemanticsCached } from '@/mcp/tools/code/cache'
import { createCodeCheckpoint, withCodeDeadline } from '@/mcp/tools/code/deadline'
import { getLayoutParent } from '@/mcp/tools/code/layout-parent'
import { buildVisibleTree } from '@/mcp/tools/code/tree'
import { collectCandidateVariableIds } from '@/mcp/tools/token/candidates'

afterEach(() => vi.restoreAllMocks())

function clock() {
  let elapsed = 0
  vi.spyOn(performance, 'now').mockImplementation(() => elapsed)
  return (value: number) => (elapsed = value)
}

function node(id: string, children: SceneNode[] = []): SceneNode {
  return {
    id,
    name: id,
    type: 'FRAME',
    visible: true,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    layoutMode: 'NONE',
    children
  } as unknown as SceneNode
}

it('rejects synchronous work that finishes after the deadline before the timer runs', async () => {
  const advance = clock()
  await expect(
    withCodeDeadline(20, async () => {
      advance(21)
      return 'too late'
    })
  ).rejects.toThrow('Code generation timed out')
})

it('checks hidden siblings before reading their visibility during depth selection', () => {
  const advance = clock()
  const check = createCodeCheckpoint(20)
  let reads = 0
  const children = Array.from({ length: 100 }, (_, index) => {
    const child = node(String(index))
    Object.defineProperty(child, 'visible', {
      get() {
        advance(++reads * 10)
        return false
      }
    })
    return child
  })
  expect(() => suggestDepthLimit([node('root', children)], check)).toThrow('timed out')
  expect(reads).toBe(2)
})

it('retains a completed tree when its final native getter exhausts the generation budget', () => {
  const advance = clock()
  const check = createCodeCheckpoint(20)
  const root = node('root')
  Object.defineProperty(root, 'inferredAutoLayout', {
    get() {
      advance(21)
      return null
    }
  })
  expect(buildVisibleTree([root], check).rootIds).toEqual(['root'])
  expect(check).toThrow('timed out')
})

it('checks a completed synchronous variable scan before building lookups', () => {
  const advance = clock()
  const check = createCodeCheckpoint(20)
  const root = node('root')
  Object.defineProperty(root, 'boundVariables', {
    get() {
      advance(21)
      return {}
    }
  })
  expect(() =>
    collectCandidateVariableIds([root], undefined, undefined, {
      traverseChildren: false,
      checkpoint: check
    })
  ).toThrow('timed out')
})

it('checks the final variable lookup even when there is no following node', () => {
  const advance = clock()
  const check = createCodeCheckpoint(20)
  const root = node('root')
  Object.assign(root, { boundVariables: { width: { type: 'VARIABLE_ALIAS', id: 'v' } } })
  vi.stubGlobal('figma', {
    variables: {
      getVariableById: () => {
        advance(21)
        return null
      }
    }
  })
  try {
    expect(() =>
      collectCandidateVariableIds([root], undefined, undefined, {
        traverseChildren: false,
        checkpoint: check
      })
    ).toThrow('timed out')
  } finally {
    vi.unstubAllGlobals()
  }
})

it.each(['transform', 'bounds', 'hidden'])(
  'checks physical child %s reads while resolving a bounded tree’s layout hints',
  (kind) => {
    const advance = clock()
    const check = createCodeCheckpoint(20)
    let scanningOverflow = false
    let reads = 0
    const children = Array.from({ length: 2048 }, (_, index) => {
      const child = node(`deep-${index}`)
      Object.defineProperty(child, 'visible', {
        get() {
          if (kind === 'hidden' && scanningOverflow) advance(++reads * 10)
          return kind !== 'hidden'
        }
      })
      Object.defineProperty(
        child,
        kind === 'bounds' ? 'absoluteBoundingBox' : 'relativeTransform',
        {
          get() {
            advance(++reads * 10)
            return kind === 'bounds'
              ? { x: 0, y: 0, width: 100, height: 100 }
              : [
                  [1, 0, 0],
                  [0, 1, 0]
                ]
          }
        }
      )
      return child
    })
    const clipped = Object.assign(node('clipped', children), {
      inferredAutoLayout: null,
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 }
    })
    Object.defineProperty(clipped, 'clipsContent', {
      get() {
        scanningOverflow = true
        return true
      }
    })
    const root = node('root', [
      clipped,
      ...Array.from({ length: 1535 }, (_, index) => node(`sibling-${index}`))
    ])
    expect(suggestDepthLimit([root])).toBe(kind === 'hidden' ? undefined : 1)
    expect(() => buildVisibleTree([root], check)).toThrow('timed out')
    expect(reads).toBe(2)
  }
)

it('checks the same overflow scan when generation populates semantic caches', () => {
  const advance = clock()
  let reads = 0
  const children = Array.from({ length: 100 }, (_, index) =>
    Object.defineProperty(node(String(index)), 'relativeTransform', {
      get() {
        advance(++reads * 10)
        return [
          [1, 0, 0],
          [0, 1, 0]
        ]
      }
    })
  )
  // Explicit auto layout skips the tree’s inferred-layout pass; collection still
  // needs its physical overflow through the request-scoped semantic cache.
  const root = Object.assign(node('root', children), {
    clipsContent: true,
    layoutMode: 'HORIZONTAL'
  })
  const cache = { ...createGetCodeCacheContext(), checkpoint: createCodeCheckpoint(20) }
  expect(() => getNodeSemanticsCached(root, cache)).toThrow('timed out')
  expect(reads).toBe(2)
  expect(cache.nodeSemantics.has(root.id)).toBe(false)
})

it('reuses the tree’s inferred layout hint when resolving a group’s flow parent', () => {
  const leaf = node('leaf')
  const group = Object.assign(node('group', [leaf]), { type: 'GROUP' })
  const root = node('root', [group])
  let reads = 0
  Object.defineProperty(root, 'inferredAutoLayout', {
    get() {
      reads++
      return { layoutMode: 'HORIZONTAL' }
    }
  })
  const tree = buildVisibleTree([root])
  expect(tree.nodes.get(root.id)?.autoLayoutHint).toBe('inferred')
  expect(getLayoutParent(tree, tree.nodes.get(leaf.id)!)?.id).toBe(group.id)
  expect(reads).toBe(1)
})

it.each(['range', 'fills', 'effects', 'style-paints', 'nested-bindings'])(
  'stops a node’s candidate %s scan before reading its remaining fields',
  (kind) => {
    const advance = clock()
    const check = createCodeCheckpoint(20)
    let reads = 0
    const root = node('root')
    const laterRead = vi.fn(() => undefined)
    const paints = Array.from({ length: 100 }, () => ({
      get boundVariables() {
        advance(++reads * 10)
        return { color: { type: 'VARIABLE_ALIAS', id: 'v' } }
      }
    }))
    const readers = {
      getStyleById: vi.fn(() => ({ paints }) as unknown as BaseStyle),
      getVariableById: vi.fn(() => null)
    }
    if (kind === 'range') {
      Object.assign(root, {
        type: 'TEXT',
        characters: 'text',
        getRangeBoundVariable() {
          advance(++reads * 21)
          return null
        }
      })
      Object.defineProperty(root, 'textStyleId', { get: laterRead })
    } else if (kind === 'style-paints') {
      Object.assign(root, { fillStyleId: 'style' })
      Object.defineProperty(root, 'strokeStyleId', { get: laterRead })
    } else if (kind === 'nested-bindings') {
      Object.assign(root, { boundVariables: { fills: paints } })
      Object.defineProperty(root, 'fills', { get: laterRead })
    } else {
      Object.assign(root, { [kind]: paints })
      Object.defineProperty(root, 'fillStyleId', { get: laterRead })
    }
    expect(() =>
      collectCandidateVariableIds([root], undefined, readers, {
        traverseChildren: false,
        checkpoint: check
      })
    ).toThrow('timed out')
    expect(reads).toBe(kind === 'range' ? 1 : 2)
    expect(laterRead).not.toHaveBeenCalled()
  }
)
