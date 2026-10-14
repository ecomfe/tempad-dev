import type { MaybeRefOrGetter } from 'vue'

import { computed, reactive, toValue, watchEffect } from 'vue'

import { bytesToBase64 } from '@/mcp/encoding'

const devResourcesCache = reactive(new WeakMap<SceneNode, DevResourceWithNodeId[]>())
const inflightDevResources = new WeakMap<SceneNode, Promise<void>>()

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
      await response.body?.cancel()
      return null
    }
    const { meta } = await response.json()
    return `data:image/png;base64,${bytesToBase64(new Uint8Array(meta))}`
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
    const resources = devResourcesCache.get(node) ?? []

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

    void refreshDevResourceLinks(node).catch(() => {
      // Preserve the last successful links; explicit refresh reports failures.
    })
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

export function refreshDevResourceLinks(node: SceneNode): Promise<void> {
  const pending = inflightDevResources.get(node)
  if (pending) return pending

  // Register before invoking the native API, including its synchronous failures.
  const request = Promise.resolve()
    .then(async () => {
      const resources = await node.getDevResourcesAsync()
      devResourcesCache.set(node, resources)
    })
    .finally(() => {
      inflightDevResources.delete(node)
    })
  inflightDevResources.set(node, request)
  return request
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
  if (node.type === 'COMPONENT_SET') return node.documentationLinks

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
