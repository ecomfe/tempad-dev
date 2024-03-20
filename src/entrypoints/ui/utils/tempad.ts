type TemPadComponent = {
  code: string
  name?: string
  libName?: string
  libDisplayName?: string
  link: string
}

type TemPadSource = {
  name: string
  libName: string
}

const NS = 'tempad.baidu.com'
const LIB_DISPLAY_NAMES = {
  '@baidu/one-ui': 'ONE UI',
  '@baidu/one-ui-pro': 'ONE UI Pro',
  '@baidu/one-charts': 'ONE Charts',
  '@baidu/light-ai-react': 'Light AI',
  'dls-icons-react': 'DLS Icons',
  'dls-illustrations-react': 'DLS Illus.'
} as Record<string, string>

export function getTemPadComponent(node: SceneNode): TemPadComponent | null {
  if (node.type !== 'FRAME' || !node.name.startsWith('🧩')) {
    return null
  }

  const tempadData = JSON.parse(
    node.getSharedPluginData(NS, 'source') || 'null'
  ) as TemPadSource | null

  if (
    tempadData?.libName === '@baidu/one-ui' &&
    (tempadData?.name === 'Icon' || tempadData?.name === 'Illustration')
  ) {
    const tree = JSON.parse(node.getSharedPluginData(NS, 'tree') || 'null')
    try {
      const iconNode = tree.slots.default.children[0]
      tempadData.libName =
        tempadData.name === 'Illustration' ? 'dls-illustrations-react' : iconNode.props.libName.v
      tempadData.name = iconNode.props.name.v?.name || iconNode.props.name.v
    } catch (e) {
      console.error(e)
    }
  }

  const libDisplayName = tempadData?.libName ? LIB_DISPLAY_NAMES[tempadData.libName] : null

  const codeNode = node.findChild((n) => n.type === 'TEXT' && n.name === '代码') as TextNode
  const linkNode = node.findChild((n) => n.type === 'TEXT' && n.name === '🔗') as TextNode

  if (!codeNode || !linkNode) {
    return null
  }

  const code = extractJSX(codeNode.characters)
  const link = (linkNode.hyperlink as HyperlinkTarget).value

  return {
    code,
    link,
    name: node.name,
    ...tempadData,
    ...(libDisplayName ? { libDisplayName } : null)
  }
}

const COMPONENT_RE = /<>[\s\n]+<Stack[^>]*>[\s\n]+?(\s*)([\s\S]+?)[\s\n]+<\/Stack>[\s\n]+<\/>/
const COMPONENT_PROVIDER_RE =
  /<ProviderConfig[^>]*>[\s\n]+<Stack[^>]*>[\s\n]+?(\s*)([\s\S]+?)[\s\n]+<\/Stack>[\s\n]+<\/ProviderConfig>/
export function extractJSX(code: string) {
  const [, indent = '', jsx = ''] =
    code.match(COMPONENT_RE) || code.match(COMPONENT_PROVIDER_RE) || []
  return jsx
    .split('\n')
    .map((line) => line.replace(new RegExp(`^${indent}`), ''))
    .join('\n')
}
