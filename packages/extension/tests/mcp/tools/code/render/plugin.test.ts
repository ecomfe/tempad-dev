import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => ({
  generateCodeBlocksForNode: vi.fn()
}))

vi.mock('@/utils/codegen', () => ({
  generateCodeBlocksForNode: mocked.generateCodeBlocksForNode
}))

import { renderPluginComponent, resolvePluginComponent } from '@/mcp/tools/code/render/plugin'

function createCodeBlock({
  lang = 'jsx',
  code = '<A />',
  name = 'component'
}: {
  lang?: string
  code?: string
  name?: string
} = {}) {
  return {
    name,
    title: name,
    code,
    lang
  }
}

function createConfig() {
  return {
    cssUnit: 'px',
    rootFontSize: 16,
    scale: 1
  } as const
}

describe('mcp/code render plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when plugin code is missing in render context', async () => {
    const result = await renderPluginComponent(
      {} as InstanceNode,
      {
        config: createConfig()
      } as never
    )

    expect(result).toBeNull()
    expect(mocked.generateCodeBlocksForNode).not.toHaveBeenCalled()
  })

  it('delegates render path to resolve using preferred language', async () => {
    const devComponent = { name: 'Comp', props: {}, children: [] }
    mocked.generateCodeBlocksForNode.mockResolvedValue({
      codeBlocks: [
        createCodeBlock({ lang: 'tsx', code: ' <Card /> ' }),
        createCodeBlock({ lang: 'vue', code: ' <template><Card /></template> ' })
      ],
      devComponent
    })

    const node = { id: 'n1' } as InstanceNode
    const config = createConfig()
    const result = await renderPluginComponent(node, {
      config,
      pluginCode: 'plugin()',
      preferredLang: 'vue'
    } as never)

    expect(mocked.generateCodeBlocksForNode).toHaveBeenCalledWith(node, config, 'plugin()', {
      returnDevComponent: true
    })
    expect(result).toEqual({
      component: devComponent,
      code: '<template><Card /></template>',
      lang: 'vue'
    })
  })

  it('detects vue first when preferred language is not provided', async () => {
    mocked.generateCodeBlocksForNode.mockResolvedValue({
      codeBlocks: [
        createCodeBlock({ lang: 'jsx', code: ' <X /> ' }),
        createCodeBlock({ lang: 'vue', code: ' <template><X /></template> ' })
      ],
      devComponent: undefined
    })

    const result = await resolvePluginComponent(
      {} as InstanceNode,
      createConfig(),
      'plugin-code',
      undefined
    )

    expect(result).toEqual({
      component: undefined,
      code: '<template><X /></template>',
      lang: 'vue'
    })
  })

  it('normalizes tsx and unknown language blocks to jsx', async () => {
    mocked.generateCodeBlocksForNode
      .mockResolvedValueOnce({
        codeBlocks: [createCodeBlock({ lang: 'tsx', code: ' <A /> ' })],
        devComponent: undefined
      })
      .mockResolvedValueOnce({
        codeBlocks: [createCodeBlock({ lang: 'svelte', code: ' <B /> ' })],
        devComponent: undefined
      })

    const tsxResult = await resolvePluginComponent({} as InstanceNode, createConfig(), 'plugin')
    const unknownResult = await resolvePluginComponent({} as InstanceNode, createConfig(), 'plugin')

    expect(tsxResult).toEqual({
      component: undefined,
      code: '<A />',
      lang: 'jsx'
    })
    expect(unknownResult).toEqual({
      component: undefined,
      code: '<B />',
      lang: 'jsx'
    })
  })

  it('returns component-only payload when preferred language block is absent', async () => {
    const devComponent = { name: 'OnlyComponent', props: {}, children: [] }
    mocked.generateCodeBlocksForNode.mockResolvedValue({
      codeBlocks: [createCodeBlock({ lang: 'vue', code: '<template />' })],
      devComponent
    })

    const result = await resolvePluginComponent(
      {} as InstanceNode,
      createConfig(),
      'plugin-code',
      'jsx'
    )

    expect(result).toEqual({
      component: devComponent,
      code: undefined,
      lang: 'jsx'
    })
  })

  it('keeps language undefined when component blocks have unknown language', async () => {
    const devComponent = { name: 'OnlyDevComponent', props: {}, children: [] }
    mocked.generateCodeBlocksForNode.mockResolvedValue({
      codeBlocks: [
        { name: 'component', title: 'component', code: '<Unknown />', lang: undefined },
        { name: 'styles', title: 'styles', code: '.x {}', lang: undefined }
      ],
      devComponent
    })

    const result = await resolvePluginComponent(
      {} as InstanceNode,
      createConfig(),
      'plugin-without-component-blocks'
    )

    expect(result).toEqual({
      component: devComponent,
      code: undefined,
      lang: undefined
    })
  })

  it('returns null when both component block and dev component are empty', async () => {
    mocked.generateCodeBlocksForNode.mockResolvedValue({
      codeBlocks: [createCodeBlock({ lang: 'jsx', code: '   ' })],
      devComponent: undefined
    })

    const result = await resolvePluginComponent({} as InstanceNode, createConfig(), 'plugin-code')

    expect(result).toBeNull()
  })
})
