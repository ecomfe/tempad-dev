import { describe, expect, it } from 'vitest'

import { prune } from '@/utils/object'

describe('utils/object prune', () => {
  it('removes undefined values and empty nested objects', () => {
    const input = {
      keep: 1,
      drop: undefined,
      nested: {
        keep: 'ok',
        gone: undefined,
        empty: {
          a: undefined
        }
      }
    }

    expect(prune(input)).toEqual({
      keep: 1,
      nested: { keep: 'ok' }
    })
  })

  it('preserves arrays and keeps empty object placeholders inside arrays', () => {
    const input = {
      list: [{ a: undefined }, { a: 1, b: undefined }, [{ c: undefined }, { c: 2 }]],
      emptyObj: {
        x: undefined
      }
    }

    expect(prune(input)).toEqual({
      list: [{}, { a: 1 }, [{}, { c: 2 }]]
    })
  })

  it('returns undefined when the top-level object becomes empty', () => {
    expect(prune({ only: undefined, nested: { also: undefined } })).toBeUndefined()
  })
})
