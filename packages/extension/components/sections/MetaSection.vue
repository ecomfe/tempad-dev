<script setup lang="ts">
import Badge from '@/components/Badge.vue'
import Copyable from '@/components/Copyable.vue'
import IconButton from '@/components/IconButton.vue'
import Link from '@/components/icons/Link.vue'
import Select from '@/components/icons/Select.vue'
import Section from '@/components/Section.vue'
import { useDevResourceLinks } from '@/composables'
import { selection, selectedNode, selectedTemPadComponent } from '@/ui/state'

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

const devResourceLinks = useDevResourceLinks(selectedNode)

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
      <div class="tp-meta-title tp-row tp-shrink tp-gap-l" v-if="title != null">
        <Copyable
          class="tp-ellipsis"
          :data-tooltip="`Click to copy layer name: ${title}`"
          data-tooltip-type="text"
        >
          {{ title }}
        </Copyable>
        <Copyable variant="block" :data-copy="libName">
          <Badge v-if="libName" :title="libName">{{ libDisplayName || libName }}</Badge>
        </Copyable>
      </div>
      <span class="tp-meta-title-aux tp-ellipsis" v-else>No selection</span>
      <IconButton
        v-if="showFocusButton"
        title="Scroll into view"
        class="tp-meta-scroll"
        @click="scrollIntoView"
      >
        <Select />
      </IconButton>
    </template>
    <div v-if="devResourceLinks.length > 0" class="tp-meta-dev-links">
      <a
        class="tp-row tp-meta-dev-link"
        :href="link.url"
        target="_blank"
        v-for="link in devResourceLinks"
        :key="link.url"
      >
        <div class="tp-meta-dev-link-icon">
          <img class="tp-meta-dev-link-favicon" v-if="link.favicon" :src="link.favicon" />
          <Link class="tp-meta-dev-link-fallback-icon" v-else />
        </div>
        <span class="tp-meta-dev-link-label">{{ link.name }}</span>
      </a>
    </div>
  </Section>
</template>

<style scoped>
.tp-meta-title {
  font-family: var(--text-body-large-strong-font-family);
  font-size: var(--text-body-large-strong-font-size);
  font-weight: var(--text-body-large-strong-font-weight);
  letter-spacing: var(--text-body-large-strong-letter-spacing);
  line-height: var(--text-body-large-strong-line-height);
  color: var(--color-text);
}

.tp-meta-title-aux {
  color: var(--color-text-secondary);
}

.tp-meta-dev-links {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-bottom: 12px;
}

.tp-meta-dev-link {
  position: relative;
  font-family: var(--text-body-medium-font-family);
  font-size: var(--text-body-medium-font-size);
  font-weight: var(--text-body-medium-font-weight);
  letter-spacing: var(--text-body-medium-letter-spacing);
  line-height: var(--text-body-medium-line-height);
  height: 24px;
  gap: 4px;
  overflow-wrap: break-word;
  cursor: pointer;
}

.tp-meta-dev-link:hover::after {
  content: '';
  position: absolute;
  inset: 0 calc(var(--spacer-2, 0.5rem) * -1);
  background: var(--color-bghovertransparent);
  border-radius: var(--fpl-radius-left, var(--radius-medium))
    var(--fpl-radius-right, var(--radius-medium)) var(--fpl-radius-right, var(--radius-medium))
    var(--fpl-radius-left, var(--radius-medium));
}

.tp-meta-dev-link-label {
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tp-meta-dev-link-favicon {
  width: 16px;
  height: 16px;
  vertical-align: middle;
}

.tp-meta-dev-link-fallback-icon {
  margin-inline: -4px;
}
</style>
