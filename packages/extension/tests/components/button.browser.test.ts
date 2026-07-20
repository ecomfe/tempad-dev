import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'

import Button from '@/components/Button.vue'

import { mount, unmountAll } from './mount'

function mountButtons(): HTMLElement {
  return mount(
    defineComponent(
      () => () =>
        h('div', [
          h(Button, { variant: 'primary' }, () => 'Done'),
          h(Button, { variant: 'secondary' }, () => 'Copy command')
        ])
    ),
    {
      tag: 'tempad',
      tokens: {
        '--spacer-1': '4px',
        '--spacer-2': '8px',
        '--spacer-4': '24px',
        '--radius-medium': '5px',
        '--color-bg': 'rgb(255, 255, 255)',
        '--color-bg-brand': 'rgb(13, 153, 255)',
        '--color-border': 'rgb(230, 230, 230)',
        '--color-text': 'rgb(0, 0, 0)',
        '--color-text-onbrand': 'rgb(255, 255, 255)',
        '--text-body-medium-font-family': 'Inter, sans-serif',
        '--text-body-medium-font-size': '11px',
        '--text-body-medium-font-weight': '450',
        '--text-body-medium-letter-spacing': '0.055px',
        '--text-body-medium-line-height': '16px'
      }
    }
  )
}

afterEach(unmountAll)

describe('Button', () => {
  it('renders primary and secondary variants with the Figma tokens', () => {
    const host = mountButtons()
    const primary = host.querySelector<HTMLElement>('.tp-action-button-primary')
    const secondary = host.querySelector<HTMLElement>('.tp-action-button-secondary')

    expect(primary).not.toBeNull()
    expect(secondary).not.toBeNull()

    const primaryStyle = getComputedStyle(primary!)
    const secondaryStyle = getComputedStyle(secondary!)

    expect(primaryStyle.height).toBe('24px')
    expect(primaryStyle.borderRadius).toBe('5px')
    expect(primaryStyle.backgroundColor).toBe('rgb(13, 153, 255)')
    expect(primaryStyle.color).toBe('rgb(255, 255, 255)')
    expect(primaryStyle.fontWeight).toBe('450')
    expect(primaryStyle.lineHeight).toBe('16px')
    expect(secondaryStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(secondaryStyle.outlineColor).toBe('rgb(230, 230, 230)')
    expect(secondaryStyle.boxShadow).toBe('none')
  })
})
