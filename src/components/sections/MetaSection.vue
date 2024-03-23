<script lang="ts" setup>
import { computed } from 'vue'
import Section from '../Section.vue'
import { selection, selectedTemPadComponent } from '@/entrypoints/ui/state'
import Copyable from '../Copyable.vue'
import IconButton from '../IconButton.vue'
import Select from '../icons/Select.vue'
import Badge from '../Badge.vue'
import Plus from '../icons/Plus.vue'
import Minus from '../icons/Minus.vue'

import { useGlobalState } from '@/entrypoints/ui/state'

const { scaleInputs, addScaleInput, removeScaleInput } = useGlobalState()

const title = computed(() => {
  const nodes = selection.value

  if (!nodes || nodes.length === 0) {
    return null
  }

  if (nodes.length > 1) {
    return `${nodes.length} Selected`
  }

  const component = selectedTemPadComponent.value
  if (component) {
    return component.name
  }

  return nodes[0].name
})

const libDisplayName = computed(() => selectedTemPadComponent.value?.libDisplayName)

const libName = computed(() => selectedTemPadComponent.value?.libName)

function scrollIntoView() {
  figma.viewport.scrollAndZoomIntoView(selection.value || [])
}
</script>

<template>
  <Section flat>
    <h1 class="tp-row tp-row-justify tp-gap-l tp-meta-title">
      <span class="tp-meta-title-aux tp-ellipsis" v-if="title == null">No selection</span>
      <div class="tp-row tp-shrink tp-gap-l" v-else>
        <Copyable class="tp-ellipsis">
          {{ title }}
        </Copyable>
        <Copyable variant="block" :data-copy="libName">
          <Badge v-if="libName" :title="libName">{{ libDisplayName || libName }}</Badge>
        </Copyable>
      </div>
      <div class="tp-row tp-row-justify" v-if="selection && selection.length > 0">
        <IconButton title="Scroll into view" class="tp-meta-scroll" @click="scrollIntoView">
          <Select />
        </IconButton>
        <div class="tp-row tp-row-justify">
          <IconButton @click="removeScaleInput" v-if="scaleInputs.length">
            <Minus />
          </IconButton>
          <IconButton @click="addScaleInput">
            <Plus />
          </IconButton>
        </div>
      </div>
    </h1>
  </Section>
</template>

<style scoped>
.tp-meta-title {
  min-height: 40px;
  font-weight: 600;
  font-size: 11px;
  line-height: 16px;
  letter-spacing: calc(0.005px + var(--text-tracking-pos, 0) * 11px);
}

.tp-meta-title:not(:hover) .tp-meta-scroll {
  display: none;
}

.tp-meta-title-aux {
  color: var(--color-text-secondary);
}
</style>
