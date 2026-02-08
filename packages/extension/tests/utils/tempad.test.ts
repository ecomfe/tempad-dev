import { describe, expect, it, vi } from 'vitest'

import { logger } from '@/utils/log'
import { extractJSX, getTemPadComponent } from '@/utils/tempad'

type TextChild = {
  type: 'TEXT'
  name: string
  characters: string
  hyperlink?: unknown
}

function makeTextChild(name: string, characters: string, hyperlink?: unknown): TextChild {
  return {
    type: 'TEXT',
    name,
    characters,
    ...(hyperlink !== undefined ? { hyperlink } : {})
  }
}

function makeFrameNode(options?: {
  name?: string
  sharedData?: Record<string, string | undefined>
  children?: TextChild[]
}): SceneNode {
  const name = options?.name ?? '🧩 Card'
  const sharedData = options?.sharedData ?? {}
  const children = options?.children ?? []

  return {
    type: 'FRAME',
    name,
    getSharedPluginData: (_ns: string, key: string) => sharedData[key] ?? '',
    findChild: (predicate: (node: SceneNode) => boolean) =>
      children.find((child) => predicate(child as unknown as SceneNode)) ?? null
  } as unknown as SceneNode
}

function jsxStack(content: string): string {
  return `<>
<Stack>
  ${content}
</Stack>
</>`
}

describe('utils/tempad extractJSX', () => {
  it('extracts JSX from Stack wrapper and removes indent', () => {
    const code = jsxStack('<Button />\n  <Tag />')

    expect(extractJSX(code)).toBe('<Button />\n<Tag />')
  })

  it('extracts JSX from ProviderConfig wrapper', () => {
    const code = `<ProviderConfig>
<Stack>
  <Input />
</Stack>
</ProviderConfig>`

    expect(extractJSX(code)).toBe('<Input />')
  })

  it('returns empty string when no known wrapper matches', () => {
    expect(extractJSX('<div />')).toBe('')
  })
})

