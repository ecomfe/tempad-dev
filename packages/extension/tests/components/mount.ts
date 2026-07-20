import type { App, Component } from 'vue'

import { createApp } from 'vue'

const apps: App[] = []

export function mount(
  component: Component,
  {
    tag = 'div',
    tokens = {}
  }: {
    tag?: string
    tokens?: Record<`--${string}`, string>
  } = {}
): HTMLElement {
  const host = document.createElement(tag)
  const target = document.createElement('div')

  for (const [name, value] of Object.entries(tokens)) {
    host.style.setProperty(name, value)
  }

  host.append(target)
  document.body.append(host)
  const app = createApp(component)
  app.mount(target)
  apps.push(app)

  return host
}

export function unmountAll(): void {
  for (const app of apps.splice(0)) {
    app.unmount()
  }

  document.body.replaceChildren()
}
