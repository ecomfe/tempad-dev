<script lang="ts" setup>
import Panel from '@/components/Panel.vue'
import MetaSection from '@/components/sections/MetaSection.vue'
import CodeSection from '@/components/sections/CodeSection.vue'
import PrefSection from '@/components/sections/PrefSection.vue'
import Toast from '@/components/Toast.vue'
import IconButton from '@/components/IconButton.vue'
import Info from '@/components/icons/Info.vue'
import Preferences from '@/components/icons/Preferences.vue'
import Minus from '@/components/icons/Minus.vue'
import Plus from '@/components/icons/Plus.vue'
import { useSelection } from './composables/selection'
import { useKeyLock } from './composables/key-lock'
import { options, isQuirksMode } from './state'
import { ui } from './figma'
import { showDuplicateItem } from './utils'

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
          v-if="isQuirksMode"
          variant="secondary"
          title="TemPad Dev is running in quirks mode. Enter normal mode by duplicate this file to your drafts."
          dull
          @click="showDuplicateItem"
        >
          <Info />
        </IconButton>
      </div>
      <div class="tp-row tp-gap">
        <IconButton
          v-if="!options.minimized"
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
    <PrefSection :collapsed="!options.prefOpen" />
    <MetaSection />
    <CodeSection />
  </Panel>
  <Toast />
</template>

<style scoped>
.tp-main {
  width: v-bind(panelWidth);
  transition: width, height;
  transition-duration: 0.2s;
  transition-timing-function: cubic-bezier(0.87, 0, 0.13, 1);
}

.tp-main-minimized {
  height: 41px;
  border-bottom-width: 0;
}
</style>
