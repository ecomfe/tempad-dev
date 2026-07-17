import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import selectSource from '@/components/Select.vue?raw'

function mountSelect(): HTMLSelectElement {
  const css = selectSource
    .match(/<style scoped>([\s\S]+)<\/style>/)?.[1]
    ?.replaceAll('v-bind(anchorName)', '--tp-select-test-anchor')
    .replace('v-bind(selectedIndex)', '5')

  if (!css) throw new Error('Select styles not found')

  const style = document.createElement('style')
  style.textContent = css

  const host = document.createElement('div')
  host.style.cssText = [
    'position: absolute',
    'top: 200px',
    'left: 200px',
    '--spacer-1: 4px',
    '--spacer-2: 8px',
    '--spacer-4: 32px',
    '--radius-medium: 4px',
    '--radius-large: 6px',
    '--color-border: #ddd',
    '--color-bg: #fff',
    '--color-bg-menu: #fff',
    '--color-text: #222',
    '--color-text-menu: #222',
    '--tp-select-trigger-padding-left: 30px'
  ].join(';')
  host.innerHTML = `
    <select class="tp-select" aria-label="Agent">
      <button type="button" class="tp-select-trigger">
        <span class="tp-select-value"><selectedcontent class="tp-select-selected"></selectedcontent></span>
      </button>
      <option class="tp-select-option" value="a">Alpha</option>
      <option class="tp-select-option" value="b">Beta</option>
      <option class="tp-select-option" value="c">Gamma</option>
      <option class="tp-select-option" value="d">Delta</option>
      <option class="tp-select-option" value="e">Epsilon</option>
      <option class="tp-select-option" value="f" selected>Zeta</option>
    </select>
  `

  document.body.append(style, host)
  return host.querySelector('select') as HTMLSelectElement
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('Select', () => {
  it('keeps the selected option aligned when trigger content has custom padding', async () => {
    expect(CSS.supports('appearance', 'base-select')).toBe(true)
    const select = mountSelect()

    await page.getByRole('combobox', { name: 'Agent' }).click()

    const controlRect = select.getBoundingClientRect()
    const selectedRect = select.selectedOptions[0].getBoundingClientRect()

    expect(Math.abs(selectedRect.top - controlRect.top)).toBeLessThanOrEqual(1)
    expect(Math.abs(selectedRect.left - controlRect.left)).toBeLessThanOrEqual(2)
  })
})
