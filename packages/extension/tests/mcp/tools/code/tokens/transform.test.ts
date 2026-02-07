import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CodegenConfig } from '@/utils/codegen'

import { runTransformVariableBatch } from '@/mcp/transform-variables/requester'
import { logger } from '@/utils/log'

import { applyPluginTransformToNames } from '../../../../../mcp/tools/code/tokens/transform'

vi.mock('@/mcp/transform-variables/requester', () => ({
  runTransformVariableBatch: vi.fn()
}))

vi.mock('@/utils/log', () => ({
  logger: {
    warn: vi.fn()
  }
}))

const CONFIG: CodegenConfig = {
  cssUnit: 'px',
  rootFontSize: 16,
  scale: 1
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('tokens/transform applyPluginTransformToNames', () => {
  it('returns empty maps for empty used name set', async () => {
    const result = await applyPluginTransformToNames(new Set(), new Map(), undefined, CONFIG)

    expect(result.rewriteMap.size).toBe(0)
    expect(result.finalBridge.size).toBe(0)
    expect(runTransformVariableBatch).not.toHaveBeenCalled()
  })

  it('builds bridge directly when plugin transform is disabled', async () => {
    const result = await applyPluginTransformToNames(
      new Set(['--color-primary', '--missing']),
      new Map([
        ['--color-primary', 'var-1'],
        ['--spacing-2', 'var-2']
      ]),
      undefined,
      CONFIG
    )

    expect(result.rewriteMap.size).toBe(0)
    expect(result.finalBridge).toEqual(new Map([['--color-primary', 'var-1']]))
    expect(runTransformVariableBatch).not.toHaveBeenCalled()
  })

  it('applies plugin rename results and keeps id bridge based on source index', async () => {
    vi.mocked(runTransformVariableBatch).mockResolvedValue(['--brand-color', '@Space Large'])

    const result = await applyPluginTransformToNames(
      new Set(['--color-primary', '--spacing-2', 'plainName']),
      new Map([
        ['--color-primary', 'var-1'],
        ['--spacing-2', 'var-2'],
        ['plainName', 'var-3']
      ]),
      'plugin-code',
      CONFIG
    )

    expect(runTransformVariableBatch).toHaveBeenCalledTimes(1)
    expect(result.rewriteMap).toEqual(
      new Map([
        ['--color-primary', '--brand-color'],
        ['--spacing-2', '--Space-Large']
      ])
    )
    expect(result.finalBridge).toEqual(
      new Map([
        ['--brand-color', 'var-1'],
        ['--Space-Large', 'var-2'],
        ['plainName', 'var-3']
      ])
    )
  })

  it('falls back to original name when transform output is invalid', async () => {
    vi.mocked(runTransformVariableBatch).mockResolvedValue(['<script>alert(1)</script>'])

    const result = await applyPluginTransformToNames(
      new Set(['--color-primary']),
      new Map([['--color-primary', 'var-1']]),
      'plugin-code',
      CONFIG
    )

    expect(result.rewriteMap.size).toBe(0)
    expect(result.finalBridge).toEqual(new Map([['--color-primary', 'var-1']]))
    expect(logger.warn).toHaveBeenCalledWith(
      'transformVariable returned non-variable output; using fallback name.'
    )
  })

  it('keeps original name when transform output is empty', async () => {
    vi.mocked(runTransformVariableBatch).mockResolvedValue(['   '])

    const result = await applyPluginTransformToNames(
      new Set(['--color-primary']),
      new Map([['--color-primary', 'var-1']]),
      'plugin-code',
      CONFIG
    )

    expect(result.rewriteMap.size).toBe(0)
    expect(result.finalBridge).toEqual(new Map([['--color-primary', 'var-1']]))
  })

  it('skips transform batch when there are no custom property names', async () => {
    const result = await applyPluginTransformToNames(
      new Set(['plainName']),
      new Map([['plainName', 'var-3']]),
      'plugin-code',
      CONFIG
    )

    expect(runTransformVariableBatch).not.toHaveBeenCalled()
    expect(result.rewriteMap.size).toBe(0)
    expect(result.finalBridge).toEqual(new Map([['plainName', 'var-3']]))
  })

  it('skips bridge entries when source index has no id for original or rewritten name', async () => {
    vi.mocked(runTransformVariableBatch).mockResolvedValue(['--rewritten'])

    const result = await applyPluginTransformToNames(
      new Set(['--unknown']),
      new Map(),
      'plugin-code',
      CONFIG
    )

    expect(result.rewriteMap).toEqual(new Map([['--unknown', '--rewritten']]))
    expect(result.finalBridge.size).toBe(0)
  })

  it('warns and drops conflicting bridge entries after rename collisions', async () => {
    vi.mocked(runTransformVariableBatch).mockResolvedValue(['--token', '--token'])

    const result = await applyPluginTransformToNames(
      new Set(['--a', '--b']),
      new Map([
        ['--a', 'var-1'],
        ['--b', 'var-2']
      ]),
      'plugin-code',
      CONFIG
    )

    expect(result.rewriteMap).toEqual(
      new Map([
        ['--a', '--token'],
        ['--b', '--token']
      ])
    )
    expect(result.finalBridge).toEqual(new Map([['--token', 'var-1']]))
    expect(logger.warn).toHaveBeenCalledWith(
      'Duplicate token name resolved to multiple ids:',
      '--token'
    )
  })
})
