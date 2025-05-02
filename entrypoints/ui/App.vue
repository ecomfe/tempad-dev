<script setup lang="ts">
import IconButton from '@/components/IconButton.vue'
import Info from '@/components/icons/Info.vue'
import Minus from '@/components/icons/Minus.vue'
import Plus from '@/components/icons/Plus.vue'
import Preferences from '@/components/icons/Preferences.vue'
import Panel from '@/components/Panel.vue'
import CodeSection from '@/components/sections/CodeSection.vue'
import ErrorSection from '@/components/sections/ErrorSection.vue'
import MetaSection from '@/components/sections/MetaSection.vue'
import PrefSection from '@/components/sections/PrefSection.vue'
import Toast from '@/components/Toast.vue'
import { useKeyLock, useSelection } from '@/composables'
import { ui } from '@/ui/figma'
import { options, runtimeMode } from '@/ui/state'
import { showDuplicateItem } from '@/utils'

useSelection()
useKeyLock()

function toggleMinimized() {
  options.value.minimized = !options.value.minimized
}

const panelWidth = `${ui.tempadPanelWidth}px`
</script>

<template>
  <Panel class="tp-main" :class="{ 'tp-main-minimized': options.minimized }">
    <template #header>
      <div class="tp-row">
        TemPad Dev
        <IconButton
          v-if="runtimeMode === 'quirks'"
          variant="secondary"
          title="TemPad Dev is running in quirks mode. Enter standard mode by duplicating this file to your drafts."
          dull
          @click="showDuplicateItem"
        >
          <Info />
        </IconButton>
      </div>
      <div class="tp-row tp-gap">
        <IconButton
          v-if="runtimeMode !== 'unavailable' && !options.minimized"
          title="Preferences"
          toggle
          v-model:selected="options.prefOpen"
          @dblclick.stop
        >
          <Preferences class="tp-panel-header-icon" />
        </IconButton>
        <IconButton @click="toggleMinimized">
          <Plus v-if="options.minimized" />
          <Minus v-else />
        </IconButton>
      </div>
    </template>
    <ErrorSection v-if="runtimeMode === 'unavailable'" />
    <template v-else>
      <PrefSection :collapsed="!options.prefOpen" />
      <MetaSection />
      <CodeSection />
    </template>
  </Panel>
  <Toast />
</template>

<style scoped>
.tp-main {
  width: v-bind(panelWidth);
  transition: width, height;
  transition-duration: 0.2s;
  transition-timing-function: cubic-bezier(0.87, 0, 0.13, 1);
  overflow: hidden;
}

.tp-main-minimized {
  height: 41px;
  border-bottom-width: 0;
}
</style>
