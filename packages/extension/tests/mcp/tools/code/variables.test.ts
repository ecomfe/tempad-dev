import { describe, expect, it, vi } from 'vitest'

import type { CodegenConfig } from '@/utils/codegen'

import { collectRefs, transform } from '@/mcp/tools/code/variables'
import { runTransformVariableBatch } from '@/mcp/transform-variables/requester'
import { workerUnitOptions } from '@/utils/codegen'

vi.mock('@/mcp/transform-variables/requester', () => ({
  runTransformVariableBatch: vi.fn()
}))

vi.mock('@/utils/codegen', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/codegen')>()
  return {
    ...actual,
    workerUnitOptions: vi.fn(() => ({ cssUnit: 'px', rootFontSize: 16, scale: 1 }))
  }
})

const CONFIG: CodegenConfig = {
  cssUnit: 'px',
  rootFontSize: 16,
  scale: 1
}

describe('mcp/code variables', () => {
  it('collects only custom property references and keeps buckets by node/property', () => {
    const styles = new Map<string, Record<string, string>>([
      [
        'node-1',
        {
          color: 'var(--brand-primary) var(theme-color)',
          size: 'calc(var(--spacing-sm, 8px) + 2px)'
        }
      ]
    ])

    const { references, buckets } = collectRefs(styles)

    expect(references).toEqual([
      {
        nodeId: 'node-1',
        property: 'color',
        code: 'var(--brand-primary)',
        name: 'brand-primary',
        value: undefined
      },
      {
        nodeId: 'node-1',
        property: 'size',
        code: 'var(--spacing-sm, 8px)',
        name: 'spacing-sm',
        value: '8px'
      }
    ])
    expect(buckets.get('node-1:color')?.matchIndices).toEqual([0])
    expect(buckets.get('node-1:size')?.matchIndices).toEqual([1])
  })

  it('preprocesses comment/scss forms before collecting variable references', () => {
    const styles = new Map<string, Record<string, string>>([
      [
        'node-1',
        {
          color: '/* theme */ $brand-primary'
        }
      ]
    ])

    const { references, buckets } = collectRefs(styles)

    expect(styles.get('node-1')?.color).toBe(' var(--brand-primary)')
    expect(references).toEqual([
      {
        nodeId: 'node-1',
        property: 'color',
        code: 'var(--brand-primary)',
        name: 'brand-primary',
        value: undefined
      }
    ])
    expect(buckets.get('node-1:color')).toEqual({
      nodeId: 'node-1',
      property: 'color',
      value: ' var(--brand-primary)',
      matchIndices: [0]
    })
  })

  it('returns empty used-name set when no variable references are found', async () => {
    const styles = new Map<string, Record<string, string>>([
      ['node-1', { color: '#fff', width: '100px' }]
    ])

    await expect(transform(styles, { config: CONFIG })).resolves.toEqual(new Set())
    expect(runTransformVariableBatch).not.toHaveBeenCalled()
  })

  it('rewrites variable expressions and returns used names from original and transformed refs', async () => {
    const styles = new Map<string, Record<string, string>>([
      [
        'node-1',
        {
          color: 'var(--brand-primary)',
          width: 'calc(var(--spacing-sm) + 2px)'
        }
      ]
    ])

    vi.mocked(runTransformVariableBatch).mockResolvedValue(['--brand-color', '12px'])

    const used = await transform(styles, { config: CONFIG, pluginCode: 'return x' })

    expect(workerUnitOptions).toHaveBeenCalledWith(CONFIG)
    expect(runTransformVariableBatch).toHaveBeenCalledWith(
      [
        { code: 'var(--brand-primary)', name: 'brand-primary', value: undefined },
        { code: 'var(--spacing-sm)', name: 'spacing-sm', value: undefined }
      ],
      { cssUnit: 'px', rootFontSize: 16, scale: 1 },
      'return x'
    )
    expect(styles.get('node-1')).toEqual({
      color: 'var(--brand-color)',
      width: 'calc(12px + 2px)'
    })
    expect(used).toEqual(new Set(['--brand-primary', '--spacing-sm', '--brand-color']))
  })

  it('skips rewrite when style bucket target no longer exists and tolerates missing transform output', async () => {
    const styles = new Map<string, Record<string, string>>([['node-1', { color: 'var(--brand)' }]])
    vi.mocked(runTransformVariableBatch).mockImplementation(async () => {
      styles.delete('node-1')
      return []
    })

    const used = await transform(styles, { config: CONFIG })

    expect(styles.has('node-1')).toBe(false)
    expect(used).toEqual(new Set(['--brand']))
  })

  it('falls back to original var expression when transform result is missing for an occurrence', async () => {
    const styles = new Map<string, Record<string, string>>([
      [
        'node-1',
        {
          color: 'var(--brand)',
          width: 'var(--space)'
        }
      ]
    ])

    vi.mocked(runTransformVariableBatch).mockResolvedValue(['--brand-next'])

    const used = await transform(styles, { config: CONFIG })

    expect(styles.get('node-1')).toEqual({
      color: 'var(--brand-next)',
      width: 'var(--space)'
    })
    expect(used).toEqual(new Set(['--brand', '--space', '--brand-next']))
  })
})
