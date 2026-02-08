import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
  useClipboard: vi.fn(),
  show: vi.fn(),
  useToast: vi.fn(),
  loggerError: vi.fn()
}))

vi.mock('@vueuse/core', () => ({
  useClipboard: mocks.useClipboard
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
    mocks.useClipboard.mockReturnValue({ copy: mocks.copyToClipboard })
    mocks.useToast.mockReturnValue({ show: mocks.show })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('copies explicit source and uses explicit message', () => {
    const copy = useCopy('default')

    copy('hello', 'Done')

    expect(mocks.copyToClipboard).toHaveBeenCalledWith('hello')
    expect(mocks.show).toHaveBeenCalledWith('Done')
  })

  it('resolves value from fallback content and option message getter', () => {
    const copy = useCopy('fallback-value', {
      message: () => 'Copied from options'
    })

    copy()

    expect(mocks.copyToClipboard).toHaveBeenCalledWith('fallback-value')
    expect(mocks.show).toHaveBeenCalledWith('Copied from options')
  })

  it('supports element sources via dataset, textContent, and empty fallback', () => {
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

    copy(datasetNode)
    copy(textNode)
    copy(emptyNode)

    expect(mocks.copyToClipboard).toHaveBeenNthCalledWith(1, 'from-dataset')
    expect(mocks.copyToClipboard).toHaveBeenNthCalledWith(2, 'from-text')
    expect(mocks.copyToClipboard).toHaveBeenNthCalledWith(3, '')
    expect(mocks.show).toHaveBeenNthCalledWith(1, 'Copied to clipboard')
    expect(mocks.show).toHaveBeenNthCalledWith(2, 'Copied to clipboard')
    expect(mocks.show).toHaveBeenNthCalledWith(3, 'Copied to clipboard')
  })

  it('logs errors when clipboard copy fails', () => {
    const err = new Error('copy failed')
    mocks.copyToClipboard.mockImplementationOnce(() => {
      throw err
    })

    const copy = useCopy('payload')

    copy()

    expect(mocks.loggerError).toHaveBeenCalledWith(err)
    expect(mocks.show).not.toHaveBeenCalled()
  })
})
