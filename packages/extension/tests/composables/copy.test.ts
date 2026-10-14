import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
  show: vi.fn(),
  useToast: vi.fn(),
  loggerError: vi.fn()
}))

vi.mock('@/composables', () => ({
  useToast: mocks.useToast
}))

vi.mock('@/utils/log', () => ({
  logger: {
    error: mocks.loggerError
  }
}))

import { useCopy } from '@/composables/copy'

describe('composables/copy', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { clipboard: { writeText: mocks.copyToClipboard } })
    mocks.useToast.mockReturnValue({ show: mocks.show })
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('copies explicit source and uses explicit message', async () => {
    const copy = useCopy('default')

    await copy('hello', 'Done')

    expect(mocks.copyToClipboard).toHaveBeenCalledWith('hello')
    expect(mocks.show).toHaveBeenCalledWith('Done')
  })

  it('resolves value from fallback content and option message getter', async () => {
    const copy = useCopy('fallback-value', {
      message: () => 'Copied from options'
    })

    await copy()

    expect(mocks.copyToClipboard).toHaveBeenCalledWith('fallback-value')
    expect(mocks.show).toHaveBeenCalledWith('Copied from options')
  })

  it('supports element sources via dataset, textContent, and empty fallback', async () => {
    const copy = useCopy()

    const datasetNode = {
      dataset: { copy: 'from-dataset' },
      textContent: 'ignored'
    } as unknown as HTMLElement

    const textNode = {
      dataset: {},
      textContent: 'from-text'
    } as unknown as HTMLElement

    const emptyNode = {
      dataset: {},
      textContent: null
    } as unknown as HTMLElement

    await copy(datasetNode)
    await copy(textNode)
    await copy(emptyNode)

    expect(mocks.copyToClipboard).toHaveBeenNthCalledWith(1, 'from-dataset')
    expect(mocks.copyToClipboard).toHaveBeenNthCalledWith(2, 'from-text')
    expect(mocks.copyToClipboard).toHaveBeenNthCalledWith(3, '')
    expect(mocks.show).toHaveBeenNthCalledWith(1, 'Copied to clipboard')
    expect(mocks.show).toHaveBeenNthCalledWith(2, 'Copied to clipboard')
    expect(mocks.show).toHaveBeenNthCalledWith(3, 'Copied to clipboard')
  })
})
