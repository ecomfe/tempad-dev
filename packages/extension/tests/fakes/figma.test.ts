import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFixture } from './figma'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Figma authoring fixture', () => {
  it('keeps document, resource, plugin data, and current-page state local to each fixture', async () => {
    const first = createFixture()
    first.page.name = 'First document'
    first.page.setSharedPluginData('tempad_dev', 'page-key', 'first')
    const otherPage = figma.createPage()
    await figma.setCurrentPageAsync(otherPage)
    const collection = figma.variables.createVariableCollection('First tokens')
    const variable = figma.variables.createVariable('Color', collection, 'COLOR')
    const style = figma.createPaintStyle()

    const second = createFixture()
    expect(second.page).not.toBe(first.page)
    expect(second.page.name).toBe('Page 1')
    expect(second.page.getSharedPluginData('tempad_dev', 'page-key')).toBe('')
    expect(second.pages).toHaveLength(1)
    expect(second.variableCollections.has(collection.id)).toBe(false)
    expect(second.variables.has(variable.id)).toBe(false)
    expect(second.styles.has(style.id)).toBe(false)

    const firstNode = first.createNode('FRAME')
    const secondNode = second.createNode('FRAME')
    expect(firstNode.parent).toBe(otherPage)
    expect(secondNode.parent).toBe(second.page)
    expect(otherPage.children).toContain(firstNode)
    expect(second.page.children).toEqual([secondNode])
    expect(first.getNode(firstNode.id)).toBe(firstNode)
    expect(second.getNode(secondNode.id)).toBe(secondNode)
  })

  it('loads other pages without loading the initial current page', async () => {
    const fixture = createFixture()
    const other = figma.createPage()
    await figma.loadAllPagesAsync()
    expect(fixture.page.loadAsync).not.toHaveBeenCalled()
    expect(other.loadAsync).toHaveBeenCalledOnce()
  })

  it('models empty group removal without deleting same-parent reorders', () => {
    const fixture = createFixture()
    const group = fixture.createNode('GROUP')
    const child = fixture.createNode('RECTANGLE')
    group.appendChild(child)
    group.appendChild(child)
    group.insertChild(0, child)
    expect(group.removed).toBe(false)
    expect(group.children).toEqual([child])

    fixture.page.appendChild(child)
    expect(group.removed).toBe(true)
    expect(fixture.nodes.has(group.id)).toBe(false)
    expect(child.parent).toBe(fixture.page)
    expect(() => group.appendChild(child)).toThrow('Cannot reparent a removed node')

    const outer = fixture.createNode('GROUP')
    const inner = fixture.createNode('GROUP')
    const removedChild = fixture.createNode('RECTANGLE')
    inner.appendChild(removedChild)
    outer.appendChild(inner)
    removedChild.remove()
    expect(inner.removed).toBe(true)
    expect(outer.removed).toBe(true)
    expect(fixture.nodes.has(inner.id)).toBe(false)
    expect(fixture.nodes.has(outer.id)).toBe(false)
  })
})
