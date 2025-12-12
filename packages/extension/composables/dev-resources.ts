const devResourcesCache = reactive<Map<string, DevResourceWithNodeId[]>>(new Map())
const inflightDevResources = new Map<string, Promise<void>>()

const faviconCache = reactive<Map<string, string | null>>(new Map())
const inflightFavicons = new Map<string, Promise<void>>()

const FAVICON_PROXY_ENDPOINT = 'https://www.figma.com/api/favicon_for_url_proxy?url='

export type DevResourceLink = {
  name: string
  url: string
  favicon: string | null
  inherited: boolean
}

async function getFavicon(url: string) {
  try {
    const response = await fetch(FAVICON_PROXY_ENDPOINT + encodeURIComponent(url))
    if (!response.ok) {
      return null
    }
    const { meta } = await response.json()
    return bytesToDataURL(new Uint8Array(meta))
  } catch {
    return null
  }
}

export function useDevResourceLinks(nodeSource: MaybeRefOrGetter<SceneNode | null | undefined>) {
  const nodeRef = computed(() => toValue(nodeSource) ?? null)

  const links = computed<DevResourceLink[]>(() => {
    const node = nodeRef.value
    if (!node) {
      return []
    }

    const documentationLinks = getDocumentationLinks(node)
    const resources = devResourcesCache.get(node.id) ?? []

    const docLinks = documentationLinks.map(({ uri }) => toLink('Documentation', uri))
    const resourceLinks = [...resources]
      .sort((a, b) => Number(Boolean(b.inheritedNodeId)) - Number(Boolean(a.inheritedNodeId)))
      .map(({ name, url, inheritedNodeId }) => toLink(name, url, inheritedNodeId != null))

    return [...docLinks, ...resourceLinks]
  })

  watchEffect(() => {
    const node = nodeRef.value
    if (!node) {
      return
    }

    ensureDevResources(node)
  })

  watchEffect(() => {
    const node = nodeRef.value
    if (!node) {
      return
    }

    for (const { url } of links.value) {
      if (url && !faviconCache.has(url)) {
        ensureFavicon(url)
      }
    }
  })

  return links
}

function ensureDevResources(node: SceneNode) {
  if (inflightDevResources.has(node.id)) {
    return
  }

  async function request() {
    try {
      const resources = await node.getDevResourcesAsync()
      devResourcesCache.set(node.id, resources)
    } catch (e: unknown) {
      if (typeof e === 'string' && e.includes('status 403')) {
        devResourcesCache.set(node.id, [])
      }
    } finally {
      inflightDevResources.delete(node.id)
    }
  }

  inflightDevResources.set(node.id, request())
}

function ensureFavicon(url: string) {
  if (faviconCache.has(url) || inflightFavicons.has(url)) {
    return
  }

  async function request() {
    try {
      const favicon = await getFavicon(url)
      faviconCache.set(url, favicon)
    } finally {
      inflightFavicons.delete(url)
    }
  }

  inflightFavicons.set(url, request())
}

function bytesToDataURL(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return `data:image/png;base64,${btoa(binary)}`
}

function toLink(name: string, url: string, inherited: boolean = false): DevResourceLink {
  return {
    name,
    url,
    favicon: url ? (faviconCache.get(url) ?? null) : null,
    inherited
  }
}

function getDocumentationLinks(node: SceneNode): readonly DocumentationLink[] {
  if (node.type !== 'INSTANCE' && node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') {
    return []
  }

  let currentNode = node

  if (currentNode.type === 'INSTANCE' && currentNode.mainComponent) {
    currentNode = currentNode.mainComponent
  }

  if (currentNode.type === 'COMPONENT') {
    if (currentNode.documentationLinks.length > 0) {
      return currentNode.documentationLinks
    } else if (currentNode.parent && currentNode.parent.type === 'COMPONENT_SET') {
      return currentNode.parent.documentationLinks
    }
  }

  return []
}
