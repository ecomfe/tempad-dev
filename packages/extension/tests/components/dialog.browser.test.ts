import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref, type Ref } from 'vue'

import Button from '@/components/Button.vue'
import Dialog from '@/components/Dialog.vue'

import { mount, unmountAll } from './mount'

const tokens = {
  '--spacer-1': '4px',
  '--spacer-2': '8px',
  '--spacer-3': '16px',
  '--spacer-4': '24px',
  '--spacer-6': '40px',
  '--radius-large': '13px',
  '--color-bg': 'rgb(255, 255, 255)',
  '--color-border': 'rgb(230, 230, 230)',
  '--color-text': 'rgb(0, 0, 0)',
  '--elevation-500':
    '0 2px 5px rgba(0, 0, 0, 0.15), 0 10px 24px rgba(0, 0, 0, 0.18), 0 0 0.5px rgba(0, 0, 0, 0.08)',
  '--text-body-medium-strong-font-family': 'Inter, sans-serif',
  '--text-body-medium-strong-font-size': '11px',
  '--text-body-medium-strong-font-weight': '550',
  '--text-body-medium-strong-letter-spacing': '0.055px',
  '--text-body-medium-strong-line-height': '16px'
} as const

function mountDialog(open: Ref<boolean>): HTMLElement {
  return mount(
    defineComponent(
      () => () =>
        h(
          Dialog,
          {
            modelValue: open.value,
            'onUpdate:modelValue': (value: boolean) => (open.value = value),
            title: 'Set up agents'
          },
          {
            default: () => h('button', 'Dialog action'),
            footer: ({ close }: { close: () => void }) =>
              h(Button, { onClick: close }, () => 'Done')
          }
        )
    ),
    { tag: 'tempad', tokens }
  )
}

afterEach(unmountAll)

describe('Dialog', () => {
  it('renders the component with the Figma modal geometry and overlay treatment', async () => {
    const host = mountDialog(ref(true))
    await nextTick()

    const overlay = host.querySelector<HTMLElement>('.tp-dialog-overlay')
    const panel = host.querySelector<HTMLElement>('[role="dialog"]')
    const title = host.querySelector<HTMLElement>('h2')

    expect(overlay).not.toBeNull()
    expect(panel).not.toBeNull()
    expect(title).not.toBeNull()
    expect(panel!.getAttribute('aria-labelledby')).toMatch(/^tp-dialog-title-/)
    expect(panel!.getBoundingClientRect()).toMatchObject({
      width: Math.min(600, window.innerWidth - 32),
      height: 480
    })

    const panelStyle = getComputedStyle(panel!)
    expect(panelStyle.borderRadius).toBe('13px')
    expect(panelStyle.gridTemplateRows).toBe('40px 400px 40px')
    expect(panelStyle.overflow).toBe('hidden')
    expect(panelStyle.boxShadow).toContain('rgba(0, 0, 0, 0.15) 0px 2px 5px')
    expect(getComputedStyle(overlay!).backgroundColor).toBe('rgba(0, 0, 0, 0.5)')

    const titleStyle = getComputedStyle(title!)
    expect(titleStyle.fontSize).toBe('11px')
    expect(titleStyle.fontWeight).toBe('550')
    expect(titleStyle.lineHeight).toBe('16px')
  })

  it('closes on Escape and restores the previous focus', async () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'Open dialog'
    document.body.append(trigger)
    trigger.focus()

    const open = ref(true)
    const host = mountDialog(open)
    await nextTick()

    expect(document.activeElement).toBe(host.querySelector('[role="dialog"]'))

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()

    expect(open.value).toBe(false)
    expect(document.activeElement).toBe(trigger)
  })

  it('wraps keyboard focus within the dialog', async () => {
    const host = mountDialog(ref(true))
    await nextTick()

    const panel = host.querySelector<HTMLElement>('[role="dialog"]')
    const buttons = Array.from(panel!.querySelectorAll<HTMLButtonElement>('button'))
    const first = buttons[0]
    const last = buttons.at(-1)

    expect(first).toBeDefined()
    expect(last).toBeDefined()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }))
    expect(document.activeElement).toBe(last)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
    expect(document.activeElement).toBe(first)
  })
})
