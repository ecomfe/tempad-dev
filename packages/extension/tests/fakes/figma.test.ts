import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFixture } from './figma'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Figma authoring fixture', () => {
  it.each(['fontSize', 'lineHeight', 'letterSpacing'] as const)(
    'propagates direct %s aliases to one newline without widening TextStyle scope',
    async (field) => {
      const fixture = createFixture()
      const text = fixture.createNode('TEXT') as TextNode
      text.characters = 'A\n\nB'
      const base = fixture.variables.get('variable:spacing')!
      const local = fixture.variables.get('variable:range-size')!
      text.setBoundVariable(field, base)
      text.setRangeBoundVariable(0, 1, field, local)
      expect(text.getRangeBoundVariable(0, 1, field)).toMatchObject({ id: local.id })
      expect(text.getRangeBoundVariable(0, 2, field)).toMatchObject({ id: local.id })
      expect(text.getRangeBoundVariable(1, 2, field)).toMatchObject({ id: local.id })
      expect(text.getRangeBoundVariable(2, 3, field)).toMatchObject({ id: base.id })
      text.setRangeBoundVariable(0, 1, field, null)
      expect(text.getRangeBoundVariable(0, 2, field)).toBeNull()
      expect(text.getRangeBoundVariable(2, 3, field)).toMatchObject({ id: base.id })
      const style = fixture.styles.get('style:text') as TextStyle
      Object.assign(style, {
        boundVariables: { [field]: { type: 'VARIABLE_ALIAS', id: local.id } }
      })
      await text.setRangeTextStyleIdAsync(0, 1, style.id)
      expect(text.getRangeBoundVariable(0, 1, field)).toMatchObject({ id: local.id })
      expect(text.getRangeBoundVariable(1, 2, field)).toBeNull()
      expect(text.getRangeBoundVariable(0, 2, field)).toBe(figma.mixed)
    }
  )

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

  it('resolves range-style bindings from their owning fixture after another fixture starts', async () => {
    const first = createFixture()
    const text = first.createNode('TEXT') as TextNode
    text.characters = 'Owner'
    const style = first.styles.get('style:text') as TextStyle
    const variable = first.variables.get('variable:range-size')!
    Object.assign(style, {
      boundVariables: { fontSize: { type: 'VARIABLE_ALIAS', id: variable.id } }
    })

    const second = createFixture()
    second.variables.set(variable.id, {
      ...variable,
      resolveForConsumer: () => ({ value: 99, resolvedType: 'FLOAT' })
    } as Variable)
    const foreignLookup = vi.mocked(figma.variables.getVariableByIdAsync)

    await text.setRangeTextStyleIdAsync(0, text.characters.length, style.id)

    expect(text.getRangeFontSize(0, text.characters.length)).toBe(18)
    expect(text.getRangeBoundVariable(0, text.characters.length, 'fontSize')).toEqual({
      type: 'VARIABLE_ALIAS',
      id: variable.id
    })
    expect(foreignLookup).not.toHaveBeenCalled()
  })

  it('stores and deletes shared metadata consistently for pages, nodes, and resources', () => {
    const fixture = createFixture()
    const collection = figma.variables.createVariableCollection('Tokens')
    const objects: PluginDataMixin[] = [
      fixture.page,
      fixture.createNode('FRAME'),
      figma.createTextStyle(),
      collection,
      figma.variables.createVariable('Spacing', collection, 'FLOAT')
    ]
    for (const object of objects) {
      object.setSharedPluginData('tempad_dev', 'key', 'retained')
      object.setSharedPluginData('tempad_dev', 'custom:key', 'removed')
      object.setSharedPluginData('tempad_dev_extra', 'key', 'separate')
      expect(object.getSharedPluginDataKeys('tempad_dev').sort()).toEqual(['custom:key', 'key'])
      expect(object.getSharedPluginDataKeys('tempad_dev_extra')).toEqual(['key'])

      object.setSharedPluginData('tempad_dev', 'custom:key', '')
      expect(object.getSharedPluginData('tempad_dev', 'custom:key')).toBe('')
      expect(object.getSharedPluginDataKeys('tempad_dev')).toEqual(['key'])
      expect(object.getSharedPluginData('tempad_dev_extra', 'key')).toBe('separate')
    }
    for (const object of objects) {
      expect(() => object.getSharedPluginDataKeys('invalid:namespace')).toThrow('namespace')
    }
    const copy = (objects[1] as FrameNode).clone()
    expect(copy.getSharedPluginDataKeys('tempad_dev')).toEqual(['key'])
    expect(copy.getSharedPluginData('tempad_dev', 'key')).toBe('retained')
    copy.setSharedPluginData('tempad_dev', 'key', '')
    expect(objects[1]!.getSharedPluginData('tempad_dev', 'key')).toBe('retained')
  })

  it('stores opted-in native scalars at float32 precision from creation', () => {
    const fixture = createFixture({ float32: ['opacity', 'width', 'height'] })
    const node = fixture.createNode('FRAME')
    node.opacity = 0.3
    node.resize(100.1, 40.3)
    expect(node).toMatchObject({
      opacity: Math.fround(0.3),
      width: Math.fround(100.1),
      height: Math.fround(40.3)
    })
    const ordinary = createFixture().createNode('FRAME')
    ordinary.opacity = 0.3
    ordinary.resize(100.1, 40.3)
    expect(ordinary).toMatchObject({ opacity: 0.3, width: 100.1, height: 40.3 })
  })

  it('clones ordinary subtrees with independent native state and copied shared plugin data', () => {
    const fixture = createFixture({ float32: ['opacity', 'width', 'height'] })
    const source = fixture.createNode('FRAME') as FrameNode
    const group = fixture.createNode('GROUP') as GroupNode
    const leaf = fixture.createNode('RECTANGLE') as RectangleNode
    source.appendChild(group)
    group.appendChild(leaf)
    source.name = 'Source'
    source.opacity = 0.3
    source.resize(100.1, 40.3)
    source.rotation = 30
    source.x = 12
    source.y = 24
    source.itemSpacing = 8
    source.counterAxisSpacing = null
    source.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]
    source.fillStyleId = 'style:fill'
    const variable = fixture.variables.get('variable:spacing')!
    const collection = fixture.variableCollections.get('collection:tokens')!
    source.setBoundVariable('opacity', variable)
    source.setExplicitVariableModeForCollection(collection, 'mode:dark')
    for (const node of [source, group, leaf]) {
      node.setSharedPluginData('tempad_dev', 'canvas-key', node.name || node.type)
      node.setSharedPluginData('tempad_dev', 'canvas-owner', node.id)
      node.setSharedPluginData('another_plugin', 'custom:key', `metadata:${node.id}`)
    }

    const copy = source.clone()
    const copiedGroup = copy.children[0] as GroupNode
    const copiedLeaf = copiedGroup.children[0] as RectangleNode
    expect(copy.parent).toBe(fixture.page)
    for (const [original, cloned] of [
      [source, copy],
      [group, copiedGroup],
      [leaf, copiedLeaf]
    ] as const) {
      expect(cloned.id).not.toBe(original.id)
      expect(fixture.getNode(cloned.id)).toBe(cloned)
      expect(cloned.getSharedPluginData('tempad_dev', 'canvas-key')).toBe(
        original.getSharedPluginData('tempad_dev', 'canvas-key')
      )
      expect(cloned.getSharedPluginData('tempad_dev', 'canvas-owner')).toBe(original.id)
      expect(cloned.getSharedPluginData('another_plugin', 'custom:key')).toBe(
        `metadata:${original.id}`
      )
    }
    expect(copy).toMatchObject({
      name: 'Source',
      opacity: Math.fround(0.3),
      width: Math.fround(100.1),
      height: Math.fround(40.3),
      fillStyleId: 'style:fill'
    })
    expect(copy.relativeTransform).toEqual(source.relativeTransform)
    expect(copy.relativeTransform).not.toBe(source.relativeTransform)
    expect(copy.fills).toEqual(source.fills)
    expect(copy.fills).not.toBe(source.fills)
    expect(copy.boundVariables).toEqual(source.boundVariables)
    expect(copy.explicitVariableModes).toEqual(source.explicitVariableModes)

    copy.resize(200.1, 80.3)
    copy.itemSpacing = 16
    expect(copy.counterAxisSpacing).toBe(16)
    expect(source.counterAxisSpacing).toBe(8)
    copy.setBoundVariable('opacity', null)
    copy.clearExplicitVariableModeForCollection(collection)
    copy.setSharedPluginData('tempad_dev', 'canvas-owner', copy.id)
    expect(copy.boundVariables?.opacity).toBeUndefined()
    expect(copy.explicitVariableModes).toEqual({})
    expect(source.width).toBe(Math.fround(100.1))
    expect(source.boundVariables?.opacity).toEqual({ type: 'VARIABLE_ALIAS', id: variable.id })
    expect(source.explicitVariableModes).toEqual({ 'collection:tokens': 'mode:dark' })
    expect(source.getSharedPluginData('tempad_dev', 'canvas-owner')).toBe(source.id)
    copiedLeaf.remove()
    expect(copiedGroup.removed).toBe(true)
    expect(group.removed).toBe(false)
    expect(group.children).toEqual([leaf])
    copy.remove()
    expect(source.removed).toBe(false)
    expect(fixture.nodes.has(source.id)).toBe(true)
  })

  it('rejects unsupported clone descendants before creating any nodes', () => {
    const fixture = createFixture()
    const source = fixture.createNode('FRAME') as FrameNode
    source.appendChild(fixture.createNode('TEXT'))
    const ids = [...fixture.nodes.keys()]
    const children = [...fixture.page.children]
    expect(() => source.clone()).toThrow('Unsupported mock clone: TEXT')
    expect([...fixture.nodes.keys()]).toEqual(ids)
    expect(fixture.page.children).toEqual(children)
    source.remove()
    expect(() => source.clone()).toThrow('Cannot clone a removed node')
  })

  it.each(['locked aspect ratio', 'grid tracks'] as const)(
    'rejects unsupported %s clone state without a partial copy',
    (state) => {
      const fixture = createFixture()
      const source = fixture.createNode('FRAME') as FrameNode
      const child = fixture.createNode('FRAME') as FrameNode
      source.appendChild(child)
      if (state === 'locked aspect ratio') child.lockAspectRatio()
      else child.layoutMode = 'GRID'
      const ids = [...fixture.nodes.keys()]
      expect(() => source.clone()).toThrow(`Unsupported mock clone: ${state}`)
      expect([...fixture.nodes.keys()]).toEqual(ids)
      expect(fixture.page.children).toEqual([source])
    }
  )

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