describe('utils/tempad getTemPadComponent', () => {
  it('returns null for non-TemPad nodes', () => {
    const node = { type: 'FRAME', name: 'Card' } as unknown as SceneNode

    expect(getTemPadComponent(node)).toBeNull()
  })

  it('returns null when no code is available', () => {
    const node = makeFrameNode({
      sharedData: {
        source: '{"name":"Button","libName":"@baidu/one-ui"}'
      }
    })

    expect(getTemPadComponent(node)).toBeNull()
  })

  it('falls back to null source payload when source data is missing', () => {
    const node = makeFrameNode({
      sharedData: {
        code: jsxStack('<NoSource />')
      }
    })

    expect(getTemPadComponent(node)).toEqual({
      code: '<NoSource />',
      link: null,
      name: '🧩 Card'
    })
  })

  it('uses plugin code/link and rewrites one-ui Icon metadata from tree payload', () => {
    const node = makeFrameNode({
      name: '🧩 Icon node',
      sharedData: {
        source: '{"name":"Icon","libName":"@baidu/one-ui"}',
        tree: JSON.stringify({
          slots: {
            default: {
              children: [
                {
                  props: {
                    libName: { v: 'dls-icons-react' },
                    name: { v: { name: 'Search' } }
                  }
                }
              ]
            }
          }
        }),
        code: jsxStack('<IconSearch />'),
        link: 'https://example.test/icon'
      }
    })

    expect(getTemPadComponent(node)).toEqual({
      code: '<IconSearch />',
      link: 'https://example.test/icon',
      name: 'Search',
      libName: 'dls-icons-react',
      libDisplayName: 'DLS Icons'
    })
  })

  it('keeps icon metadata when tree payload is missing', () => {
    const node = makeFrameNode({
      sharedData: {
        source: '{"name":"Icon","libName":"@baidu/one-ui"}',
        code: jsxStack('<IconFallback />')
      }
    })

    expect(getTemPadComponent(node)).toEqual({
      code: '<IconFallback />',
      link: null,
      name: 'Icon',
      libName: '@baidu/one-ui',
      libDisplayName: 'ONE UI'
    })
  })

  it('keeps icon metadata when tree has no default children', () => {
    const node = makeFrameNode({
      sharedData: {
        source: '{"name":"Icon","libName":"@baidu/one-ui"}',
        tree: '{"slots":{"default":{}}}',
        code: jsxStack('<IconNoChildren />')
      }
    })

    expect(getTemPadComponent(node)).toEqual({
      code: '<IconNoChildren />',
      link: null,
      name: 'Icon',
      libName: '@baidu/one-ui',
      libDisplayName: 'ONE UI'
    })
  })

  it('keeps icon metadata when tree child has no props', () => {
    const node = makeFrameNode({
      sharedData: {
        source: '{"name":"Icon","libName":"@baidu/one-ui"}',
        tree: '{"slots":{"default":{"children":[{}]}}}',
        code: jsxStack('<IconNoProps />')
      }
    })

    expect(getTemPadComponent(node)).toEqual({
      code: '<IconNoProps />',
      link: null,
      name: 'Icon',
      libName: '@baidu/one-ui',
      libDisplayName: 'ONE UI'
    })
  })

  it('updates icon library without overriding icon name when tree name is absent', () => {
    const node = makeFrameNode({
      sharedData: {
        source: '{"name":"Icon","libName":"@baidu/one-ui"}',
        tree: JSON.stringify({
          slots: {
            default: {
              children: [
                {
                  props: {
                    libName: { v: '@baidu/one-ui-pro' },
                    name: {}
                  }
                }
              ]
            }
          }
        }),
        code: jsxStack('<IconLibOnly />')
      }
    })

    expect(getTemPadComponent(node)).toEqual({
      code: '<IconLibOnly />',
      link: null,
      name: 'Icon',
      libName: '@baidu/one-ui-pro',
      libDisplayName: 'ONE UI Pro'
    })
  })

  it('updates icon name without overriding library when tree libName is absent', () => {
    const node = makeFrameNode({
      sharedData: {
        source: '{"name":"Icon","libName":"@baidu/one-ui"}',
        tree: JSON.stringify({
          slots: {
            default: {
              children: [
                {
                  props: {
                    name: { v: 'Home' }
                  }
                }
              ]
            }
          }
        }),
        code: jsxStack('<IconNameOnly />')
      }
    })

    expect(getTemPadComponent(node)).toEqual({
      code: '<IconNameOnly />',
      link: null,
      name: 'Home',
      libName: '@baidu/one-ui',
      libDisplayName: 'ONE UI'
    })
  })

  it('keeps icon metadata when tree props contain no usable icon fields', () => {
    const node = makeFrameNode({
      sharedData: {
        source: '{"name":"Icon","libName":"@baidu/one-ui"}',
        tree: '{"slots":{"default":{"children":[{"props":{}}]}}}',
        code: jsxStack('<IconNoMeta />')
      }
    })

    expect(getTemPadComponent(node)).toEqual({
      code: '<IconNoMeta />',
      link: null,
      name: 'Icon',
      libName: '@baidu/one-ui',
      libDisplayName: 'ONE UI'
    })
  })

  it('uses text fallback for code/link and rewrites Illustration library', () => {
    const node = makeFrameNode({
      name: '🧩 Illustration node',
      sharedData: {
        source: '{"name":"Illustration","libName":"@baidu/one-ui"}',
        tree: JSON.stringify({
          slots: {
            default: {
              children: [
                {
                  props: {
                    name: { v: 'Robot' }
                  }
                }
              ]
            }
          }
        })
      },
      children: [
        makeTextChild('代码', jsxStack('<Robot />')),
        makeTextChild('🔗', '', { value: 'https://example.test/robot' })
      ]
    })

    expect(getTemPadComponent(node)).toEqual({
      code: '<Robot />',
      link: 'https://example.test/robot',
      name: 'Robot',
      libName: 'dls-illustrations-react',
      libDisplayName: 'DLS Illus.'
    })
  })

  it('rewrites Tem.RichText source and keeps null link for invalid hyperlink payload', () => {
    const node = makeFrameNode({
      sharedData: {
        source: '{"name":"Tem.RichText"}',
        code: jsxStack('<Typography />')
      },
      children: [makeTextChild('🔗', '', { value: 1 })]
    })

    expect(getTemPadComponent(node)).toEqual({
      code: '<Typography />',
      link: null,
      name: 'Typography',
      libName: '@baidu/light-ai-react',
      libDisplayName: 'Light AI'
    })
  })

  it('tolerates malformed source JSON and still returns parsed code', () => {
    const node = makeFrameNode({
      sharedData: {
        source: '{not-json',
        code: jsxStack('<Plain />')
      }
    })

    expect(getTemPadComponent(node)).toEqual({
      code: '<Plain />',
      link: null,
      name: '🧩 Card'
    })
  })

  it('logs and continues when icon metadata parsing throws', () => {
    const node = makeFrameNode({
      sharedData: {
        source: '{"name":"Icon","libName":"@baidu/one-ui"}',
        tree: '{"ok":true}',
        code: jsxStack('<Safe />')
      }
    })

    const originalParse = JSON.parse
    vi.spyOn(JSON, 'parse').mockImplementation((value: string) => {
      if (value === '{"ok":true}') {
        return {
          get slots() {
            throw new Error('broken tree accessor')
          }
        }
      }
      return originalParse(value)
    })
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined)

    expect(getTemPadComponent(node)).toEqual({
      code: '<Safe />',
      link: null,
      name: 'Icon',
      libName: '@baidu/one-ui',
      libDisplayName: 'ONE UI'
    })
    expect(errorSpy).toHaveBeenCalledOnce()
    expect(errorSpy.mock.calls[0]?.[0]).toBeInstanceOf(Error)
  })

  it('drops non-string source fields from parsed data', () => {
    const node = makeFrameNode({
      sharedData: {
        source: '{"name":1,"libName":2}',
        code: jsxStack('<NoMeta />')
      }
    })

    expect(getTemPadComponent(node)).toEqual({
      code: '<NoMeta />',
      link: null,
      name: '🧩 Card'
    })
  })
})
