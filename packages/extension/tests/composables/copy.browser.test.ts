import { afterEach, expect, it, vi } from 'vitest'

const show = vi.hoisted(() => vi.fn())
vi.mock('@/composables', () => ({ useToast: () => ({ show }) }))

import { useCopy } from '@/composables/copy'

afterEach(() => {
  vi.restoreAllMocks()
  show.mockClear()
})

it('reports failure when both browser clipboard mechanisms reject the copy', async () => {
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
  vi.spyOn(document, 'execCommand').mockReturnValue(false)
  await useCopy('payload')()
  expect(show).toHaveBeenCalledExactlyOnceWith('Could not copy to clipboard. Please try again.')
})

it('uses a successful fallback without losing the current editor focus or selection', async () => {
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
  const editor = document.createElement('textarea')
  editor.value = 'Keep this draft'
  document.body.append(editor)
  editor.focus()
  editor.setSelectionRange(2, 6)
  const fallback = vi.spyOn(document, 'execCommand').mockImplementation(() => {
    expect((document.activeElement as HTMLTextAreaElement).value).toBe('payload')
    return true
  })
  try {
    await useCopy('payload')()
    expect(fallback).toHaveBeenCalledWith('copy')
    expect(document.activeElement).toBe(editor)
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 6])
    expect(show).toHaveBeenCalledExactlyOnceWith('Copied to clipboard')
    expect(document.querySelectorAll('textarea')).toHaveLength(1)
  } finally {
    editor.remove()
  }
})
