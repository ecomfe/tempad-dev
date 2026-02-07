import { describe, expect, it } from 'vitest'

import { transformHTML } from '@/utils/dom'

describe('utils/dom transformHTML (browser)', () => {
  it('transforms template fragment and returns updated html', () => {
    const input = '<section><p data-id="a">A</p><p data-id="b">B</p></section>'

    const output = transformHTML(input, (frag) => {
      const p = frag.querySelector('p[data-id="b"]')
      if (p) {
        p.textContent = 'Renamed'
        p.setAttribute('data-checked', '1')
      }
    })

    expect(output).toContain('Renamed')
    expect(output).toContain('data-checked="1"')
  })
})
