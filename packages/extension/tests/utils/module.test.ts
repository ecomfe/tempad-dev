import { afterEach, describe, expect, it, vi } from 'vitest'

import { evaluate } from '@/utils/module'

describe('utils/module', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('evaluates code from object URL and always revokes the generated URL', async () => {
    const dataUrl = 'data:text/javascript;base64,ZXhwb3J0IGNvbnN0IGV2YWx1YXRlZCA9IDQyOw=='

    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue(dataUrl)
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    const mod = await evaluate('export const evaluated = 42;')

    expect(mod.evaluated).toBe(42)
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const [blobArg] = createObjectURL.mock.calls[0]
    expect(blobArg).toBeInstanceOf(Blob)
    if (!(blobArg instanceof Blob)) {
      throw new Error('Expected Blob payload for URL.createObjectURL.')
    }
    expect(await blobArg.text()).toBe('export const evaluated = 42;')
    expect(revokeObjectURL).toHaveBeenCalledWith(dataUrl)
  })
})
