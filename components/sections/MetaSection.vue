<script setup lang="ts">
import Badge from '@/components/Badge.vue'
import Copyable from '@/components/Copyable.vue'
import IconButton from '@/components/IconButton.vue'
import Select from '@/components/icons/Select.vue'
import Section from '@/components/Section.vue'
import { selection, selectedTemPadComponent } from '@/ui/state'

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

const showFocusButton = computed(
  () => window.figma && selection.value && selection.value.length > 0
)

const libDisplayName = computed(() => selectedTemPadComponent.value?.libDisplayName)

const libName = computed(() => selectedTemPadComponent.value?.libName)

function scrollIntoView() {
  // if we have window.figma, selection.value is certainly SceneNode[]
  window?.figma.viewport.scrollAndZoomIntoView((selection.value as SceneNode[]) || [])
}
</script>

<template>
  <Section flat>
    <template #header>
      <span class="tp-meta-title-aux tp-ellipsis" v-if="title == null">No selection</span>
      <div class="tp-row tp-shrink tp-gap-l" v-else>
        <Copyable class="tp-ellipsis">
          {{ title }}
        </Copyable>
        <Copyable variant="block" :data-copy="libName">
          <Badge v-if="libName" :title="libName">{{ libDisplayName || libName }}</Badge>
        </Copyable>
      </div>
      <IconButton
        v-if="showFocusButton"
        title="Scroll into view"
        class="tp-meta-scroll"
        @click="scrollIntoView"
      >
        <Select />
      </IconButton>
    </template>
  </Section>
</template>

<style scoped>
.tp-meta-title:not(:hover) .tp-meta-scroll {
  display: none;
}

.tp-meta-title-aux {
  color: var(--color-text-secondary);
}
</style>
