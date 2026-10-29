import { describe, expect, it } from 'vitest'

import { textRangesOutside, type TextRange } from '@/mcp/tools/canvas/reconcile/text-ranges'

function positions(ranges: readonly TextRange[]): number[] {
  return ranges.flatMap(({ start, end }) =>
    Array.from({ length: end - start }, (_, i) => start + i)
  )
}

describe('text range subtraction', () => {
  it('matches character ownership for ordered overlapping, adjacent and clipped overrides', () => {
    const intervals = Array.from({ length: 7 }, (_, start) =>
      Array.from({ length: 7 - start }, (_, offset) => ({ start, end: start + offset + 1 }))
    ).flat()
    for (const first of intervals) {
      for (const second of intervals) {
        if (second.start < first.start) continue
        const overrides = [first, second]
        for (const scope of [
          { start: 0, end: 7 },
          { start: 2, end: 5 }
        ]) {
          const expected = positions([scope]).filter(
            (position) => !overrides.some(({ start, end }) => start <= position && position < end)
          )
          expect(positions([...textRangesOutside(scope, overrides)])).toEqual(expected)
        }
      }
    }
  })

  it('stops reading ordered overrides after the target scope ends', () => {
    let reads = 0
    const overrides = Array.from({ length: 10_000 }, (_, index) => ({
      get start() {
        reads++
        return index + 5
      },
      end: index + 6
    }))
    expect([...textRangesOutside({ start: 1, end: 5 }, overrides)]).toEqual([{ start: 1, end: 5 }])
    expect(reads).toBe(1)
  })
})
