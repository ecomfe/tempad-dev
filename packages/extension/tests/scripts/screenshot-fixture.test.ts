import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync(
  new URL('../../screenshots/fixture-runtime.js', import.meta.url),
  'utf8'
)
const component = {
  remote: true,
  key: '1ee41f133f277b708cf54a74a6c2e294be6664fb',
  parent: { type: 'COMPONENT_SET', name: 'Button' }
}

type FixtureNode = {
  id: string
  type: string
  name: string
  marker: string
  removed: boolean
  parent: FixtureNode | null
  children: FixtureNode[]
  selection: FixtureNode[]
  mainComponent: typeof component | null
  x: number
  y: number
  width: number
  height: number
  getSharedPluginData(): string
  setSharedPluginData(namespace: string, key: string, value: string): void
  appendChild(child: FixtureNode): void
  findOne(predicate: (item: FixtureNode) => boolean): FixtureNode | null
  remove(): void
  resize(width: number, height: number): void
}

function node(type: string, name: string, marker = ''): FixtureNode {
  const value: FixtureNode = {
    id: name,
    type,
    name,
    marker,
    removed: false,
    parent: null,
    children: [],
    selection: [],
    mainComponent: type === 'INSTANCE' ? component : null,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    getSharedPluginData: () => value.marker,
    setSharedPluginData: (_namespace: string, _key: string, next: string) => {
      value.marker = next
    },
    appendChild(child) {
      if (child.parent)
        child.parent.children = child.parent.children.filter((item) => item !== child)
      child.parent = value
      value.children.push(child)
    },
    findOne(predicate) {
      for (const child of value.children) {
        if (predicate(child)) return child
        const descendant = child.findOne(predicate)
        if (descendant) return descendant
      }
      return null
    },
    remove() {
      for (const child of [...value.children]) child.remove()
      value.removed = true
      if (value.parent)
        value.parent.children = value.parent.children.filter((child) => child !== value)
    },
    resize(width: number, height: number) {
      value.width = width
      value.height = height
    }
  }
  return value
}

function scene(pages: [FixtureNode, ...FixtureNode[]]) {
  const figma = {
    root: { children: pages },
    currentPage: pages[0],
    createPage: vi.fn(() => {
      const page = node('PAGE', 'New page')
      pages.push(page)
      return page
    }),
    createFrame: vi.fn(() => {
      const frame = node('FRAME', 'Frame')
      figma.currentPage.appendChild(frame)
      return frame
    }),
    viewport: { scrollAndZoomIntoView: vi.fn() }
  }
  return { figma, run: () => runInNewContext(source, { figma }) as Promise<unknown> }
}

describe('marketing fixture preservation', () => {
  it('rejects a missing real button before selecting, renaming, or creating a page', async () => {
    const original = node('PAGE', 'Original')
    const fixturePage = node('PAGE', 'README Fixtures')
    const impostor = node('INSTANCE', 'Other button', 'plugins')
    fixturePage.appendChild(impostor)
    const { figma, run } = scene([original, fixturePage])

    await expect(run()).rejects.toThrow('real remote Kong Button')
    expect(figma.currentPage).toBe(original)
    expect(figma.createPage).not.toHaveBeenCalled()
    expect(figma.createFrame).not.toHaveBeenCalled()
    expect(impostor.removed).toBe(false)
    expect(impostor.x).toBe(0)

    const missing = scene([original])
    await expect(missing.run()).rejects.toThrow('real remote Kong Button')
    expect(missing.figma.createPage).not.toHaveBeenCalled()
    expect(original.name).toBe('Original')
  })

  it('ignores an obsolete marker and uses the verified remote instance', async () => {
    const page = node('PAGE', 'README Fixtures')
    const impostor = node('INSTANCE', 'Button', 'plugins')
    impostor.mainComponent = { ...component, key: 'another-component' }
    const button = node('INSTANCE', 'Button')
    page.appendChild(impostor)
    page.appendChild(button)
    await scene([page]).run()
    expect(impostor.removed).toBe(true)
    expect(button.marker).toBe('plugins')
    expect(button.x).toBe(6000)
    expect(button.removed).toBe(false)
  })

  it('preserves a verified button inside geometry that is being replaced', async () => {
    const page = node('PAGE', 'Existing fixtures')
    const oldFrame = node('FRAME', 'Old fixture', 'code')
    const button = node('INSTANCE', 'Button', 'plugins')
    const unowned = node('FRAME', 'User content')
    oldFrame.appendChild(button)
    page.appendChild(oldFrame)
    page.appendChild(unowned)
    await scene([page]).run()
    expect(page.name).toBe('README Fixtures')
    expect(oldFrame.removed).toBe(true)
    expect(button.removed).toBe(false)
    expect(button.parent).toBe(page)
    expect(button.x).toBe(6000)
    expect(unowned.removed).toBe(false)
  })
})
