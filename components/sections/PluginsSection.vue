<script setup lang="ts">
import type { Plugin } from '@/plugins/src/index'

import IconButton from '@/components/IconButton.vue'
import Plus from '@/components/icons/Plus.vue'
import PluginImporter from '@/components/PluginImporter.vue'
import PluginItem from '@/components/PluginItem.vue'
import Section from '@/components/Section.vue'
import { options } from '@/ui/state'

const isImporterShown = shallowRef(false)
const importer = useTemplateRef('importer')

async function showImporter() {
  isImporterShown.value = true

  await nextTick()
  importer.value?.focus()
}

const installedPlugins = computed(() => Object.values(options.value.plugins || {}))

function handleImported({
  source,
  code,
  plugin
}: {
  source: string
  code: string
  plugin: Plugin
}) {
  if (!options.value.plugins) {
    options.value.plugins = {}
  }

  options.value.plugins[source] = { name: plugin.name, source, code }

  if (!options.value.activePluginSource) {
    options.value.activePluginSource = source
  }

  isImporterShown.value = false
}

function handleActiveChange(source: string, checked: boolean) {
  if (checked) {
    options.value.activePluginSource = source
  } else if (options.value.activePluginSource === source) {
    options.value.activePluginSource = null
  }
}

function handleRemove(source: string) {
  delete options.value.plugins[source]

  if (options.value.activePluginSource === source) {
    options.value.activePluginSource = null
  }
}
</script>

<template>
  <Section flat class="tp-plugins">
    <template #header>
      <div class="tp-row">Plugins</div>
      <IconButton title="Install plugin">
        <Plus @click="showImporter" />
      </IconButton>
    </template>
    <div class="tp-plugins-list">
      <PluginImporter
        ref="importer"
        class="tp-plugins-item"
        v-if="isImporterShown"
        @imported="handleImported"
        @cancel="isImporterShown = false"
      />
      <PluginItem
        v-for="{ name, source } in installedPlugins"
        :key="source"
        :checked="source === options.activePluginSource"
        :source="source"
        :name="name"
        @change="handleActiveChange(source, $event)"
        @remove="handleRemove(source)"
        class="tp-plugin-item"
      />
    </div>
  </Section>
</template>

<style scoped>
.tp-plugins-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-right: -8px;
}

.tp-plugins-list:not(:empty) {
  margin-bottom: 8px;
}
</style>
