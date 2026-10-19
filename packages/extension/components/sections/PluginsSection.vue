<script setup lang="ts">
import type { PluginData } from '@/composables'

import Button from '@/components/Button.vue'
import IconButton from '@/components/IconButton.vue'
import Plus from '@/components/icons/Plus.vue'
import PluginInstaller from '@/components/PluginInstaller.vue'
import PluginItem from '@/components/PluginItem.vue'
import Section from '@/components/Section.vue'
import { useToast } from '@/composables'
import { CorruptPluginStorageError } from '@/ui/plugin-storage'
import { options, plugins, pluginStorageCorrupted, resetPlugins, savePlugin } from '@/ui/state'

const { show } = useToast()

const isImporterShown = shallowRef(false)
const resetting = shallowRef(false)
const installer = useTemplateRef('installer')

async function showImporter() {
  isImporterShown.value = true

  await nextTick()
  installer.value?.focus()
}

const installedPlugins = computed(() => Object.values(plugins.value))

async function handleInstalled(
  { source, code, integrity, resolvedUrl, pluginName }: PluginData,
  isUpdate = false
) {
  try {
    await savePlugin(source, {
      name: pluginName,
      source,
      code,
      integrity,
      resolvedUrl
    })
  } catch (error) {
    show(
      error instanceof CorruptPluginStorageError
        ? 'Stored plugin data is invalid. Reset plugins to continue.'
        : 'Could not save plugin. Browser storage may be full or unavailable.'
    )
    return
  }

  if (!options.value.activePluginSource) {
    options.value.activePluginSource = source
  }

  isImporterShown.value = false
  show(`Plugin "${pluginName}" ${isUpdate ? 'updated' : 'installed'} successfully.`)
}

function handleActiveChange(source: string, checked: boolean) {
  if (checked) {
    options.value.activePluginSource = source
  } else if (options.value.activePluginSource === source) {
    options.value.activePluginSource = null
  }
}

async function handleRemove(source: string) {
  try {
    await savePlugin(source, null)
  } catch (error) {
    show(
      error instanceof CorruptPluginStorageError
        ? 'Stored plugin data is invalid. Reset plugins to continue.'
        : 'Could not save plugin removal. Browser storage may be full or unavailable.'
    )
    return
  }

  if (options.value.activePluginSource === source) {
    options.value.activePluginSource = null
  }
}

async function handleReset() {
  if (resetting.value) return
  resetting.value = true
  try {
    await resetPlugins()
  } catch {
    show('Could not reset plugins. Browser storage may be full or unavailable.')
  } finally {
    resetting.value = false
  }
}
</script>

<template>
  <Section flat class="tp-plugins">
    <template #header>
      <button
        v-if="!installedPlugins.length"
        type="button"
        class="tp-plugins-add"
        data-tooltip="Install plugin"
        data-tooltip-type="text"
        @click="showImporter"
      >
        <span>Plugins</span>
        <Plus />
      </button>
      <template v-else>
        <div class="tp-row">Plugins</div>
        <IconButton
          variant="secondary"
          class="tp-plugins-add-button"
          title="Install plugin"
          @click="showImporter"
        >
          <Plus />
        </IconButton>
      </template>
    </template>
    <div class="tp-plugins-list">
      <div v-if="pluginStorageCorrupted" class="tp-plugins-recovery">
        <p role="alert">
          Stored plugin data is invalid. Resetting removes installed code-output plugins.
        </p>
        <Button class="tp-plugins-reset" :disabled="resetting" @click="handleReset">
          Reset plugins
        </Button>
      </div>
      <PluginInstaller
        ref="installer"
        class="tp-plugins-item"
        v-if="isImporterShown"
        @installed="handleInstalled"
        @cancel="isImporterShown = false"
      />
      <PluginItem
        v-for="{ integrity, name, resolvedUrl, source } in installedPlugins"
        :key="source"
        :checked="source === options.activePluginSource"
        :source="source"
        :integrity="integrity"
        :resolved-url="resolvedUrl"
        :name="name"
        @updated="handleInstalled($event, true)"
        @change="handleActiveChange(source, $event)"
        @remove="handleRemove(source)"
        class="tp-plugin-item"
      />
    </div>
  </Section>
</template>

<style scoped>
.tp-plugins-add {
  --icon-button-icon: var(--color-icon-secondary);
  align-self: stretch;
  flex: 1;
  justify-content: space-between;
  margin-right: calc(-1 * var(--spacer-2));
  margin-left: calc(-1 * var(--spacer-3));
  padding-right: var(--spacer-2);
  padding-left: var(--spacer-3);
  color: var(--color-text-secondary);
  cursor: pointer;
}

.tp-plugins-add:hover {
  --icon-button-icon: var(--color-icon-hover);
  color: var(--color-text-secondary-hover);
}

.tp-plugins-add:focus-visible {
  outline: 1px solid var(--color-border-selected);
  outline-offset: -1px;
}

.tp-plugins-add .tp-icon {
  width: var(--spacer-4);
  height: var(--spacer-4);
  color: var(--icon-button-icon);
}

.tp-plugins-add-button {
  --icon-button-icon: var(--color-icon-hover);
}

.tp-plugins-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-right: -8px;
}

.tp-plugins-list:not(:empty) {
  margin-bottom: 8px;
}

.tp-plugins-recovery {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--spacer-2);
  margin-right: 8px;
  color: var(--color-text-secondary);
}

.tp-plugins-recovery p {
  margin: 0;
}
</style>
