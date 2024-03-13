<script lang="ts" setup>
import { computed } from "vue";
import Section from "../Section.vue";
import { selection } from "@/entrypoints/ui/state";
import Copyable from "../Copyable.vue";
import IconButton from "../IconButton.vue";
import Select from "../icons/Select.vue";

const title = computed(() => {
  const nodes = selection.value;

  if (!nodes || nodes.length === 0) {
    return null;
  }

  if (nodes.length > 1) {
    return `${nodes.length} Selected`;
  }

  return nodes[0].name;
});

function scrollIntoView() {
  figma.viewport.scrollAndZoomIntoView(selection.value || []);
}
</script>

<template>
  <Section flat>
    <h1 class="tp-row tp-row-justify tp-meta-title">
      <span class="tp-meta-title-aux" v-if="title == null">No selection</span>
      <Copyable v-else>{{ title }}</Copyable>
      <IconButton
        v-if="selection && selection.length > 0"
        title="Scroll into view"
        class="tp-meta-scroll"
        @click="scrollIntoView"
      >
        <Select />
      </IconButton>
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
