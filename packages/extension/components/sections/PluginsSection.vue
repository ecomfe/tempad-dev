<script setup lang="ts">
import IconButton from '@/components/IconButton.vue'
import Plus from '@/components/icons/Plus.vue'
import PluginInstaller from '@/components/PluginInstaller.vue'
import PluginItem from '@/components/PluginItem.vue'
import Section from '@/components/Section.vue'
import { options } from '@/ui/state'

const isImporterShown = shallowRef(false)
const installer = useTemplateRef('installer')

async function showImporter() {
  isImporterShown.value = true

  await nextTick()
  installer.value?.focus()
}

const installedPlugins = computed(() => Object.values(options.value.plugins || {}))

function handleInstalled({
  source,
  code,
  pluginName
}: {
  source: string
  code: string
  pluginName: string
}) {
  if (!options.value.plugins) {
    options.value.plugins = {}
  }

  options.value.plugins[source] = { name: pluginName, source, code }

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
      <IconButton variant="secondary" title="Install plugin">
        <Plus @click="showImporter" />
      </IconButton>
    </template>
    <div class="tp-plugins-list">
      <PluginInstaller
        ref="installer"
        class="tp-plugins-item"
        v-if="isImporterShown"
        @installed="handleInstalled"
        @cancel="isImporterShown = false"
      />
      <PluginItem
        v-for="{ name, source } in installedPlugins"
        :key="source"
        :checked="source === options.activePluginSource"
        :source="source"
        :name="name"
        @updated="handleInstalled"
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
