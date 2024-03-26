<script lang="ts" setup>
import Panel from '@/components/Panel.vue'
import MetaSection from '@/components/sections/MetaSection.vue'
import CodeSection from '@/components/sections/CodeSection.vue'
import PrefSection from '@/components/sections/PrefSection.vue'
import IconButton from '@/components/IconButton.vue'
import Preferences from '@/components/icons/Preferences.vue'
import Minus from '@/components/icons/Minus.vue'
import Plus from '@/components/icons/Plus.vue'
import { useSelection } from './composables/selection'
import { useKeyLock } from './composables/key-lock'
import { options } from './state'
import { PANEL_WIDTH } from './const'

useSelection()
useKeyLock()

function toggleMinimized() {
  options.value.minimized = !options.value.minimized
}

const panelWidth = `${PANEL_WIDTH}px`
</script>

<template>
  <Panel class="tp-main" :class="{ 'tp-main-minimized': options.minimized }">
    <template #header>
      TemPad Dev
      <div class="tp-row">
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
