import SNAPSHOT_PLUGINS from '@/plugins/available-plugins.json'
import { codegen } from '@/utils'

import { useToast } from './toast'

const REGISTERED_SOURCE_RE = /@[a-z\d_-]+/

// plugin registry from the latest commit of the main branch
const REGISTRY_URL =
  'https://raw.githubusercontent.com/ecomfe/tempad-dev/refs/heads/main/packages/extension/plugins/available-plugins.json'

async function getRegisteredPluginSource(source: string, signal?: AbortSignal) {
  const name = source.slice(1)
  let pluginList = null

  try {
    pluginList = (await fetch(REGISTRY_URL, { cache: 'no-cache', signal }).then((res) =>
      res.json()
    )) as {
      name: string
      url: string
    }[]
  } catch {
    pluginList = SNAPSHOT_PLUGINS
  }

  const plugins = Object.fromEntries(pluginList.map(({ name, url }) => [name, url]))

  if (!plugins[name]) {
    throw new Error(`"${name}" is not a registered plugin.`)
  }

  return plugins[name]
}

export type PluginData = {
  code: string
  pluginName: string
  source: string // can be a URL or a registered plugin name like `@{plugin-name}`
}

export function usePluginInstall() {
  const { show } = useToast()

  const validity = shallowRef('')

  const installing = shallowRef(false)
  let controller: AbortController | null = null

  function cancel() {
    controller?.abort()
    installing.value = false
  }

  async function install(src: string, isUpdate = false) {
    let installed: PluginData | null = null

    if (installing.value) {
      return null
    }

    controller?.abort()
    controller = new AbortController()
    const { signal } = controller
    let code: string | null = null

    installing.value = true

    try {
      const url = REGISTERED_SOURCE_RE.test(src)
        ? await getRegisteredPluginSource(src, signal)
        : src
      const response = await fetch(url, { cache: 'no-cache', signal })
      if (response.status !== 200) {
        throw new Error('404: Not Found')
      }
      code = await response.text()

      try {
        const { pluginName } = await codegen(
          {},
          null,
          { useRem: false, rootFontSize: 12, scale: 1 },
          code
        )
        if (!pluginName) {
          validity.value = 'The plugin name must not be empty.'
        } else {
          validity.value = ''
          show(`Plugin "${pluginName}" ${isUpdate ? 'updated' : 'installed'} successfully.`)
          installed = { code, pluginName, source: src }
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Unknown error'
        validity.value = `Failed to evaluate the code: ${message}`
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Network error'
      validity.value = `Failed to fetch the script content: ${message}`
    }

    controller = null
    installing.value = false

    return installed
  }

  return {
    validity,
    installing,
    cancel,
    install
  }
}
