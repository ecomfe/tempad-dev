/* global figma, window, document, MouseEvent */

;(async () => {
  const namespace = 'tempad_dev'
  const key = 'readme_shot'
  const kongButtonComponentKey = '1ee41f133f277b708cf54a74a6c2e294be6664fb'
  const markerOf = (node) => node.getSharedPluginData(namespace, key)
  const isKongButton = (node) => {
    if (node.type !== 'INSTANCE' || node.name !== 'Button') return false

    try {
      const component = node.mainComponent
      return Boolean(
        component?.remote &&
        component.key === kongButtonComponentKey &&
        component.parent?.type === 'COMPONENT_SET' &&
        component.parent.name === 'Button'
      )
    } catch {
      return false
    }
  }

  let page = figma.root.children.find(
    (node) => node.type === 'PAGE' && node.name === 'README Fixtures'
  )

  if (!page) {
    page = figma.root.children.find(
      (node) => node.type === 'PAGE' && node.findOne(isKongButton) !== null
    )

    if (page) {
      page.name = 'README Fixtures'
    } else {
      page = figma.createPage()
      page.name = 'README Fixtures'
    }
  }

  figma.currentPage = page

  const markedPluginFixture = page.findOne(
    (node) => markerOf(node) === 'plugins' && node.type === 'INSTANCE'
  )
  const selectedKongButton = page.selection.find(isKongButton)
  const kongButton = page.findOne(isKongButton)
  const button = markedPluginFixture ?? selectedKongButton ?? kongButton

  if (!button || button.type !== 'INSTANCE') {
    throw new Error(
      'A real remote Kong Button instance is required on README Fixtures before running this script'
    )
  }

  const managedTopLevelMarkers = new Set(['code', 'deep_outer', 'measure_outer', 'plugins'])
  for (const child of [...page.children]) {
    if (child !== button && managedTopLevelMarkers.has(markerOf(child))) {
      child.remove()
    }
  }

  const mark = (node, id) => node.setSharedPluginData(namespace, key, id)
  const solid = (r, g, b) => [{ type: 'SOLID', color: { r, g, b } }]

  function createFrame({ id, name, x, y, width, height, fills }) {
    const node = figma.createFrame()
    mark(node, id)
    node.name = name
    node.x = x
    node.y = y
    node.resize(width, height)
    node.layoutMode = 'NONE'
    node.fills = fills
    node.strokes = []
    node.cornerRadius = 0
    node.clipsContent = true
    return node
  }

  const code = createFrame({
    id: 'code',
    name: 'Frame 1',
    x: 0,
    y: 0,
    width: 120,
    height: 80,
    fills: solid(1, 1, 1)
  })

  const deepOuter = createFrame({
    id: 'deep_outer',
    name: 'Frame 1',
    x: 2000,
    y: 0,
    width: 180,
    height: 120,
    fills: solid(0.87, 0.87, 0.87)
  })
  const deepInner = createFrame({
    id: 'deep_inner',
    name: 'Inner',
    x: 20,
    y: 20,
    width: 140,
    height: 80,
    fills: solid(1, 1, 1)
  })
  deepOuter.appendChild(deepInner)

  const measureOuter = createFrame({
    id: 'measure_outer',
    name: 'Frame 3',
    x: 4000,
    y: 0,
    width: 180,
    height: 120,
    fills: solid(0.87, 0.87, 0.87)
  })
  const measureInner = createFrame({
    id: 'measure_inner',
    name: 'Frame 2',
    x: 20,
    y: 20,
    width: 140,
    height: 80,
    fills: solid(1, 1, 1)
  })
  measureOuter.appendChild(measureInner)

  mark(button, 'plugins')
  button.x = 6000
  button.y = 0

  figma.currentPage.selection = [code]
  figma.viewport.scrollAndZoomIntoView([code])

  const findFixture = (marker) => {
    const node = page.findOne(
      (candidate) => candidate.getSharedPluginData(namespace, key) === marker
    )

    if (!node || !('absoluteBoundingBox' in node) || !node.absoluteBoundingBox) {
      throw new Error(`README fixture not found: ${marker}`)
    }

    return node
  }

  const describeFixture = (node) => ({
    id: node.id,
    marker: node.getSharedPluginData(namespace, key),
    name: node.name,
    type: node.type
  })

  const screenBounds = (node) => {
    const box = node.absoluteBoundingBox
    const bounds = figma.viewport.bounds
    const zoom = figma.viewport.zoom

    return {
      x: (box.x - bounds.x) * zoom,
      y: (box.y - bounds.y) * zoom,
      width: box.width * zoom,
      height: box.height * zoom
    }
  }

  const setCanvasTheme = (theme) => {
    const themes = {
      dark: {
        background: { r: 0, g: 0, b: 0 },
        outer: { r: 85 / 255, g: 85 / 255, b: 85 / 255 },
        surface: { r: 51 / 255, g: 51 / 255, b: 51 / 255 }
      },
      light: {
        background: { r: 245 / 255, g: 245 / 255, b: 245 / 255 },
        outer: { r: 0.87, g: 0.87, b: 0.87 },
        surface: { r: 1, g: 1, b: 1 }
      }
    }
    const colors = themes[theme]

    if (!colors) {
      throw new Error(`Unknown README screenshot theme: ${theme}`)
    }

    page.backgrounds = solid(colors.background.r, colors.background.g, colors.background.b)
    code.fills = solid(colors.surface.r, colors.surface.g, colors.surface.b)
    deepOuter.fills = solid(colors.outer.r, colors.outer.g, colors.outer.b)
    deepInner.fills = solid(colors.surface.r, colors.surface.g, colors.surface.b)
    measureOuter.fills = solid(colors.outer.r, colors.outer.g, colors.outer.b)
    measureInner.fills = solid(colors.surface.r, colors.surface.g, colors.surface.b)
    return page.backgrounds
  }

  const stage = ({ focus, selection = [], theme, x = 392, y = 151, zoom = 1 }) => {
    const focusNode = findFixture(focus)
    const selectionNodes = selection.map(findFixture)

    figma.currentPage = page
    if (theme) setCanvasTheme(theme)
    figma.currentPage.selection = selectionNodes
    figma.viewport.zoom = zoom
    figma.viewport.center = {
      x: focusNode.absoluteBoundingBox.x + (window.innerWidth / 2 - x) / zoom,
      y: focusNode.absoluteBoundingBox.y + (window.innerHeight / 2 - y) / zoom
    }

    document
      .querySelector('#fullscreen-root .gpu-view-content canvas')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    return {
      focus: describeFixture(focusNode),
      selection: selectionNodes.map(describeFixture),
      fixtures: Object.fromEntries(
        [focusNode, ...selectionNodes].map((node) => [
          node.getSharedPluginData(namespace, key),
          screenBounds(node)
        ])
      ),
      viewport: {
        bounds: figma.viewport.bounds,
        center: figma.viewport.center,
        zoom: figma.viewport.zoom
      }
    }
  }

  globalThis.__TEMPAD_README_SCREENSHOTS__ = {
    bounds(marker) {
      return screenBounds(findFixture(marker))
    },
    list() {
      return page
        .findAll((node) => node.getSharedPluginData(namespace, key) !== '')
        .map(describeFixture)
    },
    setCanvasTheme,
    stage,
    select(marker, { x = 392, y = 151, zoom = 1 } = {}) {
      return stage({ focus: marker, selection: [marker], x, y, zoom })
    }
  }

  return {
    page: { id: page.id, name: page.name },
    nodes: [code, deepOuter, deepInner, measureOuter, measureInner, button].map((node) => ({
      id: node.id,
      marker: node.getSharedPluginData(namespace, key),
      name: node.name,
      type: node.type
    }))
  }
})()
